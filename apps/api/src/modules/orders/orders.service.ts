import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { AppError, Errors } from '../../common/errors';
import { decryptBytes, encryptBytes, hmacSha256, numericCode, safeEqualHex } from '../../common/crypto';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DB, Database, DbOrTx } from '../../database/database.module';
import {
  communes,
  conversationMembers,
  conversations,
  deliveries,
  deliveryEvents,
  deliveryOffers,
  inventoryMovements,
  messages,
  orderEvents,
  orderHandoverCodes,
  orderItems,
  orders,
  productMedia,
  products,
  productVariants,
  shopMembers,
  shops,
  users,
} from '../../database/schema';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../media/storage';
import { MessagingService } from '../messaging/messaging.service';
import { SettingsService } from '../settings/settings.service';
import { DeliveryMode } from '../tariffs/pricing';
import { TariffsService } from '../tariffs/tariffs.service';
import { PaymentsService } from './payments.service';
import { ReviewsService } from './reviews.service';

type Order = typeof orders.$inferSelect;
type Item = typeof orderItems.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type OrderMode = 'pickup' | DeliveryMode;
export type PaymentMethod = 'mobile_money' | 'cash';
export type Party = 'customer' | 'shop';

export interface LineInput {
  productId: string;
  variantId: string;
  quantity: number;
  /** Proposition de la boutique seulement (A15 : jamais au-dessus du prix du catalogue). */
  appliedPriceFcfa?: number;
}

export interface FulfilmentInput {
  deliveryMode: OrderMode;
  communeCode?: string;
  address?: string;
  paymentMethod: PaymentMethod;
}

/** Statuts où la commande est encore ouverte côté client (code visible, annulation possible…). */
const ACTIVE = ['confirmed', 'preparing', 'ready', 'in_delivery'] as const;
const ENDED = ['declined', 'expired', 'cancelled'];
const MAX_LINES = 20;

const stateChanged = (status: string) =>
  new AppError('ORDER_STATE_CHANGED', 'Cette commande a changé entre-temps. Actualise pour voir son état.', HttpStatus.CONFLICT, { status });

/**
 * Lot 7-B — Commandes (§3, §4). Toutes les transitions passent par `move` : mise à jour conditionnelle
 * (`WHERE status IN (…) RETURNING`) et événement d'historique dans la même transaction ; une requête tardive ou répétée
 * reste sans effet. Aucun paiement en ligne : le moyen de paiement est seulement « prévu » ici (registre au 7-C).
 */
@Injectable()
export class OrdersService {
  private readonly codeKey: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) cfg: AppConfig,
    private readonly tariffs: TariffsService,
    private readonly age: AgePolicyService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly reviews: ReviewsService,
  ) {
    // Clé de chiffrement des codes de remise, dérivée du secret des codes (aucun nouveau secret à fournir).
    this.codeKey = createHmac('sha256', cfg.OTP_SECRET).update('bim-handover-code-key-v1').digest().toString('base64');
    this.otpSecret = cfg.OTP_SECRET;
  }

  private readonly otpSecret: string;

  private async intSetting(key: string, fallback: number) {
    const v = (await this.settings.get<number>(key))?.value;
    return typeof v === 'number' ? v : fallback;
  }

  // ------------------------------------------------------------------ Lignes et montants

  /**
   * Résout les lignes : article de la boutique, non retiré, variante active ; prix du catalogue au moment (promotion
   * comprise) ; version de la fiche. `published` : exigé pour une commande du BimShop (une proposition peut porter sur
   * une fiche non publiée, A14).
   */
  private async resolveLines(tx: DbOrTx, shopId: string, lines: LineInput[], opts: { published: boolean; allowNegotiated: boolean }) {
    if (!lines.length || lines.length > MAX_LINES) throw Errors.validation({ fields: { items: [`Entre 1 et ${MAX_LINES} lignes.`] } });
    const seen = new Set<string>();
    const out: Array<{
      productId: string;
      variantId: string;
      quantity: number;
      reference: string;
      contentVersion: number;
      kind: string;
      title: string;
      variantLabel: string;
      catalogPriceFcfa: number;
      appliedPriceFcfa: number;
      stock: number | null;
    }> = [];
    for (const [i, l] of lines.entries()) {
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99) throw Errors.validation({ fields: { [`items.${i}.quantity`]: ['Entre 1 et 99.'] } });
      if (seen.has(l.variantId)) throw Errors.validation({ fields: { [`items.${i}.variantId`]: ['Variante en double.'] } });
      seen.add(l.variantId);
      const [row] = await tx
        .select({ p: products, v: productVariants })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(productVariants.id, l.variantId), eq(products.id, l.productId), eq(products.shopId, shopId)))
        .limit(1);
      if (!row || row.p.status === 'archived' || !row.v.active || (opts.published && row.p.status !== 'published')) {
        throw new AppError('PRODUCT_UNAVAILABLE', 'Un article n’est plus disponible.', HttpStatus.CONFLICT, { index: i, productId: l.productId });
      }
      const catalog = row.p.promoPriceFcfa ?? row.p.priceFcfa;
      let applied = catalog;
      if (l.appliedPriceFcfa !== undefined) {
        if (!opts.allowNegotiated) throw Errors.validation({ fields: { [`items.${i}.appliedPriceFcfa`]: ['Le prix est celui du catalogue.'] } });
        if (!Number.isInteger(l.appliedPriceFcfa) || l.appliedPriceFcfa < 1 || l.appliedPriceFcfa > catalog) {
          throw Errors.validation({ fields: { [`items.${i}.appliedPriceFcfa`]: [`Entre 1 et ${catalog} F (jamais au-dessus du prix du catalogue).`] } });
        }
        applied = l.appliedPriceFcfa;
      }
      let stock: number | null = null;
      if (row.p.kind === 'product') {
        const [{ s }] = await tx.select({ s: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int` }).from(inventoryMovements).where(eq(inventoryMovements.variantId, row.v.id));
        stock = s;
      }
      out.push({
        productId: row.p.id,
        variantId: row.v.id,
        quantity: l.quantity,
        reference: row.p.reference,
        contentVersion: row.p.contentVersion,
        kind: row.p.kind,
        title: row.p.title,
        variantLabel: row.v.label,
        catalogPriceFcfa: catalog,
        appliedPriceFcfa: applied,
        stock,
      });
    }
    return out;
  }

  private static itemsTotal(lines: Array<{ appliedPriceFcfa: number; quantity: number }>) {
    return lines.reduce((s, l) => s + l.appliedPriceFcfa * l.quantity, 0);
  }

  private static outOfStock(lines: Array<{ stock: number | null; quantity: number }>) {
    return lines.map((l, i) => ({ i, l })).filter(({ l }) => l.stock !== null && l.stock < l.quantity);
  }

  /** Mode, adresse, frais : calculés par le serveur (§3.1, §7). Rien n'est enregistré. */
  private async fulfilment(tx: DbOrTx, shopId: string, f: FulfilmentInput, requireAddress = true) {
    if (!['pickup', 'express', 'economy'].includes(f.deliveryMode)) throw Errors.validation({ fields: { deliveryMode: ['Mode inconnu.'] } });
    if (!['mobile_money', 'cash'].includes(f.paymentMethod)) throw Errors.validation({ fields: { paymentMethod: ['Moyen inconnu.'] } });
    if (f.deliveryMode === 'pickup') {
      return { deliveryMode: 'pickup' as const, paymentMethod: f.paymentMethod, shopCommuneCode: await this.tariffs.shopCommune(shopId, tx), deliveryCommuneCode: null, deliveryAddress: null, fee: null };
    }
    // Espèces : seulement au retrait en boutique tant que les livreurs employés n'existent pas (F3 bis, 7-E / 7-F).
    if (f.paymentMethod === 'cash') {
      throw Errors.validation({ fields: { paymentMethod: ['Les espèces ne sont possibles qu’au retrait en boutique pour le moment.'] } });
    }
    const address = f.address?.trim();
    const fields: Record<string, string[]> = {};
    if (!f.communeCode) fields.communeCode = ['Choisis la commune de livraison.'];
    if (requireAddress && (!address || address.length < 5 || address.length > 300)) fields.address = ['Précise l’adresse (5 à 300 caractères).'];
    if (Object.keys(fields).length) throw Errors.validation({ fields });
    const from = await this.tariffs.shopCommune(shopId, tx);
    const q = await this.tariffs.quote(from, f.communeCode!, f.deliveryMode, tx);
    if (!q.available) throw new AppError('DELIVERY_UNAVAILABLE', 'Ce mode de livraison n’est pas disponible pour cette adresse.', HttpStatus.CONFLICT, { mode: f.deliveryMode, reason: q.reason });
    return { deliveryMode: f.deliveryMode, paymentMethod: f.paymentMethod, shopCommuneCode: from, deliveryCommuneCode: f.communeCode!, deliveryAddress: address ?? null, fee: q };
  }

  private async assertCanOrder(tx: DbOrTx, customerId: string, shopId: string) {
    const [u] = await tx.select({ status: users.status, birthDate: users.birthDate }).from(users).where(eq(users.id, customerId)).limit(1);
    if (!u || u.status !== 'active') throw Errors.forbidden();
    // A12 : âge minimum des « autres paiements (BimShop, projets) » ; non décidé = commandes fermées (F15).
    await this.age.assert('other_payments', u.birthDate);
    const [member] = await tx.select({ u: shopMembers.userId }).from(shopMembers).where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, customerId), isNotNull(shopMembers.acceptedAt))).limit(1);
    if (member) throw Errors.forbidden('Tu ne peux pas commander dans ta propre boutique.');
  }

  private async activeShop(tx: DbOrTx, shopId: string) {
    const [s] = await tx
      .select({ id: shops.id, status: shops.status, owner: shops.ownerUserId, ownerStatus: users.status })
      .from(shops)
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!s || s.status !== 'active' || s.ownerStatus !== 'active') throw new AppError('SHOP_UNAVAILABLE', 'Cette boutique ne prend pas de commande pour le moment.', HttpStatus.CONFLICT);
    return s;
  }

  /** Récapitulatif affiché avant confirmation (§3.1) : prix des lignes, frais, délai estimé, règle d'attente. */
  async preview(customerId: string, shopId: string, lines: LineInput[], f: FulfilmentInput) {
    await this.activeShop(this.db, shopId);
    const resolved = await this.resolveLines(this.db, shopId, lines, { published: true, allowNegotiated: false });
    const ful = await this.fulfilment(this.db, shopId, f, false);
    const itemsTotal = OrdersService.itemsTotal(resolved);
    const fee = ful.fee?.available ? ful.fee.feeFcfa : 0;
    return {
      items: resolved.map((l) => ({ productId: l.productId, variantId: l.variantId, reference: l.reference, title: l.title, variantLabel: l.variantLabel, quantity: l.quantity, unitPriceFcfa: l.appliedPriceFcfa, available: l.stock === null || l.stock >= l.quantity })),
      deliveryMode: ful.deliveryMode,
      paymentMethod: ful.paymentMethod,
      itemsTotalFcfa: itemsTotal,
      deliveryFeeFcfa: ful.fee ? fee : null,
      totalFcfa: itemsTotal + fee,
      delivery: ful.fee?.available ? this.feeView(ful.fee) : null,
      canOrder: await this.age.status('other_payments', (await this.birth(customerId))).then((s) => s.allowed),
    };
  }

  private async birth(userId: string) {
    const [u] = await this.db.select({ b: users.birthDate }).from(users).where(eq(users.id, userId)).limit(1);
    return u!.b;
  }

  private feeView(q: Extract<Awaited<ReturnType<TariffsService['quote']>>, { available: true }>) {
    return {
      estimatedMinutes: q.minutes,
      tariffVersion: q.tariffVersion,
      waitRule: { freeMinutes: q.breakdown.freeWaitMinutes, perMinuteFcfa: q.breakdown.waitPerMinuteFcfa, capMinutes: q.breakdown.waitCapMinutes, billed: q.waitFeesBilled },
    };
  }

  private checkExpected(expected: number | undefined, total: number, itemsTotal: number, fee: number | null) {
    if (expected !== total) {
      throw new AppError('PRICE_CHANGED', 'Le montant a changé : vérifie le récapitulatif avant de confirmer.', HttpStatus.CONFLICT, { itemsTotalFcfa: itemsTotal, deliveryFeeFcfa: fee, totalFcfa: total });
    }
  }

  // ------------------------------------------------------------------ Création

  /** Copie de la photo principale de chaque ligne (l'archivage d'un article efface ses photos). */
  private async copyPhotos(orderId: string, lines: Array<{ productId: string }>, ids: string[]) {
    const keys: (string | null)[] = [];
    for (const [i, l] of lines.entries()) {
      const [m] = await this.db.select({ key: productMedia.storageKey }).from(productMedia).where(eq(productMedia.productId, l.productId)).orderBy(asc(productMedia.position)).limit(1);
      if (!m || !this.storage.available) {
        keys.push(null);
        continue;
      }
      const key = `orders/${orderId}/${ids[i]}.jpg`;
      try {
        await this.storage.put(key, await this.storage.read(m.key), 'image/jpeg');
        keys.push(key);
      } catch {
        keys.push(null);
      }
    }
    return keys;
  }

  private async insertItems(tx: Tx, orderId: string, lines: Awaited<ReturnType<OrdersService['resolveLines']>>, ids: string[], photos: (string | null)[]) {
    await tx.insert(orderItems).values(
      lines.map((l, i) => ({
        id: ids[i],
        orderId,
        position: i,
        productId: l.productId,
        reference: l.reference,
        contentVersion: l.contentVersion,
        kind: l.kind,
        title: l.title,
        variantId: l.variantId,
        variantLabel: l.variantLabel,
        quantity: l.quantity,
        catalogPriceFcfa: l.catalogPriceFcfa,
        appliedPriceFcfa: l.appliedPriceFcfa,
        photoKey: photos[i],
      })),
    );
  }

  event(tx: DbOrTx, orderId: string, type: string, actorType: string, actorId: string | null, from: string | null, to: string | null, data: Record<string, unknown> = {}) {
    return tx.insert(orderEvents).values({ id: uuidv7(), orderId, type, actorType, actorId, fromStatus: from, toStatus: to, data });
  }

  private feeColumns(ful: Awaited<ReturnType<OrdersService['fulfilment']>>) {
    const q = ful.fee?.available ? ful.fee : null;
    return {
      deliveryMode: ful.deliveryMode,
      paymentMethod: ful.paymentMethod,
      shopCommuneCode: ful.shopCommuneCode,
      deliveryCommuneCode: ful.deliveryCommuneCode,
      deliveryAddress: ful.deliveryAddress,
      deliveryFeeFcfa: q ? q.feeFcfa : null,
      tariffId: q ? q.tariffId : null,
      tariffVersion: q ? q.tariffVersion : null,
      estimatedMinutes: q ? q.minutes : null,
      feeDetails: q ? { ...q.breakdown, minutes: q.minutes, waitFeesBilled: q.waitFeesBilled } : null,
    };
  }

  /**
   * Commande du BimShop : en attente de la boutique. Clé anti-doublon : la même demande renvoyée (double appui, réseau)
   * rend la commande déjà créée. Le montant attendu par l'app doit être celui calculé par le serveur.
   */
  async create(customerId: string, input: { shopId: string; items: LineInput[]; expectedTotalFcfa: number; idempotencyKey: string } & FulfilmentInput, meta: RequestMeta) {
    const existing = await this.byIdempotency(customerId, input.idempotencyKey);
    if (existing) return existing.id;
    await this.assertCanOrder(this.db, customerId, input.shopId);
    await this.activeShop(this.db, input.shopId);
    const pre = await this.resolveLines(this.db, input.shopId, input.items, { published: true, allowNegotiated: false });
    const short = OrdersService.outOfStock(pre);
    if (short.length) throw new AppError('OUT_OF_STOCK', 'Stock insuffisant pour un article.', HttpStatus.CONFLICT, { indexes: short.map((s) => s.i) });
    const id = uuidv7();
    const itemIds = pre.map(() => uuidv7());
    const photos = await this.copyPhotos(id, pre, itemIds);
    const ttl = await this.intSetting('orders.shop_confirm_ttl_hours', 24);
    try {
      await this.db.transaction(async (tx) => {
        await this.activeShop(tx, input.shopId);
        const lines = await this.resolveLines(tx, input.shopId, input.items, { published: true, allowNegotiated: false });
        const ful = await this.fulfilment(tx, input.shopId, input);
        const itemsTotal = OrdersService.itemsTotal(lines);
        const fee = ful.fee?.available ? ful.fee.feeFcfa : null;
        this.checkExpected(input.expectedTotalFcfa, itemsTotal + (fee ?? 0), itemsTotal, fee);
        await tx.insert(orders).values({
          id,
          shopId: input.shopId,
          customerId,
          source: 'bimshop',
          status: 'pending_shop',
          ...this.feeColumns(ful),
          itemsTotalFcfa: itemsTotal,
          idempotencyKey: input.idempotencyKey,
          createdBy: customerId,
          expiresAt: new Date(Date.now() + ttl * 3600_000),
        });
        await this.insertItems(tx, id, lines, itemIds, photos);
        await this.event(tx, id, 'created', 'customer', customerId, null, 'pending_shop', { source: 'bimshop' });
        await this.audit.log({ actorType: 'user', actorId: customerId, action: 'orders.order_created', targetType: 'order', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId: input.shopId, source: 'bimshop' } }, tx);
      });
    } catch (e) {
      await this.removePhotos(photos);
      // Deux envois simultanés de la même demande : le second rend la commande du premier.
      const again = await this.byIdempotency(customerId, input.idempotencyKey);
      if (again) return again.id;
      throw e;
    }
    return id;
  }

  private async removePhotos(keys: (string | null)[]) {
    for (const k of keys) if (k) await this.storage.remove(k).catch(() => undefined);
  }

  private async byIdempotency(userId: string, key: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key ?? '')) throw Errors.validation({ fields: { idempotencyKey: ['Clé invalide.'] } });
    const [o] = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.createdBy, userId), eq(orders.idempotencyKey, key))).limit(1);
    return o ?? null;
  }

  /**
   * Proposition de la boutique dans sa conversation (§3.1) : vaut confirmation de la boutique ; le client choisit le mode
   * et l'accepte. Refusée si la personne ne peut pas commander (âge, A12).
   */
  async propose(staffId: string, shopId: string, input: { conversationId: string; items: LineInput[]; idempotencyKey: string }, meta: RequestMeta) {
    const existing = await this.byIdempotency(staffId, input.idempotencyKey);
    if (existing) return existing.id;
    await this.activeShop(this.db, shopId);
    const [conv] = await this.db
      .select({ id: conversations.id, client: conversationMembers.userId, owner: shops.ownerUserId })
      .from(conversations)
      .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
      .innerJoin(shops, eq(shops.id, conversations.shopId))
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.kind, 'shop'), eq(conversations.shopId, shopId)))
      .limit(1);
    if (!conv || (await this.messaging.blocked(conv.client, conv.owner)).length) throw Errors.notFound('Conversation');
    try {
      await this.assertCanOrder(this.db, conv.client, shopId);
    } catch (e) {
      if (e instanceof AppError && e.code === 'RULE_NOT_DECIDED') throw e;
      // Le motif exact (âge…) n'est pas communiqué à la boutique.
      throw new AppError('CUSTOMER_CANNOT_ORDER', 'Cette personne ne peut pas recevoir de proposition de commande.', HttpStatus.FORBIDDEN);
    }
    const pre = await this.resolveLines(this.db, shopId, input.items, { published: false, allowNegotiated: true });
    const id = uuidv7();
    const itemIds = pre.map(() => uuidv7());
    const photos = await this.copyPhotos(id, pre, itemIds);
    const ttl = await this.intSetting('orders.proposal_ttl_hours', 24);
    try {
      await this.db.transaction(async (tx) => {
        const lines = await this.resolveLines(tx, shopId, input.items, { published: false, allowNegotiated: true });
        const now = new Date();
        await tx.insert(orders).values({
          id,
          shopId,
          customerId: conv.client,
          source: 'conversation',
          conversationId: conv.id,
          status: 'proposed',
          itemsTotalFcfa: OrdersService.itemsTotal(lines),
          idempotencyKey: input.idempotencyKey,
          createdBy: staffId,
          expiresAt: new Date(now.getTime() + ttl * 3600_000),
        });
        await this.insertItems(tx, id, lines, itemIds, photos);
        await this.event(tx, id, 'proposed', 'shop', staffId, null, 'proposed', { negotiated: lines.some((l) => l.appliedPriceFcfa < l.catalogPriceFcfa) });
        // Carte de la proposition dans la conversation.
        const mid = uuidv7();
        await tx.insert(messages).values({ id: mid, conversationId: conv.id, senderId: staffId, senderShopId: shopId, kind: 'order', orderId: id, createdAt: now });
        await tx.update(conversations).set({ lastMessageAt: now, shopLastReadMessageId: mid }).where(eq(conversations.id, conv.id));
        await this.audit.log({ actorType: 'user', actorId: staffId, action: 'orders.order_proposed', targetType: 'order', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, conversationId: conv.id } }, tx);
      });
    } catch (e) {
      await this.removePhotos(photos);
      const again = await this.byIdempotency(staffId, input.idempotencyKey);
      if (again) return again.id;
      throw e;
    }
    return id;
  }

  // ------------------------------------------------------------------ Transitions

  /** Transition conditionnelle : sans effet (409) si la commande n'est plus dans un statut attendu. */
  async move(tx: Tx, orderId: string, from: readonly string[], to: string, set: Partial<Order>, ev: { type: string; actorType: string; actorId: string | null; data?: Record<string, unknown> }) {
    const [before] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
    if (!before) throw Errors.notFound('Commande');
    if (!from.includes(before.status)) throw stateChanged(before.status);
    const [after] = await tx
      .update(orders)
      .set({ ...set, status: to })
      .where(and(eq(orders.id, orderId), inArray(orders.status, [...from])))
      .returning();
    if (!after) throw stateChanged(before.status);
    await this.event(tx, orderId, ev.type, ev.actorType, ev.actorId, before.status, to, ev.data ?? {});
    return { before, after };
  }

  /** Stock retiré à la confirmation (mouvements « sale ») ; la base refuse tout stock négatif : survente impossible. */
  private async commitStock(tx: Tx, orderId: string, actorId: string) {
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const it of items) {
      if (it.kind !== 'product') continue;
      try {
        await tx.insert(inventoryMovements).values({ id: uuidv7(), variantId: it.variantId, delta: -it.quantity, reason: 'sale', createdBy: actorId });
      } catch (e) {
        // La transaction est annulée : rien n'est confirmé si une seule ligne manque de stock.
        if (!/Stock négatif interdit/.test(String((e as { cause?: unknown }).cause ?? e))) throw e;
        throw new AppError('OUT_OF_STOCK', `Stock insuffisant : ${it.title} (${it.variantLabel}).`, HttpStatus.CONFLICT, { reference: it.reference, variantLabel: it.variantLabel });
      }
    }
    await tx.update(orders).set({ stockCommitted: 1 }).where(eq(orders.id, orderId));
  }

  private async returnStock(tx: Tx, order: Order, actorId: string | null) {
    if (!order.stockCommitted) return;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    for (const it of items) {
      if (it.kind === 'product') await tx.insert(inventoryMovements).values({ id: uuidv7(), variantId: it.variantId, delta: it.quantity, reason: 'return', createdBy: actorId });
    }
    await tx.update(orders).set({ stockCommitted: 0 }).where(eq(orders.id, order.id));
  }

  /** Code de remise créé à la confirmation (§3.2) : jamais journalisé, chiffré pour l'affichage au client. */
  private async createCode(tx: Tx, orderId: string) {
    const code = numericCode(4);
    await tx.insert(orderHandoverCodes).values({
      orderId,
      codeEncrypted: encryptBytes(Buffer.from(code), this.codeKey).toString('base64'),
      codeHash: hmacSha256(this.otpSecret, `handover:${orderId}:${code}`),
    });
  }

  /** Commande du BimShop confirmée par la boutique : stock retiré, code de remise créé. */
  async confirm(staffId: string, shopId: string, orderId: string) {
    await this.ownedByShop(shopId, orderId);
    await this.expireIfDue(orderId);
    await this.db.transaction(async (tx) => {
      const { after } = await this.move(tx, orderId, ['pending_shop'], 'confirmed', { confirmedAt: new Date(), expiresAt: null }, { type: 'confirmed', actorType: 'shop', actorId: staffId });
      await this.commitStock(tx, orderId, staffId);
      await this.createCode(tx, orderId);
      await this.payments.open(tx, after);
    });
  }

  /** Proposition acceptée par le client : il choisit le mode, l'adresse et le moyen prévu ; le montant est vérifié. */
  async accept(customerId: string, orderId: string, input: FulfilmentInput & { expectedTotalFcfa: number }, meta: RequestMeta) {
    const o = await this.ownedByCustomer(customerId, orderId);
    await this.expireIfDue(orderId);
    await this.assertCanOrder(this.db, customerId, o.shopId);
    await this.activeShop(this.db, o.shopId);
    await this.db.transaction(async (tx) => {
      const ful = await this.fulfilment(tx, o.shopId, input);
      const fee = ful.fee?.available ? ful.fee.feeFcfa : null;
      this.checkExpected(input.expectedTotalFcfa, o.itemsTotalFcfa + (fee ?? 0), o.itemsTotalFcfa, fee);
      const { after } = await this.move(tx, orderId, ['proposed'], 'confirmed', { ...this.feeColumns(ful), confirmedAt: new Date(), expiresAt: null }, { type: 'accepted', actorType: 'customer', actorId: customerId });
      await this.commitStock(tx, orderId, customerId);
      await this.createCode(tx, orderId);
      await this.payments.open(tx, after);
      await this.audit.log({ actorType: 'user', actorId: customerId, action: 'orders.proposal_accepted', targetType: 'order', targetId: orderId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId: o.shopId } }, tx);
    });
  }

  async decline(staffId: string, shopId: string, orderId: string, reason: string) {
    await this.ownedByShop(shopId, orderId);
    await this.expireIfDue(orderId);
    await this.db.transaction(async (tx) => {
      await this.move(tx, orderId, ['pending_shop'], 'declined', { closedAt: new Date(), endedByType: 'shop', endedById: staffId, endReason: reason, endedFromStatus: 'pending_shop', expiresAt: null }, { type: 'declined', actorType: 'shop', actorId: staffId, data: { reason } });
    });
  }

  async prepare(staffId: string, shopId: string, orderId: string) {
    await this.ownedByShop(shopId, orderId);
    await this.db.transaction(async (tx) => {
      await this.move(tx, orderId, ['confirmed'], 'preparing', {}, { type: 'preparing', actorType: 'shop', actorId: staffId });
    });
  }

  async ready(staffId: string, shopId: string, orderId: string) {
    await this.ownedByShop(shopId, orderId);
    await this.db.transaction(async (tx) => {
      await this.move(tx, orderId, ['preparing'], 'ready', { readyAt: new Date() }, { type: 'ready', actorType: 'shop', actorId: staffId });
    });
  }

  /**
   * Retrait en boutique (§3.11) : la boutique saisit le code du client. Essais faux limités (code bloqué ensuite) ;
   * code à usage unique ; le code n'est jamais enregistré dans l'historique ni le journal.
   */
  async handover(staffId: string, shopId: string, orderId: string, code: string) {
    const o = await this.ownedByShop(shopId, orderId);
    if (o.deliveryMode !== 'pickup') throw new AppError('NOT_PICKUP', 'Cette commande est livrée : le code est saisi par le livreur.', HttpStatus.CONFLICT);
    const result = await this.db.transaction(async (tx) => {
      const [cur] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
      if (!cur) throw Errors.notFound('Commande');
      if (cur.status !== 'ready') throw stateChanged(cur.status);
      const r = await this.checkHandoverCode(tx, orderId, code, 'shop', staffId);
      if (!r.ok) return r;
      await this.move(tx, orderId, ['ready'], 'delivered', { deliveredAt: new Date() }, { type: 'handed_over', actorType: 'shop', actorId: staffId });
      return r;
    });
    OrdersService.throwCodeResult(result);
  }

  /**
   * Vérifie le code de remise d'une commande (retrait au comptoir ou livraison) : empreinte comparée à temps constant,
   * essais faux comptés et code bloqué au-delà, usage unique. Le code n'apparaît jamais dans l'historique. Le résultat
   * d'un échec est renvoyé (et non levé) pour que le compteur d'essais soit enregistré avec la transaction.
   */
  async checkHandoverCode(tx: Tx, orderId: string, code: string, actorType: 'shop' | 'courier', actorId: string): Promise<{ ok: true } | { ok: false; code: string; remaining?: number }> {
    const max = await this.intSetting('orders.handover_code_max_attempts', 5);
    const [c] = await tx.select().from(orderHandoverCodes).where(eq(orderHandoverCodes.orderId, orderId)).for('update').limit(1);
    if (!c) throw stateChanged('no_code');
    if (c.status === 'blocked') return { ok: false, code: 'HANDOVER_CODE_BLOCKED' };
    if (c.status !== 'active') throw new AppError('HANDOVER_CODE_USED', 'Ce code a déjà servi ou n’est plus valable.', HttpStatus.CONFLICT);
    const ok = /^\d{4}$/.test(code) && safeEqualHex(c.codeHash, hmacSha256(this.otpSecret, `handover:${orderId}:${code}`));
    if (!ok) {
      const failed = c.failedAttempts + 1;
      const blocked = failed >= max;
      await tx.update(orderHandoverCodes).set({ failedAttempts: failed, status: blocked ? 'blocked' : 'active' }).where(eq(orderHandoverCodes.orderId, orderId));
      await this.event(tx, orderId, blocked ? 'code_blocked' : 'code_failed', actorType, actorId, null, null, { attempt: failed });
      return { ok: false, code: blocked ? 'HANDOVER_CODE_BLOCKED' : 'HANDOVER_CODE_INVALID', remaining: Math.max(0, max - failed) };
    }
    await tx.update(orderHandoverCodes).set({ status: 'used', usedAt: new Date(), usedBy: actorType === 'shop' ? actorId : null }).where(eq(orderHandoverCodes.orderId, orderId));
    await this.event(tx, orderId, 'code_validated', actorType, actorId, null, null);
    return { ok: true };
  }

  static throwCodeResult(result: { ok: true } | { ok: false; code: string; remaining?: number }) {
    if (result.ok) return;
    if (result.code === 'HANDOVER_CODE_BLOCKED') throw new AppError('HANDOVER_CODE_BLOCKED', 'Trop d’essais : ce code est bloqué. Le support peut le recréer.', HttpStatus.CONFLICT);
    throw new AppError('HANDOVER_CODE_INVALID', 'Code incorrect.', HttpStatus.BAD_REQUEST, { remaining: result.remaining });
  }

  /** Annulation par le client : proposition refusée, ou commande annulée avant la préparation. */
  async cancelByCustomer(customerId: string, orderId: string, reason: string | undefined) {
    await this.ownedByCustomer(customerId, orderId);
    await this.expireIfDue(orderId);
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
      const to = cur.status === 'proposed' ? 'declined' : 'cancelled';
      const { before } = await this.move(tx, orderId, ['proposed', 'pending_shop', 'confirmed'], to, { closedAt: new Date(), endedByType: 'customer', endedById: customerId, endReason: reason ?? null, endedFromStatus: cur.status, expiresAt: null }, { type: to === 'declined' ? 'proposal_declined' : 'cancelled', actorType: 'customer', actorId: customerId, data: reason ? { reason } : {} });
      await this.returnStock(tx, before, customerId);
      await tx.update(orderHandoverCodes).set({ status: 'cancelled' }).where(and(eq(orderHandoverCodes.orderId, orderId), eq(orderHandoverCodes.status, 'active')));
      await this.payments.cancel(tx, orderId);
    });
  }

  /** Annulation par la boutique (motif obligatoire) ou retrait d'une proposition. */
  async cancelByShop(staffId: string, shopId: string, orderId: string, reason: string) {
    await this.ownedByShop(shopId, orderId);
    await this.expireIfDue(orderId);
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
      const { before } = await this.move(tx, orderId, ['proposed', 'confirmed', 'preparing', 'ready'], 'cancelled', { closedAt: new Date(), endedByType: 'shop', endedById: staffId, endReason: reason, endedFromStatus: cur.status, expiresAt: null }, { type: cur.status === 'proposed' ? 'proposal_withdrawn' : 'cancelled', actorType: 'shop', actorId: staffId, data: { reason } });
      await this.returnStock(tx, before, staffId);
      // 7-F : la livraison non encore prise en charge est annulée, son état figé (le colis n'a pas quitté la boutique).
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).for('update').limit(1);
      if (d && !['closed', 'refused_by_client', 'client_absent', 'cancelled'].includes(d.status)) {
        await tx.update(deliveryOffers).set({ status: 'withdrawn', answeredAt: new Date() }).where(and(eq(deliveryOffers.deliveryId, d.id), eq(deliveryOffers.status, 'offered')));
        await tx.update(deliveries).set({ status: 'cancelled', endedAt: new Date(), endReason: 'Commande annulée par la boutique' }).where(eq(deliveries.id, d.id));
        await tx.insert(deliveryEvents).values({ id: uuidv7(), deliveryId: d.id, type: 'cancelled', actorType: 'shop', actorId: staffId, data: { fromStatus: d.status } });
      }
      await tx.update(orderHandoverCodes).set({ status: 'cancelled' }).where(and(eq(orderHandoverCodes.orderId, orderId), eq(orderHandoverCodes.status, 'active')));
      await this.payments.cancel(tx, orderId);
    });
  }

  // ------------------------------------------------------------------ Expiration

  /** Expire une proposition ou une commande en attente dont le délai est dépassé (aussi appelé à la lecture). */
  async expireIfDue(orderId: string, now = new Date()) {
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1);
      if (!o || !['proposed', 'pending_shop'].includes(o.status) || !o.expiresAt || o.expiresAt > now) return;
      await tx.update(orders).set({ status: 'expired', closedAt: now, endedByType: 'system', endedFromStatus: o.status, expiresAt: null }).where(eq(orders.id, orderId));
      await this.event(tx, orderId, 'expired', 'system', null, o.status, 'expired');
    });
  }

  /** Worker : toutes les commandes échues (par lots). */
  async expireDue(now = new Date()) {
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(inArray(orders.status, ['proposed', 'pending_shop']), lte(orders.expiresAt, now)))
      .limit(200);
    for (const d of due) await this.expireIfDue(d.id, now);
    return due.length;
  }

  // ------------------------------------------------------------------ Lecture

  private async ownedByCustomer(customerId: string, orderId: string) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    return o;
  }

  private async ownedByShop(shopId: string, orderId: string) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).limit(1);
    if (!o) throw Errors.notFound('Commande');
    return o;
  }

  private async photo(key: string | null, apiBase: string) {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  /** Ce que chaque partie peut faire maintenant (l'app n'affiche que ces actions ; le serveur revérifie tout). */
  static actions(o: Order, party: Party): string[] {
    if (party === 'customer') {
      return { proposed: ['accept', 'decline'], pending_shop: ['cancel'], confirmed: ['cancel'] }[o.status as 'proposed'] ?? [];
    }
    const a: Record<string, string[]> = {
      proposed: ['withdraw'],
      pending_shop: ['confirm', 'decline'],
      confirmed: ['prepare', 'cancel'],
      preparing: ['ready', 'cancel'],
      ready: o.deliveryMode === 'pickup' ? ['handover', 'cancel'] : ['cancel'],
    };
    return a[o.status] ?? [];
  }

  async view(o: Order, party: Party, apiBase: string) {
    const items: Item[] = await this.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.position));
    const events = await this.db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    const [shop] = await this.db.select({ id: shops.id, name: shops.name, slug: shops.slug, city: shops.city, commune: shops.commune }).from(shops).where(eq(shops.id, o.shopId));
    const [customer] = await this.db.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, o.customerId));
    const [commune] = o.deliveryCommuneCode ? await this.db.select({ name: communes.name, city: communes.city }).from(communes).where(eq(communes.code, o.deliveryCommuneCode)) : [];
    const [code] = await this.db.select().from(orderHandoverCodes).where(eq(orderHandoverCodes.orderId, o.id));
    const fee = o.feeDetails as { freeWaitMinutes?: number; waitPerMinuteFcfa?: number; waitCapMinutes?: number; waitFeesBilled?: boolean } | null;
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      source: o.source,
      shop: { id: shop.id, name: shop.name, slug: shop.slug, city: shop.city, commune: shop.commune },
      // La boutique voit le nom de la personne (pas son adresse tant qu'il n'y a pas de livraison).
      customer: party === 'shop' ? { fullName: customer.fullName, username: customer.username } : null,
      conversationId: o.conversationId,
      items: await Promise.all(
        items.map(async (i) => ({
          productId: i.productId,
          reference: i.reference,
          contentVersion: i.contentVersion,
          kind: i.kind,
          title: i.title,
          variantLabel: i.variantLabel,
          quantity: i.quantity,
          catalogPriceFcfa: i.catalogPriceFcfa,
          unitPriceFcfa: i.appliedPriceFcfa,
          lineTotalFcfa: i.appliedPriceFcfa * i.quantity,
          photoUrl: await this.photo(i.photoKey, apiBase),
        })),
      ),
      deliveryMode: o.deliveryMode,
      paymentMethod: o.paymentMethod,
      delivery:
        o.deliveryMode && o.deliveryMode !== 'pickup'
          ? {
              communeCode: o.deliveryCommuneCode,
              commune: commune ? `${commune.name} (${commune.city})` : o.deliveryCommuneCode,
              address: o.deliveryAddress,
              feeFcfa: o.deliveryFeeFcfa,
              estimatedMinutes: o.estimatedMinutes,
              tariffVersion: o.tariffVersion,
              waitRule: fee ? { freeMinutes: fee.freeWaitMinutes, perMinuteFcfa: fee.waitPerMinuteFcfa, capMinutes: fee.waitCapMinutes, billed: fee.waitFeesBilled } : null,
            }
          : null,
      itemsTotalFcfa: o.itemsTotalFcfa,
      deliveryFeeFcfa: o.deliveryFeeFcfa,
      totalFcfa: o.itemsTotalFcfa + (o.deliveryFeeFcfa ?? 0),
      createdAt: o.createdAt,
      expiresAt: o.expiresAt,
      confirmedAt: o.confirmedAt,
      readyAt: o.readyAt,
      deliveredAt: o.deliveredAt,
      ended: ENDED.includes(o.status) ? { byType: o.endedByType, reason: o.endReason, fromStatus: o.endedFromStatus, at: o.closedAt } : null,
      // Code de remise : au client seulement, tant qu'il peut servir. Jamais à la boutique.
      handoverCode: party === 'customer' && code?.status === 'active' && (ACTIVE as readonly string[]).includes(o.status) ? decryptBytes(Buffer.from(code.codeEncrypted, 'base64'), this.codeKey).toString() : null,
      handoverCodeStatus: code ? code.status : null,
      events: events.map((e) => ({ type: e.type, actorType: e.actorType, fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.createdAt, reason: (e.data as { reason?: string }).reason ?? null })),
      payment: await this.payments.view(o, party),
      // 7-H : évaluations du client (articles et boutique), après la remise et dans le délai.
      reviews: party === 'customer' ? await this.reviews.orderState(o) : null,
      actions: [...OrdersService.actions(o, party), ...PaymentsService.actions(o, await this.payments.forOrder(o.id), party, await this.payments.payable(o))],
    };
  }

  async getForCustomer(customerId: string, orderId: string, apiBase: string) {
    await this.ownedByCustomer(customerId, orderId);
    await this.expireIfDue(orderId);
    return this.view(await this.ownedByCustomer(customerId, orderId), 'customer', apiBase);
  }

  async getForShop(shopId: string, orderId: string, apiBase: string) {
    await this.ownedByShop(shopId, orderId);
    await this.expireIfDue(orderId);
    return this.view(await this.ownedByShop(shopId, orderId), 'shop', apiBase);
  }

  private summary(o: Order, extra: { shopName?: string; customerName?: string; firstTitle: string | null; count: number; photoUrl: string | null }, party: Party) {
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      source: o.source,
      deliveryMode: o.deliveryMode,
      totalFcfa: o.itemsTotalFcfa + (o.deliveryFeeFcfa ?? 0),
      createdAt: o.createdAt,
      expiresAt: o.expiresAt,
      shopName: extra.shopName ?? null,
      customerName: extra.customerName ?? null,
      title: extra.count > 1 ? `${extra.firstTitle} + ${extra.count - 1}` : extra.firstTitle,
      photoUrl: extra.photoUrl,
      actions: OrdersService.actions(o, party),
    };
  }

  private async firstItems(ids: string[]) {
    if (!ids.length) return new Map<string, { title: string; count: number; photoKey: string | null }>();
    const rows = await this.db.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.position));
    const m = new Map<string, { title: string; count: number; photoKey: string | null }>();
    for (const r of rows) {
      const cur = m.get(r.orderId);
      if (cur) cur.count += 1;
      else m.set(r.orderId, { title: r.title, count: 1, photoKey: r.photoKey });
    }
    return m;
  }

  /** « Mes commandes » (client), du plus récent au plus ancien. */
  async listForCustomer(customerId: string, cursor: string | undefined, apiBase: string) {
    await this.expireOwned(eq(orders.customerId, customerId));
    const rows = await this.db
      .select({ o: orders, shopName: shops.name })
      .from(orders)
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .where(and(eq(orders.customerId, customerId), cursor ? lt(orders.id, cursor) : undefined))
      .orderBy(desc(orders.id))
      .limit(31);
    const page = rows.slice(0, 30);
    const first = await this.firstItems(page.map((r) => r.o.id));
    return {
      items: await Promise.all(page.map(async (r) => this.summary(r.o, { shopName: r.shopName, firstTitle: first.get(r.o.id)?.title ?? null, count: first.get(r.o.id)?.count ?? 0, photoUrl: await this.photo(first.get(r.o.id)?.photoKey ?? null, apiBase) }, 'customer'))),
      nextCursor: rows.length > 30 ? page[page.length - 1].o.id : null,
    };
  }

  /** « Commandes reçues » (boutique) : à traiter, en cours, terminées. */
  async listForShop(shopId: string, box: 'todo' | 'active' | 'done', cursor: string | undefined, apiBase: string) {
    await this.expireOwned(eq(orders.shopId, shopId));
    const statuses = { todo: ['pending_shop', 'confirmed'], active: ['proposed', 'preparing', 'ready', 'delivered'], done: ['completed', 'declined', 'expired', 'cancelled'] }[box];
    if (!statuses) throw Errors.validation({ fields: { box: ['todo, active ou done.'] } });
    const rows = await this.db
      .select({ o: orders, customerName: users.fullName })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.customerId))
      .where(and(eq(orders.shopId, shopId), inArray(orders.status, statuses), cursor ? lt(orders.id, cursor) : undefined))
      .orderBy(desc(orders.id))
      .limit(31);
    const page = rows.slice(0, 30);
    const first = await this.firstItems(page.map((r) => r.o.id));
    return {
      items: await Promise.all(page.map(async (r) => this.summary(r.o, { customerName: r.customerName, firstTitle: first.get(r.o.id)?.title ?? null, count: first.get(r.o.id)?.count ?? 0, photoUrl: await this.photo(first.get(r.o.id)?.photoKey ?? null, apiBase) }, 'shop'))),
      nextCursor: rows.length > 30 ? page[page.length - 1].o.id : null,
    };
  }

  /** Compteurs de l'espace boutique (écran 55) : commandes à traiter. */
  async shopCounts(shopId: string) {
    await this.expireOwned(eq(orders.shopId, shopId));
    const rows = await this.db.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.shopId, shopId)).groupBy(orders.status);
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return { toConfirm: by.pending_shop ?? 0, toPrepare: (by.confirmed ?? 0) + (by.preparing ?? 0), ready: by.ready ?? 0, paymentsToConfirm: await this.payments.shopPendingCount(shopId) };
  }

  private async expireOwned(where: ReturnType<typeof eq>) {
    const due = await this.db.select({ id: orders.id }).from(orders).where(and(where, inArray(orders.status, ['proposed', 'pending_shop']), lte(orders.expiresAt, new Date()))).limit(50);
    for (const d of due) await this.expireIfDue(d.id);
  }

  /** Résumé d'une commande pour sa carte dans la conversation (les deux parties). */
  async card(orderId: string) {
    await this.expireIfDue(orderId);
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) return null;
    const first = (await this.firstItems([o.id])).get(o.id);
    return { id: o.id, number: o.number, status: o.status, itemsTotalFcfa: o.itemsTotalFcfa, title: first ? (first.count > 1 ? `${first.title} + ${first.count - 1}` : first.title) : null, expiresAt: o.expiresAt };
  }
}
