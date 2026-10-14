import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { hmacSha256 } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import {
  interests,
  loginAttempts,
  privacySettings,
  userContacts,
  userInterests,
  userPreferences,
  users,
} from '../../database/schema';
import { isRealDate } from '../age-policy/age';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { AuditService } from '../audit/audit.service';
import { DeliveryService } from '../delivery/delivery.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { StepUpScope } from './auth.decorators';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyCodeDto } from './dto';
import { classifyIdentifier, normalizeEmail, normalizePhone, normalizeUsername, usernameProblem } from './identifiers';
import { PasswordService } from './password.service';
import { SessionService, TokenPair } from './session.service';
import { StepUpService } from './step-up.service';
import { Challenge, HIDE_CHANNEL_SCOPE, VerificationService } from './verification.service';

const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_IDENTIFIER = 5;
const MAX_FAILS_PER_IP = 30;
/** Un compte jamais vérifié libère son nom d'utilisateur et ses coordonnées après ce délai. */
const PENDING_ACCOUNT_TTL_MS = 24 * 3600_000;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly passwords: PasswordService,
    private readonly verification: VerificationService,
    private readonly sessions: SessionService,
    private readonly stepUp: StepUpService,
    private readonly usersService: UsersService,
    private readonly agePolicy: AgePolicyService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly delivery: DeliveryService,
  ) {}

  // ---------------------------------------------------------------- Inscription

  async usernameAvailability(raw: string) {
    const username = normalizeUsername(raw);
    const problem = usernameProblem(username);
    if (problem) return { username, available: false, reason: problem };
    const taken = await this.db.select({ id: users.id, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.username, username)).limit(1);
    const t = taken[0];
    const free = !t || (t.status === 'pending_verification' && t.createdAt.getTime() < Date.now() - PENDING_ACCOUNT_TTL_MS);
    return { username, available: free, reason: free ? null : 'taken' };
  }

  async register(dto: RegisterDto, meta: RequestMeta): Promise<{ userId: string; verification: Challenge }> {
    const fields: Record<string, string[]> = {};
    const add = (f: string, m: string) => (fields[f] ??= []).push(m);

    const fullName = dto.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) add('fullName', 'Indique ton nom et ton prénom.');
    const username = normalizeUsername(dto.username);
    const uProblem = usernameProblem(username);
    if (uProblem === 'format') add('username', "3 à 30 caractères : lettres minuscules, chiffres, point ou tiret bas.");
    if (uProblem === 'reserved') add('username', "Ce nom d'utilisateur est réservé.");
    const city = dto.city.trim();
    if (city.length < 2) add('city', 'Indique ta ville ou ta commune.');
    if (!isRealDate(dto.birthDate) || dto.birthDate < '1900-01-01' || new Date(`${dto.birthDate}T00:00:00Z`) > new Date()) {
      add('birthDate', 'Date de naissance invalide.');
    }
    const phone = dto.phone?.trim() ? normalizePhone(dto.phone, this.cfg.DEFAULT_PHONE_REGION) : null;
    if (dto.phone?.trim() && !phone) add('phone', 'Numéro de téléphone invalide.');
    const email = dto.email?.trim() ? normalizeEmail(dto.email) : null;
    if (dto.email?.trim() && !email) add('email', 'Adresse e-mail invalide.');
    if (!dto.phone?.trim() && !dto.email?.trim()) add('phone', 'Indique un numéro de téléphone ou une adresse e-mail pour pouvoir récupérer ton compte.');
    const weak = this.passwords.weakness(dto.password, { username });
    if (weak) add('password', weak);

    const minInterests = (await this.settings.get<number>('auth.registration_min_interests'))?.value ?? 3;
    const codes = [...new Set(dto.interests)];
    if (codes.length < minInterests) add('interests', `Choisis au moins ${minInterests} thèmes.`);
    else {
      const known = await this.db.select({ code: interests.code }).from(interests).where(and(inArray(interests.code, codes), eq(interests.active, true)));
      if (known.length !== codes.length) add('interests', 'Certains thèmes sont inconnus.');
    }
    if (Object.keys(fields).length) throw Errors.validation({ fields });

    // F15 : âge minimum d'inscription (réglage age.min_registration).
    await this.agePolicy.assert('registration', dto.birthDate);

    // F16 : le téléphone est privilégié pour la vérification, sinon l'e-mail.
    const preferred = await this.usersService.preferredChannel();
    const channel: 'phone' | 'email' = (preferred === 'phone' && phone) || !email ? 'phone' : 'email';
    const destination = (channel === 'phone' ? phone : email)!;
    if (!this.delivery.isAvailable(channel)) throw Errors.notConfigured(channel === 'phone' ? "L'envoi de SMS" : "L'envoi d'e-mails");

    const passwordHash = await this.passwords.hash(dto.password);
    const userId = uuidv7();

    try {
      const challenge = await this.db.transaction(async (tx) => {
        const existing = await tx.select({ id: users.id, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.username, username)).for('update').limit(1);
        if (existing[0]) {
          const stale = existing[0].status === 'pending_verification' && existing[0].createdAt.getTime() < Date.now() - PENDING_ACCOUNT_TTL_MS;
          if (!stale) throw Errors.conflict('USERNAME_TAKEN', "Ce nom d'utilisateur est déjà pris.");
          await tx.delete(users).where(eq(users.id, existing[0].id));
        }
        for (const [type, value] of [['phone', phone], ['email', email]] as const) {
          if (!value) continue;
          const taken = await tx.select({ id: userContacts.id }).from(userContacts).where(and(eq(userContacts.type, type), eq(userContacts.value, value), isNotNull(userContacts.verifiedAt))).limit(1);
          if (taken[0]) {
            throw Errors.conflict('CONTACT_TAKEN', type === 'phone' ? 'Ce numéro est déjà utilisé par un compte BIM.' : 'Cette adresse e-mail est déjà utilisée par un compte BIM.');
          }
        }
        await tx.insert(users).values({ id: userId, fullName, username, birthDate: dto.birthDate, gender: dto.gender ?? null, city, passwordHash, passwordChangedAt: new Date() });
        if (phone) await tx.insert(userContacts).values({ id: uuidv7(), userId, type: 'phone', value: phone });
        if (email) await tx.insert(userContacts).values({ id: uuidv7(), userId, type: 'email', value: email });
        await tx.insert(userInterests).values(codes.map((code) => ({ userId, interestCode: code })));
        await tx.insert(privacySettings).values({ userId });
        await tx.insert(userPreferences).values({ userId });
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'user.registered', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { channel, hasPhone: !!phone, hasEmail: !!email } }, tx);
        return this.verification.createDeferred({ purpose: 'signup', channel, destination, userId, ip: meta.ip }, tx);
      });
      // Envoi après validation de la transaction : aucun verrou retenu pendant l'appel au fournisseur SMS.
      await challenge.deliver();
      return { userId, verification: challenge.challenge };
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('USERNAME_TAKEN', "Ce nom d'utilisateur est déjà pris.");
      throw err;
    }
  }

  /** Active le compte quand le code reçu par SMS ou e-mail est confirmé, puis ouvre une session. */
  async verifySignup(dto: VerifyCodeDto, meta: RequestMeta): Promise<TokenPair & { userId: string }> {
    const row = await this.verification.consume(dto.challengeId, dto.code, 'signup');
    const userId = row.userId!;
    try {
      return await this.db.transaction(async (tx) => {
        const user = await this.usersService.findById(userId, tx);
        if (!user || user.status === 'deleted') throw Errors.notFound('Compte');
        await tx
          .update(userContacts)
          .set({ verifiedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(userContacts.userId, userId), eq(userContacts.type, row.channel), eq(userContacts.value, row.destination), isNull(userContacts.verifiedAt)));
        if (user.status === 'pending_verification') {
          await tx.update(users).set({ status: 'active', updatedAt: new Date(), lastLoginAt: new Date() }).where(eq(users.id, userId));
        }
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'user.contact_verified', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { channel: row.channel, purpose: 'signup' } }, tx);
        const pair = await this.sessions.open(userId, { ip: meta.ip, userAgent: meta.userAgent, deviceName: dto.deviceName }, tx);
        return { ...pair, userId };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('CONTACT_TAKEN', 'Cette coordonnée vient d’être vérifiée par un autre compte.');
      throw err;
    }
  }

  resendCode(challengeId: string): Promise<Challenge> {
    return this.verification.resend(challengeId, ['signup', 'password_reset', 'contact_add', 'step_up']);
  }

  // ---------------------------------------------------------------- Connexion

  async login(dto: LoginDto, meta: RequestMeta): Promise<TokenPair & { userId: string }> {
    const identifier = classifyIdentifier(dto.identifier, this.cfg.DEFAULT_PHONE_REGION);
    const user = identifier ? await this.findUserForLogin(identifier) : null;
    // Les essais sont comptés par COMPTE (quel que soit l'identifiant utilisé : @nom, téléphone, e-mail),
    // ou par identifiant brut si aucun compte ne correspond. Empreinte HMAC : non réversible sans le secret serveur.
    const identifierHash = this.attemptKey(user ? `user:${user.id}` : `raw:${identifier?.value ?? dto.identifier.trim().toLowerCase()}`);
    await this.assertLoginNotThrottled(identifierHash, meta.ip);

    const ok = await this.passwords.verify(user?.passwordHash ?? null, dto.password);
    await this.db.insert(loginAttempts).values({ id: uuidv7(), identifierHash, ip: meta.ip, success: ok && !!user });

    if (!user || !ok) {
      if (user) await this.audit.log({ actorType: 'user', actorId: user.id, action: 'auth.login_failed', targetType: 'user', targetId: user.id, ip: meta.ip, userAgent: meta.userAgent });
      throw new AppError('INVALID_CREDENTIALS', 'Identifiant ou mot de passe incorrect.', HttpStatus.UNAUTHORIZED);
    }
    if (user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'Ce compte est suspendu. Contacte le support BIM.', HttpStatus.FORBIDDEN);
    if (user.status === 'pending_verification') {
      // On réutilise le code déjà envoyé s'il est encore valable : pas de nouveau SMS à chaque tentative.
      const verification = (await this.verification.findOpenForUser(user.id, 'signup')) ?? (await this.newSignupChallenge(user.id, meta));
      throw new AppError('CONTACT_NOT_VERIFIED', 'Confirme d’abord ton numéro ou ton e-mail avec le code reçu.', HttpStatus.FORBIDDEN, { verification });
    }
    const pair = await this.db.transaction(async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.log({ actorType: 'user', actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { via: identifier!.kind } }, tx);
      return this.sessions.open(user.id, { ip: meta.ip, userAgent: meta.userAgent, deviceName: dto.deviceName }, tx);
    });
    return { ...pair, userId: user.id };
  }

  refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    return this.sessions.refresh(refreshToken, { ip: meta.ip, userAgent: meta.userAgent });
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeFamilyOf(sessionId, 'logout', tx);
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'auth.logout', targetType: 'session', targetId: sessionId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
  }

  // ---------------------------------------------------------------- Mot de passe oublié

  /**
   * Réponse identique que le compte existe ou non : même forme, même canal annoncé (le canal n'est jamais révélé
   * pour un @nom d'utilisateur), même cycle de vie au renvoi, et l'envoi réel ne retarde pas la réponse.
   */
  async forgotPassword(dto: ForgotPasswordDto, meta: RequestMeta) {
    const identifier = classifyIdentifier(dto.identifier, this.cfg.DEFAULT_PHONE_REGION);
    const user = identifier ? await this.findUserForLogin(identifier) : null;
    const message = 'Si un compte correspond, un code de réinitialisation vient d’être envoyé.';
    const byUsername = !identifier || identifier.kind === 'username';
    const visibility = { revealDestination: false, revealChannel: !byUsername };
    const scope = byUsername ? HIDE_CHANNEL_SCOPE : undefined;
    const announcedChannel: 'phone' | 'email' = identifier?.kind === 'email' ? 'email' : 'phone';

    const contacts = user && user.status === 'active' ? await this.usersService.verifiedContacts(user.id) : [];
    const matching = identifier && identifier.kind !== 'username' ? contacts.find((c) => c.type === identifier.kind && c.value === identifier.value) : undefined;
    const target = matching ?? (user && user.status === 'active' ? await this.usersService.recoveryContact(user.id) : null);
    if (!user || !target) {
      return { ...(await this.verification.createDecoy(announcedChannel, meta.ip, visibility, scope ?? null)), message };
    }
    const { challenge, deliver } = await this.verification.createDeferred(
      { purpose: 'password_reset', channel: target.type, destination: target.value, userId: user.id, scope, ip: meta.ip },
      this.db,
      visibility,
    );
    void deliver().catch((err: unknown) => this.logger.error(`Envoi du code de réinitialisation impossible : ${(err as Error).message}`));
    await this.audit.log({ actorType: 'user', actorId: user.id, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { channel: target.type } });
    return { ...challenge, message };
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<void> {
    // Contrôle de robustesse SANS lien avec le compte : il ne doit rien révéler sur le titulaire du défi.
    const weak = this.passwords.weakness(dto.newPassword);
    if (weak) throw Errors.validation({ fields: { newPassword: [weak] } });

    const row = await this.verification.consume(dto.challengeId, dto.code, 'password_reset');
    const userId = row.userId!;
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.db.transaction(async (tx) => {
      // Verrou exclusif sur le compte : un rafraîchissement de session concurrent attend, puis voit la révocation.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.update(users).set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      await this.sessions.revokeAllForUser(userId, 'password_reset', tx);
      await this.stepUp.revokeAllForUser(userId, tx);
      await this.verification.invalidateAllForUser(userId, tx);
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'auth.password_reset', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    await this.delivery.sendSecurityAlert(row.channel, row.destination, 'BIM : ton mot de passe vient d’être modifié. Si ce n’est pas toi, contacte immédiatement le support.');
  }

  // ---------------------------------------------------------------- Opérations sensibles (F16)

  async startStepUp(userId: string, scope: StepUpScope, password: string | undefined, meta: RequestMeta): Promise<Challenge> {
    const user = await this.usersService.findById(userId);
    this.usersService.assertActive(user);
    if (user.passwordHash) {
      const identifierHash = this.attemptKey(`stepup:${userId}`);
      await this.assertLoginNotThrottled(identifierHash, meta.ip);
      const ok = await this.passwords.verify(user.passwordHash, password ?? '');
      await this.db.insert(loginAttempts).values({ id: uuidv7(), identifierHash, ip: meta.ip, success: ok });
      if (!ok) {
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'auth.step_up_failed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { scope } });
        throw new AppError('INVALID_CREDENTIALS', 'Mot de passe incorrect.', HttpStatus.UNAUTHORIZED);
      }
    }
    const contact = await this.usersService.recoveryContact(userId);
    if (!contact) throw new AppError('NO_RECOVERY_CONTACT', 'Aucune coordonnée vérifiée sur ce compte.', HttpStatus.CONFLICT);
    return this.verification.create({ purpose: 'step_up', channel: contact.type, destination: contact.value, userId, scope, ip: meta.ip });
  }

  async completeStepUp(userId: string, sessionId: string, dto: VerifyCodeDto, meta: RequestMeta) {
    const row = await this.verification.consume(dto.challengeId, dto.code, 'step_up');
    if (row.userId !== userId || !row.scope) throw Errors.forbidden();
    const grant = await this.stepUp.grant(userId, sessionId, row.scope as StepUpScope);
    await this.audit.log({ actorType: 'user', actorId: userId, action: 'auth.step_up_granted', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { scope: row.scope } });
    return grant;
  }

  // ---------------------------------------------------------------- Interne

  private async newSignupChallenge(userId: string, meta: RequestMeta): Promise<Challenge> {
    const contacts = await this.db.select().from(userContacts).where(and(eq(userContacts.userId, userId), isNull(userContacts.verifiedAt)));
    const preferred = await this.usersService.preferredChannel();
    const target = contacts.find((c) => c.type === preferred) ?? contacts[0];
    if (!target) throw new AppError('NO_RECOVERY_CONTACT', 'Aucune coordonnée à vérifier sur ce compte.', HttpStatus.CONFLICT);
    return this.verification.create({ purpose: 'signup', channel: target.type, destination: target.value, userId, ip: meta.ip });
  }

  private async findUserForLogin(identifier: { kind: 'email' | 'phone' | 'username'; value: string }) {
    if (identifier.kind === 'username') {
      const rows = await this.db.select().from(users).where(eq(users.username, identifier.value)).limit(1);
      return rows[0] && rows[0].status !== 'deleted' ? rows[0] : null;
    }
    const verified = await this.db
      .select({ user: users })
      .from(userContacts)
      .innerJoin(users, eq(users.id, userContacts.userId))
      .where(and(eq(userContacts.type, identifier.kind), eq(userContacts.value, identifier.value), isNotNull(userContacts.verifiedAt)))
      .limit(1);
    if (verified[0]) return verified[0].user.status !== 'deleted' ? verified[0].user : null;
    // Compte en attente de vérification : seule sa propre coordonnée non vérifiée permet de reprendre l'inscription.
    const pending = await this.db
      .select({ user: users })
      .from(userContacts)
      .innerJoin(users, eq(users.id, userContacts.userId))
      .where(and(eq(userContacts.type, identifier.kind), eq(userContacts.value, identifier.value), eq(users.status, 'pending_verification'), gt(users.createdAt, new Date(Date.now() - PENDING_ACCOUNT_TTL_MS))))
      .orderBy(desc(users.createdAt))
      .limit(1);
    return pending[0]?.user ?? null;
  }

  private attemptKey(key: string): string {
    return hmacSha256(this.cfg.OTP_SECRET, `login-attempt:${key}`);
  }

  private async assertLoginNotThrottled(identifierHash: string, ip: string | null): Promise<void> {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS);
    const [byId] = await this.db
      .select({ n: count() })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.identifierHash, identifierHash), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    if (byId.n >= MAX_FAILS_PER_IDENTIFIER) throw Errors.tooMany('Trop d’essais pour ce compte. Réessaie dans 15 minutes ou réinitialise ton mot de passe.');
    if (ip) {
      const [byIp] = await this.db
        .select({ n: count() })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
      if (byIp.n >= MAX_FAILS_PER_IP) throw Errors.tooMany();
    }
  }

  /** Purge des anciennes tentatives (appelée par une tâche planifiée au lot 2). */
  async purgeOldAttempts(): Promise<void> {
    await this.db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(Date.now() - 30 * 86_400_000)));
  }
}
