import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { products } from './catalog';
import { projects } from './projects';

/**
 * Lot 4 — Social : publications, « J'ai fait mon BIM », j'aime, commentaires, abonnements, blocages, signalements de
 * contenu et modération. Les images sont ré-encodées (métadonnées et position GPS supprimées) et rangées dans le
 * stockage privé ; elles ne sont servies que par des liens temporaires, après contrôle de la visibilité.
 */

/**
 * Publication (écrans 10, 11, 16). kind : post (texte et images) ou bim (« J'ai fait mon BIM », photos avant / après
 * d'un projet, publiées avec l'accord explicite de la personne). visibility : public (tout le monde), followers (mes
 * abonnés), private (moi seul). status : published, hidden (masquée par la modération), deleted (supprimée).
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).notNull(),
    text: varchar('text', { length: 2200 }),
    visibility: varchar('visibility', { length: 10 }).notNull().default('public'),
    /** Projet lié (« J'ai fait mon BIM ») ; le lien disparaît si le projet est supprimé, la publication reste. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Résumé du parcours figé à la publication (catégorie, objectif, durée, étapes faites) : rien de privé. */
    journeyCategory: varchar('journey_category', { length: 80 }),
    journeyGoal: varchar('journey_goal', { length: 120 }),
    journeyDays: integer('journey_days'),
    journeyStepsDone: integer('journey_steps_done'),
    status: varchar('status', { length: 10 }).notNull().default('published'),
    moderationNote: varchar('moderation_note', { length: 500 }),
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('posts_feed_idx').on(t.status, t.visibility, t.createdAt),
    index('posts_user_idx').on(t.userId, t.createdAt),
    check('posts_kind_ck', sql`${t.kind} IN ('post', 'bim')`),
    check('posts_visibility_ck', sql`${t.visibility} IN ('public', 'followers', 'private')`),
    check('posts_status_ck', sql`${t.status} IN ('published', 'hidden', 'deleted')`),
    check('posts_counts_ck', sql`${t.likeCount} >= 0 AND ${t.commentCount} >= 0`),
  ],
);

/** Images d'une publication : image (publication simple, 4 au plus), before / after (« J'ai fait mon BIM »). */
export const postMedia = pgTable(
  'post_media',
  {
    id: uuid('id').primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: varchar('kind', { length: 8 }).notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    /** Jour de la photo (avant / après) ; null pour une image simple. */
    takenDay: date('taken_day', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('post_media_position_uq').on(t.postId, t.position), check('post_media_kind_ck', sql`${t.kind} IN ('image', 'before', 'after')`)],
);

export const postLikes = pgTable(
  'post_likes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_likes_user_idx').on(t.userId, t.createdAt)],
);

/** Commentaire (écran 12) ; réponse sur un seul niveau (parentId). Pièces et « Encourager » : lot 9. */
export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    text: varchar('text', { length: 1000 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('published'),
    likeCount: integer('like_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('post_comments_post_idx').on(t.postId, t.createdAt),
    index('post_comments_user_idx').on(t.userId, t.createdAt),
    check('post_comments_status_ck', sql`${t.status} IN ('published', 'hidden', 'deleted')`),
    check('post_comments_like_ck', sql`${t.likeCount} >= 0`),
  ],
);

export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => postComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

/** Abonnements : followerId suit followeeId. */
export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index('follows_followee_idx').on(t.followeeId, t.createdAt),
    check('follows_self_ck', sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

/** Blocage : blockerId ne voit plus blockedId et réciproquement ; plus d'interaction possible entre eux. */
export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('user_blocks_blocked_idx').on(t.blockedId), check('user_blocks_self_ck', sql`${t.blockerId} <> ${t.blockedId}`)],
);

/**
 * Signalement d'un contenu (publication, commentaire, personne), traité par la modération dans l'administration.
 * Un seul signalement ouvert par personne et par contenu.
 */
export const contentReports = pgTable(
  'content_reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: varchar('target_type', { length: 8 }).notNull(),
    targetId: uuid('target_id').notNull(),
    /** Auteur du contenu signalé (pour la modération et les statistiques). */
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 16 }).notNull(),
    message: varchar('message', { length: 500 }),
    status: varchar('status', { length: 10 }).notNull().default('open'),
    /** none (rien à reprocher) · hidden (contenu masqué). */
    action: varchar('action', { length: 8 }),
    resolution: varchar('resolution', { length: 500 }),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('content_reports_status_idx').on(t.status, t.createdAt),
    index('content_reports_target_idx').on(t.targetType, t.targetId),
    // Centre de notifications : branche « contenu masqué » de chaque lecture (audit, D-8).
    index('content_reports_target_user_idx').on(t.targetUserId, t.resolvedAt).where(sql`${t.action} = 'hidden'`),
    uniqueIndex('content_reports_open_uq').on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} = 'open'`),
    check('content_reports_target_ck', sql`${t.targetType} IN ('post', 'comment', 'user', 'story', 'message', 'review')`),
    check('content_reports_reason_ck', sql`${t.reason} IN ('spam', 'harassment', 'nudity', 'violence', 'hate', 'self_harm', 'false_info', 'other')`),
    check('content_reports_status_ck', sql`${t.status} IN ('open', 'resolved')`),
    check('content_reports_action_ck', sql`${t.action} IS NULL OR ${t.action} IN ('none', 'hidden')`),
  ],
);

/**
 * Story (lot 4-B, écran 10) : une photo visible 24 heures par les abonnés de la personne (et par elle-même).
 * status : published, hidden (modération), deleted (supprimée par la personne). Les fichiers des stories expirées
 * sont effacés par la maintenance quotidienne (sauf signalement ouvert, pour la modération).
 */
export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('stories_user_idx').on(t.userId, t.expiresAt), index('stories_expires_idx').on(t.expiresAt), check('stories_status_ck', sql`${t.status} IN ('published', 'hidden', 'deleted')`)],
);

/** Stories vues (anneau gris dans le fil) ; rien d'autre n'est enregistré sur la personne qui regarde. */
export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.userId] })],
);

/**
 * Lot 5-E — « Produits et services utilisés » (écran 11, règle E2) : articles du BimShop que l'auteur d'un « J'ai fait
 * mon BIM » associe à son expérience (5 au plus). Simple lien vers la fiche : aucun achat ni commande depuis la
 * publication, aucun effet sur la réputation de l'article. Chaque lecteur ne voit que les fiches visibles pour lui.
 */
export const postProducts = pgTable(
  'post_products',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.productId] }),
    // 5 au plus, garanti par la base : positions 0 à 4, une seule fois chacune.
    uniqueIndex('post_products_position_uq').on(t.postId, t.position),
    index('post_products_product_idx').on(t.productId),
    check('post_products_position_ck', sql`${t.position} BETWEEN 0 AND 4`),
  ],
);
