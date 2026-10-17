import { createHmac, timingSafeEqual } from 'node:crypto';
import { uuidv7 } from '../../../common/uuid';
import type { InitiateInput, InitiateResult, Operator, PayeeAccountCheck, PaymentProvider, RefundStatus, VerifyResult, WebhookEvent } from './provider';

export const SIMULATOR_SIGNATURE_HEADER = 'x-bim-simulator-signature';

/**
 * Simulateur de prestataire, pour le développement et les tests seulement (interdit ailleurs par la configuration).
 * Il imite le fonctionnement documenté des prestataires étudiés : référence propre, notification signée HMAC SHA512
 * sur le corps brut, vérification par appel serveur, remboursements. Aucun argent ne circule.
 */
export class SimulatorProvider implements PaymentProvider {
  readonly name = 'simulator' as const;
  readonly operators: Operator[] = ['orange', 'mtn', 'wave'];
  private readonly store = new Map<string, { amountFcfa: number; status: VerifyResult['status']; paidAmountFcfa: number | null; payee: string; paidPayee: string | null }>();
  private readonly refunds = new Map<string, RefundStatus>();

  constructor(private readonly secret: string) {}

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const providerRef = `sim_${uuidv7()}`;
    this.store.set(providerRef, { amountFcfa: input.amountFcfa, status: 'pending', paidAmountFcfa: null, payee: input.payeeAccountRef, paidPayee: null });
    return { providerRef, redirectUrl: `https://simulateur.invalid/pay/${providerRef}` };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const s = this.store.get(providerRef);
    if (!s) return { status: 'failed', amountFcfa: null, currency: null, payeeAccountRef: null, raw: 'unknown' };
    return { status: s.status, amountFcfa: s.paidAmountFcfa, currency: s.paidAmountFcfa === null ? null : 'XOF', payeeAccountRef: s.paidPayee, raw: s.status };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null {
    const sig = headers[SIMULATOR_SIGNATURE_HEADER];
    if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return null;
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
    try {
      const body = JSON.parse(rawBody.toString('utf8')) as { id?: unknown; reference?: unknown; refund?: unknown };
      if (typeof body.id !== 'string') return null;
      if (typeof body.refund === 'string') return { eventKey: body.id, kind: 'refund', providerRef: typeof body.reference === 'string' ? body.reference : null, refundRef: body.refund };
      if (typeof body.reference !== 'string') return null;
      return { eventKey: body.id, kind: 'charge', providerRef: body.reference, refundRef: null };
    } catch {
      return null;
    }
  }

  async refund(providerRef: string, amountFcfa: number): Promise<{ refundRef: string; status: RefundStatus }> {
    const s = this.store.get(providerRef);
    if (!s || s.status !== 'succeeded' || amountFcfa > (s.paidAmountFcfa ?? 0)) throw new Error('Remboursement refusé par le simulateur');
    const refundRef = `simr_${uuidv7()}`;
    this.refunds.set(refundRef, 'pending');
    return { refundRef, status: 'pending' };
  }

  /** Comptes simulés : par défaut valides (actifs, XOF, 0 % pour le compte principal) ; `setAccount` pour un autre cas. */
  readonly accounts = new Map<string, PayeeAccountCheck>();

  async checkPayeeAccount(accountRef: string): Promise<PayeeAccountCheck> {
    return this.accounts.get(accountRef) ?? { exists: true, active: true, mainAccountPercent: 0, currency: 'XOF' };
  }

  async fetchRefund(refundRef: string) {
    return { status: this.refunds.get(refundRef) ?? ('failed' as RefundStatus) };
  }

  // ---- Outils de test : simuler le prestataire.

  sign(rawBody: Buffer | string) {
    return createHmac('sha512', this.secret).update(rawBody).digest('hex');
  }

  /** Le client valide (ou non) chez le prestataire ; montant et bénéficiaire payés modifiables pour les tests. */
  settle(providerRef: string, status: 'succeeded' | 'failed', opts: { amountFcfa?: number; payee?: string } = {}) {
    const s = this.store.get(providerRef);
    if (!s) throw new Error('Référence inconnue du simulateur');
    s.status = status;
    s.paidAmountFcfa = status === 'succeeded' ? (opts.amountFcfa ?? s.amountFcfa) : null;
    s.paidPayee = status === 'succeeded' ? (opts.payee ?? s.payee) : null;
  }

  settleRefund(refundRef: string, status: RefundStatus) {
    this.refunds.set(refundRef, status);
  }
}
