import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, smallint, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { communes, deliveryTariffs } from './logistics';
import { conversations } from './messaging';
import { products, productVariants } from './catalog';
import { shops } from './spaces';

/**
 * Lot 7-B — Commandes (LOT7_CONCEPTION §3, §4, §10). Module unique pour les deux origines : BimShop (le client
 * commande, la boutique confirme) et proposition faite par la boutique dans sa conversation (la proposition vaut
 * confirmation de la boutique ; le client l'accepte). Aucun paiement en ligne : le paiement est enregistré au 7-C.
 *
 * Statuts : proposed · pending_shop → confirmed → preparing → ready → (retrait) delivered ; (livraison, 7-F) ;
 * sorties : declined · expired · cancelled. L'historique est dans `order_events`, jamais réécrit.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey(),
    /** Numéro lisible `CMD-000001`, attribué par la base, immuable. */
    number: varchar('number', { length: 20 })
      .notNull()
      .default(sql`bim_order_number(nextval('order_number_seq'))`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    source: varchar('source', { length: 12 }).notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    status: varchar('status', { length: 14 }).notNull(),
    /** Mode : pickup (retrait en boutique) · express (rapide) · economy (économique). null tant qu'une proposition n'est pas acceptée. */
    deliveryMode: varchar('delivery_mode', { length: 10 }),
    /** Moyen prévu : mobile_money (au numéro de la boutique) · cash (retrait en boutique seulement au 7-B). */
    paymentMethod: varchar('payment_method', { length: 12 }),
    shopCommuneCode: varchar('shop_commune_code', { length: 80 }).references(() => communes.code),
    deliveryCommuneCode: varchar('delivery_commune_code', { length: 80 }).references(() => communes.code),
    deliveryAddress: varchar('delivery_address', { length: 300 }),
    /** Copie figée du calcul des frais à la confirmation (grille, durée, détail) : aucun supplément ensuite. */
    deliveryFeeFcfa: integer('delivery_fee_fcfa'),
    tariffId: uuid('tariff_id').references(() => deliveryTariffs.id),
    tariffVersion: integer('tariff_version'),
    estimatedMinutes: integer('estimated_minutes'),
    feeDetails: jsonb('fee_details'),
    itemsTotalFcfa: integer('items_total_fcfa').notNull(),
    /** Clé anti-doublon fournie par l'app (une même demande envoyée deux fois ne crée qu'une commande). */
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Annulation, refus ou expiration : auteur, motif et statut au moment de la sortie. */
    endedByType: varchar('ended_by_type', { length: 10 }),
    endedById: uuid('ended_by_id'),
    endReason: varchar('end_reason', { length: 300 }),
    endedFromStatus: varchar('ended_from_status', { length: 14 }),
    /** Le stock des lignes a été retiré (vente) ; remis en cas d'annulation. */
    stockCommitted: smallint('stock_committed').notNull().default(0),
  },
  (t) => [
    uniqueIndex('orders_number_uq').on(t.number),
    uniqueIndex('orders_idempotency_uq').on(t.createdBy, t.idempotencyKey),
    index('orders_shop_idx').on(t.shopId, t.createdAt),
    index('orders_customer_idx').on(t.customerId, t.createdAt),
    index('orders_expiry_idx').on(t.expiresAt).where(sql`${t.status} IN ('proposed', 'pending_shop')`),
    check('orders_source_ck', sql`${t.source} IN ('bimshop', 'conversation')`),
    check('orders_status_ck', sql`${t.status} IN ('proposed', 'pending_shop', 'confirmed', 'preparing', 'ready', 'delivered', 'declined', 'expired', 'cancelled')`),
    check('orders_mode_ck', sql`${t.deliveryMode} IS NULL OR ${t.deliveryMode} IN ('pickup', 'express', 'economy')`),
    check('orders_payment_ck', sql`${t.paymentMethod} IS NULL OR ${t.paymentMethod} IN ('mobile_money', 'cash')`),
    // Espèces : retrait en boutique seulement à ce stade (les livreurs employés arrivent au 7-E / 7-F).
    check('orders_cash_ck', sql`${t.paymentMethod} IS DISTINCT FROM 'cash' OR ${t.deliveryMode} = 'pickup'`),
    check('orders_delivery_ck', sql`${t.deliveryMode} IS DISTINCT FROM 'express' AND ${t.deliveryMode} IS DISTINCT FROM 'economy' OR (${t.deliveryCommuneCode} IS NOT NULL AND ${t.deliveryAddress} IS NOT NULL AND ${t.deliveryFeeFcfa} IS NOT NULL AND ${t.tariffId} IS NOT NULL)`),
    check('orders_conversation_ck', sql`(${t.source} = 'conversation') = (${t.conversationId} IS NOT NULL)`),
    check('orders_amounts_ck', sql`${t.itemsTotalFcfa} > 0 AND (${t.deliveryFeeFcfa} IS NULL OR ${t.deliveryFeeFcfa} >= 0)`),
  ],
);

/**
 * Ligne de commande : copie figée (L7-04) — référence et version de la fiche, titre, type, variante, prix du
 * catalogue au moment et prix appliqué (A15 : jamais au-dessus), copie de la photo principale.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    position: integer('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    reference: varchar('reference', { length: 20 }).notNull(),
    contentVersion: integer('content_version').notNull(),
    kind: varchar('kind', { length: 10 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    variantLabel: varchar('variant_label', { length: 60 }).notNull(),
    quantity: integer('quantity').notNull(),
    catalogPriceFcfa: integer('catalog_price_fcfa').notNull(),
    appliedPriceFcfa: integer('applied_price_fcfa').notNull(),
    photoKey: varchar('photo_key', { length: 200 }),
  },
  (t) => [
    uniqueIndex('order_items_position_uq').on(t.orderId, t.position),
    index('order_items_product_idx').on(t.productId),
    check('order_items_quantity_ck', sql`${t.quantity} BETWEEN 1 AND 99`),
    check('order_items_price_ck', sql`${t.appliedPriceFcfa} > 0 AND ${t.appliedPriceFcfa} <= ${t.catalogPriceFcfa}`),
  ],
);

/** Historique horodaté d'une commande (jamais modifié ni supprimé : déclencheur de la base). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    type: varchar('type', { length: 30 }).notNull(),
    /** customer · shop · system · admin · courier */
    actorType: varchar('actor_type', { length: 10 }).notNull(),
    actorId: uuid('actor_id'),
    fromStatus: varchar('from_status', { length: 14 }),
    toStatus: varchar('to_status', { length: 14 }),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt), check('order_events_actor_ck', sql`${t.actorType} IN ('customer', 'shop', 'system', 'admin', 'courier')`)],
);

/**
 * Code de remise à 4 chiffres (§3.2) : visible du seul client, lié à cette commande, à usage unique, essais limités.
 * Stocké chiffré (affichage au client) et sous forme d'empreinte (vérification à temps constant) ; jamais journalisé.
 */
export const orderHandoverCodes = pgTable(
  'order_handover_codes',
  {
    orderId: uuid('order_id')
      .primaryKey()
      .references(() => orders.id),
    codeEncrypted: varchar('code_encrypted', { length: 200 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: uuid('used_by').references(() => users.id),
  },
  (t) => [check('order_handover_codes_status_ck', sql`${t.status} IN ('active', 'used', 'blocked', 'cancelled')`)],
);
