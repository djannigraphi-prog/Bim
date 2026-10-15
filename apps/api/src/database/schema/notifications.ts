import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Appareils qui reçoivent les notifications push (lot 2). Un jeton est rattaché à l'appareil connecté, c'est-à-dire à la
 * famille de sessions (`sessions.family_id`, stable malgré les rotations de jetons) — jamais à une ligne de session.
 * Supprimé à la déconnexion ou à la révocation de l'appareil, et quand le service d'envoi le déclare invalide.
 */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionFamilyId: uuid('session_family_id').notNull(),
    /** android (FCM) ou ios (APNs via FCM). */
    platform: varchar('platform', { length: 8 }).notNull(),
    token: varchar('token', { length: 4096 }).notNull(),
    appVersion: varchar('app_version', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_devices_family_uq').on(t.sessionFamilyId),
    uniqueIndex('push_devices_token_uq').on(t.token),
    index('push_devices_user_idx').on(t.userId),
    check('push_devices_platform_ck', sql`${t.platform} IN ('android', 'ios')`),
  ],
);

/**
 * Préférences de notification de la personne (lot 2). Heures calmes : null = valeur de la plateforme
 * (réglage `notifications.quiet_hours`, dans l'administration), sinon « HH:MM » à l'heure locale.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    remindersEnabled: boolean('reminders_enabled').notNull().default(true),
    quietStart: varchar('quiet_start', { length: 5 }),
    quietEnd: varchar('quiet_end', { length: 5 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('notification_prefs_quiet_ck', sql`(${t.quietStart} IS NULL) = (${t.quietEnd} IS NULL)`),
    check('notification_prefs_time_ck', sql`${t.quietStart} IS NULL OR (${t.quietStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.quietEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`),
  ],
);
