import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
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
  },
  (t) => [uniqueIndex('shop_members_shop_user_uq').on(t.shopId, t.userId), index('shop_members_user_idx').on(t.userId)],
);

export const courierAccounts = pgTable(
  'courier_accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: courierType('type').notNull(),
    status: courierStatus('status').notNull().default('pending_verification'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('courier_accounts_user_uq').on(t.userId)],
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
    /** Droit, accordé par le marchand, d'encaisser le paiement des articles pour la boutique. */
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
  ],
);
