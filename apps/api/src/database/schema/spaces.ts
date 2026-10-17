import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgEnum, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Module Espaces : une personne = un compte utilisateur ; les espaces marchand et livreur s'y rattachent.
 *  - Plusieurs boutiques par utilisateur (Présentation p. 15, écran 53).
 *  - Un seul compte livreur par utilisateur : index unique sur courier_accounts.user_id.
 *  - Trois statuts de livreur (Q52) : indépendant, freelance (plusieurs boutiques), employé d'une boutique.
 *  - Seul un livreur ayant un partenariat actif avec une boutique, et le droit accordé par le marchand,
 *    peut encaisser le paiement des articles (précision du fondateur du 14/10/2026).
 * Lot 0 : tables et contrôle d'accès uniquement. La création de boutique / compte livreur (avec vérification
 * d'identité) arrive au lot 5 et au lot 7.
 */

export const shopStatus = pgEnum('shop_status', ['draft', 'pending_verification', 'active', 'suspended', 'closed']);
export const shopMemberRole = pgEnum('shop_member_role', ['owner', 'staff']);
export const courierType = pgEnum('courier_type', ['independent', 'freelance', 'employed']);
export const courierStatus = pgEnum('courier_status', ['pending_verification', 'active', 'suspended', 'closed']);
export const partnershipStatus = pgEnum('partnership_status', ['pending', 'active', 'ended']);

export const shops = pgTable(
  'shops',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    status: shopStatus('status').notNull().default('draft'),
    /** Lot 5 : présentation publique de la boutique (écran 54). */
    description: varchar('description', { length: 300 }),
    city: varchar('city', { length: 80 }),
    commune: varchar('commune', { length: 80 }),
    /** Logo : clé du stockage privé, servi par lien temporaire. */
    logoKey: varchar('logo_key', { length: 200 }),
    /** Boutique validée par l'équipe BIM (vérification d'identité de la personne qui l'ouvre). */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shops_slug_uq').on(t.slug), index('shops_owner_idx').on(t.ownerUserId)],
);

export const shopMembers = pgTable(
  'shop_members',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: shopMemberRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * 7-A : invitation acceptée par la personne (null = invitation en attente : aucun accès à la boutique).
     * Le propriétaire et les membres existants sont acceptés (valeur par défaut).
     */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow(),
    /** 7-A : propriétaire qui a invité la personne. */
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('shop_members_shop_user_uq').on(t.shopId, t.userId), index('shop_members_user_idx').on(t.userId)],
);

/**
 * 7-A (A16) — Permissions d'un employé, accordées et retirées par le propriétaire uniquement. Le propriétaire a tous
 * les droits ; un employé n'a que les permissions listées ici (aucune par défaut). Aucune permission ne donne le droit
 * d'encaisser des espèces : cela dépend du statut réel du livreur (F3 bis), jamais d'un droit de la boutique.
 */
export const SHOP_PERMISSIONS = [
  'orders.read',
  'orders.prepare',
  'products.edit',
  'products.publish',
  'products.visibility',
  'messages.reply',
  'deliveries.select_courier',
  'deliveries.settings',
  'payments.decide',
] as const;
export type ShopPermission = (typeof SHOP_PERMISSIONS)[number];

export const shopMemberPermissions = pgTable(
  'shop_member_permissions',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 32 }).notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.shopId, t.userId, t.permission] }),
    check('shop_member_permissions_ck', sql`${t.permission} IN (${sql.raw(SHOP_PERMISSIONS.map((p) => `'${p}'`).join(', '))})`),
  ],
);

export const courierAccounts = pgTable(
  'courier_accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Indicatif seulement : la catégorie d'un livreur pour une commande se déduit de sa relation avec la boutique (7-E). */
    type: courierType('type').notNull(),
    status: courierStatus('status').notNull().default('pending_verification'),
    // 7-E : vérification (pièces chiffrées, comme les marchands), puis profil de travail.
    idDocType: varchar('id_doc_type', { length: 12 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    rejectReason: varchar('reject_reason', { length: 300 }),
    /** Disponible pour des courses (déclaré par le livreur). */
    available: boolean('available').notNull().default(false),
    /** Courses simultanées au plus (déclaré). */
    capacity: integer('capacity').notNull().default(1),
    vehicle: varchar('vehicle', { length: 10 }),
    /** A3-b : opérateur Mobile Money du livreur (numéro = son téléphone vérifié), affiché au client qui paie un indépendant. */
    payoutOperator: varchar('payout_operator', { length: 8 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('courier_accounts_user_uq').on(t.userId),
    check('courier_accounts_capacity_ck', sql`${t.capacity} BETWEEN 1 AND 20`),
    check('courier_accounts_payout_operator_ck', sql`${t.payoutOperator} IS NULL OR ${t.payoutOperator} IN ('orange', 'mtn', 'wave', 'moov')`),
    check('courier_accounts_vehicle_ck', sql`${t.vehicle} IS NULL OR ${t.vehicle} IN ('moto', 'velo', 'voiture', 'pied')`),
  ],
);

export const courierShopPartnerships = pgTable(
  'courier_shop_partnerships',
  {
    id: uuid('id').primaryKey(),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => courierAccounts.id),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    status: partnershipStatus('status').notNull().default('pending'),
    /** 7-E : employee (employé de la boutique) · partner (partenaire). Seul l'emploi actif autorise les espèces (F3 bis). */
    relation: varchar('relation', { length: 10 }).notNull().default('partner'),
    invitedBy: uuid('invited_by').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    endedBy: uuid('ended_by').references(() => users.id),
    /** Ancien champ, **jamais** utilisé comme autorisation d'espèces (L7-02). */
    canCollectArticlePayment: boolean('can_collect_article_payment').notNull().default(false),
    /** Encours maximal (FCFA) que le livreur peut détenir pour la boutique avant de reverser. Null = non fixé. */
    maxOutstandingFcfa: bigint('max_outstanding_fcfa', { mode: 'number' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('courier_shop_active_uq')
      .on(t.courierId, t.shopId)
      .where(sql`${t.status} <> 'ended'`),
    // Au plus un emploi actif par livreur.
    uniqueIndex('courier_one_employment_uq')
      .on(t.courierId)
      .where(sql`${t.relation} = 'employee' AND ${t.status} = 'active'`),
    check('courier_shop_relation_ck', sql`${t.relation} IN ('employee', 'partner')`),
  ],
);
