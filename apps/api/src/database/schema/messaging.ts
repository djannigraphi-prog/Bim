import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './catalog';
import { users } from './identity';
import { projectOffers } from './offers';
import { shops } from './spaces';

/**
 * Lot 6-A — Messagerie entre personnes (écran 47) : conversations à deux, demandes, texte et photos, lu / non lu.
 * Les messages sont privés : seuls les deux membres les lisent ; l'équipe ne voit qu'un message signalé (journalisé).
 * Conservation : aucune suppression automatique tant que la durée n'est pas décidée (réglage messages.retention_days).
 */

/**
 * Conversation.
 * - kind direct (6-A) : deux personnes ; `directKey` = les deux identifiants triés : une seule conversation par paire.
 * - kind shop (6-B) : une personne (cliente, seul membre de `conversation_members`) et une boutique ; tous les membres
 *   actifs de la boutique y répondent depuis l'espace boutique. `directKey` = `shop:<boutique>:<cliente>` : une seule
 *   conversation par cliente et par boutique. Seule la cliente peut l'ouvrir (la boutique ne démarche personne).
 *   L'état côté boutique (lu, archivée, marquée) est commun à toute l'équipe de la boutique.
 * Point d'intégration des commandes (lot 7) : le module Commandes publiera ses cartes comme messages d'un nouveau
 * type, qui ne contiendront qu'une référence ; l'app affiche un texte neutre pour tout type qu'elle ne connaît pas.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    kind: varchar('kind', { length: 10 }).notNull().default('direct'),
    directKey: varchar('direct_key', { length: 80 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 6-B : la boutique (kind shop). */
    shopId: uuid('shop_id').references(() => shops.id),
    /** 6-B : dernier message lu par la boutique. */
    shopLastReadMessageId: uuid('shop_last_read_message_id'),
    /** 6-B : rangée dans « Archivés » par la boutique (revient dans « Tous » au prochain message de la cliente). */
    shopArchivedAt: timestamp('shop_archived_at', { withTimezone: true }),
    /** 6-B : marquée par la boutique (à suivre). */
    shopMarkedAt: timestamp('shop_marked_at', { withTimezone: true }),
    /** 6-B : article dont on parle (bandeau de l'écran 48), dernier ouvert avec « Discuter ». */
    contextProductId: uuid('context_product_id').references(() => products.id, { onDelete: 'set null' }),
    /** 6-B : offre de projet à l'origine de la conversation (« Discuter » de l'écran 49). */
    contextOfferId: uuid('context_offer_id').references(() => projectOffers.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('conversations_direct_uq').on(t.directKey),
    index('conversations_shop_idx').on(t.shopId, t.lastMessageAt),
    check('conversations_kind_ck', sql`${t.kind} IN ('direct', 'shop')`),
    check('conversations_shop_ck', sql`(${t.kind} = 'direct' AND ${t.shopId} IS NULL) OR (${t.kind} = 'shop' AND ${t.shopId} IS NOT NULL)`),
  ],
);

/**
 * Membre d'une conversation. status : active (dans « Tous »), request (demande à accepter : la personne ne suit pas
 * l'auteur), declined (demande refusée : masquée, l'auteur n'en est pas averti).
 */
export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 10 }).notNull().default('active'),
    /** Dernier message lu (identifiant uuidv7, ordonné dans le temps). */
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_members_user_idx').on(t.userId, t.status),
    check('conversation_members_status_ck', sql`${t.status} IN ('active', 'request', 'declined')`),
  ],
);

/** Message. kind : text · photo. status : published · deleted (par son auteur) · hidden (modération). */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 6-B : message envoyé au nom de la boutique (`sender_id` = la personne de l'équipe qui l'a écrit). */
    senderShopId: uuid('sender_shop_id').references(() => shops.id),
    kind: varchar('kind', { length: 8 }).notNull().default('text'),
    text: varchar('text', { length: 2000 }),
    mediaKey: varchar('media_key', { length: 200 }),
    mediaWidth: integer('media_width'),
    mediaHeight: integer('media_height'),
    status: varchar('status', { length: 10 }).notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.id),
    index('messages_sender_idx').on(t.senderId, t.createdAt),
    check('messages_kind_ck', sql`${t.kind} IN ('text', 'photo')`),
    check('messages_status_ck', sql`${t.status} IN ('published', 'deleted', 'hidden')`),
    check('messages_content_ck', sql`(${t.kind} = 'text' AND ${t.text} IS NOT NULL) OR (${t.kind} = 'photo' AND ${t.mediaKey} IS NOT NULL) OR ${t.status} <> 'published'`),
  ],
);

/** 6-B — Réponses rapides d'une boutique (écran 51), 10 au plus, communes à toute l'équipe. */
export const shopQuickReplies = pgTable(
  'shop_quick_replies',
  {
    id: uuid('id').primaryKey(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    text: varchar('text', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shop_quick_replies_shop_idx').on(t.shopId, t.createdAt)],
);
