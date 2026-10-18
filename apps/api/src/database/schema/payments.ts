import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { shops } from './spaces';
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
    // 3. Confirmation technique : « unavailable » sans prestataire ; « confirmed » seulement après vérification serveur
    //    d'un paiement par un prestataire (lot 8, désactivé tant que le fondateur n'a pas autorisé un prestataire).
    providerStatus: varchar('provider_status', { length: 12 }).notNull().default('unavailable'),
    providerConfirmedAt: timestamp('provider_confirmed_at', { withTimezone: true }),
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
    // Lot 8 : « confirmé par le prestataire » seulement avec la date de la vérification serveur (§5, information 3).
    check('order_payments_provider_ck', sql`(${t.providerStatus} = 'unavailable' AND ${t.providerConfirmedAt} IS NULL) OR (${t.providerStatus} = 'confirmed' AND ${t.providerConfirmedAt} IS NOT NULL AND ${t.method} = 'mobile_money')`),
    check('order_payments_decision_ck', sql`${t.decision} IN ('pending', 'confirmed', 'contested')`),
    check('order_payments_failure_ck', sql`${t.failure} IN ('none', 'failed', 'cancelled')`),
    check('order_payments_contest_ck', sql`(${t.decision} = 'contested') = (${t.contestReason} IS NOT NULL)`),
    check('order_payments_cash_ck', sql`${t.cashObservedAt} IS NULL OR ${t.method} = 'cash'`),
    check('order_payments_declared_ck', sql`${t.declaredAt} IS NULL OR ${t.method} = 'mobile_money'`),
  ],
);

/**
 * Lot 8 (socle, désactivé) — Paiement en ligne d'un paiement du registre, chez un prestataire. F4 (17/10/2026) : l'argent
 * va directement à la boutique (`payee_shop_id`) ; BIM ne détient jamais les fonds. Aucun prestataire réel n'est intégré :
 * seul un simulateur existe, interdit hors développement et tests.
 * Statuts : pending (lancé, en attente du client) → succeeded · failed · expired.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey(),
    orderPaymentId: uuid('order_payment_id')
      .notNull()
      .references(() => orderPayments.id),
    payeeShopId: uuid('payee_shop_id')
      .notNull()
      .references(() => shops.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    providerRef: varchar('provider_ref', { length: 100 }).notNull(),
    /** Compte de la boutique chez le prestataire (sous-compte) : le paiement vérifié doit lui être attribué (F4). */
    payeeAccountRef: varchar('payee_account_ref', { length: 60 }),
    amountFcfa: integer('amount_fcfa').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('XOF'),
    /** pending · succeeded · failed · expired · late_paid (argent reçu mais non retenu : remboursé automatiquement). */
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    /** Montant réellement reçu, vérifié auprès du prestataire, quand il diffère de l'attendu ou arrive en retard. */
    paidAmountFcfa: integer('paid_amount_fcfa'),
    /** Motif technique d'un échec (montant, devise, bénéficiaire, refus du prestataire, expiration) ; jamais de donnée personnelle. */
    failureReason: varchar('failure_reason', { length: 40 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payment_intents_ref_uq').on(t.provider, t.providerRef),
    // Un seul paiement en ligne en cours par paiement du registre.
    uniqueIndex('payment_intents_open_uq').on(t.orderPaymentId).where(sql`${t.status} = 'pending'`),
    check('payment_intents_status_ck', sql`${t.status} IN ('pending', 'succeeded', 'failed', 'expired', 'late_paid')`),
    check('payment_intents_amount_ck', sql`${t.amountFcfa} > 0`),
    check('payment_intents_currency_ck', sql`${t.currency} = 'XOF'`),
  ],
);

/** Notifications reçues des prestataires (signature vérifiée), en écriture seule ; une clé d'événement n'est traitée qu'une fois. */
export const paymentProviderEvents = pgTable(
  'payment_provider_events',
  {
    id: uuid('id').primaryKey(),
    provider: varchar('provider', { length: 20 }).notNull(),
    eventKey: varchar('event_key', { length: 160 }).notNull(),
    intentId: uuid('intent_id').references(() => paymentIntents.id),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_provider_events_key_uq').on(t.provider, t.eventKey)],
);

/**
 * Lot 8 — Compte d'une boutique chez un prestataire (sous-compte Paystack, par exemple). F4 : sans compte actif de la
 * boutique, aucun paiement en ligne n'est lancé (l'argent n'irait jamais sur un compte de BIM). Saisi par l'équipe BIM
 * après vérification auprès du prestataire ; seule la référence est gardée, jamais les coordonnées bancaires.
 */
export const shopPaymentAccounts = pgTable(
  'shop_payment_accounts',
  {
    id: uuid('id').primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    accountRef: varchar('account_ref', { length: 60 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    note: varchar('note', { length: 300 }),
    createdByAdmin: uuid('created_by_admin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('shop_payment_accounts_active_uq').on(t.shopId, t.provider).where(sql`${t.status} = 'active'`),
    check('shop_payment_accounts_status_ck', sql`${t.status} IN ('active', 'disabled')`),
  ],
);

/**
 * Lot 8 — Remboursement d'un paiement en ligne, demandé par l'équipe BIM (jamais automatique, A8), journalisé.
 * Statuts : pending → processing → processed · failed.
 */
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid('id').primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    amountFcfa: integer('amount_fcfa').notNull(),
    reason: varchar('reason', { length: 300 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    providerRefundRef: varchar('provider_refund_ref', { length: 60 }),
    /** Équipe BIM ; null pour un remboursement automatique (paiement reçu en retard ou non conforme). */
    requestedByAdmin: uuid('requested_by_admin'),
    automatic: boolean('automatic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    // Un seul remboursement en cours par paiement ; total remboursé contrôlé par le serveur.
    uniqueIndex('payment_refunds_open_uq').on(t.intentId).where(sql`${t.status} IN ('pending', 'processing')`),
    check('payment_refunds_status_ck', sql`${t.status} IN ('pending', 'processing', 'processed', 'failed')`),
    check('payment_refunds_amount_ck', sql`${t.amountFcfa} > 0`),
    check('payment_refunds_origin_ck', sql`${t.automatic} OR ${t.requestedByAdmin} IS NOT NULL`),
  ],
);
