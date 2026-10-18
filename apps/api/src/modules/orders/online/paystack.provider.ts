import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { InitiateInput, InitiateResult, Operator, PayeeAccountCheck, PaymentProvider, VerifyResult, WebhookEvent } from './provider';
import { ProviderError } from './provider';

export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';
const TIMEOUT_MS = 15_000;

/**
 * Paystack (documentation officielle consultée le 17/10/2026, paystack.com/docs) — **désactivé par défaut**, clés de
 * test seulement (la configuration refuse toute clé de production).
 *
 * - Initialisation : `POST /transaction/initialize` (montant XOF × 100 : « no subunit for XOF, multiply by 100 »),
 *   canal `mobile_money` seulement, `subaccount` = compte de la boutique (F4), `bearer` selon la décision sur les frais.
 * - Vérification : `GET /transaction/verify/:reference` (statut, montant, devise, sous-compte).
 * - Notifications : en-tête `x-paystack-signature` = HMAC SHA512 du corps brut avec la clé secrète. Paystack n'envoie
 *   une notification que pour les paiements réussis : les échecs se constatent par la vérification.
 * - Aucun remboursement par BIM (règle du fondateur, 18/10/2026) : l'API de remboursement n'est jamais appelée.
 * - Compte de la boutique : `GET /subaccount/:code` (actif, devise, `percentage_charge` = part du compte principal,
 *   qui doit être 0 : BIM ne prélève aucune commission). `bearer: subaccount` : la boutique supporte les frais (L8-02).
 * - Opérateurs en Côte d'Ivoire selon Paystack : MTN, Orange, Wave. **Moov Money n'est pas pris en charge.**
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack' as const;
  readonly operators: Operator[] = ['orange', 'mtn', 'wave'];
  private readonly log = new Logger('Paystack');

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly callbackUrl: string | null = null,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // Réseau ou délai dépassé : on peut réessayer plus tard ; aucune donnée de la requête n'est journalisée.
      this.log.warn(`Paystack injoignable (${path.split('/')[1]}) : ${(e as Error).name}`);
      throw new ProviderError('Prestataire injoignable', true);
    }
    const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!res.ok || !json || json.status !== true || json.data === undefined) {
      this.log.warn(`Paystack a refusé (${path.split('/')[1]}) : HTTP ${res.status}`);
      throw new ProviderError(`Refus du prestataire (HTTP ${res.status})`, res.status >= 500);
    }
    return json.data;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const data = await this.call<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
      email: input.customerEmail,
      amount: String(input.amountFcfa * 100),
      currency: input.currency,
      reference: input.reference,
      channels: ['mobile_money'],
      subaccount: input.payeeAccountRef,
      bearer: input.feeBearer === 'shop' ? 'subaccount' : 'account',
      // Commission de BIM : 0 % (aucune part pour le compte principal).
      transaction_charge: 0,
      ...(this.callbackUrl ? { callback_url: this.callbackUrl } : {}),
      metadata: JSON.stringify({ bim_reference: input.reference, description: input.description }),
    });
    if (data.reference !== input.reference) throw new ProviderError('Référence inattendue du prestataire', false);
    return { providerRef: data.reference, redirectUrl: data.authorization_url };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const d = await this.call<{ status: string; amount: number; currency: string; reference: string; subaccount?: { subaccount_code?: string } | null }>(
      'GET',
      `/transaction/verify/${encodeURIComponent(providerRef)}`,
    );
    if (d.reference !== providerRef) throw new ProviderError('Référence inattendue du prestataire', false);
    const status: VerifyResult['status'] = d.status === 'success' ? 'succeeded' : ['failed', 'abandoned', 'reversed'].includes(d.status) ? 'failed' : 'pending';
    const amount = Number.isInteger(d.amount) ? d.amount / 100 : null;
    return { status, amountFcfa: amount !== null && Number.isInteger(amount) ? amount : null, currency: d.currency ?? null, payeeAccountRef: d.subaccount?.subaccount_code ?? null, raw: d.status };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null {
    const sig = headers[PAYSTACK_SIGNATURE_HEADER];
    if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/i.test(sig)) return null;
    const expected = Buffer.from(createHmac('sha512', this.secretKey).update(rawBody).digest('hex'), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig.toLowerCase(), 'hex'))) return null;
    let body: { event?: unknown; data?: Record<string, unknown> };
    try {
      body = JSON.parse(rawBody.toString('utf8')) as typeof body;
    } catch {
      return null;
    }
    const event = typeof body.event === 'string' ? body.event : '';
    const data = body.data ?? {};
    if (event.startsWith('charge.success')) {
      const ref = typeof data.reference === 'string' ? data.reference : null;
      return { eventKey: `${event}:${String(data.id ?? ref)}`, kind: 'charge', providerRef: ref };
    }
    return { eventKey: `${event}:${String(data.id ?? '')}`, kind: 'other', providerRef: null };
  }

  async checkPayeeAccount(accountRef: string): Promise<PayeeAccountCheck> {
    try {
      const d = await this.call<{ active?: boolean; is_verified?: boolean; percentage_charge?: number; currency?: string; subaccount_code?: string }>(
        'GET',
        `/subaccount/${encodeURIComponent(accountRef)}`,
      );
      if (d.subaccount_code !== undefined && d.subaccount_code !== accountRef) return { exists: false, active: false, mainAccountPercent: null, currency: null };
      return { exists: true, active: d.active === true, mainAccountPercent: typeof d.percentage_charge === 'number' ? d.percentage_charge : null, currency: d.currency ?? null };
    } catch (e) {
      // 404 : compte inconnu ; toute autre erreur remonte (réessayer plus tard).
      if (e instanceof ProviderError && e.message.includes('HTTP 404')) return { exists: false, active: false, mainAccountPercent: null, currency: null };
      throw e;
    }
  }
}
