/**
 * Lot 8 — Interface commune des prestataires de paiement en ligne (Mobile Money). Le reste de BIM ne parle qu'à elle :
 * ajouter un prestataire revient à écrire une classe de plus, sans toucher aux commandes.
 *
 * Règles communes, quel que soit le prestataire :
 * - une notification n'est acceptée que si sa signature est valide (corps brut, secret du prestataire) ;
 * - elle ne fait jamais foi seule : le paiement est revérifié par un appel serveur (`verify`) avant toute confirmation ;
 * - montant, devise et compte bénéficiaire doivent correspondre exactement ; sinon le paiement est refusé ;
 * - F4 : l'argent va directement au compte de la boutique (`payeeAccountRef`) ; jamais sur un compte de BIM.
 */
export type ProviderName = 'simulator' | 'paystack';
/** Opérateurs Mobile Money ; un opérateur n'est proposé que si le prestataire le prend réellement en charge. */
export type Operator = 'orange' | 'mtn' | 'wave' | 'moov';

export interface InitiateInput {
  /** Identifiant BIM unique du paiement en ligne (référence chez le prestataire). */
  reference: string;
  amountFcfa: number;
  currency: 'XOF';
  /** Compte de la boutique chez le prestataire (F4). */
  payeeAccountRef: string;
  /** Qui supporte les frais du prestataire (décision commerciale du fondateur). */
  feeBearer: 'shop' | 'bim';
  /** Adresse demandée par certains prestataires ; jamais d'autre donnée personnelle. */
  customerEmail: string;
  description: string;
}

export interface InitiateResult {
  providerRef: string;
  /** Page du prestataire où le client valide le paiement. */
  redirectUrl: string | null;
}

export type VerifiedStatus = 'succeeded' | 'failed' | 'pending';

export interface VerifyResult {
  status: VerifiedStatus;
  amountFcfa: number | null;
  currency: string | null;
  /** Compte bénéficiaire constaté par le prestataire. */
  payeeAccountRef: string | null;
  /** Statut brut du prestataire (journal technique), jamais de donnée personnelle. */
  raw: string;
}

export interface WebhookEvent {
  /** Clé unique de l'événement (anti-doublon et anti-rejeu). */
  eventKey: string;
  kind: 'charge' | 'refund' | 'other';
  /** Référence du paiement (charge) ou de la transaction remboursée (refund). */
  providerRef: string | null;
  /** Identifiant du remboursement chez le prestataire (refund). */
  refundRef: string | null;
}

export type RefundStatus = 'pending' | 'processing' | 'processed' | 'failed';

export interface PaymentProvider {
  readonly name: ProviderName;
  /** Opérateurs que ce prestataire prend en charge en Côte d'Ivoire, selon sa documentation officielle. */
  readonly operators: Operator[];
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(providerRef: string): Promise<VerifyResult>;
  /** Signature valide → l'événement ; sinon `null` (la notification est refusée). */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null;
  refund(providerRef: string, amountFcfa: number, note: string): Promise<{ refundRef: string; status: RefundStatus }>;
  fetchRefund(refundRef: string): Promise<{ status: RefundStatus }>;
}

/** Erreur d'un prestataire (réseau, refus, réponse inattendue) : message technique, sans donnée personnelle. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
