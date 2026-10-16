import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { communes } from './logistics';
import { courierAccounts } from './spaces';

/**
 * Lot 7-E — Livreurs : pièces de vérification (chiffrées, lues seulement par l'administration autorisée, chaque lecture
 * journalisée) et communes desservies. Rien ici ne donne accès aux commandes d'une boutique (L7-04).
 */
export const courierDocuments = pgTable(
  'courier_documents',
  {
    id: uuid('id').primaryKey(),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => courierAccounts.id),
    kind: varchar('kind', { length: 10 }).notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('courier_documents_kind_uq').on(t.courierId, t.kind), check('courier_documents_kind_ck', sql`${t.kind} IN ('id_front', 'id_back', 'selfie')`)],
);

export const courierCommunes = pgTable(
  'courier_communes',
  {
    courierId: uuid('courier_id')
      .notNull()
      .references(() => courierAccounts.id),
    communeCode: varchar('commune_code', { length: 80 })
      .notNull()
      .references(() => communes.code),
  },
  (t) => [primaryKey({ columns: [t.courierId, t.communeCode] }), index('courier_communes_commune_idx').on(t.communeCode)],
);
