import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { deliveries, incidentEvents, incidents, orders, shopMembers, shops, users } from '../../database/schema';
import type { AdminContext } from '../admin/admin.decorators';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

export const INCIDENT_REASONS = ['item_incorrect', 'item_damaged', 'item_incomplete', 'client_absent', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'other'] as const;
export type IncidentReason = (typeof INCIDENT_REASONS)[number];
export type IncidentActor = 'customer' | 'shop' | 'courier';

type Incident = typeof incidents.$inferSelect;

/** Motifs que chaque partie peut choisir (le reste est ouvert par le système ou d'autres parties). */
const REASONS_FOR: Record<IncidentActor, IncidentReason[]> = {
  customer: ['item_incorrect', 'item_damaged', 'item_incomplete', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'other'],
  shop: ['courier_absent', 'delay', 'payment', 'behaviour', 'other'],
  courier: ['client_absent', 'payment', 'behaviour', 'other'],
};

/**
 * Lot 7-G — Incidents d'une commande ou de sa livraison. Ouverts par le client, la boutique (permission « préparer les
 * commandes ») ou le livreur attribué ; motif dans une liste, description libre ; suivi (ouvert → au support → résolu) ;
 * historique en écriture seule ; consultation et décision du support journalisées. **Aucune pénalité, aucun frais,
 * aucun remboursement automatique** : la décision du support est une note, sans effet financier.
 * Pièces jointes (photos) : non prévues dans l'architecture actuelle (stockage des preuves à décider).
 */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Délai pour signaler un problème après la remise (`orders.dispute_window_days` : 3 jours, décision L7-08). */
  async disputeWindowDays(): Promise<number> {
    const s = await this.settings.get<number>('orders.dispute_window_days');
    return typeof s?.value === 'number' && Number.isInteger(s.value) && s.value > 0 ? s.value : 3;
  }

  /**
   * L7-08 : un problème signalé après la remise se règle entre le client et la boutique (sans le support) ; une fois le
   * délai passé, la vente est close : plus aucun échange sur l'incident. Le client garde son évaluation de la boutique.
   */
  private async postDelivery(i: Incident): Promise<{ post: boolean; closed: boolean }> {
    const o = await this.order(i.orderId);
    if (!o.deliveredAt || i.createdAt < o.deliveredAt) return { post: false, closed: false };
    const until = o.deliveredAt.getTime() + (await this.disputeWindowDays()) * 86_400_000;
    return { post: true, closed: Date.now() >= until };
  }

  /**
   * Problème après la remise (L7-08) : signalable jusqu'à `deliveredAt` + 3 jours ; pendant ce délai, un incident non
   * résolu ouvert depuis la remise est « problème signalé », à régler entre le client et la boutique ; ensuite, vente close.
   */
  async disputeState(o: typeof orders.$inferSelect, now = new Date()) {
    if (!o.deliveredAt || !['delivered', 'completed'].includes(o.status)) return { disputeUntil: null, inDispute: false };
    const until = new Date(o.deliveredAt.getTime() + (await this.disputeWindowDays()) * 86_400_000);
    const [x] = await this.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.orderId, o.id), inArray(incidents.status, ['open', 'with_support']), sql`${incidents.createdAt} >= ${o.deliveredAt}`))
      .limit(1);
    return { disputeUntil: until, inDispute: !!x && now < until, disputeOpen: now < until };
  }

  private event(tx: DbOrTx, incidentId: string, type: string, actorType: string, actorId: string | null, note: string | null = null) {
    return tx.insert(incidentEvents).values({ id: uuidv7(), incidentId, type, actorType, actorId, note });
  }

  async hasOpen(tx: DbOrTx, deliveryId: string) {
    const [x] = await tx.select({ id: incidents.id }).from(incidents).where(and(eq(incidents.deliveryId, deliveryId), inArray(incidents.status, ['open', 'with_support']))).limit(1);
    return !!x;
  }

  /** Ouverture dans une transaction existante (refus du client, client absent). */
  async openInTx(tx: DbOrTx, i: { orderId: string; deliveryId: string | null; actorType: IncidentActor | 'system'; actorId: string; reason: IncidentReason; description?: string }) {
    const id = uuidv7();
    await tx.insert(incidents).values({ id, orderId: i.orderId, deliveryId: i.deliveryId, openedByType: i.actorType, openedById: i.actorId, reason: i.reason, description: i.description?.trim() || null });
    await this.event(tx, id, 'opened', i.actorType, i.actorId, i.description?.trim() || null);
    return id;
  }

  /** Rôle de la personne dans la commande, contrôlé par le serveur ; null = aucun accès. */
  private async roleIn(o: typeof orders.$inferSelect, userId: string, as: IncidentActor, courierId?: string): Promise<boolean> {
    if (as === 'customer') return o.customerId === userId;
    if (as === 'courier') {
      if (!courierId) return false;
      const [d] = await this.db.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.orderId, o.id), eq(deliveries.courierId, courierId))).limit(1);
      return !!d;
    }
    const [m] = await this.db
      .select({ role: shopMembers.role })
      .from(shopMembers)
      .where(and(eq(shopMembers.shopId, o.shopId), eq(shopMembers.userId, userId), isNotNull(shopMembers.acceptedAt), sql`${shopMembers.revokedAt} IS NULL`))
      .limit(1);
    if (!m) return false;
    if (m.role === 'owner') return true;
    const [p] = await this.db.execute<{ ok: number }>(sql`SELECT 1 AS ok FROM shop_member_permissions WHERE shop_id = ${o.shopId} AND user_id = ${userId} AND permission = 'orders.prepare'`).then((r) => r.rows);
    return !!p;
  }

  private async order(orderId: string) {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) throw Errors.notFound('Commande');
    return o;
  }

  async open(userId: string, as: IncidentActor, orderId: string, reason: IncidentReason, description: string | undefined, meta: RequestMeta, ctx: { shopId?: string; courierId?: string } = {}) {
    const o = await this.order(orderId);
    if ((as === 'shop' && o.shopId !== ctx.shopId) || !(await this.roleIn(o, userId, as, ctx.courierId))) throw Errors.notFound('Commande');
    if (!REASONS_FOR[as].includes(reason)) throw Errors.validation({ fields: { reason: ['Motif non disponible.'] } });
    if (reason === 'other' && (!description || description.trim().length < 5)) throw Errors.validation({ fields: { description: ['Décris le problème.'] } });
    if (['proposed', 'pending_shop', 'declined', 'expired'].includes(o.status)) throw new AppError('INCIDENT_NOT_ALLOWED', 'Un incident concerne une commande confirmée.', HttpStatus.CONFLICT);
    // Après la remise : contestation dans le délai seulement (§9, §12) ; au-delà, le support reste joignable par « Aide ».
    const dispute = await this.disputeState(o);
    if (dispute.disputeUntil && !dispute.disputeOpen) {
      const days = await this.disputeWindowDays();
      throw new AppError('DISPUTE_WINDOW_CLOSED', `La vente est close : un problème se signale dans les ${days} jours qui suivent la remise. Tu peux toujours donner ton avis sur la boutique.`, HttpStatus.CONFLICT, { days, until: dispute.disputeUntil.toISOString() });
    }
    const [d] = await this.db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.orderId, o.id)).limit(1);
    const id = await this.db.transaction(async (tx) => {
      const nid = await this.openInTx(tx, { orderId: o.id, deliveryId: d?.id ?? null, actorType: as, actorId: userId, reason, description });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'incidents.opened', targetType: 'incident', targetId: nid, ip: meta.ip, userAgent: meta.userAgent, metadata: { orderId: o.id, reason, as } }, tx);
      return nid;
    });
    return this.view(id, as);
  }

  private async authorized(userId: string, as: IncidentActor, incidentId: string, ctx: { shopId?: string; courierId?: string }) {
    const [i] = await this.db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
    if (!i) throw Errors.notFound('Incident');
    const o = await this.order(i.orderId);
    if ((as === 'shop' && o.shopId !== ctx.shopId) || !(await this.roleIn(o, userId, as, ctx.courierId))) throw Errors.notFound('Incident');
    return i;
  }

  /** Une partie ajoute une précision (historique en écriture seule). */
  async addNote(userId: string, as: IncidentActor, incidentId: string, note: string, ctx: { shopId?: string; courierId?: string } = {}) {
    const i = await this.authorized(userId, as, incidentId, ctx);
    if (i.status === 'resolved') throw new AppError('INCIDENT_RESOLVED', 'Cet incident est résolu.', HttpStatus.CONFLICT);
    if ((await this.postDelivery(i)).closed) throw new AppError('DISPUTE_WINDOW_CLOSED', 'La vente est close : plus d’échange sur ce problème.', HttpStatus.CONFLICT);
    await this.event(this.db, i.id, 'note', as, userId, note.trim());
    return this.view(i.id, as);
  }

  /** Transmettre le dossier au support. */
  async transfer(userId: string, as: IncidentActor, incidentId: string, ctx: { shopId?: string; courierId?: string } = {}) {
    const i = await this.authorized(userId, as, incidentId, ctx);
    // L7-08 : un problème signalé après la remise se règle entre le client et la boutique, sans le support.
    if ((await this.postDelivery(i)).post) throw new AppError('INCIDENT_NOT_FOR_SUPPORT', 'Un problème signalé après la remise se règle directement entre toi et la boutique.', HttpStatus.CONFLICT);
    await this.db.transaction(async (tx) => {
      const [u] = await tx.update(incidents).set({ status: 'with_support' }).where(and(eq(incidents.id, i.id), eq(incidents.status, 'open'))).returning();
      if (!u) throw new AppError('INCIDENT_STATE_CHANGED', 'Cet incident est déjà au support ou résolu.', HttpStatus.CONFLICT);
      await this.event(tx, i.id, 'sent_to_support', as, userId);
    });
    return this.view(i.id, as);
  }

  async view(incidentId: string, as: IncidentActor | 'admin') {
    const [i] = await this.db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
    if (!i) throw Errors.notFound('Incident');
    const evs = await this.db.select().from(incidentEvents).where(eq(incidentEvents.incidentId, i.id)).orderBy(asc(incidentEvents.createdAt), asc(incidentEvents.id));
    const pd = await this.postDelivery(i);
    const partyActions = i.status === 'resolved' || pd.closed ? [] : pd.post ? ['add_note'] : i.status === 'open' ? ['add_note', 'send_to_support'] : ['add_note'];
    return {
      id: i.id,
      orderId: i.orderId,
      reason: i.reason,
      description: i.description,
      status: i.status,
      openedBy: i.openedByType,
      resolution: i.resolution,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
      // L'identité des personnes de l'équipe du support n'est pas montrée aux parties.
      events: evs.map((e) => ({ type: e.type, actorType: e.actorType, note: e.note, at: e.createdAt })),
      /** L7-08 : après la remise, à régler entre le client et la boutique ; vente close après le délai. */
      afterDelivery: pd.post,
      saleClosed: pd.closed,
      actions: as === 'admin' ? (i.status === 'resolved' ? [] : ['resolve']) : partyActions,
    };
  }

  /** Incidents d'une commande visibles par cette partie. */
  async forOrder(userId: string, as: IncidentActor, orderId: string, ctx: { shopId?: string; courierId?: string } = {}) {
    const o = await this.order(orderId);
    if ((as === 'shop' && o.shopId !== ctx.shopId) || !(await this.roleIn(o, userId, as, ctx.courierId))) throw Errors.notFound('Commande');
    const rows = await this.db.select({ id: incidents.id }).from(incidents).where(eq(incidents.orderId, o.id)).orderBy(desc(incidents.createdAt));
    return { items: await Promise.all(rows.map((r) => this.view(r.id, as))) };
  }

  async summaryForOrder(orderId: string) {
    const rows = await this.db.select({ id: incidents.id, status: incidents.status, reason: incidents.reason, createdAt: incidents.createdAt }).from(incidents).where(eq(incidents.orderId, orderId)).orderBy(desc(incidents.createdAt));
    const o = await this.order(orderId);
    // L7-08 : signalé après la remise → à régler entre le client et la boutique (pas de transmission au support).
    return rows.map(({ createdAt, ...r }) => ({ ...r, afterDelivery: !!o.deliveredAt && createdAt >= o.deliveredAt }));
  }

  // ------------------------------------------------------------------ Support

  async adminList(a: AdminContext, status: 'with_support' | 'open' | 'resolved', meta: RequestMeta) {
    const rows = await this.db
      .select({ i: incidents, number: orders.number, shop: shops.name, customer: users.fullName })
      .from(incidents)
      .innerJoin(orders, eq(orders.id, incidents.orderId))
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .innerJoin(users, eq(users.id, orders.customerId))
      .where(eq(incidents.status, status))
      .orderBy(asc(incidents.createdAt))
      .limit(100);
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.incidents_viewed', targetType: 'incident', ip: meta.ip, userAgent: meta.userAgent, metadata: { status, count: rows.length } });
    return { items: await Promise.all(rows.map(async (r) => ({ ...(await this.view(r.i.id, 'admin')), orderNumber: r.number, shop: r.shop, customer: r.customer }))) };
  }

  /** Décision du support : une note, sans pénalité ni remboursement automatique ; journalisée. */
  async resolve(a: AdminContext, incidentId: string, resolution: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(incidents)
        .set({ status: 'resolved', resolution: resolution.trim(), resolvedBy: a.adminId, resolvedAt: new Date() })
        .where(and(eq(incidents.id, incidentId), inArray(incidents.status, ['open', 'with_support'])))
        .returning();
      if (!u) throw new AppError('INCIDENT_STATE_CHANGED', 'Cet incident est introuvable ou déjà résolu.', HttpStatus.CONFLICT);
      await this.event(tx, incidentId, 'resolved', 'admin', a.adminId, resolution.trim());
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.incident_resolved', targetType: 'incident', targetId: incidentId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return this.view(incidentId, 'admin');
  }
}

export type { Incident };
