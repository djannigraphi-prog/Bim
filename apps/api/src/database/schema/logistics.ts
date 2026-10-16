import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { adminUsers } from './platform';

/**
 * Lot 7-D — Tarification des livraisons (LOT7_CONCEPTION §7, A2). Aucune valeur dans le code : les communes, les
 * durées estimées entre communes et les grilles sont saisies par BIM dans l'administration (A2-b, proposé).
 * Modes : `express` (rapide) et `economy` (économique). Le retrait en boutique n'a pas de frais.
 */

/** Communes desservables (référentiel de BIM). Code stable : ville et commune normalisées (`abidjan-cocody`). */
export const communes = pgTable(
  'communes',
  {
    code: varchar('code', { length: 80 }).primaryKey(),
    city: varchar('city', { length: 80 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('communes_code_ck', sql`${t.code} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)],
);

/**
 * Durée estimée d'un trajet (minutes) d'une commune à une autre, par mode. Absente = livraison indisponible
 * (jamais d'estimation inventée). Modifiable ; la valeur utilisée est copiée dans la commande à la confirmation.
 */
export const deliveryDurations = pgTable(
  'delivery_durations',
  {
    fromCode: varchar('from_code', { length: 80 })
      .notNull()
      .references(() => communes.code),
    toCode: varchar('to_code', { length: 80 })
      .notNull()
      .references(() => communes.code),
    mode: varchar('mode', { length: 10 }).notNull(),
    minutes: integer('minutes').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => adminUsers.id),
  },
  (t) => [
    primaryKey({ columns: [t.fromCode, t.toCode, t.mode] }),
    check('delivery_durations_mode_ck', sql`${t.mode} IN ('express', 'economy')`),
    check('delivery_durations_minutes_ck', sql`${t.minutes} BETWEEN 1 AND 2880`),
  ],
);

/**
 * Grille tarifaire d'un mode, versionnée. Brouillon modifiable → publiée (immuable, déclencheur de la base) →
 * remplacée. La grille en vigueur d'un mode est sa dernière version publiée ; elle s'applique aux commandes
 * confirmées après sa publication.
 */
export const deliveryTariffs = pgTable(
  'delivery_tariffs',
  {
    id: uuid('id').primaryKey(),
    mode: varchar('mode', { length: 10 }).notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 10 }).notNull().default('draft'),
    baseFcfa: integer('base_fcfa').notNull(),
    perMinuteFcfa: integer('per_minute_fcfa').notNull(),
    minimumFcfa: integer('minimum_fcfa').notNull(),
    roundingFcfa: integer('rounding_fcfa').notNull(),
    freeWaitMinutes: integer('free_wait_minutes').notNull(),
    waitPerMinuteFcfa: integer('wait_per_minute_fcfa').notNull(),
    waitCapMinutes: integer('wait_cap_minutes').notNull(),
    createdBy: uuid('created_by').references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => adminUsers.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('delivery_tariffs_version_uq').on(t.mode, t.version),
    // Un seul brouillon par mode.
    uniqueIndex('delivery_tariffs_draft_uq').on(t.mode).where(sql`${t.status} = 'draft'`),
    index('delivery_tariffs_published_idx').on(t.mode, t.publishedAt),
    check('delivery_tariffs_mode_ck', sql`${t.mode} IN ('express', 'economy')`),
    check('delivery_tariffs_status_ck', sql`${t.status} IN ('draft', 'published')`),
    check(
      'delivery_tariffs_values_ck',
      sql`${t.baseFcfa} >= 0 AND ${t.perMinuteFcfa} >= 0 AND ${t.minimumFcfa} >= 0 AND ${t.roundingFcfa} >= 1 AND ${t.freeWaitMinutes} >= 0 AND ${t.waitPerMinuteFcfa} >= 0 AND ${t.waitCapMinutes} >= 0`,
    ),
    check('delivery_tariffs_published_ck', sql`(${t.status} = 'published') = (${t.publishedAt} IS NOT NULL)`),
  ],
);
