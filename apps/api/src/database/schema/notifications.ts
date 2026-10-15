import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
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

/**
 * File des rappels à envoyer et historique des envois (lot 2). Une ligne par occurrence « projet|tâche|jour|tentative » :
 * la clé unique garantit qu'un rappel n'est enregistré qu'une fois, même si plusieurs planificateurs tournent.
 * États : pending (à envoyer) → sending (pris par un worker, avec un bail) → sent | skipped | stale | failed.
 * Un bail expiré (worker arrêté en plein envoi) remet la ligne en pending : reprise après panne sans perte.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey(),
    key: varchar('key', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull().default('task_reminder'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    day: varchar('day', { length: 10 }),
    attempt: integer('attempt').notNull().default(0),
    fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('pending'),
    /** Raison d'un rappel non envoyé (done, paused, disabled, quiet, no_device, invalid_token…), sans donnée personnelle. */
    reason: varchar('reason', { length: 40 }),
    sendTries: integer('send_tries').notNull().default(0),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: varchar('claimed_by', { length: 80 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_key_uq').on(t.key),
    index('notification_deliveries_due_idx').on(t.status, t.fireAt),
    index('notification_deliveries_user_idx').on(t.userId, t.createdAt),
    check('notification_deliveries_status_ck', sql`${t.status} IN ('pending', 'sending', 'sent', 'skipped', 'stale', 'failed')`),
  ],
);

/** Battement de cœur des workers (surveillance : un worker silencieux depuis plus de 3 minutes déclenche une alerte). */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  name: varchar('name', { length: 80 }).primaryKey(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  details: varchar('details', { length: 400 }),
});
