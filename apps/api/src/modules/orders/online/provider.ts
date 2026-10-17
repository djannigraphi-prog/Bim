/**
 * Lot 8 — Interface commune des prestataires de paiement en ligne (Mobile Money). Le reste de BIM ne parle qu'à elle :
 * ajouter un prestataire (Paystack, CinetPay…) revient à écrire une classe de plus, sans toucher aux commandes.
 * Aucun prestataire réel n'est branché (autorisation du fondateur requise, étude du 17/10/2026).
 *
 * Règles communes, quel que soit le prestataire :
 * - une notification n'est acceptée que si sa signature est valide (corps brut, secret du prestataire) ;
 * - elle ne fait jamais foi seule : le paiement est revérifié par un appel serveur (`verify`) avant toute confirmation ;
 * - montant et devise doivent correspondre exactement ; sinon le paiement est refusé et journalisé ;
 * - F4 : l'argent va directement à la boutique (`payeeShopId`) ; BIM ne détient pas les fonds.
 */
export type ProviderName = 'simulator';

export interface InitiateInput {
  /** Identifiant BIM unique du paiement en ligne (sert de référence chez le prestataire). */
  reference: string;
  amountFcfa: number;
  currency: 'XOF';
  /** Boutique bénéficiaire (F4). Un prestataire réel y associera le sous-compte ou le compte de la boutique. */
  payeeShopId: string;
  description: string;
}

export interface InitiateResult {
  providerRef: string;
  /** Page du prestataire où le client valide le paiement (absente si la validation se fait sur le téléphone). */
  redirectUrl: string | null;
}

export type VerifiedStatus = 'succeeded' | 'failed' | 'pending';

export interface VerifyResult {
  status: VerifiedStatus;
  amountFcfa: number | null;
  currency: string | null;
}

export interface WebhookEvent {
  /** Clé unique de l'événement chez le prestataire (anti-doublon). */
  eventKey: string;
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(providerRef: string): Promise<VerifyResult>;
  /** Signature valide → l'événement ; sinon `null` (la notification est ignorée). */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null;
}
