import { boolean, integer, pgEnum, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Module Profils : centres d'intérêt (écran 05, au moins 3), confidentialité et préférences.
 * Par défaut rien de personnel n'est public : date de naissance, genre et commune restent privés.
 */

export const themePreference = pgEnum('theme_preference', ['system', 'light', 'dark']);

/** Liste administrable des centres d'intérêt ; le code est stable, le libellé peut évoluer. */
export const interests = pgTable('interests', {
  code: varchar('code', { length: 40 }).primaryKey(),
  label: varchar('label', { length: 60 }).notNull(),
  icon: varchar('icon', { length: 40 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const userInterests = pgTable(
  'user_interests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interestCode: varchar('interest_code', { length: 40 })
      .notNull()
      .references(() => interests.code),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.interestCode] })],
);

export const privacySettings = pgTable('privacy_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  birthDatePublic: boolean('birth_date_public').notNull().default(false),
  genderPublic: boolean('gender_public').notNull().default(false),
  cityPublic: boolean('city_public').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: themePreference('theme').notNull().default('system'),
  language: varchar('language', { length: 5 }).notNull().default('fr'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
