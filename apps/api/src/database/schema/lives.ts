import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './catalog';
import { users } from './identity';
import { shops } from './spaces';

/**
 * Lot 10 (prototype) — Lives (écrans 39 à 46). Aucun service vidéo : le prototype gère la programmation, le lancement,
 * les commentaires, les cœurs, les cadeaux en pièces, le produit épinglé et le nombre de spectateurs ; l'image en direct
 * arrivera avec un prestataire vidéo (dépense à autoriser). Ouvert seulement en mode démonstration (DEMO_MODE).
 *
 * kind : simple (une personne) · sale (une boutique, avec produit épinglé). status : scheduled · live · ended.
 */
export const lives = pgTable(
  'lives',
  {
    id: uuid('id').primaryKey(),
    hostUserId: uuid('host_user_id')
      .notNull()
      .references(() => users.id),
    shopId: uuid('shop_id').references(() => shops.id),
    kind: varchar('kind', { length: 8 }).notNull(),
    title: varchar('title', { length: 100 }).notNull(),
    status: varchar('status', { length: 10 }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    pinnedProductId: uuid('pinned_product_id').references(() => products.id),
    heartCount: integer('heart_count').notNull().default(0),
    coinCount: integer('coin_count').notNull().default(0),
    peakViewers: integer('peak_viewers').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lives_status_idx').on(t.status, t.startedAt),
    index('lives_scheduled_idx').on(t.status, t.scheduledAt),
    index('lives_host_idx').on(t.hostUserId, t.createdAt),
    check('lives_kind_ck', sql`(${t.kind} = 'simple' AND ${t.shopId} IS NULL) OR (${t.kind} = 'sale' AND ${t.shopId} IS NOT NULL)`),
    check('lives_status_ck', sql`${t.status} IN ('scheduled', 'live', 'ended')`),
    check('lives_counts_ck', sql`${t.heartCount} >= 0 AND ${t.coinCount} >= 0 AND ${t.peakViewers} >= 0`),
  ],
);

export const liveComments = pgTable(
  'live_comments',
  {
    id: uuid('id').primaryKey(),
    liveId: uuid('live_id')
      .notNull()
      .references(() => lives.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    text: varchar('text', { length: 300 }).notNull(),
    /** published · hidden (retiré par l'hôte). */
    status: varchar('status', { length: 10 }).notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('live_comments_live_idx').on(t.liveId, t.id), index('live_comments_user_idx').on(t.userId), check('live_comments_status_ck', sql`${t.status} IN ('published', 'hidden')`)],
);

/** Présence des spectateurs : dernière lecture de l'état du Live (compte « en ce moment » sur 30 secondes). */
export const liveViewers = pgTable(
  'live_viewers',
  {
    liveId: uuid('live_id')
      .notNull()
      .references(() => lives.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.liveId, t.userId] }), index('live_viewers_user_idx').on(t.userId)],
);
