import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './catalog';
import { users } from './identity';
import { deliveries } from './deliveries';
import { orderItems, orders } from './orders';
import { shops } from './spaces';

/**
 * Lot 7-H (partie sans livraison) — Évaluations (LOT7_CONCEPTION §13, proposé). Deux objets distincts : l'article ou
 * la prestation (une évaluation par ligne de commande, rattachée à sa référence et à sa version) et la boutique (une
 * par commande). L'évaluation de la livraison arrivera avec 7-F. Aucune moyenne ni « étoiles » de boutique calculées :
 * leur calcul et le statut Gold attendent l'arbitrage A17.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey(),
    /** item · shop */
    kind: varchar('kind', { length: 8 }).notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    productId: uuid('product_id').references(() => products.id),
    /** 7-F : évaluation de la livraison (distincte de l'article et de la boutique). */
    deliveryId: uuid('delivery_id').references(() => deliveries.id),
    productReference: varchar('product_reference', { length: 20 }),
    contentVersion: integer('content_version'),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    rating: smallint('rating').notNull(),
    comment: varchar('comment', { length: 1000 }),
    /** published · hidden (modération) · deleted (par son auteur) */
    status: varchar('status', { length: 10 }).notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reviews_item_uq').on(t.orderItemId).where(sql`${t.kind} = 'item'`),
    uniqueIndex('reviews_shop_uq').on(t.orderId).where(sql`${t.kind} = 'shop'`),
    uniqueIndex('reviews_delivery_uq').on(t.deliveryId).where(sql`${t.kind} = 'delivery'`),
    index('reviews_product_idx').on(t.productId, t.createdAt),
    index('reviews_shop_idx').on(t.shopId, t.createdAt),
    check('reviews_kind_ck', sql`${t.kind} IN ('item', 'shop', 'delivery')`),
    check('reviews_delivery_ck', sql`(${t.kind} = 'delivery') = (${t.deliveryId} IS NOT NULL)`),
    check('reviews_item_ck', sql`(${t.kind} = 'item') = (${t.orderItemId} IS NOT NULL AND ${t.productId} IS NOT NULL AND ${t.productReference} IS NOT NULL AND ${t.contentVersion} IS NOT NULL)`),
    check('reviews_rating_ck', sql`${t.rating} BETWEEN 1 AND 5`),
    check('reviews_status_ck', sql`${t.status} IN ('published', 'hidden', 'deleted')`),
  ],
);
