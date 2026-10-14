import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { userContacts, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { DeliveryService } from '../delivery/delivery.service';
import { SpacesService } from '../spaces/spaces.service';
import { ContactRow, UsersService } from '../users/users.service';
import { AddContactDto, VerifyCodeDto } from './dto';
import { normalizeEmail, normalizePhone } from './identifiers';
import { PasswordService } from './password.service';
import { ActiveSpace, SessionService } from './session.service';
import { StepUpService } from './step-up.service';
import { VerificationService } from './verification.service';

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Sécurité du compte de la personne connectée : coordonnées de récupération, mot de passe, sessions, espaces.
 * Toute modification de coordonnées ou de mot de passe exige une autorisation step-up (vérifiée par la garde)
 * et déclenche une alerte sur les coordonnées déjà vérifiées.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly usersService: UsersService,
    private readonly verification: VerificationService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly spaces: SpacesService,
    private readonly stepUp: StepUpService,
    private readonly audit: AuditService,
    private readonly delivery: DeliveryService,
  ) {}

  /** Étape 1 (après step-up « contact_change ») : enregistre la nouvelle coordonnée et y envoie un code. */
  async addContact(userId: string, dto: AddContactDto, meta: RequestMeta) {
    const value = dto.type === 'phone' ? normalizePhone(dto.value, this.cfg.DEFAULT_PHONE_REGION) : normalizeEmail(dto.value);
    if (!value) throw Errors.validation({ fields: { value: [dto.type === 'phone' ? 'Numéro de téléphone invalide.' : 'Adresse e-mail invalide.'] } });
    const takenElsewhere = await this.db
      .select({ userId: userContacts.userId })
      .from(userContacts)
      .where(and(eq(userContacts.type, dto.type), eq(userContacts.value, value), isNotNull(userContacts.verifiedAt)))
      .limit(1);
    if (takenElsewhere[0]) {
      if (takenElsewhere[0].userId === userId) throw Errors.conflict('CONTACT_ALREADY_VERIFIED', 'Cette coordonnée est déjà vérifiée sur ton compte.');
      throw Errors.conflict('CONTACT_TAKEN', 'Cette coordonnée est déjà utilisée par un compte BIM.');
    }
    await this.db.insert(userContacts).values({ id: uuidv7(), userId, type: dto.type, value }).onConflictDoNothing();
    const challenge = await this.verification.create({ purpose: 'contact_add', channel: dto.type, destination: value, userId, ip: meta.ip });
    await this.audit.log({ actorType: 'user', actorId: userId, action: 'account.contact_add_requested', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { type: dto.type } });
    return challenge;
  }

  /** Étape 2 : le code reçu sur la nouvelle coordonnée la rend vérifiée ; les autres coordonnées sont alertées. */
  async verifyContact(userId: string, dto: VerifyCodeDto, meta: RequestMeta) {
    const row = await this.verification.consume(dto.challengeId, dto.code, 'contact_add');
    if (row.userId !== userId) throw Errors.forbidden();
    const previous = await this.usersService.verifiedContacts(userId);
    try {
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(userContacts)
          .set({ verifiedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(userContacts.userId, userId), eq(userContacts.type, row.channel), eq(userContacts.value, row.destination)))
          .returning({ id: userContacts.id });
        if (updated.length !== 1) throw Errors.notFound('Coordonnée');
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'account.contact_verified', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { type: row.channel } }, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('CONTACT_TAKEN', 'Cette coordonnée vient d’être vérifiée par un autre compte.');
      throw err;
    }
    for (const c of previous) {
      await this.delivery.sendSecurityAlert(c.type, c.value, 'BIM : une nouvelle coordonnée vient d’être ajoutée à ton compte. Si ce n’est pas toi, contacte immédiatement le support.');
    }
    return this.usersService.me(userId);
  }

  /**
   * F16 : impossible de retirer la dernière coordonnée vérifiée (le compte deviendrait irrécupérable).
   * Le compte est verrouillé pendant le contrôle : deux suppressions simultanées sont traitées l'une après l'autre.
   * La base le garantit aussi (déclencheur différé, migration 0003).
   */
  async removeContact(userId: string, contactId: string, meta: RequestMeta) {
    let remaining: ContactRow[] = [];
    let removedType: 'phone' | 'email' = 'phone';
    try {
      await this.db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
        const all = await tx.select().from(userContacts).where(eq(userContacts.userId, userId));
        const target = all.find((c) => c.id === contactId);
        if (!target) throw Errors.notFound('Coordonnée');
        const verified = all.filter((c) => c.verifiedAt);
        if (target.verifiedAt && verified.length <= 1) throw this.lastContact();
        await tx.delete(userContacts).where(and(eq(userContacts.id, contactId), eq(userContacts.userId, userId)));
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'account.contact_removed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { type: target.type } }, tx);
        remaining = verified.filter((c) => c.id !== contactId);
        removedType = target.type;
      });
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } })?.cause?.code === '23514' || (err as { code?: string }).code === '23514') throw this.lastContact();
      throw err;
    }
    for (const c of remaining) {
      await this.delivery.sendSecurityAlert(c.type, c.value, `BIM : ${removedType === 'phone' ? 'un numéro' : 'une adresse e-mail'} a été retiré(e) de ton compte. Si ce n’est pas toi, contacte immédiatement le support.`);
    }
    return this.usersService.me(userId);
  }

  private lastContact(): AppError {
    return new AppError('LAST_RECOVERY_CONTACT', 'Ajoute et vérifie une autre coordonnée avant de retirer celle-ci.', HttpStatus.CONFLICT);
  }

  /** Changement de mot de passe (après step-up « password_change ») : les autres appareils sont déconnectés. */
  async changePassword(userId: string, sessionId: string, newPassword: string, meta: RequestMeta) {
    const user = await this.usersService.findById(userId);
    this.usersService.assertActive(user);
    const weak = this.passwords.weakness(newPassword, { username: user.username });
    if (weak) throw Errors.validation({ fields: { newPassword: [weak] } });
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      await this.sessions.revokeAllForUser(userId, 'password_changed', tx, sessionId);
      await this.stepUp.revokeAllForUser(userId, tx);
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'account.password_changed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    for (const c of await this.usersService.verifiedContacts(userId)) {
      await this.delivery.sendSecurityAlert(c.type, c.value, 'BIM : ton mot de passe vient d’être modifié. Si ce n’est pas toi, contacte immédiatement le support.');
    }
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestMeta) {
    const s = await this.sessions.findOwned(userId, sessionId);
    if (!s) throw Errors.notFound('Session');
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeFamilyOf(sessionId, 'user_revoked', tx);
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'auth.session_revoked', targetType: 'session', targetId: sessionId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
  }

  /** Changement d'espace (écran 53) : autorisé seulement si le serveur confirme l'appartenance. */
  async switchSpace(userId: string, sessionId: string, space: ActiveSpace, meta: RequestMeta) {
    if (!(await this.spaces.canUse(userId, space))) throw Errors.forbidden("Cet espace n'est pas accessible avec ton compte.");
    await this.audit.log({ actorType: 'user', actorId: userId, action: 'auth.space_switched', targetType: space.type, targetId: space.id, ip: meta.ip, userAgent: meta.userAgent });
    return { ...this.sessions.accessFor(userId, sessionId, space), activeSpace: space };
  }
}
