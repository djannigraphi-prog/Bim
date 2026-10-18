import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { adminUsers } from './platform';
import { users } from './identity';
import { postComments, posts } from './social';

/**
 * Lot 9 — Premium, pièces et portefeuille (1 pièce = 1 F, commission BIM 0).
 *
 * Prototype : aucun argent réel. Les achats (abonnement, pièces) et les retraits passent par le seul circuit « demo »,
 * ouvert uniquement avec DEMO_MODE=true (interdit en production). Le circuit réel (achat intégré Apple / Google, site
 * web Mobile Money, décaissement) attend l'avis juridique BCEAO et l'accord du fondateur.
 *
 * Le grand livre (coin_ledger) est la source : chaque mouvement y est écrit, jamais modifié ni supprimé. Le solde du
 * portefeuille (wallets) en est le cumul, tenu dans la même transaction. Deux compartiments séparés : pièces achetées
 * (jamais retirables, F8) et pièces reçues (retirables).
 */

/** Abonnement (Premium utilisateur). Actif tant que current_period_end est dans le futur. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** user_premium (les abonnements marchand et livreur viendront plus tard). */
    plan: varchar('plan', { length: 20 }).notNull(),
    /** demo (prototype) ; plus tard apple · google · web. */
    channel: varchar('channel', { length: 10 }).notNull(),
    priceFcfa: integer('price_fcfa').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    autoRenew: boolean('auto_renew').notNull().default(true),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('subscriptions_user_idx').on(t.userId, t.plan, t.currentPeriodEnd), check('subscriptions_channel_ck', sql`${t.channel} IN ('demo')`)],
);

/** Solde par personne, cumul du grand livre (contrôlé par les tests). */
export const wallets = pgTable(
  'wallets',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    purchased: integer('purchased').notNull().default(0),
    received: integer('received').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('wallets_purchased_ck', sql`${t.purchased} >= 0`), check('wallets_received_ck', sql`${t.received} >= 0`)],
);

/** Grand livre des pièces : une ligne par mouvement et par compartiment, en ajout seulement. */
export const coinLedger = pgTable(
  'coin_ledger',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** purchased · received */
    bucket: varchar('bucket', { length: 10 }).notNull(),
    /** purchase · gift_sent · gift_received · withdrawal · withdrawal_refund */
    kind: varchar('kind', { length: 20 }).notNull(),
    delta: integer('delta').notNull(),
    /** Achat, envoi ou retrait concerné. */
    refId: uuid('ref_id').notNull(),
    /** Circuit d'achat des pièces achetées (demo…), pour appliquer plus tard les règles de chaque magasin. */
    channel: varchar('channel', { length: 10 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('coin_ledger_user_idx').on(t.userId, t.createdAt),
    check('coin_ledger_bucket_ck', sql`${t.bucket} IN ('purchased', 'received')`),
    check('coin_ledger_kind_ck', sql`${t.kind} IN ('purchase', 'gift_sent', 'gift_received', 'withdrawal', 'withdrawal_refund')`),
    check('coin_ledger_delta_ck', sql`${t.delta} <> 0`),
  ],
);

/** Achat d'un pack de pièces (prototype : circuit demo, aucun paiement). */
export const coinPurchases = pgTable(
  'coin_purchases',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    coins: integer('coins').notNull(),
    priceFcfa: integer('price_fcfa').notNull(),
    channel: varchar('channel', { length: 10 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('coin_purchases_idem_uq').on(t.userId, t.idempotencyKey),
    check('coin_purchases_coins_ck', sql`${t.coins} > 0`),
    check('coin_purchases_channel_ck', sql`${t.channel} IN ('demo')`),
  ],
);

/** Pièces envoyées (« Encourager ») sur une publication ou un commentaire. */
export const coinGifts = pgTable(
  'coin_gifts',
  {
    id: uuid('id').primaryKey(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id),
    /** post · comment */
    targetType: varchar('target_type', { length: 8 }).notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    commentId: uuid('comment_id').references(() => postComments.id),
    giftCode: varchar('gift_code', { length: 20 }).notNull(),
    quantity: integer('quantity').notNull(),
    coins: integer('coins').notNull(),
    /** Le nom de la personne n'apparaît pas dans la liste des donateurs. */
    anonymous: boolean('anonymous').notNull().default(false),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('coin_gifts_idem_uq').on(t.senderId, t.idempotencyKey),
    index('coin_gifts_post_idx').on(t.postId, t.createdAt),
    index('coin_gifts_comment_idx').on(t.commentId),
    index('coin_gifts_recipient_idx').on(t.recipientId, t.createdAt),
    check('coin_gifts_target_ck', sql`(${t.targetType} = 'post' AND ${t.commentId} IS NULL) OR (${t.targetType} = 'comment' AND ${t.commentId} IS NOT NULL)`),
    check('coin_gifts_coins_ck', sql`${t.coins} > 0 AND ${t.quantity} > 0`),
    check('coin_gifts_self_ck', sql`${t.senderId} <> ${t.recipientId}`),
  ],
);

/**
 * Retrait des pièces reçues vers le Mobile Money de la personne (téléphone vérifié). Prototype : « paid » veut dire
 * « versement simulé », aucun argent ne part. Statuts : review (vérification de l'équipe : premier retrait ou montant
 * au-delà du seuil) · paid · rejected (pièces rendues).
 */
export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    coins: integer('coins').notNull(),
    /** Frais de l'opérateur, à la charge de la personne (S3) ; commission BIM : 0. */
    feeFcfa: integer('fee_fcfa').notNull(),
    netFcfa: integer('net_fcfa').notNull(),
    operator: varchar('operator', { length: 10 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    channel: varchar('channel', { length: 10 }).notNull(),
    status: varchar('status', { length: 10 }).notNull(),
    /** Pourquoi l'équipe vérifie : first · amount. */
    reviewReason: varchar('review_reason', { length: 10 }),
    decidedBy: uuid('decided_by').references(() => adminUsers.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectReason: varchar('reject_reason', { length: 300 }),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('withdrawals_idem_uq').on(t.userId, t.idempotencyKey),
    index('withdrawals_user_idx').on(t.userId, t.createdAt),
    index('withdrawals_status_idx').on(t.status, t.createdAt),
    check('withdrawals_status_ck', sql`${t.status} IN ('review', 'paid', 'rejected')`),
    check('withdrawals_operator_ck', sql`${t.operator} IN ('orange', 'mtn', 'moov', 'wave')`),
    check('withdrawals_channel_ck', sql`${t.channel} IN ('demo')`),
    check('withdrawals_amount_ck', sql`${t.coins} > 0 AND ${t.feeFcfa} >= 0 AND ${t.netFcfa} = ${t.coins} - ${t.feeFcfa}`),
  ],
);
