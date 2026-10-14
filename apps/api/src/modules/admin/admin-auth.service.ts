import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from '../../common/totp';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { adminLoginChallenges, adminSessions, adminUserRoles, adminUsers } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AdminContext } from './admin.decorators';
import { permissionsFor } from './permissions';

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;

/** Horloge remplaçable dans les tests (codes TOTP calculés à un instant donné). */
export const ADMIN_CLOCK = Symbol('ADMIN_CLOCK');
export interface AdminClock {
  now(): number;
}

/**
 * Connexion des administrateurs en deux temps :
 *  1. e-mail + mot de passe → jeton d'étape (5 min) ;
 *  2. code TOTP (ou enrôlement du premier appareil, puis code) → session d'administration.
 * Aucun accès sans TOTP. Verrouillage temporaire après plusieurs échecs. Tout est journalisé.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(ADMIN_CLOCK) private readonly clock: AdminClock,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  private invalidCredentials(): AppError {
    return new AppError('INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect.', HttpStatus.UNAUTHORIZED);
  }

  async login(email: string, password: string, meta: RequestMeta) {
    const normalized = email.trim().toLowerCase();
    const [admin] = await this.db.select().from(adminUsers).where(eq(adminUsers.email, normalized)).limit(1);
    const now = this.clock.now();
    if (admin?.lockedUntil && admin.lockedUntil.getTime() > now) {
      await this.passwords.verify(null, password); // même durée de réponse
      throw Errors.tooMany('Compte temporairement verrouillé après plusieurs échecs. Réessaie plus tard.');
    }
    const ok = await this.passwords.verify(admin?.passwordHash ?? null, password);
    if (!admin || !ok || admin.status !== 'active') {
      if (admin) {
        const failures = admin.failedLoginCount + 1;
        const lock = failures >= this.cfg.ADMIN_LOGIN_MAX_FAILURES;
        await this.db
          .update(adminUsers)
          .set({ failedLoginCount: lock ? 0 : failures, lockedUntil: lock ? new Date(now + this.cfg.ADMIN_LOCK_MINUTES * 60_000) : admin.lockedUntil })
          .where(eq(adminUsers.id, admin.id));
        await this.audit.log({ actorType: 'admin', actorId: admin.id, action: lock ? 'admin.locked' : 'admin.login_failed', ip: meta.ip, userAgent: meta.userAgent });
      }
      throw this.invalidCredentials();
    }
    const token = randomToken();
    const enrolled = !!admin.totpEnabledAt && !!admin.totpSecretEncrypted;
    await this.db.insert(adminLoginChallenges).values({
      id: uuidv7(),
      adminId: admin.id,
      tokenHash: sha256(token),
      pendingTotpSecretEncrypted: enrolled ? null : encryptSecret(newTotpSecret(), this.cfg.ADMIN_TOTP_ENCRYPTION_KEY),
      expiresAt: new Date(now + CHALLENGE_TTL_MS),
    });
    return { loginToken: token, next: enrolled ? ('totp' as const) : ('totp_enrollment' as const) };
  }

  private async challenge(loginToken: string) {
    const [c] = await this.db
      .select()
      .from(adminLoginChallenges)
      .where(and(eq(adminLoginChallenges.tokenHash, sha256(loginToken ?? '')), isNull(adminLoginChallenges.consumedAt)))
      .limit(1);
    if (!c || c.expiresAt.getTime() <= this.clock.now() || c.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      throw new AppError('LOGIN_EXPIRED', 'Étape de connexion expirée. Recommence avec ton e-mail et ton mot de passe.', HttpStatus.UNAUTHORIZED);
    }
    const [admin] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, c.adminId)).limit(1);
    if (!admin || admin.status !== 'active') throw this.invalidCredentials();
    return { c, admin };
  }

  /** Premier appareil : secret à scanner (QR code) ; il ne devient actif qu'après un premier code valide. */
  async enrollment(loginToken: string) {
    const { c, admin } = await this.challenge(loginToken);
    if (!c.pendingTotpSecretEncrypted) throw Errors.conflict('TOTP_ALREADY_ENROLLED', 'La double authentification est déjà configurée.');
    const secret = decryptSecret(c.pendingTotpSecretEncrypted, this.cfg.ADMIN_TOTP_ENCRYPTION_KEY);
    return { secret, otpauthUri: otpauthUri(secret, admin.email) };
  }

  async verify(loginToken: string, code: string, meta: RequestMeta) {
    const { c, admin } = await this.challenge(loginToken);
    const enrolling = !!c.pendingTotpSecretEncrypted;
    const encrypted = enrolling ? c.pendingTotpSecretEncrypted! : admin.totpSecretEncrypted;
    if (!encrypted) throw this.invalidCredentials();
    const secret = decryptSecret(encrypted, this.cfg.ADMIN_TOTP_ENCRYPTION_KEY);
    const step = verifyTotp(secret, code, this.clock.now(), enrolling ? null : admin.totpLastStep);
    if (step === null) {
      await this.db.update(adminLoginChallenges).set({ attempts: sql`${adminLoginChallenges.attempts} + 1` }).where(eq(adminLoginChallenges.id, c.id));
      await this.audit.log({ actorType: 'admin', actorId: admin.id, action: 'admin.totp_failed', ip: meta.ip, userAgent: meta.userAgent });
      throw new AppError('INVALID_CODE', 'Code incorrect ou expiré.', HttpStatus.UNAUTHORIZED);
    }
    const token = randomToken();
    const sessionId = uuidv7();
    const expiresAt = new Date(this.clock.now() + this.cfg.ADMIN_SESSION_TTL_MINUTES * 60_000);
    await this.db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(adminLoginChallenges)
        .set({ consumedAt: new Date() })
        .where(and(eq(adminLoginChallenges.id, c.id), isNull(adminLoginChallenges.consumedAt)))
        .returning({ id: adminLoginChallenges.id });
      if (!consumed) throw new AppError('LOGIN_EXPIRED', 'Étape de connexion déjà utilisée.', HttpStatus.UNAUTHORIZED);
      // Le pas TOTP ne peut servir qu'une fois, même en cas de deux connexions simultanées.
      const [updated] = await tx
        .update(adminUsers)
        .set({
          totpLastStep: step,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          ...(enrolling ? { totpSecretEncrypted: encrypted, totpEnabledAt: new Date() } : {}),
        })
        .where(and(eq(adminUsers.id, admin.id), sql`coalesce(${adminUsers.totpLastStep}, -1) < ${step}`))
        .returning({ id: adminUsers.id });
      if (!updated) throw new AppError('INVALID_CODE', 'Ce code a déjà été utilisé. Attends le suivant.', HttpStatus.UNAUTHORIZED);
      await tx.insert(adminSessions).values({ id: sessionId, adminId: admin.id, tokenHash: sha256(token), ip: meta.ip, userAgent: meta.userAgent, expiresAt });
      await this.audit.log(
        { actorType: 'admin', actorId: admin.id, action: enrolling ? 'admin.totp_enrolled' : 'admin.login', targetType: 'admin_session', targetId: sessionId, ip: meta.ip, userAgent: meta.userAgent },
        tx,
      );
    });
    return { accessToken: token, expiresAt: expiresAt.toISOString(), admin: await this.profile(admin.id) };
  }

  async authenticate(token: string): Promise<AdminContext | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({ sessionId: adminSessions.id, adminId: adminUsers.id, email: adminUsers.email, status: adminUsers.status, totp: adminUsers.totpEnabledAt })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
      .where(and(eq(adminSessions.tokenHash, sha256(token)), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date(this.clock.now()))))
      .limit(1);
    if (!row || row.status !== 'active' || !row.totp) return null;
    const roles = await this.db.select({ code: adminUserRoles.roleCode }).from(adminUserRoles).where(eq(adminUserRoles.adminId, row.adminId));
    return { adminId: row.adminId, sessionId: row.sessionId, email: row.email, roles: roles.map((r) => r.code) };
  }

  async profile(adminId: string) {
    const [a] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
    const roles = (await this.db.select({ code: adminUserRoles.roleCode }).from(adminUserRoles).where(eq(adminUserRoles.adminId, adminId))).map((r) => r.code);
    return { id: a.id, email: a.email, fullName: a.fullName, roles, permissions: permissionsFor(roles), lastLoginAt: a.lastLoginAt };
  }

  async logout(ctx: AdminContext, meta: RequestMeta) {
    await this.db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, ctx.sessionId));
    await this.audit.log({ actorType: 'admin', actorId: ctx.adminId, action: 'admin.logout', targetType: 'admin_session', targetId: ctx.sessionId, ip: meta.ip, userAgent: meta.userAgent });
  }
}
