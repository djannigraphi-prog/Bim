import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Lot 6-A — Messagerie entre personnes (écran 47) : conversations à deux, demandes, texte et photos, lu / non lu.
 * Les messages sont privés : seuls les deux membres les lisent ; l'équipe ne voit qu'un message signalé (journalisé).
 * Conservation : aucune suppression automatique tant que la durée n'est pas décidée (réglage messages.retention_days).
 */

/** Conversation. kind : direct (à deux). `directKey` = les deux identifiants triés : une seule conversation par paire. */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    kind: varchar('kind', { length: 10 }).notNull().default('direct'),
    directKey: varchar('direct_key', { length: 80 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('conversations_direct_uq').on(t.directKey), check('conversations_kind_ck', sql`${t.kind} IN ('direct')`)],
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
