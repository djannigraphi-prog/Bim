import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { shops } from './spaces';

/**
 * Lot 5-A — Ouverture d'une boutique (écrans 07 à 09) : demande vérifiée par l'équipe BIM (revue manuelle d'abord,
 * prestataire de vérification ensuite, selon le contrat KYC). Données sensibles : les images de la pièce d'identité et
 * du selfie sont ré-encodées (métadonnées supprimées), **chiffrées par l'application** (AES-256-GCM, clé
 * KYC_ENCRYPTION_KEY) puis rangées dans le stockage privé ; elles ne sont lues que par l'équipe autorisée, et chaque
 * lecture est inscrite au journal d'audit. Durée de conservation : non fixée (réglage kyc.document_retention_days,
 * à valider), rien n'est supprimé automatiquement.
 *
 * status : draft (en préparation) · submitted (envoyée, à vérifier) · approved (boutique ouverte) · rejected (à
 * corriger, motif donné à la personne).
 */
export const merchantApplications = pgTable(
  'merchant_applications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 10 }).notNull().default('draft'),
    /** cni · passport · permis */
    idDocType: varchar('id_doc_type', { length: 10 }),
    /** Numéro Mobile Money de la boutique (E.164) et opérateur ; confirmé par un code SMS. */
    payoutPhone: varchar('payout_phone', { length: 20 }),
    payoutOperator: varchar('payout_operator', { length: 10 }),
    payoutVerifiedAt: timestamp('payout_verified_at', { withTimezone: true }),
    /** Adresse de la boutique ou du domicile (facultative), jamais publique. */
    address: varchar('address', { length: 200 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: varchar('rejection_reason', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('merchant_applications_shop_uq').on(t.shopId),
    // Une seule demande ouverte par personne, garanti par la base (audit, D-2 : double envoi simultané).
    uniqueIndex('merchant_applications_open_user_uq').on(t.userId).where(sql`${t.status} IN ('draft', 'submitted', 'rejected')`),
    index('merchant_applications_status_idx').on(t.status, t.submittedAt),
    index('merchant_applications_user_idx').on(t.userId),
    check('merchant_applications_status_ck', sql`${t.status} IN ('draft', 'submitted', 'approved', 'rejected')`),
    check('merchant_applications_doc_ck', sql`${t.idDocType} IS NULL OR ${t.idDocType} IN ('cni', 'passport', 'permis')`),
    check('merchant_applications_operator_ck', sql`${t.payoutOperator} IS NULL OR ${t.payoutOperator} IN ('wave', 'orange', 'mtn', 'moov')`),
  ],
);

/** Images chiffrées d'une demande : id_front, id_back, selfie (une de chaque ; une nouvelle remplace l'ancienne). */
export const merchantDocuments = pgTable(
  'merchant_documents',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => merchantApplications.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 10 }).notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('merchant_documents_kind_uq').on(t.applicationId, t.kind), check('merchant_documents_kind_ck', sql`${t.kind} IN ('id_front', 'id_back', 'selfie')`)],
);
