import { createHmac } from 'node:crypto';

/**
 * V1 — Vérification d'un achat dans l'app auprès du magasin (Google Play Developer API, App Store Server API).
 *
 * Le serveur ne croit jamais l'app : il demande au magasin si la transaction existe, pour ce produit, et si elle est
 * payée ; il crédite ensuite d'après son propre catalogue (réglage `store.products`). Les vérificateurs réels seront
 * ajoutés avec les comptes développeur (après l'accord du fondateur) : ils n'ont pas pu être essayés chez Google ni chez
 * Apple, faute de compte. Seul le simulateur existe, réservé au développement et aux tests.
 */
export type StorePlatform = 'google' | 'apple';

export interface StoreVerification {
  /** Payé et non annulé chez le magasin. */
  valid: boolean;
  /** Produit réellement acheté (peut différer de celui annoncé par l'app : refusé). */
  productId: string;
  /** Identifiant unique de la transaction chez le magasin (anti-rejeu). */
  transactionId: string;
  /** Abonnement : fin de la période payée, donnée par le magasin. */
  expiresAt: Date | null;
  /** Achat fait par un compte testeur du magasin. */
  testPurchase: boolean;
}

export interface StoreVerifier {
  readonly name: string;
  verify(platform: StorePlatform, productId: string, purchaseToken: string): Promise<StoreVerification>;
}

export class StoreUnavailableError extends Error {}

/** Simulateur : un jeton est « payé » s'il a été signé par le test (`token`), jamais autrement. */
export class SimulatorStore implements StoreVerifier {
  readonly name = 'simulator';
  private readonly secret = 'bim-store-simulator';
  /** Jetons annulés (remboursés) chez le « magasin ». */
  readonly revoked = new Set<string>();
  unavailable = false;

  /** Jeton d'achat simulé pour un produit (utilisé par les tests et la démonstration). */
  token(productId: string, transactionId: string, opts: { days?: number; test?: boolean } = {}) {
    const body = Buffer.from(JSON.stringify({ productId, transactionId, days: opts.days ?? null, test: opts.test ?? true })).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
  }

  async verify(_platform: StorePlatform, productId: string, purchaseToken: string): Promise<StoreVerification> {
    if (this.unavailable) throw new StoreUnavailableError('magasin injoignable');
    const [body, sig] = purchaseToken.split('.');
    const ok = !!body && !!sig && createHmac('sha256', this.secret).update(body).digest('base64url') === sig;
    if (!ok) return { valid: false, productId, transactionId: '', expiresAt: null, testPurchase: false };
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { productId: string; transactionId: string; days: number | null; test: boolean };
    return {
      valid: !this.revoked.has(purchaseToken),
      productId: p.productId,
      transactionId: p.transactionId,
      expiresAt: p.days ? new Date(Date.now() + p.days * 86_400_000) : null,
      testPurchase: p.test,
    };
  }
}
