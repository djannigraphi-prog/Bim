import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products, shopCategories } from './catalog';
import { projectCategories, projects } from './projects';
import { shops } from './spaces';

/**
 * Lot 5-D — Demandes et offres de projet (écrans 21, 49, 55) ; recommandations des projets Premium.
 * Aucune commande ni paiement : une offre présente des articles du BimShop, l'achat se fera sur le BimShop (lot 7).
 */

/** Rubriques du BimShop liées à chaque catégorie de projet (valeurs initiales proposées, à valider par le fondateur). */
export const projectCategoryRubriques = pgTable(
  'project_category_rubriques',
  {
    projectCategoryCode: varchar('project_category_code', { length: 40 })
      .notNull()
      .references(() => projectCategories.code, { onDelete: 'cascade' }),
    shopCategoryCode: varchar('shop_category_code', { length: 40 })
      .notNull()
      .references(() => shopCategories.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectCategoryCode, t.shopCategoryCode] })],
);

/** Offre d'une boutique pour un projet (une par boutique et par projet). status : sent · declined · withdrawn. */
export const projectOffers = pgTable(
  'project_offers',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    message: varchar('message', { length: 500 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('sent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('project_offers_shop_uq').on(t.projectId, t.shopId),
    index('project_offers_shop_idx').on(t.shopId, t.createdAt),
    check('project_offers_status_ck', sql`${t.status} IN ('sent', 'declined', 'withdrawn')`),
  ],
);

/** Articles présentés dans une offre (3 au plus, de la boutique qui fait l'offre). */
export const projectOfferProducts = pgTable(
  'project_offer_products',
  {
    offerId: uuid('offer_id')
      .notNull()
      .references(() => projectOffers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.productId] })],
);
