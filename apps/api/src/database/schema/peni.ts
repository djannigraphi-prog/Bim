import { index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Peni (lot 3) : discussions guidées (écran 25). Données personnelles conservées dans la base de BIM uniquement :
 * aucun envoi à un fournisseur d'IA tant que le fondateur ne l'a pas autorisé (réglage `peni.llm_enabled`).
 */
export const peniConversations = pgTable(
  'peni_conversations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** new_project : construire un projet (écrans 19, 20, 25). */
    purpose: varchar('purpose', { length: 20 }).notNull(),
    /** open ou completed (brouillon prêt). */
    status: varchar('status', { length: 12 }).notNull().default('open'),
    /** Moteur et version qui ont produit les réponses (guided-v1 : réponses écrites, sans modèle de langage). */
    engine: varchar('engine', { length: 20 }).notNull(),
    state: jsonb('state').notNull(),
    /** Brouillon au format de POST /v1/projects, quand la discussion est terminée. */
    draft: jsonb('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('peni_conversations_user_idx').on(t.userId, t.createdAt)],
);

export const peniMessages = pgTable(
  'peni_messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => peniConversations.id, { onDelete: 'cascade' }),
    /** Copie du propriétaire : limite quotidienne de messages sans jointure. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Ordre dans la discussion (1, 2, 3…), attribué sous verrou. */
    seq: integer('seq').notNull(),
    /** peni ou user. */
    role: varchar('role', { length: 8 }).notNull(),
    text: varchar('text', { length: 1000 }).notNull(),
    /** Réponse rapide choisie (identifiant), pour un message de la personne. */
    choice: varchar('choice', { length: 60 }),
    quickReplies: jsonb('quick_replies').notNull().default([]),
    summary: jsonb('summary'),
    pose: varchar('pose', { length: 8 }),
    /** health ou urgent : message de prudence (aucun avis médical). */
    safety: varchar('safety', { length: 8 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('peni_messages_conversation_seq_uq').on(t.conversationId, t.seq), index('peni_messages_user_idx').on(t.userId, t.role, t.createdAt)],
);
