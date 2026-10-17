import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../../config/config';
import { AppError, Errors } from '../../../common/errors';
import type { RequestMeta } from '../../../common/request-meta';
import { uuidv7 } from '../../../common/uuid';
import { DB, Database } from '../../../database/database.module';
import { orderEvents, orderPayments, orders, paymentIntents, paymentProviderEvents } from '../../../database/schema';
import { AuditService } from '../../audit/audit.service';
import { SettingsService } from '../../settings/settings.service';
import { PaymentsService } from '../payments.service';
import type { PaymentProvider } from './provider';
import { SimulatorProvider } from './simulator.provider';

/**
 * Lot 8 (socle, désactivé) — Paiement en ligne de l'article, au moment où le paiement est dû (après la remise, comme
 * « J'ai payé »). Fermé tant que deux conditions ne sont pas réunies : un prestataire configuré (`PAYMENT_PROVIDER`,
 * aujourd'hui « none » ou le simulateur de test) et le réglage `payments.online_enabled` décidé par le fondateur.
 * F4 : l'argent va directement à la boutique ; la confirmation du prestataire n'est jamais la décision de la boutique.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly log = new Logger('OnlinePayments');
  readonly provider: PaymentProvider | null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) cfg: AppConfig,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {
    this.provider = cfg.PAYMENT_PROVIDER === 'simulator' ? new SimulatorProvider(cfg.PAYMENT_SIMULATOR_SECRET) : null;
  }

  /** Ouvert seulement avec un prestataire configuré ET l'autorisation du fondateur (réglage « décidé » à true). */
  private async enabled(): Promise<PaymentProvider> {
    const s = await this.settings.get<boolean>('payments.online_enabled');
    if (!this.provider || s?.value !== true) throw Errors.notConfigured('Le paiement en ligne');
    return this.provider;
  }

  /** Le client lance le paiement en ligne de l'article (Mobile Money, après la remise, aucune décision encore). */
  async start(customerId: string, orderId: string, meta: RequestMeta) {
    const provider = await this.enabled();
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    const p = await this.payments.forOrder(orderId);
    if (!p || !(await this.payments.payable(o)) || p.method !== 'mobile_money' || p.failure !== 'none' || p.decision !== 'pending' || p.providerStatus === 'confirmed') {
      throw new AppError('PAYMENT_ACTION_NOT_ALLOWED', 'Le paiement en ligne est possible après la remise, pour un paiement Mobile Money encore dû.', HttpStatus.CONFLICT);
    }
    const id = uuidv7();
    const r = await provider.initiate({ reference: id, amountFcfa: p.amountFcfa, currency: 'XOF', payeeShopId: o.shopId, description: `Commande ${o.number}` });
    await this.db.transaction(async (tx) => {
      // Un seul paiement en ligne en cours (index unique) : un second lancement remplace le précédent, expiré.
      await tx.update(paymentIntents).set({ status: 'expired', settledAt: new Date() }).where(and(eq(paymentIntents.orderPaymentId, p.id), eq(paymentIntents.status, 'pending')));
      await tx.insert(paymentIntents).values({ id, orderPaymentId: p.id, payeeShopId: o.shopId, provider: provider.name, providerRef: r.providerRef, amountFcfa: p.amountFcfa, createdBy: customerId });
      await this.audit.log({ actorType: 'user', actorId: customerId, action: 'payments.online_started', targetType: 'order', targetId: o.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider: provider.name, amountFcfa: p.amountFcfa } }, tx);
    });
    return { intentId: id, status: 'pending' as const, amountFcfa: p.amountFcfa, redirectUrl: r.redirectUrl };
  }

  /**
   * Notification d'un prestataire. Signature invalide → ignorée (rien n'est écrit). Valide → enregistrée une seule
   * fois, puis le paiement est revérifié auprès du prestataire ; montant exact exigé. Répond toujours sans détail.
   */
  async webhook(providerName: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    const provider = this.provider;
    if (!provider || provider.name !== providerName || !rawBody) throw Errors.notFound('Prestataire');
    const ev = provider.parseWebhook(headers, rawBody);
    if (!ev) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature invalide.', HttpStatus.UNAUTHORIZED);
    const [intent] = await this.db.select().from(paymentIntents).where(and(eq(paymentIntents.provider, provider.name), eq(paymentIntents.providerRef, ev.providerRef))).limit(1);
    const inserted = await this.db
      .insert(paymentProviderEvents)
      .values({ id: uuidv7(), provider: provider.name, eventKey: ev.eventKey, intentId: intent?.id ?? null, outcome: intent ? 'received' : 'unknown_reference', payload: { reference: ev.providerRef } })
      .onConflictDoNothing()
      .returning({ id: paymentProviderEvents.id });
    if (!inserted.length || !intent || intent.status !== 'pending') return { received: true };
    // La notification ne fait jamais foi seule : vérification par appel serveur.
    const v = await provider.verify(intent.providerRef);
    if (v.status === 'pending') return { received: true };
    await this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id)).for('update').limit(1);
      if (i.status !== 'pending') return;
      const [p] = await tx.select().from(orderPayments).where(eq(orderPayments.id, i.orderPaymentId)).for('update').limit(1);
      const ok = v.status === 'succeeded' && v.amountFcfa === i.amountFcfa && v.currency === i.currency && p.failure === 'none' && p.method === 'mobile_money';
      const now = new Date();
      await tx.update(paymentIntents).set({ status: ok ? 'succeeded' : 'failed', settledAt: now }).where(eq(paymentIntents.id, i.id));
      if (ok) {
        await tx.update(orderPayments).set({ providerStatus: 'confirmed', providerConfirmedAt: now }).where(eq(orderPayments.id, p.id));
        await tx.insert(orderEvents).values({ id: uuidv7(), orderId: p.orderId, type: 'payment_provider_confirmed', actorType: 'system', actorId: null, data: { provider: provider.name, amountFcfa: i.amountFcfa } });
      } else if (v.status === 'succeeded') {
        // Montant ou devise différents : jamais confirmé ; à examiner par le support.
        this.log.warn(`Paiement ${i.id} : montant ou devise ne correspondent pas`);
      }
      await this.audit.log({ actorType: 'system', actorId: null, action: ok ? 'payments.provider_confirmed' : 'payments.provider_failed', targetType: 'order', targetId: p.orderId, metadata: { provider: provider.name, intentId: i.id, verified: v.status, amountFcfa: v.amountFcfa } }, tx);
    });
    return { received: true };
  }
}
