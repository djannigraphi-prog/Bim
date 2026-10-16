import { sql } from 'drizzle-orm';
import type { Database } from '../database/database.module';

type Executor = Pick<Database, 'execute'>;

/**
 * Verrou de quota par personne, pris au début de la transaction qui crée l'élément compté (publication, commentaire,
 * story, signalement, message à Peni). Les créations simultanées d'une même personne passent alors l'une après
 * l'autre : chacune recompte sous le verrou et la limite sur 24 heures ne peut plus être dépassée (audit, défaut 1).
 * Le verrou est relâché automatiquement à la fin de la transaction ; il ne bloque jamais les autres personnes.
 */
export async function lockUserQuota(tx: Executor, scope: string, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`quota:${scope}`}), hashtext(${userId}))`);
}
