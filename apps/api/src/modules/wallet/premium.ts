import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../database/database.module';
import { shops, subscriptions } from '../../database/schema';

export const PREMIUM_PLAN = 'user_premium';

/**
 * V1-1910-C — Badge de certification : réservé aux comptes Premium (abonnement en cours), personnes et boutiques.
 * Une boutique est certifiée quand la personne qui la possède est Premium. Le statut Gold est abandonné.
 */
export async function premiumUserIds(db: DbOrTx, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const rows = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(inArray(subscriptions.userId, ids), eq(subscriptions.plan, PREMIUM_PLAN), gt(subscriptions.currentPeriodEnd, sql`now()`)));
  return new Set(rows.map((r) => r.userId));
}

/** Boutiques certifiées (propriétaire Premium) parmi une liste. */
export async function certifiedShopIds(db: DbOrTx, shopIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(shopIds)];
  if (!ids.length) return new Set();
  const rows = await db
    .selectDistinct({ id: shops.id })
    .from(shops)
    .innerJoin(subscriptions, eq(subscriptions.userId, shops.ownerUserId))
    .where(and(inArray(shops.id, ids), eq(subscriptions.plan, PREMIUM_PLAN), gt(subscriptions.currentPeriodEnd, sql`now()`)));
  return new Set(rows.map((r) => r.id));
}
