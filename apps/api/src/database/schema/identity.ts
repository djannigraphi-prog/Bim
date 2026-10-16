import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Module Identité : comptes, coordonnées de récupération, identités sociales, sessions, codes de vérification.
 * Règles portées par ces tables :
 *  - F16 : un compte actif possède au moins une coordonnée vérifiée (téléphone privilégié, ou e-mail).
 *  - Une coordonnée vérifiée n'appartient qu'à un seul compte (index unique partiel).
 *  - Aucun secret en clair : mots de passe (Argon2id), jetons de session (SHA-256) et codes (HMAC) sont hachés.
 */

export const userStatus = pgEnum('user_status', ['pending_verification', 'active', 'suspended', 'deleted']);
export const gender = pgEnum('gender', ['female', 'male', 'undisclosed']);
export const contactType = pgEnum('contact_type', ['phone', 'email']);
export const socialProvider = pgEnum('social_provider', ['google', 'apple', 'facebook']);
export const verificationPurpose = pgEnum('verification_purpose', [
  'signup',
  'password_reset',
  'contact_add',
  'step_up',
  // Lot 5 : numéro Mobile Money d'une boutique (écran 07), confirmé par un code SMS.
  'payout_number',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    status: userStatus('status').notNull().default('pending_verification'),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    /** Stocké en minuscules, sans « @ ». */
    username: varchar('username', { length: 30 }).notNull(),
    /** Privée par défaut (jamais renvoyée dans un profil public). Sert au calcul d'âge (F15). */
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    gender: gender('gender'),
    city: varchar('city', { length: 80 }).notNull(),
    /** Photo de profil (lot 4, écrans 05 et 52) : clé du stockage privé, servie par lien temporaire ; null : initiales. */
    avatarKey: varchar('avatar_key', { length: 200 }),
    /** Null pour un compte créé uniquement via Google, Apple ou Facebook. */
    passwordHash: text('password_hash'),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username), index('users_status_idx').on(t.status)],
);

export const userContacts = pgTable(
  'user_contacts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: contactType('type').notNull(),
    /** Téléphone au format E.164 (+2250700000000), e-mail en minuscules. */
    value: varchar('value', { length: 254 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_contacts_user_type_value_uq').on(t.userId, t.type, t.value),
    uniqueIndex('user_contacts_verified_value_uq')
      .on(t.type, t.value)
      .where(sql`${t.verifiedAt} is not null`),
    index('user_contacts_lookup_idx').on(t.type, t.value),
  ],
);

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: socialProvider('provider').notNull(),
    providerSubject: varchar('provider_subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 254 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_identities_provider_subject_uq').on(t.provider, t.providerSubject)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Toutes les rotations d'un même appareil partagent la même famille : une réutilisation révoque la famille. */
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull(),
    deviceName: varchar('device_name', { length: 120 }),
    userAgent: varchar('user_agent', { length: 400 }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 40 }),
  },
  (t) => [
    uniqueIndex('sessions_refresh_hash_uq').on(t.refreshTokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
  ],
);

export const verificationCodes = pgTable(
  'verification_codes',
  {
    id: uuid('id').primaryKey(),
    /** Null quand la demande ne correspond à aucun compte (mot de passe oublié) : on ne révèle pas l'existence d'un compte. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: verificationPurpose('purpose').notNull(),
    channel: contactType('channel').notNull(),
    destination: varchar('destination', { length: 254 }).notNull(),
    /** Pour une demande de type step_up : l'opération sensible visée (ex. contact_change, withdrawal). */
    scope: varchar('scope', { length: 40 }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    sendCount: integer('send_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_codes_user_idx').on(t.userId), index('verification_codes_dest_idx').on(t.destination)],
);

/** Autorisation à usage unique et de courte durée pour une opération sensible (changement de coordonnées, retrait…). */
export const stepUpGrants = pgTable(
  'step_up_grants',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 40 }).notNull(),
    /** L'autorisation n'est valable que depuis la session (l'appareil) qui l'a obtenue. */
    sessionId: uuid('session_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('step_up_grants_token_uq').on(t.tokenHash)],
);

/** Journal des tentatives de connexion, utilisé pour limiter les essais par identifiant et par adresse IP. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey(),
    identifierHash: varchar('identifier_hash', { length: 64 }).notNull(),
    ip: inet('ip'),
    success: boolean('success').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_identifier_idx').on(t.identifierHash, t.createdAt), index('login_attempts_ip_idx').on(t.ip, t.createdAt)],
);
