import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, sql, sum } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { hmacSha256, numericCode, safeEqualHex } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { verificationCodes } from '../../database/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { maskDestination } from './identifiers';

export type Purpose = 'signup' | 'password_reset' | 'contact_add' | 'step_up';

export interface Challenge {
  challengeId: string;
  /** Absent quand le révéler permettrait de deviner l'existence d'un compte (mot de passe oublié par @nom d'utilisateur). */
  channel?: 'phone' | 'email';
  /** Coordonnée masquée ; absente pour « mot de passe oublié ». */
  destination?: string;
  expiresAt: string;
  resendAvailableAt: string;
}

export interface CreateParams {
  purpose: Purpose;
  channel: 'phone' | 'email';
  destination: string;
  userId: string | null;
  scope?: string;
  ip?: string | null;
}

export interface Visibility {
  revealDestination?: boolean;
  revealChannel?: boolean;
}

const MAX_SENDS_PER_CHALLENGE = 5;
/** Portée posée sur un défi « mot de passe oublié » demandé par @nom d'utilisateur : le canal ne doit jamais être révélé. */
export const HIDE_CHANNEL_SCOPE = 'hide_channel';

/**
 * Codes à usage unique envoyés par SMS ou e-mail.
 * Sécurité : code de 6 chiffres haché (HMAC-SHA256 + secret serveur), durée de vie courte, essais limités ET cumulés
 * entre renvois, un seul défi ouvert par compte et par usage, plafond d'envois par destinataire et par heure
 * (contre le bombardement de SMS et la force brute), renvoi atomique, consommation atomique.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger('Verification');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly delivery: DeliveryService,
  ) {}

  private hashCode(challengeId: string, code: string): string {
    return hmacSha256(this.cfg.OTP_SECRET, `${challengeId}:${code}`);
  }

  /** Crée un défi et envoie le code immédiatement. */
  async create(params: CreateParams, tx: DbOrTx = this.db, visibility: Visibility = {}): Promise<Challenge> {
    const { challenge, deliver } = await this.createDeferred(params, tx, visibility);
    await deliver();
    return challenge;
  }

  /**
   * Crée un défi sans envoyer le code : l'appelant envoie APRÈS la validation de sa transaction
   * (aucun verrou ni connexion retenu pendant l'appel au fournisseur SMS).
   */
  async createDeferred(
    params: CreateParams,
    tx: DbOrTx = this.db,
    visibility: Visibility = {},
  ): Promise<{ challenge: Challenge; deliver: () => Promise<void> }> {
    if (!this.delivery.isAvailable(params.channel)) {
      throw Errors.notConfigured(params.channel === 'phone' ? "L'envoi de SMS" : "L'envoi d'e-mails");
    }
    await this.assertDestinationQuota(params.destination, tx);
    if (params.userId) {
      // Un seul défi ouvert par compte et par usage : les précédents deviennent inutilisables.
      await tx
        .update(verificationCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(verificationCodes.userId, params.userId), eq(verificationCodes.purpose, params.purpose), isNull(verificationCodes.consumedAt)));
    }
    const id = uuidv7();
    const code = numericCode(6);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.cfg.OTP_TTL_SECONDS * 1000);
    await tx.insert(verificationCodes).values({
      id,
      userId: params.userId,
      purpose: params.purpose,
      channel: params.channel,
      destination: params.destination,
      scope: params.scope ?? null,
      codeHash: this.hashCode(id, code),
      maxAttempts: this.cfg.OTP_MAX_ATTEMPTS,
      expiresAt,
      ip: params.ip ?? null,
    });
    return {
      challenge: this.toChallenge(id, params.channel, params.destination, expiresAt, now, visibility),
      deliver: () => this.delivery.sendCode(params.channel, params.destination, code, params.purpose),
    };
  }

  /**
   * Défi leurre pour « mot de passe oublié » quand aucun compte ne correspond : même forme de réponse,
   * même cycle de vie au renvoi, aucun envoi, aucun code accepté.
   */
  async createDecoy(channel: 'phone' | 'email', ip: string | null, visibility: Visibility, scope: string | null = null): Promise<Challenge> {
    const id = uuidv7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.cfg.OTP_TTL_SECONDS * 1000);
    await this.db.insert(verificationCodes).values({
      id,
      userId: null,
      purpose: 'password_reset',
      channel,
      destination: 'none',
      scope,
      codeHash: this.hashCode(id, numericCode(6)),
      maxAttempts: this.cfg.OTP_MAX_ATTEMPTS,
      expiresAt,
      ip,
    });
    return this.toChallenge(id, channel, 'none', expiresAt, now, visibility);
  }

  /** Dernier défi encore valable d'un compte pour un usage (réutilisé plutôt que d'envoyer un nouveau SMS). */
  async findOpenForUser(userId: string, purpose: Purpose): Promise<Challenge | null> {
    const rows = await this.db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, purpose),
          isNull(verificationCodes.consumedAt),
          gt(verificationCodes.expiresAt, new Date()),
          lt(verificationCodes.attempts, verificationCodes.maxAttempts),
        ),
      )
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    const r = rows[0];
    return r ? this.toChallenge(r.id, r.channel, r.destination, r.expiresAt, r.lastSentAt, {}) : null;
  }

  /**
   * Renvoie un nouveau code pour le même défi. Mise à jour conditionnelle et atomique : deux renvois simultanés
   * ne peuvent pas contourner le délai ni le nombre maximal d'envois. Les essais ratés restent comptés.
   */
  async resend(challengeId: string, expectedPurposes: Purpose[]): Promise<Challenge> {
    const rows = await this.db.select().from(verificationCodes).where(and(eq(verificationCodes.id, challengeId), isNull(verificationCodes.consumedAt))).limit(1);
    const row = rows[0];
    if (!row || !expectedPurposes.includes(row.purpose as Purpose)) throw this.invalid();
    if (row.attempts >= row.maxAttempts) throw Errors.tooMany('Trop d’essais. Recommence depuis le début.');
    const now = new Date();
    const cooldownEnds = new Date(row.lastSentAt.getTime() + this.cfg.OTP_RESEND_COOLDOWN_SECONDS * 1000);
    if (cooldownEnds > now) {
      throw Errors.tooMany('Attends un peu avant de demander un nouveau code.', { retryAt: cooldownEnds.toISOString() });
    }
    if (row.sendCount >= MAX_SENDS_PER_CHALLENGE) throw Errors.tooMany('Trop de codes demandés. Recommence plus tard.');
    if (row.userId) await this.assertDestinationQuota(row.destination, this.db);

    const code = numericCode(6);
    const expiresAt = new Date(now.getTime() + this.cfg.OTP_TTL_SECONDS * 1000);
    const cooldownCutoff = new Date(now.getTime() - this.cfg.OTP_RESEND_COOLDOWN_SECONDS * 1000);
    const updated = await this.db
      .update(verificationCodes)
      .set({ codeHash: this.hashCode(row.id, code), sendCount: sql`${verificationCodes.sendCount} + 1`, lastSentAt: now, expiresAt })
      .where(
        and(
          eq(verificationCodes.id, row.id),
          isNull(verificationCodes.consumedAt),
          lt(verificationCodes.sendCount, MAX_SENDS_PER_CHALLENGE),
          lt(verificationCodes.lastSentAt, cooldownCutoff),
        ),
      )
      .returning({ id: verificationCodes.id });
    if (updated.length !== 1) throw Errors.tooMany('Attends un peu avant de demander un nouveau code.');

    const isReset = row.purpose === 'password_reset';
    // Un défi leurre (userId null) suit exactement le même cycle de vie, sans envoi.
    if (row.userId) await this.delivery.sendCode(row.channel, row.destination, code, row.purpose);
    return this.toChallenge(row.id, row.channel, row.destination, expiresAt, now, {
      revealDestination: !isReset,
      revealChannel: row.scope !== HIDE_CHANNEL_SCOPE,
    });
  }

  /**
   * Vérifie et consomme un code, dans sa propre transaction courte (verrou sur la ligne du défi) :
   * un essai raté est enregistré même si l'opération suivante échoue, et deux requêtes simultanées
   * ne peuvent pas consommer le même code. Retourne la ligne du défi consommé (utilisateur, coordonnée, portée).
   */
  async consume(challengeId: string, code: string, purpose: Purpose) {
    if (!/^\d{6}$/.test(code)) throw this.invalidCode();
    const outcome = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(verificationCodes)
        .where(and(eq(verificationCodes.id, challengeId), isNull(verificationCodes.consumedAt)))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (!row || row.purpose !== purpose) return { error: this.invalid() };
      if (row.expiresAt <= new Date())
        return { error: new AppError('CODE_EXPIRED', 'Ce code a expiré. Demande un nouveau code.', HttpStatus.BAD_REQUEST) };
      if (row.attempts >= row.maxAttempts) return { error: Errors.tooMany('Trop d’essais. Demande un nouveau code.') };
      const ok = row.userId !== null && safeEqualHex(row.codeHash, this.hashCode(row.id, code));
      if (!ok) {
        await tx
          .update(verificationCodes)
          .set({ attempts: sql`${verificationCodes.attempts} + 1` })
          .where(eq(verificationCodes.id, row.id));
        const left = row.maxAttempts - row.attempts - 1;
        return {
          error: new AppError(
            'INVALID_CODE',
            left > 0 ? `Code incorrect. Encore ${left} essai(s).` : 'Code incorrect. Demande un nouveau code.',
            HttpStatus.BAD_REQUEST,
            { attemptsLeft: Math.max(left, 0) },
          ),
        };
      }
      await tx.update(verificationCodes).set({ consumedAt: new Date() }).where(eq(verificationCodes.id, row.id));
      return { row };
    });
    if ('error' in outcome && outcome.error) throw outcome.error;
    return outcome.row!;
  }

  /** Invalide tous les défis ouverts d'un compte (après réinitialisation ou changement de mot de passe). */
  async invalidateAllForUser(userId: string, tx: DbOrTx = this.db): Promise<void> {
    await tx.update(verificationCodes).set({ consumedAt: new Date() }).where(and(eq(verificationCodes.userId, userId), isNull(verificationCodes.consumedAt)));
  }

  /** Plafond d'envois par destinataire sur une heure glissante (OTP_MAX_SENDS_PER_DESTINATION_PER_HOUR). */
  private async assertDestinationQuota(destination: string, tx: DbOrTx): Promise<void> {
    const since = new Date(Date.now() - 3600_000);
    const [row] = await tx
      .select({ sent: sum(verificationCodes.sendCount) })
      .from(verificationCodes)
      .where(and(eq(verificationCodes.destination, destination), gt(verificationCodes.lastSentAt, since)));
    if (Number(row?.sent ?? 0) >= this.cfg.OTP_MAX_SENDS_PER_DESTINATION_PER_HOUR) {
      this.logger.warn('Plafond d’envois atteint pour un destinataire');
      throw Errors.tooMany('Trop de codes envoyés à cette coordonnée. Réessaie dans une heure.');
    }
  }

  private toChallenge(id: string, channel: 'phone' | 'email', destination: string, expiresAt: Date, sentAt: Date, v: Visibility): Challenge {
    return {
      challengeId: id,
      ...(v.revealChannel === false ? {} : { channel }),
      ...(v.revealDestination === false ? {} : { destination: maskDestination(channel, destination) }),
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(sentAt.getTime() + this.cfg.OTP_RESEND_COOLDOWN_SECONDS * 1000).toISOString(),
    };
  }

  private invalid(): AppError {
    return new AppError('INVALID_CHALLENGE', 'Cette demande de code n’est plus valable. Recommence.', HttpStatus.BAD_REQUEST);
  }

  private invalidCode(): AppError {
    return new AppError('INVALID_CODE', 'Le code doit contenir 6 chiffres.', HttpStatus.BAD_REQUEST);
  }
}
