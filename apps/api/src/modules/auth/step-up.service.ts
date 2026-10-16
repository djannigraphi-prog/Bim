import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { stepUpGrants } from '../../database/schema';
import { StepUpScope } from './auth.decorators';

/**
 * F16 — contrôle renforcé des opérations sensibles (changement de coordonnées, mot de passe, et plus tard retraits).
 * Après mot de passe + code reçu sur une coordonnée vérifiée, l'utilisateur obtient une autorisation :
 * limitée à UNE opération, à UNE portée, pendant quelques minutes.
 */
@Injectable()
export class StepUpService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async grant(userId: string, sessionId: string, scope: StepUpScope): Promise<{ stepUpToken: string; scope: StepUpScope; expiresAt: string }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.cfg.STEP_UP_TTL_SECONDS * 1000);
    await this.db.insert(stepUpGrants).values({ id: uuidv7(), userId, sessionId, scope, tokenHash: sha256(token), expiresAt });
    return { stepUpToken: token, scope, expiresAt: expiresAt.toISOString() };
  }

  /** Consomme atomiquement l'autorisation : une deuxième utilisation échoue. */
  async consume(userId: string, sessionId: string, scope: StepUpScope, token: string): Promise<void> {
    if (!token) throw this.required(scope);
    const used = await this.db
      .update(stepUpGrants)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(stepUpGrants.tokenHash, sha256(token)),
          eq(stepUpGrants.userId, userId),
          // Même appareil : la session courante ou une session antérieure de la même famille. Le renouvellement du
          // jeton crée une nouvelle ligne de session, il ne doit pas invalider la confirmation (audit, A-5).
          sql`${stepUpGrants.sessionId} IN (SELECT s.id FROM sessions s WHERE s.family_id = (SELECT c.family_id FROM sessions c WHERE c.id = ${sessionId}))`,
          eq(stepUpGrants.scope, scope),
          isNull(stepUpGrants.consumedAt),
          gt(stepUpGrants.expiresAt, new Date()),
        ),
      )
      .returning({ id: stepUpGrants.id });
    if (used.length !== 1) throw this.required(scope);
  }

  /** Annule les autorisations ouvertes (après réinitialisation ou changement de mot de passe). */
  async revokeAllForUser(userId: string, tx: DbOrTx = this.db): Promise<void> {
    await tx.update(stepUpGrants).set({ consumedAt: new Date() }).where(and(eq(stepUpGrants.userId, userId), isNull(stepUpGrants.consumedAt)));
  }

  private required(scope: StepUpScope): AppError {
    return new AppError('STEP_UP_REQUIRED', 'Confirme ton identité pour continuer.', HttpStatus.FORBIDDEN, { scope });
  }
}
