import { eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { userPreferences } from '../../database/schema';
import { DEFAULT_TIMEZONE } from '../../common/timezone';

/** Fuseau horaire IANA de la personne (préférence), Abidjan par défaut (lancement en Côte d'Ivoire). */
export async function userTimezone(db: Database, userId: string): Promise<string> {
  const [pref] = await db.select({ tz: userPreferences.timezone }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return pref?.tz ?? DEFAULT_TIMEZONE;
}
