import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DB, Database } from '../../database/database.module';
import { coinGifts, liveComments, lives, liveViewers, products, shops, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { CLOCK, Clock } from '../projects/projects.service';
import { notBlockedBetween } from '../social/access';
import { WalletService } from '../wallet/wallet.service';

type Live = typeof lives.$inferSelect;

/** Un Live s'arrête de lui-même après 4 heures (prototype). */
export const LIVE_MAX_HOURS = 4;
/** Un spectateur compte « en ce moment » s'il a lu l'état du Live dans les 30 dernières secondes. */
export const LIVE_PRESENCE_SECONDS = 30;
export const LIVE_SCHEDULE_MAX_DAYS = 30;
export const LIVE_HEARTS_MAX = 50;
const PAGE = 50;

const conflict = (code: string, message: string) => new AppError(code, message, HttpStatus.CONFLICT);

/**
 * Lot 10 (prototype) — Lives sans service vidéo. Programmation, lancement, fin, commentaires, cœurs, cadeaux en pièces
 * (reçus par la personne qui anime, Premium exigé), produit épinglé (Live vente d'une boutique), spectateurs. Le temps
 * réel passe par une lecture régulière de l'état (toutes les 2 à 3 secondes), sans service payant. Mode démonstration.
 */
@Injectable()
export class LivesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
  ) {}

  private assertDemo() {
    if (!this.cfg.DEMO_MODE) throw Errors.notConfigured('Le Live');
  }

  /** Fin automatique d'un Live trop long (appliquée à la lecture). */
  private async expire(l: Live): Promise<Live> {
    if (l.status !== 'live' || !l.startedAt || this.clock.now().getTime() - l.startedAt.getTime() < LIVE_MAX_HOURS * 3_600_000) return l;
    const [e] = await this.db.update(lives).set({ status: 'ended', endedAt: this.clock.now() }).where(and(eq(lives.id, l.id), eq(lives.status, 'live'))).returning();
    return e ?? { ...l, status: 'ended' };
  }

  /** Live visible : hôte actif, aucun blocage entre les deux ; sinon « introuvable ». */
  private async visible(viewerId: string, liveId: string): Promise<Live> {
    const [r] = await this.db
      .select({ l: lives })
      .from(lives)
      .innerJoin(users, eq(users.id, lives.hostUserId))
      .where(and(eq(lives.id, liveId), eq(users.status, 'active'), notBlockedBetween(viewerId, lives.hostUserId)));
    if (!r) throw Errors.notFound('Live');
    return this.expire(r.l);
  }

  private async hosted(userId: string, liveId: string): Promise<Live> {
    const [l] = await this.db.select().from(lives).where(eq(lives.id, liveId));
    if (!l || l.hostUserId !== userId) throw Errors.notFound('Live');
    return this.expire(l);
  }

  private async views(viewerId: string, rows: Live[]) {
    if (!rows.length) return [];
    const hostIds = [...new Set(rows.map((r) => r.hostUserId))];
    const shopIds = [...new Set(rows.map((r) => r.shopId).filter((x): x is string => !!x))];
    const productIds = [...new Set(rows.map((r) => r.pinnedProductId).filter((x): x is string => !!x))];
    const since = new Date(this.clock.now().getTime() - LIVE_PRESENCE_SECONDS * 1000);
    const [hosts, shopRows, productRows, premium, viewerRows] = await Promise.all([
      this.db.select({ id: users.id, username: users.username, fullName: users.fullName }).from(users).where(inArray(users.id, hostIds)),
      shopIds.length ? this.db.select({ id: shops.id, name: shops.name, slug: shops.slug }).from(shops).where(inArray(shops.id, shopIds)) : [],
      productIds.length
        ? this.db.select({ id: products.id, title: products.title, priceFcfa: products.priceFcfa, promoPriceFcfa: products.promoPriceFcfa, status: products.status }).from(products).where(inArray(products.id, productIds))
        : [],
      this.wallet.premiumUsers(hostIds),
      this.db
        .select({ liveId: liveViewers.liveId, n: sql<number>`count(*)::int` })
        .from(liveViewers)
        .where(and(inArray(liveViewers.liveId, rows.map((r) => r.id)), gt(liveViewers.lastSeenAt, since)))
        .groupBy(liveViewers.liveId),
    ]);
    const viewers = new Map(viewerRows.map((v) => [v.liveId, v.n]));
    return rows.map((l) => {
      const p = productRows.find((x) => x.id === l.pinnedProductId);
      return {
        id: l.id,
        kind: l.kind as 'simple' | 'sale',
        title: l.title,
        status: l.status as 'scheduled' | 'live' | 'ended',
        scheduledAt: l.scheduledAt,
        startedAt: l.startedAt,
        endedAt: l.endedAt,
        host: ((h) => (h ? { ...h, certified: premium.has(h.id) } : null))(hosts.find((x) => x.id === l.hostUserId)),
        shop: shopRows.find((s) => s.id === l.shopId) ?? null,
        pinnedProduct: p && p.status === 'published' ? { id: p.id, title: p.title, priceFcfa: p.priceFcfa, promoPriceFcfa: p.promoPriceFcfa } : null,
        heartCount: l.heartCount,
        coinCount: l.coinCount,
        viewers: l.status === 'live' ? (viewers.get(l.id) ?? 0) : 0,
        peakViewers: l.peakViewers,
        isMine: l.hostUserId === viewerId,
        // F10 non décidé : pas de pièces pendant un Live vente (boutique).
        canGift: this.cfg.DEMO_MODE && l.status === 'live' && l.kind === 'simple' && l.hostUserId !== viewerId && premium.has(l.hostUserId),
        demo: true,
        video: 'unavailable' as const,
        /** V1 — gadgets Premium de l'hôte (message épinglé, ambiance de la scène). */
        gadgets: { hostPremium: premium.has(l.hostUserId), pinnedMessage: l.pinnedMessage, theme: l.theme },
      };
    });
  }

  /** Lives en cours et programmés (écran 39), personnes bloquées exclues. */
  async list(viewerId: string) {
    if (!this.cfg.DEMO_MODE) return { available: false, live: [], upcoming: [] };
    const visible = and(eq(users.status, 'active'), notBlockedBetween(viewerId, lives.hostUserId));
    const live = await this.db.select({ l: lives }).from(lives).innerJoin(users, eq(users.id, lives.hostUserId)).where(and(eq(lives.status, 'live'), visible)).orderBy(desc(lives.startedAt)).limit(30);
    const upcoming = await this.db
      .select({ l: lives })
      .from(lives)
      .innerJoin(users, eq(users.id, lives.hostUserId))
      // Un Live programmé dont l'heure est passée depuis plus de 2 heures n'est plus proposé.
      .where(and(eq(lives.status, 'scheduled'), gt(lives.scheduledAt, new Date(this.clock.now().getTime() - 2 * 3_600_000)), visible))
      .orderBy(asc(lives.scheduledAt))
      .limit(30);
    const running = [];
    for (const r of live) {
      const l = await this.expire(r.l);
      if (l.status === 'live') running.push(l);
    }
    return { available: true, live: await this.views(viewerId, running), upcoming: await this.views(viewerId, upcoming.map((r) => r.l)) };
  }

  async detail(viewerId: string, liveId: string) {
    const [v] = await this.views(viewerId, [await this.visible(viewerId, liveId)]);
    return v;
  }

  private async checkProduct(shopId: string, productId: string | null | undefined) {
    if (!productId) return null;
    const [p] = await this.db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.shopId, shopId), eq(products.status, 'published')));
    if (!p) throw Errors.validation({ fields: { productId: ['Choisis un article publié de ta boutique.'] } });
    return p.id;
  }

  /**
   * Programmer ou lancer un Live. Simple : une personne ; vente : la boutique active (propriétaire), avec un produit
   * épinglé facultatif. Un seul Live en cours à la fois par personne.
   */
  async create(userId: string, dto: { title: string; scheduledAt?: string; productId?: string | null }, shopId: string | null, meta: RequestMeta) {
    this.assertDemo();
    const title = dto.title.trim();
    if (!title) throw Errors.validation({ fields: { title: ['Donne un titre à ton Live.'] } });
    const now = this.clock.now();
    let scheduledAt: Date | null = null;
    if (dto.scheduledAt) {
      scheduledAt = new Date(dto.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= now.getTime() || scheduledAt.getTime() > now.getTime() + LIVE_SCHEDULE_MAX_DAYS * 86_400_000) {
        throw Errors.validation({ fields: { scheduledAt: [`Choisis une date dans les ${LIVE_SCHEDULE_MAX_DAYS} prochains jours.`] } });
      }
    }
    if (shopId) {
      const [s] = await this.db.select({ status: shops.status }).from(shops).where(eq(shops.id, shopId));
      if (s?.status !== 'active') throw conflict('SHOP_NOT_ACTIVE', 'Ta boutique doit être validée pour lancer un Live vente.');
    }
    const pinned = shopId ? await this.checkProduct(shopId, dto.productId) : null;
    const id = uuidv7(now.getTime());
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('live'), hashtext(${userId}))`);
      if (!scheduledAt) await this.assertNoRunning(userId, tx);
      await tx.insert(lives).values({
        id,
        hostUserId: userId,
        shopId,
        kind: shopId ? 'sale' : 'simple',
        title,
        status: scheduledAt ? 'scheduled' : 'live',
        scheduledAt,
        startedAt: scheduledAt ? null : now,
        pinnedProductId: pinned,
      });
      await this.audit.log({ actorType: 'user', actorId: userId, action: scheduledAt ? 'live.scheduled' : 'live.started', targetType: 'live', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
    return this.detail(userId, id);
  }

  private async assertNoRunning(userId: string, db: Pick<Database, 'select'>) {
    const [r] = await db.select({ id: lives.id, startedAt: lives.startedAt }).from(lives).where(and(eq(lives.hostUserId, userId), eq(lives.status, 'live')));
    if (r && r.startedAt && this.clock.now().getTime() - r.startedAt.getTime() < LIVE_MAX_HOURS * 3_600_000) throw conflict('LIVE_ALREADY_RUNNING', 'Tu as déjà un Live en cours.');
  }

  async start(userId: string, liveId: string, meta: RequestMeta) {
    this.assertDemo();
    const l = await this.hosted(userId, liveId);
    if (l.status !== 'scheduled') throw conflict('LIVE_NOT_SCHEDULED', 'Ce Live n’est plus programmé.');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('live'), hashtext(${userId}))`);
      await this.assertNoRunning(userId, tx);
      await tx.update(lives).set({ status: 'live', startedAt: this.clock.now() }).where(and(eq(lives.id, liveId), eq(lives.status, 'scheduled')));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'live.started', targetType: 'live', targetId: liveId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return this.detail(userId, liveId);
  }

  /** Terminer un Live en cours, ou annuler un Live programmé. */
  async end(userId: string, liveId: string, meta: RequestMeta) {
    const l = await this.hosted(userId, liveId);
    if (l.status !== 'ended') {
      await this.db.update(lives).set({ status: 'ended', endedAt: this.clock.now() }).where(eq(lives.id, liveId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: l.status === 'live' ? 'live.ended' : 'live.cancelled', targetType: 'live', targetId: liveId, ip: meta.ip, userAgent: meta.userAgent });
    }
    return this.detail(userId, liveId);
  }

  async pin(userId: string, liveId: string, productId: string | null) {
    const l = await this.hosted(userId, liveId);
    if (l.kind !== 'sale' || !l.shopId) throw conflict('LIVE_NOT_SALE', 'Seul un Live vente épingle un article.');
    if (l.status === 'ended') throw conflict('LIVE_ENDED', 'Ce Live est terminé.');
    await this.db.update(lives).set({ pinnedProductId: await this.checkProduct(l.shopId, productId) }).where(eq(lives.id, liveId));
    return this.detail(userId, liveId);
  }

  /**
   * V1 — Gadgets Premium : l'hôte Premium épingle un message pour tous et choisit l'ambiance de la scène. Sans Premium,
   * seule l'ambiance « classique » et l'absence de message sont possibles (on peut toujours les retirer).
   */
  async gadgets(userId: string, liveId: string, input: { pinnedMessage?: string | null; theme?: string }) {
    const l = await this.hosted(userId, liveId);
    if (l.status === 'ended') throw conflict('LIVE_ENDED', 'Ce Live est terminé.');
    const message = input.pinnedMessage === undefined ? l.pinnedMessage : input.pinnedMessage?.trim() || null;
    const theme = input.theme ?? l.theme;
    const premium = (await this.wallet.premiumUsers([userId])).has(userId);
    if (!premium && ((message && message !== l.pinnedMessage) || (theme !== 'classic' && theme !== l.theme))) {
      throw new AppError('PREMIUM_REQUIRED', 'Les gadgets du Live sont réservés aux membres Premium.', HttpStatus.FORBIDDEN);
    }
    await this.db.update(lives).set({ pinnedMessage: message, theme }).where(eq(lives.id, liveId));
    return this.detail(userId, liveId);
  }

  private async running(viewerId: string, liveId: string) {
    const l = await this.visible(viewerId, liveId);
    if (l.status !== 'live') throw conflict('LIVE_NOT_RUNNING', 'Ce Live n’est pas en cours.');
    return l;
  }

  async comment(userId: string, liveId: string, text: string) {
    this.assertDemo();
    await this.running(userId, liveId);
    const t = text.trim();
    if (!t) throw Errors.validation({ fields: { text: ['Écris ton commentaire.'] } });
    const id = uuidv7();
    await this.db.insert(liveComments).values({ id, liveId, userId, text: t });
    return { id };
  }

  /** L'hôte retire un commentaire de son Live. */
  async hideComment(userId: string, liveId: string, commentId: string) {
    await this.hosted(userId, liveId);
    const r = await this.db.update(liveComments).set({ status: 'hidden' }).where(and(eq(liveComments.id, commentId), eq(liveComments.liveId, liveId))).returning({ id: liveComments.id });
    if (!r.length) throw Errors.notFound('Commentaire');
  }

  async hearts(userId: string, liveId: string, count: number) {
    this.assertDemo();
    await this.running(userId, liveId);
    const [l] = await this.db.update(lives).set({ heartCount: sql`${lives.heartCount} + ${count}` }).where(eq(lives.id, liveId)).returning({ heartCount: lives.heartCount });
    return { heartCount: l.heartCount };
  }

  /**
   * État du Live, lu régulièrement par l'app (temps réel sans service payant) : statut, spectateurs, cœurs, pièces,
   * nouveaux commentaires et cadeaux depuis les curseurs. Enregistre la présence de la personne qui regarde.
   */
  async state(viewerId: string, liveId: string, after?: string, giftsAfter?: string) {
    const l = await this.visible(viewerId, liveId);
    const now = this.clock.now();
    if (l.status === 'live' && l.hostUserId !== viewerId) {
      await this.db
        .insert(liveViewers)
        .values({ liveId, userId: viewerId, lastSeenAt: now })
        .onConflictDoUpdate({ target: [liveViewers.liveId, liveViewers.userId], set: { lastSeenAt: now } });
    }
    const [view] = await this.views(viewerId, [l]);
    if (view.viewers > l.peakViewers) await this.db.update(lives).set({ peakViewers: sql`greatest(${lives.peakViewers}, ${view.viewers})` }).where(eq(lives.id, liveId));
    // Curseurs avec recouvrement de 5 secondes : un identifiant plus ancien enregistré un peu plus tard (même
    // milliseconde, autre instance, attente d'un verrou) n'est jamais perdu ; l'app ignore ce qu'elle a déjà.
    const OVERLAP_MS = 5000;
    const commentConds = [eq(liveComments.liveId, liveId), eq(liveComments.status, 'published'), eq(users.status, 'active'), notBlockedBetween(viewerId, liveComments.userId)];
    if (after) {
      const [c] = await this.db.select({ at: liveComments.createdAt }).from(liveComments).where(and(eq(liveComments.id, after), eq(liveComments.liveId, liveId)));
      if (c) commentConds.push(gt(liveComments.createdAt, new Date(c.at.getTime() - OVERLAP_MS)));
    }
    const comments = await this.db
      .select({ id: liveComments.id, text: liveComments.text, at: liveComments.createdAt, user: { id: users.id, username: users.username, fullName: users.fullName } })
      .from(liveComments)
      .innerJoin(users, eq(users.id, liveComments.userId))
      .where(and(...commentConds))
      .orderBy(after ? asc(liveComments.createdAt) : desc(liveComments.createdAt), after ? asc(liveComments.id) : desc(liveComments.id))
      .limit(PAGE);
    if (!after) comments.reverse();
    // Cadeaux : personnes actives et non bloquées seulement (comme les commentaires).
    const giftConds = [eq(coinGifts.liveId, liveId), eq(users.status, 'active'), notBlockedBetween(viewerId, coinGifts.senderId)];
    let giftsSince = new Date(now.getTime() - 10_000);
    if (giftsAfter) {
      const [g] = await this.db.select({ at: coinGifts.createdAt }).from(coinGifts).where(and(eq(coinGifts.id, giftsAfter), eq(coinGifts.liveId, liveId)));
      if (g) giftsSince = new Date(g.at.getTime() - OVERLAP_MS);
    }
    giftConds.push(gt(coinGifts.createdAt, giftsSince));
    const gifts = await this.db
      .select({ id: coinGifts.id, giftCode: coinGifts.giftCode, quantity: coinGifts.quantity, coins: coinGifts.coins, anonymous: coinGifts.anonymous, fullName: users.fullName })
      .from(coinGifts)
      .innerJoin(users, eq(users.id, coinGifts.senderId))
      .where(and(...giftConds))
      .orderBy(asc(coinGifts.createdAt), asc(coinGifts.id))
      .limit(20);
    return {
      live: view,
      comments,
      gifts: gifts.map((g) => ({ id: g.id, giftCode: g.giftCode, quantity: g.quantity, coins: g.coins, from: g.anonymous ? null : g.fullName })),
      nextAfter: comments.length ? comments[comments.length - 1].id : (after ?? null),
      nextGiftsAfter: gifts.length ? gifts[gifts.length - 1].id : (giftsAfter ?? null),
      pollSeconds: l.status === 'live' ? 2 : 10,
    };
  }
}
