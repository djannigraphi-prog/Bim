import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import {
  communes,
  contentReports,
  courierAccounts,
  courierCommunes,
  deliveries,
  deliveryEvents,
  deliveryOffers,
  orderItems,
  orderPayments,
  orders,
  reviews,
  shops,
  userContacts,
  users,
} from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { CourierCategory, CouriersService } from '../couriers/couriers.service';
import { SettingsService } from '../settings/settings.service';
import { TariffsService } from '../tariffs/tariffs.service';
import { waitFee } from '../tariffs/pricing';
import { IncidentsService } from './incidents.service';
import { OrdersService } from './orders.service';

type Delivery = typeof deliveries.$inferSelect;
type Order = typeof orders.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Statuts d'une course en cours (comptent dans la capacité du livreur). */
const ON_COURSE = ['accepted', 'picked_up', 'arrived', 'code_validated'] as const;
const ENDED = ['closed', 'refused_by_client', 'client_absent', 'cancelled'];
const RANK: Record<CourierCategory, number> = { employee: 0, partner: 1, independent: 2 };

const changed = (status: string) => new AppError('DELIVERY_STATE_CHANGED', 'Cette livraison a changé entre-temps. Actualise pour voir son état.', HttpStatus.CONFLICT, { status });

export interface Candidate {
  courierId: string;
  fullName: string;
  category: CourierCategory;
  vehicle: string | null;
  /** Le marchand peut le solliciter maintenant. */
  selectable: boolean;
  /** Un motif est exigé (économique : un livreur prioritaire disponible est passé). */
  reasonRequired: boolean;
}

/**
 * Lot 7-F — Livraisons (décision du 16/10, 22 h 27) : le marchand déclenche la recherche et sollicite un livreur parmi
 * les éligibles calculés par le serveur (employés, puis partenaires, puis indépendants) ; le livreur sollicité accepte
 * ou refuse dans le délai ; sinon le marchand en sollicite un autre. Le livreur ne voit que les missions qui lui sont
 * proposées, ses courses et son historique : jamais les commandes de la boutique (L7-04).
 *
 * Règles commerciales appliquées (A4, A5) : en **rapide**, seuls les livreurs de la meilleure catégorie disponible
 * peuvent être sollicités ; en **économique**, passer un livreur d'une catégorie prioritaire disponible exige un motif.
 * Espèces (F3 bis) : seul un employé actif de la boutique, vérifié au moment de l'action, peut les recevoir.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly orders: OrdersService,
    private readonly couriers: CouriersService,
    private readonly incidents: IncidentsService,
    private readonly tariffs: TariffsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private async intSetting(key: string, fallback: number) {
    const v = (await this.settings.get<number>(key))?.value;
    return typeof v === 'number' ? v : fallback;
  }

  event(tx: DbOrTx, deliveryId: string, type: string, actorType: string, actorId: string | null, data: Record<string, unknown> = {}) {
    return tx.insert(deliveryEvents).values({ id: uuidv7(), deliveryId, type, actorType, actorId, data });
  }

  private async orderForShop(shopId: string, orderId: string, tx: DbOrTx = this.db) {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    return o;
  }

  async orderIdOf(deliveryId: string): Promise<[string]> {
    const [d] = await this.db.select({ orderId: deliveries.orderId }).from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
    if (!d) throw Errors.notFound('Course');
    return [d.orderId];
  }

  async forOrder(orderId: string, tx: DbOrTx = this.db): Promise<Delivery | null> {
    const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).limit(1);
    return d ?? null;
  }

  // ------------------------------------------------------------------ Côté boutique

  /** Le marchand déclenche la recherche d'un livreur pour une commande prête, livrée à domicile. */
  async start(staffId: string, shopId: string, orderId: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).for('update').limit(1);
      if (!o) throw Errors.notFound('Commande');
      if (o.deliveryMode === 'pickup' || !o.deliveryMode) throw new AppError('NOT_A_DELIVERY', 'Cette commande se retire en boutique.', HttpStatus.CONFLICT);
      if (o.status !== 'ready') throw changed(o.status);
      const existing = await this.forOrder(orderId, tx);
      if (existing) return; // déjà lancée : sans effet
      const id = uuidv7();
      await tx.insert(deliveries).values({ id, orderId, status: 'searching' });
      await this.event(tx, id, 'search_started', 'shop', staffId);
      await this.audit.log({ actorType: 'user', actorId: staffId, action: 'deliveries.search_started', targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
  }

  /** Livreurs en course (capacité occupée). */
  private async load(tx: DbOrTx, courierIds: string[]) {
    if (!courierIds.length) return new Map<string, number>();
    const rows = await tx
      .select({ courierId: deliveries.courierId, n: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(and(inArray(deliveries.courierId, courierIds), inArray(deliveries.status, [...ON_COURSE])))
      .groupBy(deliveries.courierId);
    return new Map(rows.map((r) => [r.courierId!, r.n]));
  }

  /**
   * Livreurs éligibles pour une commande, calculés par le serveur : compte vérifié et actif, disponible, commune de
   * livraison desservie, capacité non atteinte, pas déjà sollicité sans succès pour cette livraison, pas le client.
   * Espèces : employés de la boutique seulement. Tri : employés, partenaires, indépendants.
   */
  async candidates(o: Order, d: Delivery, tx: DbOrTx = this.db): Promise<Candidate[]> {
    if (!o.deliveryCommuneCode) return [];
    const tried = await tx.select({ c: deliveryOffers.courierId }).from(deliveryOffers).where(and(eq(deliveryOffers.deliveryId, d.id), ne(deliveryOffers.status, 'offered')));
    const rows = await tx
      .select({ id: courierAccounts.id, capacity: courierAccounts.capacity, vehicle: courierAccounts.vehicle, userId: users.id, fullName: users.fullName })
      .from(courierAccounts)
      .innerJoin(users, eq(users.id, courierAccounts.userId))
      .innerJoin(courierCommunes, and(eq(courierCommunes.courierId, courierAccounts.id), eq(courierCommunes.communeCode, o.deliveryCommuneCode)))
      .where(
        and(
          eq(courierAccounts.status, 'active'),
          eq(courierAccounts.available, true),
          eq(users.status, 'active'),
          ne(users.id, o.customerId),
          tried.length ? notInArray(courierAccounts.id, tried.map((t) => t.c)) : undefined,
        ),
      );
    const busy = await this.load(tx, rows.map((r) => r.id));
    const list: Array<Omit<Candidate, 'selectable' | 'reasonRequired'>> = [];
    for (const r of rows) {
      if ((busy.get(r.id) ?? 0) >= r.capacity) continue;
      const category = await this.couriers.category(r.id, o.shopId, tx);
      if (o.paymentMethod === 'cash' && category !== 'employee') continue;
      list.push({ courierId: r.id, fullName: r.fullName, category, vehicle: r.vehicle });
    }
    list.sort((a, b) => RANK[a.category] - RANK[b.category] || a.fullName.localeCompare(b.fullName));
    const best = list.length ? RANK[list[0].category] : 0;
    return list.map((c) => ({
      ...c,
      selectable: o.deliveryMode === 'express' ? RANK[c.category] === best : true,
      reasonRequired: o.deliveryMode === 'economy' && RANK[c.category] > best,
    }));
  }

  async candidatesForShop(shopId: string, orderId: string) {
    const o = await this.orderForShop(shopId, orderId);
    await this.expireOffers(new Date(), orderId);
    const d = await this.forOrder(orderId);
    if (!d) throw new AppError('DELIVERY_NOT_STARTED', 'Lance d’abord la recherche d’un livreur.', HttpStatus.CONFLICT);
    return { items: d.status === 'searching' ? await this.candidates(o, d) : [] };
  }

  /** Le marchand sollicite un livreur éligible ; une seule sollicitation à la fois ; le livreur doit accepter. */
  async offer(staffId: string, shopId: string, orderId: string, courierId: string, reason: string | undefined, meta: RequestMeta) {
    await this.expireOffers(new Date(), orderId);
    const minutes = await this.intSetting('deliveries.mission_accept_minutes', 5);
    await this.db.transaction(async (tx) => {
      const o = await this.orderForShop(shopId, orderId, tx);
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).for('update').limit(1);
      if (!d) throw new AppError('DELIVERY_NOT_STARTED', 'Lance d’abord la recherche d’un livreur.', HttpStatus.CONFLICT);
      if (d.status !== 'searching' || o.status !== 'ready') throw changed(d.status);
      const c = (await this.candidates(o, d, tx)).find((x) => x.courierId === courierId);
      if (!c) throw new AppError('COURIER_NOT_ELIGIBLE', 'Ce livreur n’est pas éligible pour cette livraison.', HttpStatus.CONFLICT);
      if (!c.selectable) throw new AppError('COURIER_NOT_PRIORITY', 'En livraison rapide, un livreur prioritaire disponible doit être sollicité d’abord.', HttpStatus.CONFLICT);
      if (c.reasonRequired && (!reason || reason.trim().length < 3)) throw Errors.validation({ fields: { reason: ['Un livreur prioritaire est disponible : indique le motif de ton choix.'] } });
      const id = uuidv7();
      await tx.insert(deliveryOffers).values({ id, deliveryId: d.id, courierId, category: c.category, offeredBy: staffId, skipReason: c.reasonRequired ? reason!.trim() : null, expiresAt: new Date(Date.now() + minutes * 60_000) });
      await tx.update(deliveries).set({ status: 'offered' }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'courier_requested', 'shop', staffId, { category: c.category, ...(c.reasonRequired ? { reason: reason!.trim() } : {}) });
      await this.audit.log({ actorType: 'user', actorId: staffId, action: 'deliveries.courier_requested', targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, courierId, category: c.category } }, tx);
    });
  }

  /** Le marchand retire une sollicitation sans réponse (la recherche reprend). */
  async withdraw(staffId: string, shopId: string, orderId: string) {
    await this.db.transaction(async (tx) => {
      await this.orderForShop(shopId, orderId, tx);
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).for('update').limit(1);
      if (!d || d.status !== 'offered') throw changed(d?.status ?? 'none');
      await tx.update(deliveryOffers).set({ status: 'withdrawn', answeredAt: new Date() }).where(and(eq(deliveryOffers.deliveryId, d.id), eq(deliveryOffers.status, 'offered')));
      await tx.update(deliveries).set({ status: 'searching' }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'request_withdrawn', 'shop', staffId);
    });
  }

  /** Sollicitations sans réponse dans le délai : expirées, la recherche reprend (worker et lecture). */
  async expireOffers(now = new Date(), orderId?: string) {
    const due = await this.db
      .select({ id: deliveryOffers.id, deliveryId: deliveryOffers.deliveryId })
      .from(deliveryOffers)
      .innerJoin(deliveries, eq(deliveries.id, deliveryOffers.deliveryId))
      .where(and(eq(deliveryOffers.status, 'offered'), lte(deliveryOffers.expiresAt, now), orderId ? eq(deliveries.orderId, orderId) : undefined))
      .limit(200);
    for (const x of due) {
      await this.db.transaction(async (tx) => {
        const [u] = await tx.update(deliveryOffers).set({ status: 'expired', answeredAt: now }).where(and(eq(deliveryOffers.id, x.id), eq(deliveryOffers.status, 'offered'))).returning();
        if (!u) return;
        await tx.update(deliveries).set({ status: 'searching' }).where(and(eq(deliveries.id, x.deliveryId), eq(deliveries.status, 'offered')));
        await this.event(tx, x.deliveryId, 'request_expired', 'system', null);
      });
    }
    return due.length;
  }

  /** Commande annulée par la boutique avant la prise en charge : la livraison est annulée (état figé). */
  async cancelForOrder(tx: Tx, orderId: string, actorId: string) {
    const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).for('update').limit(1);
    if (!d || ENDED.includes(d.status)) return;
    await tx.update(deliveryOffers).set({ status: 'withdrawn', answeredAt: new Date() }).where(and(eq(deliveryOffers.deliveryId, d.id), eq(deliveryOffers.status, 'offered')));
    await tx.update(deliveries).set({ status: 'cancelled', endedAt: new Date(), endReason: 'Commande annulée' }).where(eq(deliveries.id, d.id));
    await this.event(tx, d.id, 'cancelled', 'shop', actorId, { fromStatus: d.status });
  }

  // ------------------------------------------------------------------ Côté livreur

  private async offerView(o: Order, d: Delivery) {
    const [shop] = await this.db.select({ name: shops.name, city: shops.city, commune: shops.commune }).from(shops).where(eq(shops.id, o.shopId));
    const [to] = o.deliveryCommuneCode ? await this.db.select({ name: communes.name, city: communes.city }).from(communes).where(eq(communes.code, o.deliveryCommuneCode)) : [];
    const [{ n }] = await this.db.select({ n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` }).from(orderItems).where(eq(orderItems.orderId, o.id));
    return {
      deliveryId: d.id,
      mode: o.deliveryMode,
      from: { shop: shop.name, commune: shop.commune, city: shop.city },
      to: to ? { commune: to.name, city: to.city } : null,
      estimatedMinutes: o.estimatedMinutes,
      feeFcfa: o.deliveryFeeFcfa,
      itemsCount: n,
    };
  }

  /** Missions proposées au livreur : seulement ce qu'il faut pour décider (ni adresse, ni client, ni prix des articles). */
  async missions(courierId: string) {
    await this.expireOffers();
    const rows = await this.db
      .select({ offer: deliveryOffers, d: deliveries, o: orders })
      .from(deliveryOffers)
      .innerJoin(deliveries, eq(deliveries.id, deliveryOffers.deliveryId))
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(and(eq(deliveryOffers.courierId, courierId), eq(deliveryOffers.status, 'offered')))
      .orderBy(asc(deliveryOffers.expiresAt));
    return { items: await Promise.all(rows.map(async (r) => ({ offerId: r.offer.id, expiresAt: r.offer.expiresAt, category: r.offer.category, ...(await this.offerView(r.o, r.d)) }))) };
  }

  /** Le livreur sollicité accepte (éligibilité revérifiée à cet instant) ou refuse. */
  async answer(courierUserId: string, courierId: string, offerId: string, accept: boolean, meta: RequestMeta) {
    await this.expireOffers();
    const outcome = await this.db.transaction(async (tx): Promise<'ok' | 'not_eligible'> => {
      const [of] = await tx.select().from(deliveryOffers).where(and(eq(deliveryOffers.id, offerId), eq(deliveryOffers.courierId, courierId))).for('update').limit(1);
      if (!of) throw Errors.notFound('Mission');
      if (of.status !== 'offered' || of.expiresAt <= new Date()) throw new AppError('MISSION_UNAVAILABLE', 'Cette mission n’est plus disponible.', HttpStatus.CONFLICT, { status: of.status });
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, of.deliveryId)).for('update').limit(1);
      const [o] = await tx.select().from(orders).where(eq(orders.id, d.orderId)).for('update').limit(1);
      const now = new Date();
      if (!accept) {
        await tx.update(deliveryOffers).set({ status: 'declined', answeredAt: now }).where(eq(deliveryOffers.id, of.id));
        await tx.update(deliveries).set({ status: 'searching' }).where(and(eq(deliveries.id, d.id), eq(deliveries.status, 'offered')));
        await this.event(tx, d.id, 'request_declined', 'courier', courierUserId);
        return 'ok';
      }
      if (d.status !== 'offered' || o.status !== 'ready') throw changed(d.status);
      // Éligibilité revérifiée : la priorité et la catégorie ne permettent jamais à un livreur non éligible d'accepter.
      const still = (await this.candidates(o, { ...d, status: 'searching' }, tx)).find((x) => x.courierId === courierId);
      if (!still) {
        await tx.update(deliveryOffers).set({ status: 'expired', answeredAt: now }).where(eq(deliveryOffers.id, of.id));
        await tx.update(deliveries).set({ status: 'searching' }).where(eq(deliveries.id, d.id));
        await this.event(tx, d.id, 'request_invalidated', 'system', null);
        // La sollicitation est close (enregistré) ; le refus est renvoyé après la transaction.
        return 'not_eligible';
      }
      await tx.update(deliveryOffers).set({ status: 'accepted', answeredAt: now }).where(eq(deliveryOffers.id, of.id));
      await tx.update(deliveries).set({ status: 'accepted', courierId, courierCategory: still.category, acceptedAt: now }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'accepted', 'courier', courierUserId, { category: still.category });
      await this.orders.event(tx, o.id, 'courier_assigned', 'system', null, null, null);
      await this.audit.log({ actorType: 'user', actorId: courierUserId, action: 'deliveries.mission_accepted', targetType: 'order', targetId: o.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { courierId, category: still.category } }, tx);
      return 'ok';
    });
    if (outcome === 'not_eligible') {
      throw new AppError('COURIER_NOT_ELIGIBLE', 'Tu n’es plus éligible pour cette mission (disponibilité, capacité ou relation avec la boutique).', HttpStatus.CONFLICT);
    }
  }

  /** Course attribuée à ce livreur, verrouillée, avec sa commande. */
  private async mine(tx: Tx, courierId: string, deliveryId: string) {
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courierId))).for('update').limit(1);
    if (!d) throw Errors.notFound('Course');
    const [o] = await tx.select().from(orders).where(eq(orders.id, d.orderId)).for('update').limit(1);
    return { d, o };
  }

  private async step(courierUserId: string, courierId: string, deliveryId: string, from: string[], fn: (tx: Tx, d: Delivery, o: Order, now: Date) => Promise<void>) {
    await this.db.transaction(async (tx) => {
      const { d, o } = await this.mine(tx, courierId, deliveryId);
      if (!from.includes(d.status)) throw changed(d.status);
      await fn(tx, d, o, new Date());
    });
    void courierUserId;
  }

  /** Colis pris en charge à la boutique : la commande passe « en livraison ». */
  async pickedUp(courierUserId: string, courierId: string, deliveryId: string) {
    await this.step(courierUserId, courierId, deliveryId, ['accepted'], async (tx, d, o, now) => {
      await tx.update(deliveries).set({ status: 'picked_up', pickedUpAt: now }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'picked_up', 'courier', courierUserId);
      await this.orders.move(tx, o.id, ['ready'], 'in_delivery', {}, { type: 'picked_up', actorType: 'courier', actorId: courierUserId });
    });
  }

  /** « Je suis arrivé » : heure serveur, début du décompte d'attente (§3.4). */
  async arrived(courierUserId: string, courierId: string, deliveryId: string) {
    await this.step(courierUserId, courierId, deliveryId, ['picked_up'], async (tx, d, o, now) => {
      await tx.update(deliveries).set({ status: 'arrived', arrivedAt: now }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'arrived', 'courier', courierUserId);
      await this.orders.event(tx, o.id, 'courier_arrived', 'courier', courierUserId, null, null);
    });
  }

  /** Fin de l'attente : enregistrée ; facturée seulement si le réglage l'autorise (A2-c). */
  private async stopWait(d: Delivery, o: Order, now: Date) {
    const waited = d.arrivedAt ? Math.max(0, Math.floor((now.getTime() - d.arrivedAt.getTime()) / 1000)) : 0;
    const t = o.tariffId ? await this.tariffs.byId(o.tariffId) : null;
    const fee = t ? waitFee(t, waited, await this.tariffs.waitFeesBilled()).feeFcfa : 0;
    return { waitedSeconds: waited, waitFeeFcfa: fee };
  }

  /**
   * Le client a examiné l'article et accepte : il donne son code, le livreur le saisit (§3.5). Essais faux limités,
   * usage unique ; le code n'est pas une preuve de paiement. Refusé si un incident est ouvert sur la livraison.
   */
  async validateCode(courierUserId: string, courierId: string, deliveryId: string, code: string) {
    const result = await this.db.transaction(async (tx) => {
      const { d, o } = await this.mine(tx, courierId, deliveryId);
      if (d.status !== 'arrived') throw changed(d.status);
      if (await this.incidents.hasOpen(tx, d.id)) throw new AppError('INCIDENT_OPEN', 'Un incident est ouvert sur cette livraison.', HttpStatus.CONFLICT);
      const r = await this.orders.checkHandoverCode(tx, o.id, code, 'courier', courierUserId);
      if (!r.ok) return r;
      const now = new Date();
      await tx.update(deliveries).set({ status: 'code_validated', codeValidatedAt: now, ...(await this.stopWait(d, o, now)) }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'code_validated', 'courier', courierUserId);
      return r;
    });
    OrdersService.throwCodeResult(result);
  }

  /**
   * Espèces reçues par le livreur (§3.7) : seulement un **employé actif de la boutique**, vérifié dans la même
   * transaction ; jamais un partenaire ni un indépendant (F3 bis).
   */
  async cashReceived(courierUserId: string, courierId: string, deliveryId: string, amount: number, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const { d, o } = await this.mine(tx, courierId, deliveryId);
      if (d.status !== 'code_validated') throw changed(d.status);
      if (!(await this.couriers.canCollectCash(courierId, o.shopId, tx))) {
        throw new AppError('CASH_NOT_ALLOWED', 'Seul un livreur employé par la boutique peut recevoir des espèces pour elle.', HttpStatus.FORBIDDEN);
      }
      const [p] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, o.id), eq(orderPayments.kind, 'article'))).for('update').limit(1);
      if (!p || p.method !== 'cash' || p.cashObservedAt || p.failure !== 'none') throw new AppError('PAYMENT_ACTION_NOT_ALLOWED', 'Aucun paiement en espèces n’est attendu pour cette course.', HttpStatus.CONFLICT);
      if (amount !== p.amountFcfa) throw new AppError('CASH_AMOUNT_MISMATCH', `Le montant attendu est ${p.amountFcfa} F.`, HttpStatus.BAD_REQUEST, { expectedFcfa: p.amountFcfa });
      await tx.update(orderPayments).set({ cashObservedAt: new Date(), cashObservedAmountFcfa: amount, cashObservedBy: courierUserId, cashObservedByRole: 'courier' }).where(eq(orderPayments.id, p.id));
      await this.event(tx, d.id, 'cash_received', 'courier', courierUserId, { amountFcfa: amount });
      await this.audit.log({ actorType: 'user', actorId: courierUserId, action: 'payments.cash_received_by_courier', targetType: 'order', targetId: o.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { courierId, amountFcfa: amount } }, tx);
    });
  }

  /**
   * Clôture par le livreur (§3.8) : course à lui, code validé, aucun incident ouvert, paiement de l'article déclaré par
   * le client (Mobile Money) ou espèces constatées par un employé. La commande passe « livrée ». La clôture est la
   * déclaration du livreur ; elle ne prétend pas qu'un transfert a été vérifié.
   */
  async close(courierUserId: string, courierId: string, deliveryId: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const { d, o } = await this.mine(tx, courierId, deliveryId);
      if (d.status !== 'code_validated') throw changed(d.status);
      if (await this.incidents.hasOpen(tx, d.id)) throw new AppError('INCIDENT_OPEN', 'Un incident est ouvert sur cette livraison.', HttpStatus.CONFLICT);
      const [p] = await tx.select().from(orderPayments).where(and(eq(orderPayments.orderId, o.id), eq(orderPayments.kind, 'article'))).limit(1);
      const paid = p && p.failure === 'none' && (p.method === 'cash' ? !!p.cashObservedAt : !!p.declaredAt || p.providerStatus === 'confirmed');
      if (!paid) {
        throw new AppError(
          'PAYMENT_CONDITION_MISSING',
          p?.method === 'cash' ? 'Enregistre d’abord les espèces reçues.' : 'Le client doit d’abord indiquer qu’il a payé (Mobile Money au numéro de la boutique).',
          HttpStatus.CONFLICT,
        );
      }
      const now = new Date();
      await tx.update(deliveries).set({ status: 'closed', closedAt: now }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'closed', 'courier', courierUserId);
      await this.orders.move(tx, o.id, ['in_delivery'], 'delivered', { deliveredAt: now }, { type: 'delivered', actorType: 'courier', actorId: courierUserId });
      await this.audit.log({ actorType: 'user', actorId: courierUserId, action: 'deliveries.closed', targetType: 'order', targetId: o.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { courierId } }, tx);
    });
  }

  /** « Client absent » : possible après le délai réglé depuis l'arrivée ; ouvre un incident (aucune pénalité). */
  async clientAbsent(courierUserId: string, courierId: string, deliveryId: string, note: string | undefined) {
    const after = await this.intSetting('deliveries.client_absent_after_minutes', 15);
    await this.db.transaction(async (tx) => {
      const { d, o } = await this.mine(tx, courierId, deliveryId);
      if (d.status !== 'arrived') throw changed(d.status);
      const now = new Date();
      if (!d.arrivedAt || now.getTime() - d.arrivedAt.getTime() < after * 60_000) {
        throw new AppError('TOO_EARLY', `« Client absent » est possible ${after} minutes après ton arrivée.`, HttpStatus.CONFLICT, { afterMinutes: after });
      }
      await tx.update(deliveries).set({ status: 'client_absent', endedAt: now, endReason: 'Client absent', ...(await this.stopWait(d, o, now)) }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'client_absent', 'courier', courierUserId);
      await this.incidents.openInTx(tx, { orderId: o.id, deliveryId: d.id, actorType: 'courier', actorId: courierUserId, reason: 'client_absent', description: note });
    });
  }

  /** Courses en cours et historique personnel du livreur (seulement ses propres livraisons). */
  async courses(courierId: string, box: 'current' | 'history') {
    const statuses = box === 'current' ? [...ON_COURSE] : ENDED;
    const rows = await this.db
      .select({ d: deliveries, o: orders })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(and(eq(deliveries.courierId, courierId), inArray(deliveries.status, statuses)))
      .orderBy(desc(deliveries.createdAt))
      .limit(50);
    return { items: await Promise.all(rows.map(async (r) => ({ status: r.d.status, closedAt: r.d.closedAt, endedAt: r.d.endedAt, ...(await this.offerView(r.o, r.d)), number: r.o.number }))) };
  }

  /**
   * Détail d'une course pour son livreur : les informations nécessaires à la mission seulement (adresse et contact du
   * client tant que la course est en cours, articles et quantités, moyen de paiement prévu ; jamais le code).
   */
  async course(courierId: string, deliveryId: string) {
    const [r] = await this.db.select({ d: deliveries, o: orders }).from(deliveries).innerJoin(orders, eq(orders.id, deliveries.orderId)).where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courierId))).limit(1);
    if (!r) throw Errors.notFound('Course');
    const { d, o } = r;
    const live = (ON_COURSE as readonly string[]).includes(d.status);
    const [client] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, o.customerId));
    const [phone] = live
      ? await this.db.select({ value: userContacts.value }).from(userContacts).where(and(eq(userContacts.userId, o.customerId), eq(userContacts.type, 'phone'), sql`${userContacts.verifiedAt} IS NOT NULL`)).limit(1)
      : [];
    const items = await this.db.select({ title: orderItems.title, variantLabel: orderItems.variantLabel, quantity: orderItems.quantity, reference: orderItems.reference }).from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.position));
    const [p] = await this.db.select().from(orderPayments).where(and(eq(orderPayments.orderId, o.id), eq(orderPayments.kind, 'article'))).limit(1);
    const cashCollector = d.courierCategory === 'employee';
    const [review] = await this.db.select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment, status: reviews.status }).from(reviews).where(and(eq(reviews.kind, 'delivery'), eq(reviews.deliveryId, d.id), eq(reviews.status, 'published'))).limit(1);
    return {
      ...(await this.offerView(o, d)),
      number: o.number,
      status: d.status,
      category: d.courierCategory,
      client: live ? { firstName: client.fullName.split(' ')[0], phone: phone?.value ?? null, address: o.deliveryAddress } : null,
      items,
      payment: p
        ? {
            method: p.method,
            // Montant à recevoir en espèces : seulement pour un employé de la boutique.
            amountToCollectFcfa: p.method === 'cash' && cashCollector ? p.amountFcfa : null,
            declaredByCustomer: !!p.declaredAt,
            cashReceived: !!p.cashObservedAt,
          }
        : null,
      arrivedAt: d.arrivedAt,
      waitedSeconds: d.waitedSeconds,
      review: review ?? null,
      actions: DeliveriesService.courierActions(d, p ?? null),
    };
  }

  static courierActions(d: Delivery, p: typeof orderPayments.$inferSelect | null): string[] {
    switch (d.status) {
      case 'accepted':
        return ['picked_up'];
      case 'picked_up':
        return ['arrived'];
      case 'arrived':
        return ['validate_code', 'client_absent', 'report_incident'];
      case 'code_validated': {
        const a: string[] = [];
        if (p?.method === 'cash' && !p.cashObservedAt && d.courierCategory === 'employee') a.push('cash_received');
        a.push('close', 'report_incident');
        return a;
      }
      default:
        return [];
    }
  }

  /** Le livreur signale l'évaluation reçue pour sa course (modération). */
  async reportReview(courierUserId: string, courierId: string, reviewId: string, reason: string) {
    const [r] = await this.db
      .select({ id: reviews.id, authorId: reviews.authorId })
      .from(reviews)
      .innerJoin(deliveries, eq(deliveries.id, reviews.deliveryId))
      .where(and(eq(reviews.id, reviewId), eq(reviews.kind, 'delivery'), eq(reviews.status, 'published'), eq(deliveries.courierId, courierId)))
      .limit(1);
    if (!r) throw Errors.notFound('Évaluation');
    await this.db.insert(contentReports).values({ id: uuidv7(), reporterId: courierUserId, targetType: 'review', targetId: r.id, targetUserId: r.authorId, reason }).onConflictDoNothing();
    return { received: true };
  }

  // ------------------------------------------------------------------ Côté client

  /** Le client refuse la remise après examen (§3.5) : motif obligatoire, précision pour « autre » ; ouvre un incident. */
  async refuse(customerId: string, orderId: string, reason: 'incorrect' | 'damaged' | 'incomplete' | 'other', details: string | undefined) {
    if (reason === 'other' && (!details || details.trim().length < 3)) throw Errors.validation({ fields: { details: ['Précise ce qui ne va pas.'] } });
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).for('update').limit(1);
      if (!o) throw Errors.notFound('Commande');
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).for('update').limit(1);
      if (!d || d.status !== 'arrived') throw changed(d?.status ?? 'none');
      const now = new Date();
      await tx.update(deliveries).set({ status: 'refused_by_client', refusalReason: reason, endedAt: now, endReason: details?.trim() || null, ...(await this.stopWait(d, o, now)) }).where(eq(deliveries.id, d.id));
      await this.event(tx, d.id, 'refused_by_client', 'customer', customerId, { reason });
      await this.orders.event(tx, o.id, 'delivery_refused', 'customer', customerId, null, null, { reason });
      const map = { incorrect: 'item_incorrect', damaged: 'item_damaged', incomplete: 'item_incomplete', other: 'other' } as const;
      await this.incidents.openInTx(tx, { orderId: o.id, deliveryId: d.id, actorType: 'customer', actorId: customerId, reason: map[reason], description: details });
    });
  }

  /** Vue de la livraison pour le client ou la boutique (le livreur : prénom et moyen de transport seulement). */
  async view(o: Order, party: 'customer' | 'shop') {
    const d = await this.forOrder(o.id);
    if (!d) return null;
    const [c] = d.courierId ? await this.db.select({ fullName: users.fullName, vehicle: courierAccounts.vehicle }).from(courierAccounts).innerJoin(users, eq(users.id, courierAccounts.userId)).where(eq(courierAccounts.id, d.courierId)) : [];
    const [open] = await this.db.select().from(deliveryOffers).where(and(eq(deliveryOffers.deliveryId, d.id), eq(deliveryOffers.status, 'offered'))).limit(1);
    const events = await this.db.select().from(deliveryEvents).where(eq(deliveryEvents.deliveryId, d.id)).orderBy(asc(deliveryEvents.createdAt), asc(deliveryEvents.id));
    const [review] = party === 'customer' ? await this.db.select({ id: reviews.id, rating: reviews.rating, status: reviews.status }).from(reviews).where(and(eq(reviews.kind, 'delivery'), eq(reviews.deliveryId, d.id))).limit(1) : [];
    return {
      id: d.id,
      status: d.status,
      courier: c ? { firstName: party === 'customer' ? c.fullName.split(' ')[0] : c.fullName, vehicle: c.vehicle, category: party === 'shop' ? d.courierCategory : null } : null,
      requestExpiresAt: party === 'shop' && open ? open.expiresAt : null,
      arrivedAt: d.arrivedAt,
      closedAt: d.closedAt,
      waitedSeconds: d.waitedSeconds,
      waitFeeFcfa: d.waitFeeFcfa,
      refusalReason: d.refusalReason,
      events: events.map((e) => ({ type: e.type, actorType: e.actorType, at: e.createdAt })),
      review: review ?? null,
    };
  }

  static partyActions(o: Order, d: Delivery | null, party: 'customer' | 'shop'): string[] {
    if (o.deliveryMode === 'pickup' || !o.deliveryMode) return [];
    if (party === 'shop') {
      if (o.status !== 'ready') return [];
      if (!d) return ['start_delivery'];
      if (d.status === 'searching') return ['select_courier'];
      if (d.status === 'offered') return ['withdraw_request'];
      return [];
    }
    if (!d) return [];
    if (d.status === 'arrived') return ['refuse_delivery', 'report_incident'];
    if (d.status === 'closed') return ['review_delivery'];
    return [];
  }

  /** Commande vue par le client, avec sa livraison et ses incidents (actions de livraison ajoutées). */
  async customerView(customerId: string, orderId: string, apiBase: string) {
    await this.expireOffers(new Date(), orderId);
    const v = await this.orders.getForCustomer(customerId, orderId, apiBase);
    return this.decorate(v, orderId, 'customer');
  }

  async shopView(shopId: string, orderId: string, apiBase: string) {
    await this.expireOffers(new Date(), orderId);
    const v = await this.orders.getForShop(shopId, orderId, apiBase);
    return this.decorate(v, orderId, 'shop');
  }

  private async decorate<T extends { actions: string[] }>(v: T, orderId: string, party: 'customer' | 'shop') {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const d = await this.forOrder(orderId);
    const tracking = await this.view(o, party);
    // Une livraison ne s'évalue qu'une fois : l'action disparaît dès qu'une évaluation existe.
    const extra = DeliveriesService.partyActions(o, d, party).filter((x) => x !== 'review_delivery' || !tracking?.review);
    return { ...v, tracking, incidents: await this.incidents.summaryForOrder(orderId), actions: [...v.actions, ...extra] };
  }

  /** Évaluation de la livraison par le client, après la clôture ; une seule ; distincte de l'article et de la boutique. */
  async reviewDelivery(customerId: string, orderId: string, rating: number, comment: string | undefined, meta: RequestMeta) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    const d = await this.forOrder(orderId);
    if (!d || d.status !== 'closed') throw new AppError('REVIEW_NOT_ALLOWED', 'La livraison s’évalue une fois terminée.', HttpStatus.CONFLICT);
    const id = uuidv7();
    const done = await this.db
      .insert(reviews)
      .values({ id, kind: 'delivery', orderId, deliveryId: d.id, shopId: o.shopId, authorId: customerId, rating, comment: comment?.trim() || null })
      .onConflictDoNothing()
      .returning({ id: reviews.id });
    if (!done.length) throw Errors.conflict('ALREADY_REVIEWED', 'Tu as déjà évalué cette livraison.');
    await this.audit.log({ actorType: 'user', actorId: customerId, action: 'reviews.delivery_created', targetType: 'review', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { orderId, rating } });
  }
}
