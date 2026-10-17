import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../../config/config';
import { AppError, Errors } from '../../../common/errors';
import type { RequestMeta } from '../../../common/request-meta';
import { uuidv7 } from '../../../common/uuid';
import { DB, Database, DbOrTx } from '../../../database/database.module';
import { orderEvents, orderPayments, orders, paymentIntents, paymentProviderEvents, paymentRefunds, shopPaymentAccounts, shops, userContacts } from '../../../database/schema';
import type { AdminContext } from '../../admin/admin.decorators';
import { AuditService } from '../../audit/audit.service';
import { SettingsService } from '../../settings/settings.service';
import { PaymentsService } from '../payments.service';
import { PaystackProvider } from './paystack.provider';
import { type PaymentProvider, ProviderError, type VerifyResult } from './provider';
import { SimulatorProvider } from './simulator.provider';

type Intent = typeof paymentIntents.$inferSelect;
type Order = typeof orders.$inferSelect;
type Payment = typeof orderPayments.$inferSelect;

/** Raison pour laquelle le paiement en ligne n'est pas proposé (jamais affichée comme une erreur au client). */
export type OnlineUnavailable = 'NO_PROVIDER' | 'NOT_ENABLED' | 'FEE_BEARER_NOT_DECIDED' | 'SHOP_FEES_NOT_PUBLISHED' | 'SHOP_ACCOUNT_MISSING' | 'NOT_DUE' | 'ALREADY_CONFIRMED';

const unavailableMessage: Record<OnlineUnavailable, string> = {
  NO_PROVIDER: 'Le paiement en ligne n’est pas encore disponible.',
  NOT_ENABLED: 'Le paiement en ligne n’est pas encore ouvert.',
  FEE_BEARER_NOT_DECIDED: 'Le paiement en ligne n’est pas encore ouvert.',
  SHOP_FEES_NOT_PUBLISHED: 'Le paiement en ligne n’est pas encore ouvert.',
  SHOP_ACCOUNT_MISSING: 'Cette boutique ne reçoit pas encore de paiement en ligne.',
  NOT_DUE: 'Le paiement en ligne est possible après la remise, pour un paiement Mobile Money encore dû.',
  ALREADY_CONFIRMED: 'Ce paiement est déjà vérifié par le prestataire.',
};

/**
 * Lot 8 — Paiement en ligne de l'article (Mobile Money), au moment où il est dû (après la remise, comme « J'ai payé »).
 * Ouvert seulement si tout est réuni : prestataire configuré, réglage `payments.online_enabled` décidé à true, décision
 * sur les frais (`payments.fee_bearer` = « shop », L8-02 : la boutique supporte les frais du prestataire, BIM ne prélève
 * rien), frais publiés aux boutiques (`payments.shop_fee_terms`), compte actif de la boutique chez le prestataire, sans
 * part pour le compte principal (F4 : jamais sur un compte BIM).
 * La confirmation du prestataire n'est jamais la décision de la boutique : la commande reste « livrée » jusqu'à elle.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly log = new Logger('OnlinePayments');
  readonly provider: PaymentProvider | null;
  private readonly emailDomain: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) cfg: AppConfig,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {
    this.provider =
      cfg.PAYMENT_PROVIDER === 'simulator'
        ? new SimulatorProvider(cfg.PAYMENT_SIMULATOR_SECRET)
        : cfg.PAYMENT_PROVIDER === 'paystack'
          ? new PaystackProvider(cfg.PAYSTACK_SECRET_KEY, cfg.PAYSTACK_API_BASE_URL || undefined, cfg.PAYMENT_CALLBACK_URL || null)
          : null;
    this.emailDomain = cfg.PAYMENT_CUSTOMER_EMAIL_DOMAIN || 'bim.invalid';
  }

  private async platformOpen(): Promise<{ ok: true; feeBearer: 'shop' | 'bim' } | { ok: false; reason: OnlineUnavailable }> {
    if (!this.provider) return { ok: false, reason: 'NO_PROVIDER' };
    const enabled = await this.settings.get<boolean>('payments.online_enabled');
    if (enabled?.value !== true || enabled.decisionStatus !== 'decided') return { ok: false, reason: 'NOT_ENABLED' };
    // L8-02 : la boutique supporte les frais du prestataire ; toute autre valeur garde le paiement fermé.
    const bearer = await this.settings.get<string | null>('payments.fee_bearer');
    if (bearer?.value !== 'shop' || bearer.decisionStatus !== 'decided') return { ok: false, reason: 'FEE_BEARER_NOT_DECIDED' };
    // Les frais applicables sont communiqués aux boutiques avant toute activation.
    const terms = await this.settings.get<string | null>('payments.shop_fee_terms');
    if (typeof terms?.value !== 'string' || !terms.value.trim() || terms.decisionStatus !== 'decided') return { ok: false, reason: 'SHOP_FEES_NOT_PUBLISHED' };
    return { ok: true, feeBearer: 'shop' };
  }

  private async shopAccount(shopId: string, tx: DbOrTx = this.db) {
    if (!this.provider) return null;
    const [a] = await tx
      .select()
      .from(shopPaymentAccounts)
      .where(and(eq(shopPaymentAccounts.shopId, shopId), eq(shopPaymentAccounts.provider, this.provider.name), eq(shopPaymentAccounts.status, 'active')))
      .limit(1);
    return a ?? null;
  }

  /**
   * Ce que la boutique doit savoir avant de recevoir des paiements en ligne (L8-02) : la boutique supporte les frais du
   * prestataire, BIM ne prélève aucune commission, le client paie le prix affiché ; frais publiés, état de son compte.
   */
  async shopTerms(shopId: string) {
    const platform = await this.platformOpen();
    const terms = await this.settings.get<string | null>('payments.shop_fee_terms');
    const account = await this.shopAccount(shopId);
    return {
      open: platform.ok,
      provider: this.provider?.name ?? null,
      operators: this.provider && platform.ok ? this.provider.operators : [],
      feesPaidBy: 'shop' as const,
      bimCommissionPercent: 0,
      customerPaysDisplayedPrice: true,
      feeTerms: terms?.decisionStatus === 'decided' && typeof terms.value === 'string' ? terms.value : null,
      accountActive: account !== null,
    };
  }

  /** Disponibilité pour une commande (affichage de l'action « Payer en ligne » et contrôle au lancement). */
  async availability(o: Order, p: Payment | null): Promise<{ ok: true; feeBearer: 'shop' | 'bim'; accountRef: string } | { ok: false; reason: OnlineUnavailable }> {
    const platform = await this.platformOpen();
    if (!platform.ok) return platform;
    if (!p || !(await this.payments.payable(o)) || p.method !== 'mobile_money' || p.failure !== 'none' || p.decision !== 'pending') return { ok: false, reason: 'NOT_DUE' };
    if (p.providerStatus === 'confirmed') return { ok: false, reason: 'ALREADY_CONFIRMED' };
    const account = await this.shopAccount(o.shopId);
    if (!account) return { ok: false, reason: 'SHOP_ACCOUNT_MISSING' };
    return { ok: true, feeBearer: platform.feeBearer, accountRef: account.accountRef };
  }

  /** Vue pour le client : proposé ou non, opérateurs réellement pris en charge, dernier paiement en ligne. */
  async customerView(o: Order) {
    const p = await this.payments.forOrder(o.id);
    const av = await this.availability(o, p);
    const [last] = p ? await this.db.select().from(paymentIntents).where(eq(paymentIntents.orderPaymentId, p.id)).orderBy(desc(paymentIntents.createdAt)).limit(1) : [];
    // Rien n'est montré tant que le paiement en ligne n'est ni ouvert ni utilisé (aucun moyen inactif affiché).
    if (!av.ok && !last) return null;
    return {
      available: av.ok,
      operators: av.ok ? this.provider!.operators : [],
      last: last ? { id: last.id, status: last.status, failureReason: last.failureReason, createdAt: last.createdAt } : null,
    };
  }

  /** Adresse transmise au prestataire : l'e-mail vérifié du client, sinon une adresse technique sans donnée personnelle. */
  private async customerEmail(userId: string) {
    const [c] = await this.db
      .select({ value: userContacts.value })
      .from(userContacts)
      .where(and(eq(userContacts.userId, userId), eq(userContacts.type, 'email'), isNotNull(userContacts.verifiedAt)))
      .limit(1);
    return c?.value ?? `c-${createHash('sha256').update(userId).digest('hex').slice(0, 20)}@${this.emailDomain}`;
  }

  /** Le client lance le paiement en ligne de l'article. */
  async start(customerId: string, orderId: string, meta: RequestMeta) {
    // Fermé pour tout le monde tant que la plateforme ne l'est pas (même réponse pour toute commande).
    if (!(await this.platformOpen()).ok) throw Errors.notConfigured('Le paiement en ligne');
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    const p = await this.payments.forOrder(orderId);
    const av = await this.availability(o, p);
    if (!av.ok) {
      if (av.reason === 'NO_PROVIDER' || av.reason === 'NOT_ENABLED' || av.reason === 'FEE_BEARER_NOT_DECIDED') throw Errors.notConfigured('Le paiement en ligne');
      throw new AppError(av.reason === 'SHOP_ACCOUNT_MISSING' ? 'SHOP_PAYMENT_ACCOUNT_MISSING' : 'PAYMENT_ACTION_NOT_ALLOWED', unavailableMessage[av.reason], HttpStatus.CONFLICT);
    }
    const provider = this.provider!;
    const id = uuidv7();
    let r;
    try {
      r = await provider.initiate({
        reference: id,
        amountFcfa: p!.amountFcfa,
        currency: 'XOF',
        payeeAccountRef: av.accountRef,
        feeBearer: av.feeBearer,
        customerEmail: await this.customerEmail(customerId),
        description: `Commande ${o.number}`,
      });
    } catch (e) {
      if (e instanceof ProviderError) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Le service de paiement ne répond pas. Réessaie dans quelques minutes.', HttpStatus.SERVICE_UNAVAILABLE);
      throw e;
    }
    await this.db.transaction(async (tx) => {
      // Un seul paiement en ligne en cours : un nouveau lancement remplace le précédent (expiré, plus jamais confirmé).
      await tx.update(paymentIntents).set({ status: 'expired', failureReason: 'replaced', settledAt: new Date() }).where(and(eq(paymentIntents.orderPaymentId, p!.id), eq(paymentIntents.status, 'pending')));
      await tx.insert(paymentIntents).values({ id, orderPaymentId: p!.id, payeeShopId: o.shopId, payeeAccountRef: av.accountRef, provider: provider.name, providerRef: r.providerRef, amountFcfa: p!.amountFcfa, createdBy: customerId });
      await this.audit.log({ actorType: 'user', actorId: customerId, action: 'payments.online_started', targetType: 'order', targetId: o.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider: provider.name, amountFcfa: p!.amountFcfa } }, tx);
    });
    return { intentId: id, status: 'pending' as const, amountFcfa: p!.amountFcfa, redirectUrl: r.redirectUrl, operators: provider.operators };
  }

  /** « J'ai validé le paiement » : vérification immédiate auprès du prestataire (il ne notifie pas les échecs). */
  async check(customerId: string, orderId: string) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    const p = await this.payments.forOrder(orderId);
    const [i] = p ? await this.db.select().from(paymentIntents).where(eq(paymentIntents.orderPaymentId, p.id)).orderBy(desc(paymentIntents.createdAt)).limit(1) : [];
    if (!i) throw Errors.notFound('Paiement en ligne');
    if (i.status === 'pending' && this.provider) {
      try {
        await this.settle(i, await this.provider.verify(i.providerRef), 'check');
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Le service de paiement ne répond pas. Réessaie dans quelques minutes.', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
    const [now] = await this.db.select().from(paymentIntents).where(eq(paymentIntents.id, i.id));
    return { intentId: now.id, status: now.status, failureReason: now.failureReason };
  }

  /**
   * Résultat vérifié appliqué à un paiement en ligne, sous verrou, une seule fois. Confirmé seulement si le prestataire
   * dit « réussi » ET que le montant, la devise et le compte bénéficiaire sont exactement ceux attendus.
   */
  private async settle(intent: Intent, v: VerifyResult, source: 'webhook' | 'check' | 'expiry') {
    if (v.status === 'pending') return;
    await this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id)).for('update').limit(1);
      if (i.status !== 'pending') return;
      const [p] = await tx.select().from(orderPayments).where(eq(orderPayments.id, i.orderPaymentId)).for('update').limit(1);
      let failure: string | null = null;
      if (v.status === 'failed') failure = 'provider_failed';
      else if (v.amountFcfa !== i.amountFcfa) failure = 'amount_mismatch';
      else if (v.currency !== i.currency) failure = 'currency_mismatch';
      else if (i.payeeAccountRef && v.payeeAccountRef !== i.payeeAccountRef) failure = 'payee_mismatch';
      else if (p.failure !== 'none' || p.method !== 'mobile_money' || p.decision !== 'pending') failure = 'payment_closed';
      const now = new Date();
      await tx.update(paymentIntents).set({ status: failure ? 'failed' : 'succeeded', failureReason: failure, settledAt: now }).where(eq(paymentIntents.id, i.id));
      if (!failure) {
        await tx.update(orderPayments).set({ providerStatus: 'confirmed', providerConfirmedAt: now }).where(eq(orderPayments.id, p.id));
        await tx.insert(orderEvents).values({ id: uuidv7(), orderId: p.orderId, type: 'payment_provider_confirmed', actorType: 'system', actorId: null, data: { provider: i.provider, amountFcfa: i.amountFcfa } });
      } else if (v.status === 'succeeded') {
        // Payé, mais pas comme attendu : jamais confirmé ; le support examine (journal).
        this.log.warn(`Paiement en ligne ${i.id} : ${failure}`);
      }
      await this.audit.log(
        {
          actorType: 'system',
          actorId: null,
          action: failure ? 'payments.provider_failed' : 'payments.provider_confirmed',
          targetType: 'order',
          targetId: p.orderId,
          metadata: { provider: i.provider, intentId: i.id, source, verified: v.raw, reason: failure },
        },
        tx,
      );
    });
  }

  /**
   * Notification d'un prestataire. Signature invalide → refusée, rien n'est écrit. Valide → enregistrée une seule fois
   * (anti-rejeu), puis revérifiée auprès du prestataire ; seul le résultat vérifié compte.
   */
  async webhook(providerName: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    const provider = this.provider;
    if (!provider || provider.name !== providerName || !rawBody) throw Errors.notFound('Prestataire');
    const ev = provider.parseWebhook(headers, rawBody);
    if (!ev) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature invalide.', HttpStatus.UNAUTHORIZED);
    const [intent] = ev.providerRef ? await this.db.select().from(paymentIntents).where(and(eq(paymentIntents.provider, provider.name), eq(paymentIntents.providerRef, ev.providerRef))).limit(1) : [];
    const inserted = await this.db
      .insert(paymentProviderEvents)
      .values({ id: uuidv7(), provider: provider.name, eventKey: ev.eventKey, intentId: intent?.id ?? null, outcome: intent ? ev.kind : 'unknown_reference', payload: { kind: ev.kind } })
      .onConflictDoNothing()
      .returning({ id: paymentProviderEvents.id });
    if (!inserted.length || !intent) return { received: true };
    try {
      if (ev.kind === 'charge' && intent.status === 'pending') await this.settle(intent, await provider.verify(intent.providerRef), 'webhook');
      if (ev.kind === 'refund') await this.refreshRefunds(intent.id);
    } catch (e) {
      // Prestataire injoignable : la notification est gardée ; le paiement sera revérifié (expiration ou vérification).
      if (!(e instanceof ProviderError)) throw e;
    }
    return { received: true };
  }

  /** Worker : paiements en ligne non validés après le délai réglé → revérifiés, puis expirés s'ils restent en attente. */
  async expirePending(now = new Date()) {
    if (!this.provider) return 0;
    const s = await this.settings.get<number>('payments.intent_expiry_minutes');
    const minutes = typeof s?.value === 'number' && s.value > 0 ? s.value : 30;
    const due = await this.db
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.status, 'pending'), eq(paymentIntents.provider, this.provider.name), lt(paymentIntents.createdAt, new Date(now.getTime() - minutes * 60_000))))
      .limit(100);
    let n = 0;
    for (const i of due) {
      try {
        const v = await this.provider.verify(i.providerRef);
        if (v.status !== 'pending') {
          await this.settle(i, v, 'expiry');
          continue;
        }
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        continue; // revérifié au prochain passage
      }
      const done = await this.db
        .update(paymentIntents)
        .set({ status: 'expired', failureReason: 'expired', settledAt: now })
        .where(and(eq(paymentIntents.id, i.id), eq(paymentIntents.status, 'pending')))
        .returning({ id: paymentIntents.id });
      n += done.length;
    }
    return n;
  }

  // ------------------------------------------------------------------ Administration

  private requireProvider() {
    if (!this.provider) throw Errors.notConfigured('Le paiement en ligne');
    return this.provider;
  }

  /** Paiements en ligne récents (lecture journalisée). */
  async adminList(a: AdminContext, status: string | undefined, meta: RequestMeta) {
    const rows = await this.db
      .select({ i: paymentIntents, number: orders.number, shop: shops.name })
      .from(paymentIntents)
      .innerJoin(orderPayments, eq(orderPayments.id, paymentIntents.orderPaymentId))
      .innerJoin(orders, eq(orders.id, orderPayments.orderId))
      .innerJoin(shops, eq(shops.id, paymentIntents.payeeShopId))
      .where(status && ['pending', 'succeeded', 'failed', 'expired'].includes(status) ? eq(paymentIntents.status, status) : undefined)
      .orderBy(desc(paymentIntents.createdAt))
      .limit(100);
    const refunds = rows.length ? await this.db.select().from(paymentRefunds).where(inArray(paymentRefunds.intentId, rows.map((r) => r.i.id))) : [];
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.online_payments_viewed', targetType: 'payment_intent', ip: meta.ip, userAgent: meta.userAgent, metadata: { status: status ?? 'all', count: rows.length } });
    return {
      provider: this.provider?.name ?? 'none',
      operators: this.provider?.operators ?? [],
      items: rows.map((r) => ({
        id: r.i.id,
        orderNumber: r.number,
        shop: r.shop,
        provider: r.i.provider,
        amountFcfa: r.i.amountFcfa,
        status: r.i.status,
        failureReason: r.i.failureReason,
        createdAt: r.i.createdAt,
        settledAt: r.i.settledAt,
        refunds: refunds.filter((x) => x.intentId === r.i.id).map((x) => ({ id: x.id, amountFcfa: x.amountFcfa, status: x.status, reason: x.reason, createdAt: x.createdAt })),
      })),
    };
  }

  async adminAccounts() {
    const rows = await this.db
      .select({ a: shopPaymentAccounts, shop: shops.name, slug: shops.slug })
      .from(shopPaymentAccounts)
      .innerJoin(shops, eq(shops.id, shopPaymentAccounts.shopId))
      .orderBy(desc(shopPaymentAccounts.createdAt))
      .limit(200);
    return { items: rows.map((r) => ({ id: r.a.id, shopId: r.a.shopId, shop: r.shop, slug: r.slug, provider: r.a.provider, accountRef: r.a.accountRef, status: r.a.status, note: r.a.note, createdAt: r.a.createdAt })) };
  }

  /** Associe une boutique à son compte chez le prestataire (référence vérifiée auprès de lui par l'équipe BIM). */
  async setAccount(a: AdminContext, shopSlug: string, accountRef: string, note: string | undefined, meta: RequestMeta) {
    const provider = this.requireProvider();
    const [s] = await this.db.select({ id: shops.id, status: shops.status }).from(shops).where(eq(shops.slug, shopSlug.trim().toLowerCase())).limit(1);
    if (!s || s.status !== 'active') throw Errors.notFound('Boutique');
    const ref = accountRef.trim();
    if (!/^[A-Za-z0-9_-]{4,60}$/.test(ref)) throw Errors.validation({ fields: { accountRef: ['Référence du compte invalide.'] } });
    // F4 et L8-02 vérifiés chez le prestataire avant l'enregistrement : compte actif, en XOF, sans aucune part pour le
    // compte principal (BIM ne prélève aucune commission).
    const check = await provider.checkPayeeAccount(ref).catch((e: unknown) => {
      if (e instanceof ProviderError) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Le prestataire ne répond pas. Réessaie plus tard.', HttpStatus.SERVICE_UNAVAILABLE);
      throw e;
    });
    const problems = [
      ...(check.exists ? [] : ['Compte introuvable chez le prestataire.']),
      ...(check.exists && !check.active ? ['Compte inactif chez le prestataire.'] : []),
      ...(check.exists && check.mainAccountPercent !== 0 ? ['Le compte prévoit une part pour BIM : elle doit être de 0 %.'] : []),
      ...(check.exists && check.currency !== null && check.currency !== 'XOF' ? ['Le compte doit être réglé en XOF.'] : []),
    ];
    if (problems.length) throw new AppError('PAYEE_ACCOUNT_INVALID', problems.join(' '), HttpStatus.UNPROCESSABLE_ENTITY, { problems });
    await this.db.transaction(async (tx) => {
      await tx
        .update(shopPaymentAccounts)
        .set({ status: 'disabled', disabledAt: new Date() })
        .where(and(eq(shopPaymentAccounts.shopId, s.id), eq(shopPaymentAccounts.provider, provider.name), eq(shopPaymentAccounts.status, 'active')));
      await tx.insert(shopPaymentAccounts).values({ id: uuidv7(), shopId: s.id, provider: provider.name, accountRef: ref, note: note?.trim() || null, createdByAdmin: a.adminId });
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.shop_payment_account_set', targetType: 'shop', targetId: s.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider: provider.name } }, tx);
    });
    return this.adminAccounts();
  }

  async disableAccount(a: AdminContext, id: string, meta: RequestMeta) {
    const [u] = await this.db.update(shopPaymentAccounts).set({ status: 'disabled', disabledAt: new Date() }).where(and(eq(shopPaymentAccounts.id, id), eq(shopPaymentAccounts.status, 'active'))).returning();
    if (!u) throw Errors.notFound('Compte');
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.shop_payment_account_disabled', targetType: 'shop', targetId: u.shopId, ip: meta.ip, userAgent: meta.userAgent });
    return this.adminAccounts();
  }

  /**
   * Remboursement demandé par l'équipe BIM (jamais automatique, A8), motif obligatoire, au plus le montant payé moins ce
   * qui est déjà remboursé ou en cours. Le prestataire rend l'argent depuis le compte qui l'a reçu (la boutique, F4).
   */
  async refund(a: AdminContext, intentId: string, amountFcfa: number | undefined, reason: string, meta: RequestMeta) {
    const provider = this.requireProvider();
    const [i] = await this.db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
    if (!i || i.provider !== provider.name) throw Errors.notFound('Paiement en ligne');
    if (i.status !== 'succeeded') throw new AppError('REFUND_NOT_ALLOWED', 'Seul un paiement vérifié se rembourse.', HttpStatus.CONFLICT);
    const [{ used }] = await this.db
      .select({ used: sql<number>`coalesce(sum(${paymentRefunds.amountFcfa}), 0)::int` })
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.intentId, i.id), inArray(paymentRefunds.status, ['pending', 'processing', 'processed'])));
    const amount = amountFcfa ?? i.amountFcfa - used;
    if (!Number.isInteger(amount) || amount < 1 || amount + used > i.amountFcfa) {
      throw new AppError('REFUND_AMOUNT_INVALID', `Au plus ${i.amountFcfa - used} F à rembourser.`, HttpStatus.BAD_REQUEST, { maxFcfa: i.amountFcfa - used });
    }
    let r;
    try {
      r = await provider.refund(i.providerRef, amount, reason);
    } catch (e) {
      if (e instanceof ProviderError) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Le prestataire a refusé ou ne répond pas.', HttpStatus.SERVICE_UNAVAILABLE);
      throw new AppError('REFUND_NOT_ALLOWED', 'Le prestataire a refusé ce remboursement.', HttpStatus.CONFLICT);
    }
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(paymentRefunds).values({ id, intentId: i.id, amountFcfa: amount, reason: reason.trim(), status: r.status, providerRefundRef: r.refundRef, requestedByAdmin: a.adminId });
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.payment_refund_requested', targetType: 'payment_intent', targetId: i.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { amountFcfa: amount } }, tx);
    });
    return { id, status: r.status, amountFcfa: amount };
  }

  /** Statut des remboursements en cours, relu auprès du prestataire (après une notification signée). */
  private async refreshRefunds(intentId: string) {
    const provider = this.requireProvider();
    const open = await this.db.select().from(paymentRefunds).where(and(eq(paymentRefunds.intentId, intentId), inArray(paymentRefunds.status, ['pending', 'processing'])));
    for (const r of open) {
      if (!r.providerRefundRef) continue;
      const { status } = await provider.fetchRefund(r.providerRefundRef);
      if (status === r.status) continue;
      await this.db
        .update(paymentRefunds)
        .set({ status, settledAt: status === 'processed' || status === 'failed' ? new Date() : null })
        .where(and(eq(paymentRefunds.id, r.id), inArray(paymentRefunds.status, ['pending', 'processing'])));
      await this.audit.log({ actorType: 'system', actorId: null, action: `payments.refund_${status}`, targetType: 'payment_intent', targetId: intentId, metadata: { refundId: r.id } });
    }
  }
}
