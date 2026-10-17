import { createHmac, timingSafeEqual } from 'node:crypto';
import { uuidv7 } from '../../../common/uuid';
import type { InitiateInput, InitiateResult, PaymentProvider, VerifyResult, WebhookEvent } from './provider';

export const SIMULATOR_SIGNATURE_HEADER = 'x-bim-simulator-signature';

/**
 * Simulateur de prestataire, pour le développement et les tests seulement (interdit ailleurs par la configuration).
 * Il imite le fonctionnement documenté des prestataires étudiés : référence propre au prestataire, notification
 * signée HMAC SHA512 sur le corps brut, vérification par appel serveur. Aucun argent ne circule.
 */
export class SimulatorProvider implements PaymentProvider {
  readonly name = 'simulator' as const;
  private readonly store = new Map<string, { amountFcfa: number; status: VerifyResult['status']; paidAmountFcfa: number | null }>();

  constructor(private readonly secret: string) {}

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const providerRef = `sim_${uuidv7()}`;
    this.store.set(providerRef, { amountFcfa: input.amountFcfa, status: 'pending', paidAmountFcfa: null });
    return { providerRef, redirectUrl: null };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const s = this.store.get(providerRef);
    if (!s) return { status: 'failed', amountFcfa: null, currency: null };
    return { status: s.status, amountFcfa: s.paidAmountFcfa, currency: s.paidAmountFcfa === null ? null : 'XOF' };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null {
    const sig = headers[SIMULATOR_SIGNATURE_HEADER];
    if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return null;
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
    try {
      const body = JSON.parse(rawBody.toString('utf8')) as { id?: unknown; reference?: unknown };
      if (typeof body.id !== 'string' || typeof body.reference !== 'string') return null;
      return { eventKey: body.id, providerRef: body.reference };
    } catch {
      return null;
    }
  }

  // ---- Outils de test : simuler la réponse du client chez le prestataire, puis la notification signée.

  sign(rawBody: Buffer | string) {
    return createHmac('sha512', this.secret).update(rawBody).digest('hex');
  }

  settle(providerRef: string, status: 'succeeded' | 'failed', paidAmountFcfa?: number) {
    const s = this.store.get(providerRef);
    if (!s) throw new Error('Référence inconnue du simulateur');
    s.status = status;
    s.paidAmountFcfa = status === 'succeeded' ? (paidAmountFcfa ?? s.amountFcfa) : null;
  }
}
