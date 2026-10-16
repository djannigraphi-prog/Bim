import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { orders } from './orders';

/**
 * Lot 7-C — Registre des paiements (LOT7_CONCEPTION §5). BIM ne détient ni ne transfère aucun fonds : il enregistre.
 * Chaque paiement porte cinq informations distinctes, jamais fusionnées : déclaration du client, constat visuel des
 * espèces, confirmation technique (toujours « non disponible » : aucun prestataire), décision du bénéficiaire, échec ou
 * annulation. Le statut affiché est calculé à partir d'elles. Un paiement appartient à une seule commande.
 */
export const orderPayments = pgTable(
  'order_payments',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    /** article · delivery_fee (les frais de livraison arrivent avec 7-F). */
    kind: varchar('kind', { length: 14 }).notNull(),
    /** mobile_money · cash */
    method: varchar('method', { length: 12 }).notNull(),
    amountFcfa: integer('amount_fcfa').notNull(),
    // 1. Déclaration du client (jamais présentée comme une confirmation).
    declaredAt: timestamp('declared_at', { withTimezone: true }),
    declaredReference: varchar('declared_reference', { length: 60 }),
    // 2. Constat visuel des espèces (au retrait : la boutique ; en livraison : le livreur employé, 7-F).
    cashObservedAt: timestamp('cash_observed_at', { withTimezone: true }),
    cashObservedAmountFcfa: integer('cash_observed_amount_fcfa'),
    cashObservedBy: uuid('cash_observed_by').references(() => users.id),
    cashObservedByRole: varchar('cash_observed_by_role', { length: 10 }),
    // 3. Confirmation technique : aucun prestataire intégré, donc toujours « unavailable ».
    providerStatus: varchar('provider_status', { length: 12 }).notNull().default('unavailable'),
    // 4. Décision du bénéficiaire (la boutique pour l'article) : pending · confirmed · contested.
    decision: varchar('decision', { length: 10 }).notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    contestReason: varchar('contest_reason', { length: 300 }),
    // 5. Échec ou annulation.
    failure: varchar('failure', { length: 10 }).notNull().default('none'),
    failureAt: timestamp('failure_at', { withTimezone: true }),
    /** Rappel envoyé à la boutique, puis file « à vérifier » du support (jamais de confirmation implicite). */
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    reviewQueuedAt: timestamp('review_queued_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: varchar('review_note', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('order_payments_kind_uq').on(t.orderId, t.kind),
    index('order_payments_review_idx').on(t.reviewQueuedAt).where(sql`${t.reviewQueuedAt} IS NOT NULL AND ${t.reviewedAt} IS NULL`),
    check('order_payments_kind_ck', sql`${t.kind} IN ('article', 'delivery_fee')`),
    check('order_payments_method_ck', sql`${t.method} IN ('mobile_money', 'cash')`),
    check('order_payments_amount_ck', sql`${t.amountFcfa} > 0`),
    // Aucun prestataire : « confirmé par le prestataire » impossible (§5, information 3).
    check('order_payments_provider_ck', sql`${t.providerStatus} = 'unavailable'`),
    check('order_payments_decision_ck', sql`${t.decision} IN ('pending', 'confirmed', 'contested')`),
    check('order_payments_failure_ck', sql`${t.failure} IN ('none', 'failed', 'cancelled')`),
    check('order_payments_contest_ck', sql`(${t.decision} = 'contested') = (${t.contestReason} IS NOT NULL)`),
    check('order_payments_cash_ck', sql`${t.cashObservedAt} IS NULL OR ${t.method} = 'cash'`),
    check('order_payments_declared_ck', sql`${t.declaredAt} IS NULL OR ${t.method} = 'mobile_money'`),
  ],
);
