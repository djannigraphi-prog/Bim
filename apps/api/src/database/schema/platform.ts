import { bigint, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Module Plateforme : réglages administrables (tarifs, âges, limites…) et journal d'audit.
 * Les règles métier configurables vivent dans app_settings, jamais en dur dans le code ou dans l'app mobile.
 */

export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description').notNull(),
  /** decided = validé par le fondateur ; provisional = validé sous réserve (ex. vérification légale) ; pending = non décidé. */
  decisionStatus: varchar('decision_status', { length: 12 }).notNull().default('pending'),
  decisionRef: varchar('decision_ref', { length: 40 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: varchar('updated_by', { length: 80 }),
});

export const actorType = pgEnum('actor_type', ['user', 'admin', 'system']);

/** Journal d'audit : en écriture seule. Jamais de mot de passe, de code ni de jeton dans metadata. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: uuid('target_id'),
    ip: inet('ip'),
    userAgent: varchar('user_agent', { length: 400 }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_actor_idx').on(t.actorId, t.createdAt), index('audit_logs_action_idx').on(t.action, t.createdAt)],
);

/**
 * Administration : comptes distincts des utilisateurs de l'app, rôles fins (section 5 de l'analyse).
 * Connexion : mot de passe puis code TOTP (application d'authentification), obligatoire pour tous les comptes.
 */
export const adminStatus = pgEnum('admin_status', ['active', 'disabled']);

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  fullName: varchar('full_name', { length: 120 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  /** Secret TOTP chiffré (AES-256-GCM, clé ADMIN_TOTP_ENCRYPTION_KEY) ; actif seulement après une première vérification. */
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  /** Dernier pas de temps TOTP accepté : un code ne peut pas servir deux fois. */
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  status: adminStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Étape intermédiaire de connexion (mot de passe accepté, code TOTP attendu). Jeton stocké haché. */
export const adminLoginChallenges = pgTable('admin_login_challenges', {
  id: uuid('id').primaryKey(),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  /** Secret proposé pendant l'enrôlement, chiffré ; devient le secret du compte après le premier code valide. */
  pendingTotpSecretEncrypted: text('pending_totp_secret_encrypted'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Sessions d'administration : jeton opaque haché, durée courte, révocables immédiatement. */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    ip: inet('ip'),
    userAgent: varchar('user_agent', { length: 400 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin_sessions_admin_idx').on(t.adminId)],
);

export const adminRoles = pgTable('admin_roles', {
  code: varchar('code', { length: 40 }).primaryKey(),
  label: varchar('label', { length: 80 }).notNull(),
});

export const adminUserRoles = pgTable(
  'admin_user_roles',
  {
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    roleCode: varchar('role_code', { length: 40 })
      .notNull()
      .references(() => adminRoles.code),
  },
  (t) => [primaryKey({ columns: [t.adminId, t.roleCode] })],
);
