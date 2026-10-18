import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { coinGifts, coinLedger, coinPurchases, lives, postComments, posts, reels, subscriptions, userContacts, users, wallets, withdrawals } from '../../database/schema';
import type { AdminContext } from '../admin/admin.decorators';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { AuditService } from '../audit/audit.service';
import { CLOCK, Clock } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { commentParentPublished, notBlockedBetween, postVisibleTo, reelVisibleTo } from '../social/access';

export const PREMIUM_PLAN = 'user_premium';
export const PREMIUM_PERIOD_DAYS = 30;
export const GIFT_MAX_QUANTITY = 99;
export const WITHDRAWAL_OPERATORS = ['orange', 'mtn', 'moov', 'wave'] as const;
export type WithdrawalOperator = (typeof WITHDRAWAL_OPERATORS)[number];
export const GIFT_TARGETS = ['post', 'comment', 'live', 'reel'] as const;
export type GiftTarget = (typeof GIFT_TARGETS)[number];

export interface Gift {
  code: string;
  name: string;
  coins: number;
}

const DEFAULT_GIFTS: Gift[] = [];
const conflict = (code: string, message: string, details?: Record<string, unknown>) => new AppError(code, message, HttpStatus.CONFLICT, details);

/**
 * Lot 9 (prototype) — Premium utilisateur, pièces, envois et retraits. 1 pièce = 1 F ; commission BIM : 0.
 *
 * Aucun argent réel : le seul circuit est « demo », ouvert par DEMO_MODE (interdit en production). Règles appliquées
 * (réponses conseillées du questionnaire, provisoires) : seules les pièces reçues sont retirables (F8) ; Premium est
 * exigé pour recevoir des pièces, sur une publication comme sur un commentaire (F9) ; les pièces reçues restent
 * retirables après la fin de Premium (F11) ; premier retrait et gros montants vérifiés par l'équipe (F12, DELAI) ; frais
 * de l'opérateur à la charge de la personne (S3), montant minimal (S6) et plafond sur 24 heures (F14).
 */
@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly agePolicy: AgePolicyService,
    private readonly audit: AuditService,
  ) {}

  get demo(): boolean {
    return this.cfg.DEMO_MODE;
  }

  private assertDemo(what: string) {
    if (!this.demo) throw Errors.notConfigured(what);
  }

  private async num(key: string, fallback: number): Promise<number> {
    const s = await this.settings.get<number>(key);
    return typeof s?.value === 'number' ? s.value : fallback;
  }

  async gifts(): Promise<Gift[]> {
    const s = await this.settings.get<Gift[]>('coins.gifts');
    return Array.isArray(s?.value) ? s.value : DEFAULT_GIFTS;
  }

  async packs(): Promise<number[]> {
    const s = await this.settings.get<number[]>('coins.packs');
    return Array.isArray(s?.value) ? s.value : [];
  }

  private async withdrawRules() {
    const [min, dailyCap, instantMax, feePercent] = await Promise.all([
      this.num('coins.withdraw_min', 5000),
      this.num('coins.withdraw_daily_cap', 5_000_000),
      this.num('coins.withdraw_instant_max', 100_000),
      this.num('coins.withdraw_fee_percent', 1),
    ]);
    return { min, dailyCap, instantMax, feePercent };
  }

  static fee(coins: number, percent: number): number {
    return Math.ceil((coins * percent) / 100);
  }

  // ------------------------------------------------------------------------------------------------ Premium

  /** Abonnements Premium en cours, pour une liste de personnes (vues des publications, envois). */
  async premiumUsers(userIds: string[], db: DbOrTx = this.db): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(inArray(subscriptions.userId, userIds), eq(subscriptions.plan, PREMIUM_PLAN), gt(subscriptions.currentPeriodEnd, this.clock.now())));
    return new Set(rows.map((r) => r.userId));
  }

  private async current(userId: string, db: DbOrTx = this.db) {
    const [s] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.plan, PREMIUM_PLAN), gt(subscriptions.currentPeriodEnd, this.clock.now())))
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1);
    return s ?? null;
  }

  async premium(userId: string) {
    const s = await this.current(userId);
    return {
      available: this.demo,
      demo: this.demo,
      priceFcfa: await this.num('premium.user_price_fcfa', 2000),
      periodDays: PREMIUM_PERIOD_DAYS,
      active: s !== null,
      until: s?.currentPeriodEnd ?? null,
      autoRenew: s?.autoRenew ?? false,
      channel: s?.channel ?? null,
      benefits: ['receive_coins', 'no_ads'],
    };
  }

  /** Abonnement simulé (aucun paiement) ; relancer un abonnement résilié qui court encore rétablit le renouvellement. */
  async subscribe(userId: string, meta: RequestMeta) {
    this.assertDemo('L’abonnement Premium');
    const [u] = await this.db.select({ birthDate: users.birthDate }).from(users).where(eq(users.id, userId));
    await this.agePolicy.assert('paid_subscription', u.birthDate);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('premium'), hashtext(${userId}))`);
      const s = await this.current(userId, tx);
      if (s) {
        if (!s.autoRenew) await tx.update(subscriptions).set({ autoRenew: true, cancelledAt: null }).where(eq(subscriptions.id, s.id));
        return;
      }
      const now = this.clock.now();
      const id = uuidv7(now.getTime());
      const price = await this.num('premium.user_price_fcfa', 2000);
      await tx.insert(subscriptions).values({
        id,
        userId,
        plan: PREMIUM_PLAN,
        channel: 'demo',
        priceFcfa: price,
        startedAt: now,
        currentPeriodEnd: new Date(now.getTime() + PREMIUM_PERIOD_DAYS * 86_400_000),
      });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'premium.subscribed', targetType: 'subscription', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { channel: 'demo', priceFcfa: price } }, tx);
    });
    return this.premium(userId);
  }

  /** Résiliation : Premium reste actif jusqu'à la fin de la période, sans renouvellement. */
  async cancel(userId: string, meta: RequestMeta) {
    const s = await this.current(userId);
    if (s?.autoRenew) {
      await this.db.update(subscriptions).set({ autoRenew: false, cancelledAt: this.clock.now() }).where(eq(subscriptions.id, s.id));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'premium.cancelled', targetType: 'subscription', targetId: s.id, ip: meta.ip, userAgent: meta.userAgent });
    }
    return this.premium(userId);
  }

  // ------------------------------------------------------------------------------------------------ Portefeuille

  private async balances(userId: string, db: DbOrTx = this.db) {
    const [w] = await db.select().from(wallets).where(eq(wallets.userId, userId));
    return { purchased: w?.purchased ?? 0, received: w?.received ?? 0 };
  }

  async wallet(userId: string) {
    const [b, gifts, packs, rules, premium, ledger, recent, stats] = await Promise.all([
      this.balances(userId),
      this.gifts(),
      this.packs(),
      this.withdrawRules(),
      this.current(userId),
      this.db.select().from(coinLedger).where(eq(coinLedger.userId, userId)).orderBy(desc(coinLedger.createdAt), desc(coinLedger.id)).limit(30),
      this.db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(desc(withdrawals.createdAt)).limit(10),
      this.db.execute<{ received: number; sent: number }>(sql`
        SELECT COALESCE(SUM(CASE WHEN kind = 'gift_received' THEN delta END), 0)::int AS received,
               COALESCE(-SUM(CASE WHEN kind = 'gift_sent' THEN delta END), 0)::int AS sent
        FROM coin_ledger WHERE user_id = ${userId}`),
    ]);
    return {
      available: this.demo,
      demo: this.demo,
      coinValueFcfa: 1,
      balance: { total: b.purchased + b.received, purchased: b.purchased, received: b.received, withdrawable: b.received },
      premium: { active: premium !== null, until: premium?.currentPeriodEnd ?? null },
      stats: { receivedTotal: stats.rows[0]?.received ?? 0, sentTotal: stats.rows[0]?.sent ?? 0 },
      packs: packs.map((coins) => ({ coins, priceFcfa: coins })),
      gifts,
      withdrawal: { ...rules, operators: WITHDRAWAL_OPERATORS, commissionFcfa: 0 },
      history: ledger.map((l) => ({ id: l.id, kind: l.kind, bucket: l.bucket, delta: l.delta, at: l.createdAt })),
      withdrawals: recent.map((w) => this.withdrawalView(w)),
    };
  }

  private async credit(tx: DbOrTx, userId: string, bucket: 'purchased' | 'received', delta: number, kind: string, refId: string, channel: string | null = null) {
    await tx.insert(coinLedger).values({ id: uuidv7(), userId, bucket, kind, delta, refId, channel });
    const col = bucket === 'purchased' ? wallets.purchased : wallets.received;
    // Le contrôle « solde >= 0 » s'applique aussi à la ligne proposée d'un INSERT : création d'abord, puis mise à jour.
    await tx.insert(wallets).values({ userId }).onConflictDoNothing();
    await tx.update(wallets).set({ [bucket]: sql`${col} + ${delta}`, updatedAt: sql`now()` }).where(eq(wallets.userId, userId));
  }

  /** Verrouille les portefeuilles (créés si besoin) dans un ordre fixe : deux envois croisés ne s'interbloquent pas. */
  private async lockWallets(tx: DbOrTx, ids: string[]) {
    const sorted = [...new Set(ids)].sort();
    for (const id of sorted) await tx.insert(wallets).values({ userId: id }).onConflictDoNothing();
    await tx.execute(sql`SELECT user_id FROM wallets WHERE user_id IN (${sql.join(sorted.map((i) => sql`${i}::uuid`), sql`, `)}) ORDER BY user_id FOR UPDATE`);
  }

  /** Achat simulé d'un pack (prix = nombre de pièces, aucun frais ajouté). Anti-doublon par clé. */
  async buy(userId: string, coins: number, idempotencyKey: string, meta: RequestMeta) {
    this.assertDemo('L’achat de pièces');
    const [u] = await this.db.select({ birthDate: users.birthDate }).from(users).where(eq(users.id, userId));
    await this.agePolicy.assert('coins_purchase', u.birthDate);
    if (!(await this.packs()).includes(coins)) throw Errors.validation({ fields: { coins: ['Choisis un des packs proposés.'] } });
    const done = async () => {
      const [p] = await this.db.select().from(coinPurchases).where(and(eq(coinPurchases.userId, userId), eq(coinPurchases.idempotencyKey, idempotencyKey)));
      return p ?? null;
    };
    let p = await done();
    if (!p) {
      try {
        await this.db.transaction(async (tx) => {
          const id = uuidv7();
          await tx.insert(coinPurchases).values({ id, userId, coins, priceFcfa: coins, channel: 'demo', idempotencyKey });
          await this.credit(tx, userId, 'purchased', coins, 'purchase', id, 'demo');
          await this.audit.log({ actorType: 'user', actorId: userId, action: 'coins.purchased', targetType: 'coin_purchase', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { coins, channel: 'demo' } }, tx);
        });
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e;
      }
      p = await done();
    }
    if (p!.coins !== coins) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Cette clé a déjà servi pour un autre achat.');
    return { purchase: { id: p!.id, coins: p!.coins, priceFcfa: p!.priceFcfa, channel: p!.channel, at: p!.createdAt }, balance: (await this.wallet(userId)).balance };
  }

  // ------------------------------------------------------------------------------------------------ Envois

  /** Destinataire et publication d'un envoi, après contrôle de la visibilité et des blocages. */
  private async target(
    senderId: string,
    targetType: GiftTarget,
    targetId: string,
  ): Promise<{ postId: string | null; commentId: string | null; liveId: string | null; reelId: string | null; recipientId: string }> {
    if (targetType === 'reel') {
      // Lot 11 : pièces sur un Reel visible, reçues par son auteur.
      const [r] = await this.db.select({ id: reels.id, userId: reels.userId }).from(reels).innerJoin(users, eq(users.id, reels.userId)).where(and(eq(reels.id, targetId), reelVisibleTo(senderId)));
      if (!r) throw Errors.notFound('Reel');
      return { postId: null, commentId: null, liveId: null, reelId: r.id, recipientId: r.userId };
    }
    if (targetType === 'live') {
      // Lot 10 : cadeau pendant un Live en cours, reçu par la personne qui l'anime.
      const [l] = await this.db
        .select({ id: lives.id, hostUserId: lives.hostUserId, status: lives.status })
        .from(lives)
        .innerJoin(users, eq(users.id, lives.hostUserId))
        .where(and(eq(lives.id, targetId), eq(users.status, 'active'), notBlockedBetween(senderId, lives.hostUserId)));
      if (!l) throw Errors.notFound('Live');
      if (l.status !== 'live') throw conflict('LIVE_NOT_RUNNING', 'Ce Live n’est pas en cours.');
      return { postId: null, commentId: null, liveId: l.id, reelId: null, recipientId: l.hostUserId };
    }
    if (targetType === 'post') {
      const [r] = await this.db
        .select({ postId: posts.id, recipientId: posts.userId })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.userId))
        .where(and(eq(posts.id, targetId), postVisibleTo(senderId)));
      if (!r) throw Errors.notFound('Publication');
      return { postId: r.postId, commentId: null, liveId: null, reelId: null, recipientId: r.recipientId };
    }
    const [c] = await this.db
      .select({ commentId: postComments.id, postId: postComments.postId, recipientId: postComments.userId })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.userId))
      .where(and(eq(postComments.id, targetId), eq(postComments.status, 'published'), eq(users.status, 'active'), commentParentPublished(), notBlockedBetween(senderId, postComments.userId)));
    if (!c) throw Errors.notFound('Commentaire');
    const [p] = await this.db.select({ id: posts.id }).from(posts).innerJoin(users, eq(users.id, posts.userId)).where(and(eq(posts.id, c.postId), postVisibleTo(senderId)));
    if (!p) throw Errors.notFound('Commentaire');
    return { ...c, liveId: null, reelId: null };
  }

  async gift(
    senderId: string,
    dto: { targetType: GiftTarget; targetId: string; giftCode: string; quantity: number; anonymous?: boolean; idempotencyKey: string },
    meta: RequestMeta,
  ) {
    this.assertDemo('L’envoi de pièces');
    const existing = async () => {
      const [g] = await this.db.select().from(coinGifts).where(and(eq(coinGifts.senderId, senderId), eq(coinGifts.idempotencyKey, dto.idempotencyKey)));
      return g ?? null;
    };
    const before = await existing();
    if (before) return this.giftResult(senderId, before);
    const gift = (await this.gifts()).find((g) => g.code === dto.giftCode);
    if (!gift) throw Errors.validation({ fields: { giftCode: ['Cadeau inconnu.'] } });
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1 || dto.quantity > GIFT_MAX_QUANTITY) throw Errors.validation({ fields: { quantity: [`Entre 1 et ${GIFT_MAX_QUANTITY}.`] } });
    const t = await this.target(senderId, dto.targetType, dto.targetId);
    if (t.recipientId === senderId) throw conflict('COINS_SELF_GIFT', 'Tu ne peux pas t’envoyer des pièces.');
    const coins = gift.coins * dto.quantity;
    try {
      await this.db.transaction(async (tx) => {
        if (!(await this.premiumUsers([t.recipientId], tx)).has(t.recipientId)) {
          throw conflict('RECIPIENT_NOT_PREMIUM', 'Cette personne ne peut pas encore recevoir de pièces (Premium nécessaire).');
        }
        await this.lockWallets(tx, [senderId, t.recipientId]);
        const b = await this.balances(senderId, tx);
        if (b.purchased + b.received < coins) throw conflict('INSUFFICIENT_COINS', 'Tu n’as pas assez de pièces.', { needed: coins, balance: b.purchased + b.received });
        const id = uuidv7();
        await tx.insert(coinGifts).values({
          id,
          senderId,
          recipientId: t.recipientId,
          targetType: dto.targetType,
          postId: t.postId,
          commentId: t.commentId,
          liveId: t.liveId,
          reelId: t.reelId,
          giftCode: gift.code,
          quantity: dto.quantity,
          coins,
          anonymous: dto.anonymous ?? false,
          idempotencyKey: dto.idempotencyKey,
        });
        // Les pièces achetées partent d'abord : les pièces reçues (retirables) sont gardées le plus longtemps possible.
        const fromPurchased = Math.min(b.purchased, coins);
        if (fromPurchased > 0) await this.credit(tx, senderId, 'purchased', -fromPurchased, 'gift_sent', id);
        if (coins - fromPurchased > 0) await this.credit(tx, senderId, 'received', -(coins - fromPurchased), 'gift_sent', id);
        await this.credit(tx, t.recipientId, 'received', coins, 'gift_received', id);
        if (t.reelId) await tx.update(reels).set({ coinCount: sql`${reels.coinCount} + ${coins}` }).where(eq(reels.id, t.reelId));
        else if (t.liveId) await tx.update(lives).set({ coinCount: sql`${lives.coinCount} + ${coins}` }).where(eq(lives.id, t.liveId));
        else if (t.commentId) await tx.update(postComments).set({ coinCount: sql`${postComments.coinCount} + ${coins}` }).where(eq(postComments.id, t.commentId));
        else await tx.update(posts).set({ coinCount: sql`${posts.coinCount} + ${coins}` }).where(eq(posts.id, t.postId!));
        await this.audit.log({ actorType: 'user', actorId: senderId, action: 'coins.gift_sent', targetType: dto.targetType, targetId: dto.targetId, ip: meta.ip, userAgent: meta.userAgent, metadata: { giftId: id, coins, gift: gift.code } }, tx);
      });
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
    }
    return this.giftResult(senderId, (await existing())!);
  }

  private async giftResult(senderId: string, g: typeof coinGifts.$inferSelect) {
    const [target] = g.reelId
      ? await this.db.select({ coinCount: reels.coinCount }).from(reels).where(eq(reels.id, g.reelId))
      : g.liveId
      ? await this.db.select({ coinCount: lives.coinCount }).from(lives).where(eq(lives.id, g.liveId))
      : g.commentId
        ? await this.db.select({ coinCount: postComments.coinCount }).from(postComments).where(eq(postComments.id, g.commentId))
        : await this.db.select({ coinCount: posts.coinCount }).from(posts).where(eq(posts.id, g.postId!));
    const b = await this.balances(senderId);
    return {
      gift: { id: g.id, targetType: g.targetType, postId: g.postId, commentId: g.commentId, liveId: g.liveId, reelId: g.reelId, giftCode: g.giftCode, quantity: g.quantity, coins: g.coins, anonymous: g.anonymous, at: g.createdAt },
      targetCoinCount: target?.coinCount ?? 0,
      balance: { total: b.purchased + b.received, purchased: b.purchased, received: b.received, withdrawable: b.received },
    };
  }

  /** Donateurs d'une publication (écran 13) : les plus généreux d'abord ; envois anonymes regroupés, sans nom. */
  async donors(viewerId: string, postId: string) {
    const [p] = await this.db.select({ coinCount: posts.coinCount }).from(posts).innerJoin(users, eq(users.id, posts.userId)).where(and(eq(posts.id, postId), postVisibleTo(viewerId)));
    if (!p) throw Errors.notFound('Publication');
    const rows = await this.db
      .select({ id: users.id, username: users.username, fullName: users.fullName, coins: sql<number>`SUM(${coinGifts.coins})::int` })
      .from(coinGifts)
      .innerJoin(users, eq(users.id, coinGifts.senderId))
      .where(and(eq(coinGifts.postId, postId), eq(coinGifts.targetType, 'post'), eq(coinGifts.anonymous, false), eq(users.status, 'active'), notBlockedBetween(viewerId, coinGifts.senderId)))
      .groupBy(users.id)
      .orderBy(sql`SUM(${coinGifts.coins}) DESC`)
      .limit(50);
    const [anon] = await this.db
      .select({ coins: sql<number>`COALESCE(SUM(${coinGifts.coins}), 0)::int` })
      .from(coinGifts)
      .where(and(eq(coinGifts.postId, postId), eq(coinGifts.targetType, 'post'), eq(coinGifts.anonymous, true)));
    return { total: p.coinCount, donors: rows.map((r) => ({ user: { id: r.id, username: r.username, fullName: r.fullName }, coins: r.coins })), anonymousCoins: anon.coins };
  }

  // ------------------------------------------------------------------------------------------------ Retraits

  private withdrawalView(w: typeof withdrawals.$inferSelect) {
    return {
      id: w.id,
      coins: w.coins,
      feeFcfa: w.feeFcfa,
      netFcfa: w.netFcfa,
      operator: w.operator,
      phone: w.phone,
      channel: w.channel,
      status: w.status,
      reviewReason: w.reviewReason,
      rejectReason: w.rejectReason,
      decidedAt: w.decidedAt,
      at: w.createdAt,
    };
  }

  /**
   * Demande de retrait des pièces reçues vers le Mobile Money du téléphone vérifié. Prototype : « paid » = versement
   * simulé. Premier retrait et montant au-delà du seuil : vérification par l'équipe (pièces mises de côté).
   */
  async withdraw(userId: string, dto: { coins: number; operator: WithdrawalOperator; idempotencyKey: string }, meta: RequestMeta) {
    this.assertDemo('Le retrait des pièces');
    const existing = async () => {
      const [w] = await this.db.select().from(withdrawals).where(and(eq(withdrawals.userId, userId), eq(withdrawals.idempotencyKey, dto.idempotencyKey)));
      return w ?? null;
    };
    const before = await existing();
    if (before) return { withdrawal: this.withdrawalView(before), balance: (await this.wallet(userId)).balance };
    const [u] = await this.db.select({ birthDate: users.birthDate }).from(users).where(eq(users.id, userId));
    await this.agePolicy.assert('coins_withdrawal', u.birthDate);
    const [phone] = await this.db
      .select({ value: userContacts.value })
      .from(userContacts)
      .where(and(eq(userContacts.userId, userId), eq(userContacts.type, 'phone'), sql`${userContacts.verifiedAt} IS NOT NULL`))
      .limit(1);
    if (!phone) throw conflict('PHONE_NOT_VERIFIED', 'Ajoute et vérifie ton numéro de téléphone : le retrait est envoyé sur ce numéro.');
    const rules = await this.withdrawRules();
    if (!Number.isInteger(dto.coins) || dto.coins < rules.min) throw Errors.validation({ fields: { coins: [`Retrait minimal : ${rules.min} pièces.`] }, min: rules.min });
    try {
      await this.db.transaction(async (tx) => {
        await this.lockWallets(tx, [userId]);
        const b = await this.balances(userId, tx);
        if (b.received < dto.coins) throw conflict('INSUFFICIENT_COINS', 'Seules les pièces reçues peuvent être retirées.', { needed: dto.coins, withdrawable: b.received });
        const since = new Date(this.clock.now().getTime() - 86_400_000);
        const [{ total, paid }] = await tx
          .select({
            total: sql<number>`COALESCE(SUM(${withdrawals.coins}) FILTER (WHERE ${withdrawals.createdAt} > ${since}), 0)::int`,
            paid: sql<number>`COUNT(*) FILTER (WHERE ${withdrawals.status} = 'paid')::int`,
          })
          .from(withdrawals)
          .where(and(eq(withdrawals.userId, userId), ne(withdrawals.status, 'rejected')));
        if (total + dto.coins > rules.dailyCap) throw conflict('WITHDRAWAL_DAILY_CAP', `Plafond de ${rules.dailyCap} pièces retirées sur 24 heures.`, { dailyCap: rules.dailyCap, alreadyFcfa: total });
        const reviewReason = paid === 0 ? 'first' : dto.coins > rules.instantMax ? 'amount' : null;
        const fee = WalletService.fee(dto.coins, rules.feePercent);
        const id = uuidv7();
        await tx.insert(withdrawals).values({
          id,
          userId,
          coins: dto.coins,
          feeFcfa: fee,
          netFcfa: dto.coins - fee,
          operator: dto.operator,
          phone: phone.value,
          channel: 'demo',
          status: reviewReason ? 'review' : 'paid',
          reviewReason,
          decidedAt: reviewReason ? null : this.clock.now(),
          idempotencyKey: dto.idempotencyKey,
        });
        await this.credit(tx, userId, 'received', -dto.coins, 'withdrawal', id);
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'coins.withdrawal_requested', targetType: 'withdrawal', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { coins: dto.coins, operator: dto.operator, review: reviewReason, channel: 'demo' } }, tx);
      });
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
    }
    return { withdrawal: this.withdrawalView((await existing())!), balance: (await this.wallet(userId)).balance };
  }

  // ------------------------------------------------------------------------------------------------ Administration

  async adminList(status: 'review' | 'paid' | 'rejected', admin: AdminContext, meta: RequestMeta) {
    const rows = await this.db
      .select({ w: withdrawals, user: { id: users.id, username: users.username, fullName: users.fullName } })
      .from(withdrawals)
      .innerJoin(users, eq(users.id, withdrawals.userId))
      .where(eq(withdrawals.status, status))
      .orderBy(status === 'review' ? withdrawals.createdAt : desc(withdrawals.createdAt))
      .limit(100);
    await this.audit.log({ actorType: 'admin', actorId: admin.adminId, action: 'admin.withdrawals_listed', ip: meta.ip, userAgent: meta.userAgent, metadata: { status, count: rows.length } });
    return { demo: this.demo, items: rows.map((r) => ({ ...this.withdrawalView(r.w), user: r.user })) };
  }

  async adminDecide(admin: AdminContext, id: string, decision: 'approve' | 'reject', reason: string | undefined, meta: RequestMeta) {
    if (decision === 'reject' && !reason?.trim()) throw Errors.validation({ fields: { reason: ['Motif obligatoire.'] } });
    await this.db.transaction(async (tx) => {
      const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
      if (!w) throw Errors.notFound('Retrait');
      if (w.status !== 'review') throw conflict('WITHDRAWAL_ALREADY_DECIDED', 'Ce retrait est déjà traité.');
      const now = this.clock.now();
      await tx
        .update(withdrawals)
        .set({ status: decision === 'approve' ? 'paid' : 'rejected', decidedBy: admin.adminId, decidedAt: now, rejectReason: decision === 'reject' ? reason!.trim() : null })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.status, 'review')));
      if (decision === 'reject') {
        await this.lockWallets(tx, [w.userId]);
        await this.credit(tx, w.userId, 'received', w.coins, 'withdrawal_refund', w.id);
      }
      await this.audit.log({ actorType: 'admin', actorId: admin.adminId, action: `admin.withdrawal_${decision === 'approve' ? 'approved' : 'rejected'}`, targetType: 'withdrawal', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { coins: w.coins, channel: w.channel } }, tx);
    });
    const [w] = await this.db.select().from(withdrawals).where(eq(withdrawals.id, id));
    return this.withdrawalView(w);
  }
}

