import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { shops } from './spaces';

/**
 * Lot 5-B — Catalogue des boutiques. Aucun paiement ici : les prix sont affichés en FCFA, la commande et le paiement
 * arrivent aux lots 7 et 8. Le stock est la somme des mouvements ; une règle de la base interdit un stock négatif.
 */

/** Rubriques du BimShop (écran 33), sur deux niveaux : rubrique (parentCode null) puis sous-rubrique. */
export const shopCategories = pgTable(
  'shop_categories',
  {
    code: varchar('code', { length: 40 }).primaryKey(),
    label: varchar('label', { length: 60 }).notNull(),
    parentCode: varchar('parent_code', { length: 40 }),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('shop_categories_parent_idx').on(t.parentCode, t.sortOrder)],
);

/** Article (product) ou prestation (service) d'une boutique. status : draft · published · archived. */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).notNull().default('product'),
    categoryCode: varchar('category_code', { length: 40 }).references(() => shopCategories.code),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 2000 }),
    /** Prix en FCFA (entier). */
    priceFcfa: integer('price_fcfa').notNull(),
    /** Prix barré (promotion), supérieur au prix. */
    compareAtFcfa: integer('compare_at_fcfa'),
    /** Prestation : durée indicative en minutes. */
    durationMinutes: integer('duration_minutes'),
    status: varchar('status', { length: 10 }).notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_shop_idx').on(t.shopId, t.status),
    index('products_catalog_idx').on(t.status, t.categoryCode, t.publishedAt),
    check('products_kind_ck', sql`${t.kind} IN ('product', 'service')`),
    check('products_status_ck', sql`${t.status} IN ('draft', 'published', 'archived')`),
    check('products_price_ck', sql`${t.priceFcfa} > 0 AND ${t.priceFcfa} <= 100000000`),
    check('products_compare_ck', sql`${t.compareAtFcfa} IS NULL OR ${t.compareAtFcfa} > ${t.priceFcfa}`),
    check('products_duration_ck', sql`${t.durationMinutes} IS NULL OR (${t.durationMinutes} BETWEEN 5 AND 1440)`),
  ],
);

/** Photos d'un article (6 au plus), ré-encodées sans métadonnées, stockage privé, liens temporaires. */
export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_media_product_idx').on(t.productId, t.position)],
);

/** Variante (taille, couleur…) ; un article sans choix a une seule variante « Unique ». */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 60 }).notNull(),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('product_variants_label_uq').on(t.productId, t.label)],
);

/** Mouvements de stock (ajustement par le marchand ; ventes au lot 7). Stock d'une variante = somme des deltas. */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: varchar('reason', { length: 12 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('inventory_movements_variant_idx').on(t.variantId), check('inventory_movements_reason_ck', sql`${t.reason} IN ('adjustment', 'sale', 'return')`), check('inventory_movements_delta_ck', sql`${t.delta} <> 0`)],
);

/** Boutiques suivies (« Suivre », écran 54). */
export const shopFollows = pgTable(
  'shop_follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.shopId] }), index('shop_follows_shop_idx').on(t.shopId)],
);

/** Articles mis de côté (cœur, écrans 32 et 34). */
export const productFavorites = pgTable(
  'product_favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] }), index('product_favorites_product_idx').on(t.productId)],
);
