import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { orderItems, orderPayments, orders, products, reviews, shopMembers, shops, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

type Order = typeof orders.$inferSelect;

const notEligible = (message: string) => new AppError('REVIEW_NOT_ALLOWED', message, HttpStatus.CONFLICT);

/**
 * Lot 7-H (sans livraison) — Évaluations d'un article (par ligne de commande) et d'une boutique (par commande).
 * Seul le client de la commande évalue, après la remise (commande terminée, ou remise sans contestation du paiement en
 * cours), dans le délai réglé ; une seule fois ; jamais un membre de la boutique. Aucune moyenne affichée (A17).
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private async windowDays() {
    const v = (await this.settings.get<number>('reviews.window_days'))?.value;
    return typeof v === 'number' ? v : 30;
  }

  /** Commande évaluable maintenant par son client (et date de fin du délai), sinon le motif. */
  async eligibility(o: Order): Promise<{ ok: true; until: Date } | { ok: false; reason: string }> {
    if (!o.deliveredAt || !['delivered', 'completed'].includes(o.status)) return { ok: false, reason: 'L’évaluation est possible après la remise de la commande.' };
    if (o.status === 'delivered') {
      const [p] = await this.db.select({ decision: orderPayments.decision }).from(orderPayments).where(and(eq(orderPayments.orderId, o.id), eq(orderPayments.kind, 'article'))).limit(1);
      if (p?.decision === 'contested') return { ok: false, reason: 'Le paiement de cette commande est contesté : l’évaluation attend sa résolution.' };
    }
    const until = new Date(o.deliveredAt.getTime() + (await this.windowDays()) * 86_400_000);
    if (until < new Date()) return { ok: false, reason: 'Le délai pour évaluer cette commande est passé.' };
    return { ok: true, until };
  }

  private async load(customerId: string, orderId: string) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    const e = await this.eligibility(o);
    if (!e.ok) throw notEligible(e.reason);
    // Jamais par un membre de la boutique (même devenu membre après la commande).
    const [member] = await this.db.select({ u: shopMembers.userId }).from(shopMembers).where(and(eq(shopMembers.shopId, o.shopId), eq(shopMembers.userId, customerId))).limit(1);
    if (member) throw notEligible('Les membres d’une boutique n’évaluent pas leur propre boutique.');
    return o;
  }

  private static clean(comment: string | undefined) {
    const c = comment?.trim();
    return c ? c : null;
  }

  async reviewItem(customerId: string, orderId: string, position: number, rating: number, comment: string | undefined, meta: RequestMeta) {
    const o = await this.load(customerId, orderId);
    const [it] = await this.db.select().from(orderItems).where(and(eq(orderItems.orderId, o.id), eq(orderItems.position, position))).limit(1);
    if (!it) throw Errors.notFound('Ligne');
    const id = uuidv7();
    const done = await this.db
      .insert(reviews)
      .values({ id, kind: 'item', orderId: o.id, orderItemId: it.id, productId: it.productId, productReference: it.reference, contentVersion: it.contentVersion, shopId: o.shopId, authorId: customerId, rating, comment: ReviewsService.clean(comment) })
      .onConflictDoNothing()
      .returning({ id: reviews.id });
    if (!done.length) throw Errors.conflict('ALREADY_REVIEWED', 'Tu as déjà évalué cet article pour cette commande.');
    await this.audit.log({ actorType: 'user', actorId: customerId, action: 'reviews.item_created', targetType: 'review', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { orderId: o.id, reference: it.reference, rating } });
  }

  async reviewShop(customerId: string, orderId: string, rating: number, comment: string | undefined, meta: RequestMeta) {
    const o = await this.load(customerId, orderId);
    const id = uuidv7();
    const done = await this.db
      .insert(reviews)
      .values({ id, kind: 'shop', orderId: o.id, shopId: o.shopId, authorId: customerId, rating, comment: ReviewsService.clean(comment) })
      .onConflictDoNothing()
      .returning({ id: reviews.id });
    if (!done.length) throw Errors.conflict('ALREADY_REVIEWED', 'Tu as déjà évalué la boutique pour cette commande.');
    await this.audit.log({ actorType: 'user', actorId: customerId, action: 'reviews.shop_created', targetType: 'review', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { orderId: o.id, rating } });
  }

  /** L'auteur retire son évaluation (elle reste en base, non affichée). */
  async remove(authorId: string, reviewId: string, meta: RequestMeta) {
    const [r] = await this.db.update(reviews).set({ status: 'deleted' }).where(and(eq(reviews.id, reviewId), eq(reviews.authorId, authorId), eq(reviews.status, 'published'))).returning({ id: reviews.id });
    if (!r) throw Errors.notFound('Évaluation');
    await this.audit.log({ actorType: 'user', actorId: authorId, action: 'reviews.removed', targetType: 'review', targetId: reviewId, ip: meta.ip, userAgent: meta.userAgent });
  }

  /** État des évaluations d'une commande pour son client (lignes et boutique déjà évaluées, délai). */
  async orderState(o: Order) {
    const e = await this.eligibility(o);
    const mine = await this.db.select({ id: reviews.id, kind: reviews.kind, orderItemId: reviews.orderItemId, rating: reviews.rating, status: reviews.status }).from(reviews).where(eq(reviews.orderId, o.id));
    const items = await this.db.select({ id: orderItems.id, position: orderItems.position }).from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.position));
    return {
      open: e.ok,
      until: e.ok ? e.until : null,
      reason: e.ok ? null : e.reason,
      items: items.map((i) => {
        const r = mine.find((x) => x.kind === 'item' && x.orderItemId === i.id);
        return { position: i.position, review: r ? { id: r.id, rating: r.rating, status: r.status } : null };
      }),
      shop: (() => {
        const r = mine.find((x) => x.kind === 'shop');
        return r ? { id: r.id, rating: r.rating, status: r.status } : null;
      })(),
    };
  }

  private async page(where: ReturnType<typeof and>, before: string | undefined) {
    if (before && !/^[0-9a-f-]{36}$/.test(before)) throw Errors.validation({ fields: { before: ['Curseur invalide.'] } });
    const rows = await this.db
      .select({ r: reviews, fullName: users.fullName, username: users.username })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.authorId))
      .where(and(where, eq(reviews.status, 'published'), eq(users.status, 'active'), before ? lt(reviews.id, before) : undefined))
      .orderBy(desc(reviews.id))
      .limit(21);
    return { rows: rows.slice(0, 20), next: rows.length > 20 ? rows[19].r.id : null };
  }

  /** Évaluations publiées d'un article (toutes versions ; chacune indique si elle concerne la version actuelle). */
  async forProduct(productId: string, before?: string) {
    const [p] = await this.db.select({ id: products.id, version: products.contentVersion, status: products.status }).from(products).where(eq(products.id, productId)).limit(1);
    if (!p || p.status === 'archived') throw Errors.notFound('Article');
    const { rows, next } = await this.page(and(eq(reviews.kind, 'item'), eq(reviews.productId, productId)), before);
    return {
      items: rows.map(({ r, fullName, username }) => ({ id: r.id, rating: r.rating, comment: r.comment, author: { fullName, username }, reference: r.productReference, aboutCurrentVersion: r.contentVersion === p.version, createdAt: r.createdAt })),
      nextBefore: next,
    };
  }

  async forShop(slug: string, before?: string) {
    const [s] = await this.db.select({ id: shops.id, status: shops.status }).from(shops).where(eq(shops.slug, slug)).limit(1);
    if (!s || s.status !== 'active') throw Errors.notFound('Boutique');
    const { rows, next } = await this.page(and(eq(reviews.kind, 'shop'), eq(reviews.shopId, s.id)), before);
    return { items: rows.map(({ r, fullName, username }) => ({ id: r.id, rating: r.rating, comment: r.comment, author: { fullName, username }, createdAt: r.createdAt })), nextBefore: next };
  }
}
