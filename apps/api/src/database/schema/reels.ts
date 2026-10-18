import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Lot 11 (prototype) — Reels (écran 15) : petites vidéos verticales rangées dans notre stockage privé (aucun service
 * vidéo payant, aucun transcodage). Fichier MP4 vérifié (format, durée), métadonnées (dont la position) neutralisées
 * avant l'enregistrement ; lecture par lien temporaire. visibility : public · followers. status : published · hidden ·
 * deleted.
 */
export const reels = pgTable(
  'reels',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    storageKey: varchar('storage_key', { length: 200 }).notNull(),
    caption: varchar('caption', { length: 300 }),
    visibility: varchar('visibility', { length: 10 }).notNull().default('public'),
    status: varchar('status', { length: 10 }).notNull().default('published'),
    durationMs: integer('duration_ms').notNull(),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes').notNull(),
    likeCount: integer('like_count').notNull().default(0),
    coinCount: integer('coin_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reels_feed_idx').on(t.status, t.id),
    index('reels_user_idx').on(t.userId, t.createdAt),
    check('reels_visibility_ck', sql`${t.visibility} IN ('public', 'followers')`),
    check('reels_status_ck', sql`${t.status} IN ('published', 'hidden', 'deleted')`),
    check('reels_counts_ck', sql`${t.likeCount} >= 0 AND ${t.coinCount} >= 0 AND ${t.viewCount} >= 0`),
  ],
);

export const reelLikes = pgTable(
  'reel_likes',
  {
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reelId, t.userId] }), index('reel_likes_user_idx').on(t.userId)],
);

/** Une vue par personne et par Reel (compteur de vues). */
export const reelViews = pgTable(
  'reel_views',
  {
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reelId, t.userId] }), index('reel_views_user_idx').on(t.userId)],
);
