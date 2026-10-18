import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { orders } from './orders';
import { courierAccounts } from './spaces';

/**
 * Lot 7-F — Livraisons (LOT7_CONCEPTION §3.3 à §3.8, §4 ; décision du 16/10, 22 h 27). Une livraison par commande livrée
 * à domicile, distincte de la commande. Le marchand déclenche la recherche, sollicite un livreur éligible (priorité
 * employés, puis partenaires, puis indépendants, calculée par le serveur) ; le livreur sollicité accepte ou refuse dans
 * le délai. Un livreur ne voit que les missions qui lui sont proposées, ses courses et son historique.
 *
 * Statuts : searching (recherche) → offered (proposée à un livreur) → accepted → picked_up → arrived → code_validated →
 * closed (clôturée par le livreur). Sorties : refused_by_client · client_absent · cancelled. Après un refus ou une absence,
 * le colis revient en boutique : la boutique confirme le retour (returned_at), la commande est alors annulée et le stock remis.
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    status: varchar('status', { length: 18 }).notNull().default('searching'),
    /** V1 : tentatives de livraison (1, puis 2 après une nouvelle tentative demandée par le client absent). */
    attempts: integer('attempts').notNull().default(1),
    /** V1 : changement de livreur demandé par la boutique après la prise en charge (accord du livreur, sinon support). */
    reassignRequestedAt: timestamp('reassign_requested_at', { withTimezone: true }),
    reassignReason: varchar('reassign_reason', { length: 300 }),
    reassignRequestedBy: uuid('reassign_requested_by'),
    /** Livreur attribué (après acceptation). */
    courierId: uuid('courier_id').references(() => courierAccounts.id),
    /** Catégorie du livreur pour cette boutique au moment de l'acceptation : employee · partner · independent. */
    courierCategory: varchar('courier_category', { length: 12 }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    codeValidatedAt: timestamp('code_validated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Attente enregistrée (de l'arrivée à la fin de l'attente) ; facturée seulement si le réglage l'autorise. */
    waitedSeconds: integer('waited_seconds'),
    waitFeeFcfa: integer('wait_fee_fcfa'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: varchar('end_reason', { length: 300 }),
    /** Motif de refus du client (article incorrect, endommagé, incomplet, autre). */
    refusalReason: varchar('refusal_reason', { length: 20 }),
    /** Retour en boutique (après refus ou absence du client) : la boutique confirme avoir récupéré le colis. */
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnConfirmedBy: uuid('return_confirmed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('deliveries_order_uq').on(t.orderId),
    index('deliveries_courier_idx').on(t.courierId, t.createdAt),
    check('deliveries_attempts_ck', sql`${t.attempts} BETWEEN 1 AND 3`),
    check('deliveries_status_ck', sql`${t.status} IN ('searching', 'offered', 'accepted', 'picked_up', 'arrived', 'code_validated', 'closed', 'refused_by_client', 'client_absent', 'cancelled')`),
    check('deliveries_category_ck', sql`${t.courierCategory} IS NULL OR ${t.courierCategory} IN ('employee', 'partner', 'independent')`),
    check('deliveries_refusal_ck', sql`${t.refusalReason} IS NULL OR ${t.refusalReason} IN ('incorrect', 'damaged', 'incomplete', 'other')`),
    check('deliveries_return_ck', sql`${t.returnedAt} IS NULL OR (${t.status} IN ('refused_by_client', 'client_absent') AND ${t.returnConfirmedBy} IS NOT NULL)`),
    check('deliveries_courier_ck', sql`${t.status} IN ('searching', 'offered', 'cancelled') OR ${t.courierId} IS NOT NULL`),
  ],
);

/**
 * Mission proposée à un livreur (une à la fois par livraison) : offered → accepted · declined · expired · withdrawn.
 * Garde la catégorie calculée à la proposition et, si le marchand passe un livreur prioritaire disponible, son motif.
 */
export const deliveryOffers = pgTable(
  'delivery_offers',
  {
    id: uuid('id').primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id),
    courierId: uuid('courier_id')
      .notNull()
      .references(() => courierAccounts.id),
    category: varchar('category', { length: 12 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('offered'),
    skipReason: varchar('skip_reason', { length: 300 }),
    offeredBy: uuid('offered_by')
      .notNull()
      .references(() => users.id),
    offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    // Une seule proposition en cours par livraison (sollicitations simultanées impossibles).
    uniqueIndex('delivery_offers_open_uq').on(t.deliveryId).where(sql`${t.status} = 'offered'`),
    index('delivery_offers_courier_idx').on(t.courierId, t.status),
    check('delivery_offers_status_ck', sql`${t.status} IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn')`),
    check('delivery_offers_category_ck', sql`${t.category} IN ('employee', 'partner', 'independent')`),
  ],
);

/** Historique horodaté de la livraison (écriture seule). */
export const deliveryEvents = pgTable(
  'delivery_events',
  {
    id: uuid('id').primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id),
    type: varchar('type', { length: 30 }).notNull(),
    actorType: varchar('actor_type', { length: 10 }).notNull(),
    actorId: uuid('actor_id'),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('delivery_events_delivery_idx').on(t.deliveryId, t.createdAt), check('delivery_events_actor_ck', sql`${t.actorType} IN ('customer', 'shop', 'courier', 'system', 'admin')`)],
);

/**
 * Lot 7-G — Incidents liés à une commande ou à sa livraison. Aucune pénalité, aucun frais, aucun remboursement
 * automatique : un incident se constate, se suit et se transmet au support, qui note sa décision.
 * Statuts : open → with_support → resolved. Le motif est choisi dans une liste ; la description est libre.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    deliveryId: uuid('delivery_id').references(() => deliveries.id),
    openedByType: varchar('opened_by_type', { length: 10 }).notNull(),
    openedById: uuid('opened_by_id').notNull(),
    reason: varchar('reason', { length: 24 }).notNull(),
    description: varchar('description', { length: 1000 }),
    status: varchar('status', { length: 14 }).notNull().default('open'),
    resolution: varchar('resolution', { length: 1000 }),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('incidents_order_idx').on(t.orderId),
    index('incidents_status_idx').on(t.status, t.createdAt),
    check('incidents_opener_ck', sql`${t.openedByType} IN ('customer', 'shop', 'courier', 'system')`),
    check('incidents_status_ck', sql`${t.status} IN ('open', 'with_support', 'resolved')`),
    check(
      'incidents_reason_ck',
      sql`${t.reason} IN ('item_incorrect', 'item_damaged', 'item_incomplete', 'client_absent', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'reassign_refused', 'other')`,
    ),
  ],
);

/**
 * Décision du 17/10/2026 (18 h 50) — Photos jointes à un incident par les parties (client, boutique, livreur) : 3 au
 * plus par incident, ré-encodées sans métadonnées, stockées en privé (liens temporaires) ; supprimées 30 jours après la
 * clôture (vente close ou incident résolu) par la maintenance quotidienne.
 */
export const incidentPhotos = pgTable(
  'incident_photos',
  {
    id: uuid('id').primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id),
    uploadedByType: varchar('uploaded_by_type', { length: 10 }).notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('incident_photos_incident_idx').on(t.incidentId, t.createdAt), check('incident_photos_by_ck', sql`${t.uploadedByType} IN ('customer', 'shop', 'courier')`)],
);

/** Messages et actions d'un incident (écriture seule) : description, ajouts des parties, transmission, décision. */
export const incidentEvents = pgTable(
  'incident_events',
  {
    id: uuid('id').primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id),
    type: varchar('type', { length: 20 }).notNull(),
    actorType: varchar('actor_type', { length: 10 }).notNull(),
    actorId: uuid('actor_id'),
    note: varchar('note', { length: 1000 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('incident_events_incident_idx').on(t.incidentId, t.createdAt), check('incident_events_actor_ck', sql`${t.actorType} IN ('customer', 'shop', 'courier', 'system', 'admin')`)],
);
