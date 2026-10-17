import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { courierAccounts, deliveries, orderPayments, orders, userContacts, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from './orders.service';

type Delivery = typeof deliveries.$inferSelect;
type Order = typeof orders.$inferSelect;
type Fee = typeof orderPayments.$inferSelect;

const notAllowed = (m: string) => new AppError('PAYMENT_NOT_ALLOWED', m, HttpStatus.CONFLICT);

/**
 * Décision A3-b (17/10/2026) — Frais de livraison d'un **livreur indépendant** (sans lien avec la boutique) : le client
 * les paie **directement au livreur par Mobile Money**, au montant affiché à la commande (grille, figé). BIM ne détient
 * aucun fonds. Comme pour l'article : déclaration du client (jamais une confirmation), puis décision du bénéficiaire
 * (le livreur confirme la réception ou la conteste). Le paiement n'est attendu qu'après une remise réussie (code
 * validé) ; refus du client, absence et annulation ne créent aucun frais (politique financière A8 non définie).
 * Décision du 17/10/2026 (20 h 10) : un **partenaire** est payé de la même façon. Employés : frais à la boutique.
 */
@Injectable()
export class DeliveryFeesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
  ) {}

  /** À la validation du code : frais attendus si le livreur est indépendant ou partenaire et que la livraison est payante. */
  async openInTx(tx: DbOrTx, d: Delivery, o: Order) {
    if ((d.courierCategory !== 'independent' && d.courierCategory !== 'partner') || !o.deliveryFeeFcfa || o.deliveryFeeFcfa <= 0) return;
    await tx.insert(orderPayments).values({ id: uuidv7(), orderId: o.id, kind: 'delivery_fee', method: 'mobile_money', amountFcfa: o.deliveryFeeFcfa }).onConflictDoNothing();
  }

  async forOrder(orderId: string, tx: DbOrTx = this.db): Promise<Fee | null> {
    const [f] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, orderId), eq(orderPayments.kind, 'delivery_fee'))).limit(1);
    return f ?? null;
  }

  private static status(f: Fee) {
    if (f.failure !== 'none') return 'cancelled';
    if (f.decision === 'confirmed') return 'confirmed_by_courier';
    if (f.decision === 'contested') return 'contested_by_courier';
    return f.declaredAt ? 'declared_by_customer' : 'to_pay';
  }

  /**
   * Vue du client : montant, statut ; tant que rien n'est décidé, prénom, numéro Mobile Money (téléphone vérifié du
   * livreur) et opérateur du livreur, pour payer. Action « J'ai payé le livreur ».
   */
  async customerView(orderId: string) {
    const f = await this.forOrder(orderId);
    if (!f) return null;
    const open = f.failure === 'none' && f.decision === 'pending';
    let payTo: { firstName: string; phone: string | null; operator: string | null } | null = null;
    if (open) {
      const [r] = await this.db
        .select({ fullName: users.fullName, userId: users.id, operator: courierAccounts.payoutOperator })
        .from(deliveries)
        .innerJoin(courierAccounts, eq(courierAccounts.id, deliveries.courierId))
        .innerJoin(users, eq(users.id, courierAccounts.userId))
        .where(eq(deliveries.orderId, orderId))
        .limit(1);
      if (r) {
        const [phone] = await this.db
          .select({ value: userContacts.value })
          .from(userContacts)
          .where(and(eq(userContacts.userId, r.userId), eq(userContacts.type, 'phone'), sql`${userContacts.verifiedAt} IS NOT NULL`))
          .limit(1);
        payTo = { firstName: r.fullName.split(' ')[0], phone: phone?.value ?? null, operator: r.operator ?? null };
      }
    }
    return { amountFcfa: f.amountFcfa, status: DeliveryFeesService.status(f), payTo, actions: open && !f.declaredAt ? ['declare_delivery_fee'] : [] };
  }

  /** Vue du livreur : montant, déclaration du client, décision ; confirmer ou contester tant que rien n'est décidé. */
  courierView(f: Fee | null) {
    if (!f) return null;
    const open = f.failure === 'none' && f.decision === 'pending';
    return { amountFcfa: f.amountFcfa, status: DeliveryFeesService.status(f), declaredByCustomer: !!f.declaredAt, actions: open ? ['confirm_delivery_fee', 'contest_delivery_fee'] : [] };
  }

  /** « J'ai payé le livreur » : déclaration du client (jamais une confirmation) ; répétée, sans effet. */
  async declare(customerId: string, orderId: string, reference: string | undefined, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).for('update').limit(1);
      if (!o) throw Errors.notFound('Commande');
      const [f] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, orderId), eq(orderPayments.kind, 'delivery_fee'))).for('update').limit(1);
      if (!f) throw notAllowed('Aucun frais de livraison n’est à payer au livreur pour cette commande.');
      if (f.declaredAt) return;
      if (f.failure !== 'none' || f.decision !== 'pending') throw notAllowed('Ces frais ont déjà une décision du livreur.');
      await tx.update(orderPayments).set({ declaredAt: new Date(), declaredReference: reference ?? null }).where(eq(orderPayments.id, f.id));
      await this.orders.event(tx, orderId, 'delivery_fee_declared', 'customer', customerId, null, null, reference ? { reference } : {});
      await this.audit.log({ actorType: 'user', actorId: customerId, action: 'payments.delivery_fee_declared', targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { amountFcfa: f.amountFcfa } }, tx);
    });
  }

  /** Le livreur indépendant confirme avoir reçu les frais, ou conteste (motif). Une seule décision. */
  async courierDecide(courierUserId: string, courierId: string, deliveryId: string, decision: 'confirm' | 'contest', reason: string | undefined, meta: RequestMeta) {
    if (decision === 'contest' && (!reason || reason.trim().length < 3)) throw Errors.validation({ fields: { reason: ['Précise le motif.'] } });
    await this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courierId))).limit(1);
      if (!d) throw Errors.notFound('Course');
      const [f] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, d.orderId), eq(orderPayments.kind, 'delivery_fee'))).for('update').limit(1);
      if (!f) throw notAllowed('Aucun frais de livraison n’est attendu pour cette course.');
      if (f.failure !== 'none' || f.decision !== 'pending') throw notAllowed('Ces frais ont déjà une décision.');
      const now = new Date();
      await tx
        .update(orderPayments)
        .set(decision === 'confirm' ? { decision: 'confirmed', decidedAt: now, decidedBy: courierUserId } : { decision: 'contested', decidedAt: now, decidedBy: courierUserId, contestReason: reason!.trim() })
        .where(eq(orderPayments.id, f.id));
      await this.orders.event(tx, d.orderId, decision === 'confirm' ? 'delivery_fee_confirmed' : 'delivery_fee_contested', 'courier', courierUserId, null, null, decision === 'contest' ? { reason: reason!.trim() } : {});
      await this.audit.log({ actorType: 'user', actorId: courierUserId, action: `payments.delivery_fee_${decision === 'confirm' ? 'confirmed' : 'contested'}`, targetType: 'order', targetId: d.orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { courierId, amountFcfa: f.amountFcfa } }, tx);
    });
  }
}
