import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { deliveries, merchantApplications, orderEvents, orderPayments, orders, shops, users } from '../../database/schema';
import type { AdminContext } from '../admin/admin.decorators';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

type Payment = typeof orderPayments.$inferSelect;
type Order = typeof orders.$inferSelect;

/** Statut affiché, calculé à partir des cinq informations (§5) ; libellés honnêtes, jamais « payé » sans décision. */
export function paymentStatus(p: Payment): string {
  if (p.failure === 'cancelled') return 'cancelled';
  if (p.failure === 'failed') return 'failed';
  if (p.decision === 'confirmed') return 'confirmed_by_shop';
  if (p.decision === 'contested') return 'contested_by_shop';
  if (p.cashObservedAt) return 'cash_received_to_confirm';
  if (p.declaredAt) return 'declared_by_customer';
  return 'not_paid';
}

const notAllowed = (message: string) => new AppError('PAYMENT_ACTION_NOT_ALLOWED', message, HttpStatus.CONFLICT);

/**
 * Lot 7-C — Registre des paiements. Aucun prestataire, aucun transfert : le client déclare, la boutique constate les
 * espèces au comptoir et décide (confirme ou conteste) ; le silence n'est jamais une confirmation (rappel puis file
 * « à vérifier » du support). Une commande livrée dont le paiement est confirmé est « terminée ».
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private event(tx: DbOrTx, orderId: string, type: string, actorType: string, actorId: string | null, data: Record<string, unknown> = {}, from: string | null = null, to: string | null = null) {
    return tx.insert(orderEvents).values({ id: uuidv7(), orderId, type, actorType, actorId, fromStatus: from, toStatus: to, data });
  }

  /** Paiement de l'article ouvert à la confirmation de la commande (montant figé). */
  async open(tx: DbOrTx, order: Order) {
    await tx.insert(orderPayments).values({ id: uuidv7(), orderId: order.id, kind: 'article', method: order.paymentMethod ?? 'mobile_money', amountFcfa: order.itemsTotalFcfa }).onConflictDoNothing();
  }

  /** Commande annulée avant la remise : le paiement est annulé (rien n'était dû). */
  async cancel(tx: DbOrTx, orderId: string) {
    await tx.update(orderPayments).set({ failure: 'cancelled', failureAt: new Date() }).where(and(eq(orderPayments.orderId, orderId), eq(orderPayments.failure, 'none'), eq(orderPayments.decision, 'pending')));
  }

  async forOrder(orderId: string, tx: DbOrTx = this.db): Promise<Payment | null> {
    const [p] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, orderId), eq(orderPayments.kind, 'article'))).limit(1);
    return p ?? null;
  }

  /** Numéro Mobile Money confirmé de la boutique (preuve de possession du numéro, pas d'une transaction). */
  async shopPayout(shopId: string) {
    const [a] = await this.db
      .select({ phone: merchantApplications.payoutPhone, operator: merchantApplications.payoutOperator })
      .from(merchantApplications)
      .where(and(eq(merchantApplications.shopId, shopId), eq(merchantApplications.status, 'approved'), isNotNull(merchantApplications.payoutVerifiedAt)))
      .orderBy(desc(merchantApplications.payoutVerifiedAt))
      .limit(1);
    return a?.phone ? { phone: a.phone, operator: a.operator } : null;
  }

  /** Vue du paiement pour une partie ; le numéro de la boutique n'est montré au client qu'au moment de payer. */
  /** Le client peut payer : remise faite (retrait), ou code validé par le livreur (livraison, 7-F). */
  async payable(o: Order, tx: DbOrTx = this.db) {
    if (o.status === 'delivered') return true;
    if (o.status !== 'in_delivery') return false;
    const [d] = await tx.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.orderId, o.id)).limit(1);
    return d?.status === 'code_validated';
  }

  async view(o: Order, party: 'customer' | 'shop') {
    const p = await this.forOrder(o.id);
    if (!p) return null;
    const payNow = party === 'customer' && (await this.payable(o)) && p.method === 'mobile_money' && p.failure === 'none' && p.decision === 'pending';
    return {
      kind: p.kind,
      method: p.method,
      amountFcfa: p.amountFcfa,
      status: paymentStatus(p),
      declaredAt: p.declaredAt,
      declaredReference: p.declaredReference,
      cashObserved: p.cashObservedAt ? { amountFcfa: p.cashObservedAmountFcfa, at: p.cashObservedAt, byRole: p.cashObservedByRole } : null,
      provider: p.providerStatus,
      decision: p.decision,
      decidedAt: p.decidedAt,
      contestReason: p.contestReason,
      failure: p.failure,
      shopPayout: payNow ? await this.shopPayout(o.shopId) : null,
    };
  }

  /** Actions de paiement possibles maintenant (le serveur revérifie, dont la permission « payments.decide »). */
  static actions(o: Order, p: Payment | null, party: 'customer' | 'shop', payable = o.status === 'delivered'): string[] {
    if (!p || p.failure !== 'none' || p.decision !== 'pending') return [];
    if (party === 'customer') return payable && p.method === 'mobile_money' && !p.declaredAt ? ['declare_payment'] : [];
    if (o.status !== 'delivered') return [];
    if (p.method === 'cash' && !p.cashObservedAt) return ['cash_received'];
    return ['confirm_payment', 'contest_payment'];
  }

  private async lockOrder(tx: DbOrTx, orderId: string) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
    if (!o) throw Errors.notFound('Commande');
    const [p] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, orderId), eq(orderPayments.kind, 'article'))).for('update').limit(1);
    if (!p) throw notAllowed('Aucun paiement n’est attendu pour cette commande.');
    return { o, p };
  }

  /**
   * « J'ai payé » (Mobile Money) : déclaration du client, après la remise (code validé). Elle n'est jamais une
   * confirmation. Répétée : sans double opération.
   */
  async declare(customerId: string, orderId: string, reference: string | undefined, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const { o, p } = await this.lockOrder(tx, orderId);
      if (o.customerId !== customerId) throw Errors.notFound('Commande');
      if (p.declaredAt) return; // déjà déclaré : sans effet
      if (!(await this.payable(o, tx)) || p.method !== 'mobile_money' || p.failure !== 'none' || p.decision !== 'pending') {
        throw notAllowed('Le paiement se déclare après la remise de l’article, pour un paiement Mobile Money.');
      }
      await tx.update(orderPayments).set({ declaredAt: new Date(), declaredReference: reference ?? null }).where(eq(orderPayments.id, p.id));
      await this.event(tx, orderId, 'payment_declared', 'customer', customerId, reference ? { reference } : {});
      await this.audit.log({ actorType: 'user', actorId: customerId, action: 'payments.declared', targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { amountFcfa: p.amountFcfa } }, tx);
    });
  }

  /**
   * Espèces reçues au comptoir (retrait en boutique) : constat visuel par la boutique, montant attendu. En livraison,
   * seul un livreur employé de la boutique pourra le faire (7-F, F3 bis).
   */
  async cashReceived(staffId: string, shopId: string, orderId: string, amount: number, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const { o, p } = await this.lockOrder(tx, orderId);
      if (o.shopId !== shopId) throw Errors.notFound('Commande');
      if (o.status !== 'delivered' || p.method !== 'cash' || o.deliveryMode !== 'pickup' || p.cashObservedAt || p.failure !== 'none') {
        throw notAllowed('Les espèces s’enregistrent une fois, au retrait en boutique, après la remise.');
      }
      if (amount !== p.amountFcfa) {
        throw new AppError('CASH_AMOUNT_MISMATCH', `Le montant attendu est ${p.amountFcfa} F. En cas d’écart, conteste le paiement.`, HttpStatus.BAD_REQUEST, { expectedFcfa: p.amountFcfa });
      }
      await tx.update(orderPayments).set({ cashObservedAt: new Date(), cashObservedAmountFcfa: amount, cashObservedBy: staffId, cashObservedByRole: 'shop' }).where(eq(orderPayments.id, p.id));
      await this.event(tx, orderId, 'cash_received', 'shop', staffId, { amountFcfa: amount });
      await this.audit.log({ actorType: 'user', actorId: staffId, action: 'payments.cash_received', targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, amountFcfa: amount } }, tx);
    });
  }

  /** Décision de la boutique : confirmer (la commande est terminée) ou contester (motif ; file « à vérifier »). */
  async decide(staffId: string, shopId: string, orderId: string, decision: 'confirm' | 'contest', reason: string | undefined, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const { o, p } = await this.lockOrder(tx, orderId);
      if (o.shopId !== shopId) throw Errors.notFound('Commande');
      if (o.status !== 'delivered' || p.failure !== 'none' || p.decision !== 'pending') throw notAllowed('Ce paiement a déjà une décision ou n’est pas encore dû.');
      if (p.method === 'cash' && !p.cashObservedAt && decision === 'confirm') throw notAllowed('Enregistre d’abord les espèces reçues.');
      const now = new Date();
      if (decision === 'confirm') {
        await tx.update(orderPayments).set({ decision: 'confirmed', decidedAt: now, decidedBy: staffId }).where(eq(orderPayments.id, p.id));
        await this.event(tx, orderId, 'payment_confirmed', 'shop', staffId);
        const [done] = await tx.update(orders).set({ status: 'completed', closedAt: now }).where(and(eq(orders.id, orderId), eq(orders.status, 'delivered'))).returning();
        if (done) await this.event(tx, orderId, 'completed', 'system', null, {}, 'delivered', 'completed');
      } else {
        if (!reason || reason.trim().length < 3) throw Errors.validation({ fields: { reason: ['Précise le motif de la contestation.'] } });
        await tx.update(orderPayments).set({ decision: 'contested', decidedAt: now, decidedBy: staffId, contestReason: reason.trim(), reviewQueuedAt: now }).where(eq(orderPayments.id, p.id));
        await this.event(tx, orderId, 'payment_contested', 'shop', staffId, { reason: reason.trim() });
      }
      await this.audit.log({ actorType: 'user', actorId: staffId, action: `payments.${decision === 'confirm' ? 'confirmed' : 'contested'}`, targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, amountFcfa: p.amountFcfa, method: p.method } }, tx);
    });
  }

  /**
   * Worker : paiements sans décision de la boutique depuis N jours après la remise → rappel à la boutique et file
   * « à vérifier » du support. Aucune confirmation implicite. Idempotent (une seule fois par paiement).
   */
  async queueOverdue(now = new Date()) {
    const days = (await this.settings.get<number>('payments.shop_decision_reminder_days'))?.value ?? 3;
    const limit = new Date(now.getTime() - days * 86_400_000);
    const due = await this.db
      .select({ id: orderPayments.id, orderId: orderPayments.orderId })
      .from(orderPayments)
      .innerJoin(orders, eq(orders.id, orderPayments.orderId))
      .where(and(eq(orderPayments.decision, 'pending'), eq(orderPayments.failure, 'none'), isNull(orderPayments.reviewQueuedAt), eq(orders.status, 'delivered'), lte(orders.deliveredAt, limit)))
      .limit(200);
    for (const d of due) {
      await this.db.transaction(async (tx) => {
        const [u] = await tx.update(orderPayments).set({ remindedAt: now, reviewQueuedAt: now }).where(and(eq(orderPayments.id, d.id), isNull(orderPayments.reviewQueuedAt), eq(orderPayments.decision, 'pending'))).returning();
        if (u) await this.event(tx, d.orderId, 'payment_review_queued', 'system', null, { days });
      });
    }
    return due.length;
  }

  // ------------------------------------------------------------------ Support (administration)

  /** File « à vérifier » : sans décision après le délai, ou contestés. Chaque consultation est journalisée. */
  async reviewQueue(a: AdminContext, meta: RequestMeta) {
    const rows = await this.db
      .select({ p: orderPayments, number: orders.number, status: orders.status, deliveredAt: orders.deliveredAt, shop: shops.name, customer: users.fullName })
      .from(orderPayments)
      .innerJoin(orders, eq(orders.id, orderPayments.orderId))
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .innerJoin(users, eq(users.id, orders.customerId))
      .where(and(isNotNull(orderPayments.reviewQueuedAt), isNull(orderPayments.reviewedAt)))
      .orderBy(asc(orderPayments.reviewQueuedAt))
      .limit(100);
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.payments_review_viewed', targetType: 'payment', ip: meta.ip, userAgent: meta.userAgent, metadata: { count: rows.length } });
    return {
      items: rows.map((r) => ({
        id: r.p.id,
        orderNumber: r.number,
        orderStatus: r.status,
        shop: r.shop,
        customer: r.customer,
        method: r.p.method,
        amountFcfa: r.p.amountFcfa,
        status: paymentStatus(r.p),
        declaredAt: r.p.declaredAt,
        declaredReference: r.p.declaredReference,
        contestReason: r.p.contestReason,
        deliveredAt: r.deliveredAt,
        queuedAt: r.p.reviewQueuedAt,
      })),
    };
  }

  /** Le support note sa vérification (sans modifier la décision de la boutique ni aucun montant). */
  async markReviewed(a: AdminContext, paymentId: string, note: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.update(orderPayments).set({ reviewedAt: new Date(), reviewNote: note }).where(and(eq(orderPayments.id, paymentId), isNotNull(orderPayments.reviewQueuedAt), isNull(orderPayments.reviewedAt))).returning();
      if (!p) throw Errors.notFound('Paiement à vérifier');
      await tx.insert(orderEvents).values({ id: uuidv7(), orderId: p.orderId, type: 'payment_reviewed', actorType: 'admin', actorId: a.adminId, data: { note } });
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.payment_reviewed', targetType: 'payment', targetId: paymentId, ip: meta.ip, userAgent: meta.userAgent, metadata: { orderId: p.orderId } }, tx);
    });
    return { ok: true };
  }

  async shopPendingCount(shopId: string) {
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(orderPayments)
      .innerJoin(orders, eq(orders.id, orderPayments.orderId))
      .where(and(eq(orders.shopId, shopId), eq(orders.status, 'delivered'), eq(orderPayments.decision, 'pending'), eq(orderPayments.failure, 'none')));
    return n;
  }
}
