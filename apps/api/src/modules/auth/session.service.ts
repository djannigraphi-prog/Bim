import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { pushDevices, sessions, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';

export type SpaceType = 'user' | 'merchant' | 'courier';

export interface ActiveSpace {
  type: SpaceType;
  id: string;
}

/** Contenu du jeton d'accès (JWT, 15 min par défaut). */
export interface AccessClaims {
  sub: string;
  sid: string;
  space: ActiveSpace;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  activeSpace: ActiveSpace;
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  deviceName?: string | null;
}

/**
 * Sessions : jeton d'accès court (JWT signé) + jeton de rafraîchissement opaque, stocké haché, qui change à chaque usage.
 * Si un ancien jeton de rafraîchissement est présenté à nouveau (vol probable), toute la famille de sessions est révoquée.
 * L'app mobile doit sérialiser les rafraîchissements (un seul à la fois) : voir apps/mobile/lib/core/network/auth_interceptor.dart.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async open(userId: string, client: ClientInfo, tx: DbOrTx = this.db): Promise<TokenPair> {
    const id = uuidv7();
    const refreshToken = randomToken(32);
    const expiresAt = this.refreshExpiry();
    await tx.insert(sessions).values({
      id,
      userId,
      familyId: id,
      refreshTokenHash: sha256(refreshToken),
      deviceName: client.deviceName ?? null,
      userAgent: client.userAgent,
      ip: client.ip,
      expiresAt,
    });
    return this.pair(userId, id, refreshToken, expiresAt, { type: 'user', id: userId });
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const hash = sha256(refreshToken);
    const located = await this.db.select({ userId: sessions.userId }).from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
    if (!located[0]) throw this.invalid('invalid');
    const userId = located[0].userId;

    const result = await this.db.transaction(async (tx) => {
      // Verrou partagé sur le compte AVANT de relire la session : une réinitialisation de mot de passe ou une
      // révocation (verrou exclusif sur ce même compte) est soit entièrement vue, soit entièrement attendue.
      const owner = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).for('share').limit(1);
      if (owner[0]?.status !== 'active') return { error: 'revoked' as const };
      const rows = await tx.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).for('update').limit(1);
      const current = rows[0];
      if (!current) return { error: 'invalid' as const };
      if (current.revokedAt) return { error: 'revoked' as const };
      if (current.rotatedAt) {
        // Réutilisation d'un jeton déjà échangé : on coupe toute la famille.
        await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' }).where(and(eq(sessions.familyId, current.familyId), isNull(sessions.revokedAt)));
        await tx.delete(pushDevices).where(eq(pushDevices.sessionFamilyId, current.familyId));
        await this.audit.log({ actorType: 'system', action: 'session.refresh_reuse_detected', targetType: 'user', targetId: current.userId, ip: client.ip, userAgent: client.userAgent, metadata: { familyId: current.familyId } }, tx);
        return { error: 'reuse' as const };
      }
      if (current.expiresAt <= new Date()) return { error: 'expired' as const };

      const id = uuidv7();
      const newToken = randomToken(32);
      const expiresAt = this.refreshExpiry();
      await tx.update(sessions).set({ rotatedAt: new Date(), lastUsedAt: new Date() }).where(eq(sessions.id, current.id));
      await tx.insert(sessions).values({
        id,
        userId: current.userId,
        familyId: current.familyId,
        refreshTokenHash: sha256(newToken),
        deviceName: current.deviceName,
        userAgent: client.userAgent ?? current.userAgent,
        ip: client.ip,
        expiresAt,
      });
      return { pair: { userId: current.userId, id, newToken, expiresAt } };
    });
    if ('error' in result) throw this.invalid(result.error!);
    const p = result.pair!;
    // Le rafraîchissement remet l'espace « utilisateur » : l'app redemande l'espace voulu, revérifié par le serveur.
    return this.pair(p.userId, p.id, p.newToken, p.expiresAt, { type: 'user', id: p.userId });
  }

  private invalid(reason: string): AppError {
    return new AppError('SESSION_INVALID', 'Ta session a expiré. Reconnecte-toi.', HttpStatus.UNAUTHORIZED, { reason });
  }

  /** Nouveau jeton d'accès pour la même session, avec un autre espace actif (déjà autorisé par l'appelant). */
  accessFor(userId: string, sessionId: string, space: ActiveSpace): { accessToken: string; accessTokenExpiresAt: string } {
    const claims: AccessClaims = { sub: userId, sid: sessionId, space };
    return {
      accessToken: this.jwt.sign(claims, { expiresIn: this.cfg.JWT_ACCESS_TTL_SECONDS }),
      accessTokenExpiresAt: new Date(Date.now() + this.cfg.JWT_ACCESS_TTL_SECONDS * 1000).toISOString(),
    };
  }

  verifyAccess(token: string): AccessClaims | null {
    try {
      return this.jwt.verify<AccessClaims>(token);
    } catch {
      return null;
    }
  }

  /** Vrai si la session référencée par un jeton d'accès est toujours valable (révocation immédiate). */
  async isAlive(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return rows.length === 1;
  }

  async revokeFamilyOf(sessionId: string, reason: string, tx: DbOrTx = this.db): Promise<void> {
    const rows = await tx.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!rows[0]) return;
    await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(sessions.familyId, rows[0].familyId), isNull(sessions.revokedAt)));
    // L'appareil déconnecté ne reçoit plus de notifications (lot 2).
    await tx.delete(pushDevices).where(eq(pushDevices.sessionFamilyId, rows[0].familyId));
  }

  /**
   * Révoque toutes les sessions d'un compte en une seule requête (sauf, éventuellement, la famille de la session
   * en cours). L'appelant doit avoir verrouillé la ligne du compte (FOR UPDATE) dans la même transaction.
   */
  async revokeAllForUser(userId: string, reason: string, tx: DbOrTx = this.db, exceptFamilyOfSession?: string): Promise<void> {
    let keepFamily: string | null = null;
    if (exceptFamilyOfSession) {
      const r = await tx.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.id, exceptFamilyOfSession)).limit(1);
      keepFamily = r[0]?.familyId ?? null;
    }
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), keepFamily ? ne(sessions.familyId, keepFamily) : undefined));
    await tx.delete(pushDevices).where(and(eq(pushDevices.userId, userId), keepFamily ? ne(pushDevices.sessionFamilyId, keepFamily) : undefined));
  }

  /** Une ligne par appareil connecté (dernière rotation de chaque famille encore valable). */
  async listActive(userId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), isNull(sessions.rotatedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
    }));
  }

  async findOwned(userId: string, sessionId: string) {
    const rows = await this.db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId))).limit(1);
    return rows[0] ?? null;
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  private pair(userId: string, sessionId: string, refreshToken: string, refreshExpiresAt: Date, space: ActiveSpace): TokenPair {
    const access = this.accessFor(userId, sessionId, space);
    return { ...access, refreshToken, refreshTokenExpiresAt: refreshExpiresAt.toISOString(), activeSpace: space };
  }
}
