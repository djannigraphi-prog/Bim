/// <reference types="multer" />
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AppError, Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { MESSAGE_REACTIONS, conversationMembers, conversations, follows, messageReactions, messages, orderItems, orders, projectCategories, projectGoals, projectOffers, projects, shopMembers, shops, userBlocks, users } from '../../database/schema';
import { generateTitle } from '../projects/plan';
import { openReport } from '../social/access';
import { ageOn } from '../age-policy/age';
import { AuditService } from '../audit/audit.service';
import { BimShopService } from '../catalog/bimshop.service';
import { Mp4Error, inspectMp4, scrubMp4Metadata } from '../media/mp4';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { SettingsService } from '../settings/settings.service';

const PAGE = 30;
type MessageRow = typeof messages.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;
type ShopRow = typeof shops.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** 6-C — Partie qui lit : une personne en son nom, ou une boutique (toute son équipe). */
export interface Viewer {
  userId: string;
  shopId: string | null;
}

export type Reaction = (typeof MESSAGE_REACTIONS)[number];

/** Accès d'une personne à une conversation (6-A : avec une personne ; 6-B : avec une boutique, côté cliente). */
interface Access {
  conv: ConversationRow;
  me: MemberRow;
  /** Dernier message lu par l'autre partie (personne ou boutique) : statut « Vu » de mes messages. */
  otherReadId: string | null;
  other: MemberRow | null;
  otherUser: typeof users.$inferSelect | null;
  shop: ShopRow | null;
}

/**
 * Condition SQL : l'autre partie d'une conversation est joignable par `userId` (compte actif, boutique ouverte,
 * aucun blocage entre la personne et l'autre membre, ou le propriétaire de la boutique).
 */
export function counterpartReachable(userId: string, conversation: { id: unknown; kind: unknown; shopId: unknown }) {
  return sql`(
    (${conversation.kind} = 'direct' AND EXISTS (SELECT 1 FROM conversation_members o JOIN users ou ON ou.id = o.user_id
       WHERE o.conversation_id = ${conversation.id} AND o.user_id <> ${userId} AND ou.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = o.user_id) OR (b.blocker_id = o.user_id AND b.blocked_id = ${userId}))))
    OR ${conversation.kind} = 'group'
    OR (${conversation.kind} = 'shop' AND EXISTS (SELECT 1 FROM shops s JOIN users ow ON ow.id = s.owner_user_id
       WHERE s.id = ${conversation.shopId} AND s.status = 'active' AND ow.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = ow.id) OR (b.blocker_id = ow.id AND b.blocked_id = ${userId}))))
  )`;
}

/**
 * Lot 6-A — Messagerie entre personnes (écran 47) : conversations à deux, demandes, texte et photos, lu / non lu.
 *
 * Règles (décisions du 16/10/2026, E10) :
 * - un message arrive directement si la personne destinataire suit l'auteur ; sinon il arrive en « demande » ;
 * - une personne de moins de 18 ans ne reçoit pas de message d'un compte qu'elle ne suit pas (pas même en demande) ;
 * - aucun message entre deux personnes dont l'une a bloqué l'autre, ni avec un compte inactif ;
 * - les messages sont privés : seuls les membres les lisent ; l'équipe ne voit qu'un message signalé (journalisé).
 * Aucune notification sur le téléphone (Firebase non activé) : compteur de non-lus dans l'app.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly bimshop: BimShopService,
  ) {}

  private async limit(key: string, fallback: number): Promise<number> {
    const s = await this.settings.get<number>(key);
    return typeof s?.value === 'number' && s.value > 0 ? s.value : fallback;
  }

  async url(key: string | null, apiBase: string) {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  blocked(a: string, b: string) {
    return this.db
      .select({ x: userBlocks.blockerId })
      .from(userBlocks)
      .where(sql`(${userBlocks.blockerId} = ${a} AND ${userBlocks.blockedId} = ${b}) OR (${userBlocks.blockerId} = ${b} AND ${userBlocks.blockedId} = ${a})`)
      .limit(1);
  }

  private async follows(follower: string, followee: string) {
    const [r] = await this.db.select({ x: follows.followerId }).from(follows).where(and(eq(follows.followerId, follower), eq(follows.followeeId, followee))).limit(1);
    return !!r;
  }

  /** Boutique ouverte, propriétaire actif, aucun blocage avec la personne ; sinon `null`. */
  async reachableShop(where: { id?: string; slug?: string }, userId: string): Promise<ShopRow | null> {
    const [row] = await this.db
      .select({ s: shops })
      .from(shops)
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(where.id ? eq(shops.id, where.id) : eq(shops.slug, where.slug ?? ''), eq(shops.status, 'active'), eq(users.status, 'active')));
    if (!row || (await this.blocked(userId, row.s.ownerUserId)).length) return null;
    return row.s;
  }

  /** Mon adhésion et l'autre partie ; refuse une conversation inaccessible (404, jamais d'indice). */
  private async access(userId: string, conversationId: string, allowDeclined = false): Promise<Access> {
    const [conv] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) throw Errors.notFound('Conversation');
    const members = await this.db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    const me = members.find((m) => m.userId === userId);
    if (!me || me.status === 'withheld' || me.status === 'left' || (me.status === 'declined' && !allowDeclined)) throw Errors.notFound('Conversation');
    if (conv.kind === 'group') {
      // « Vu » dans un groupe : lu par tous les autres membres actifs (le plus ancien « dernier lu » d'entre eux).
      const others = members.filter((m) => m.userId !== userId && m.status === 'active');
      const reads = others.map((m) => m.lastReadMessageId);
      const otherReadId = others.length && reads.every((r) => r) ? (reads as string[]).sort()[0] : null;
      return { conv, me, otherReadId, other: null, otherUser: null, shop: null };
    }
    if (conv.kind === 'shop') {
      const shop = await this.reachableShop({ id: conv.shopId! }, userId);
      if (!shop) throw Errors.notFound('Conversation');
      return { conv, me, otherReadId: conv.shopLastReadMessageId, other: null, otherUser: null, shop };
    }
    const other = members.find((m) => m.userId !== userId);
    if (!other) throw Errors.notFound('Conversation');
    const [u] = await this.db.select().from(users).where(eq(users.id, other.userId));
    if (!u || u.status !== 'active' || (await this.blocked(userId, other.userId)).length) throw Errors.notFound('Conversation');
    return { conv, me, otherReadId: other.lastReadMessageId, other, otherUser: u, shop: null };
  }

  /**
   * Règle des moins de 18 ans (audit du 18/10/2026), appliquée à l'ouverture ET à chaque message : une personne mineure
   * qui ne suit pas l'autre ne reçoit rien (« withheld ») ; dès qu'elle la suit, c'est une demande ordinaire. La
   * personne qui écrit ne voit aucune différence (pas d'indice sur l'âge).
   */
  private async minorShield(db: DbOrTx, conversationId: string, senderId: string, otherId: string) {
    const [u] = await db.select({ birthDate: users.birthDate }).from(users).where(eq(users.id, otherId));
    if (!u) return;
    const withheld = ageOn(u.birthDate) < 18 && !(await this.follows(otherId, senderId));
    if (withheld) {
      await db
        .update(conversationMembers)
        .set({ status: 'withheld' })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, otherId), inArray(conversationMembers.status, ['active', 'request'])));
    } else {
      await db
        .update(conversationMembers)
        .set({ status: 'request' })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, otherId), eq(conversationMembers.status, 'withheld')));
    }
  }

  person(u: typeof users.$inferSelect, avatarUrl: string | null) {
    return { id: u.id, username: u.username, fullName: u.fullName, avatarUrl };
  }

  // ------------------------------------------------------------------------------------------------ Conversations

  /** Ouvre (ou retrouve) la conversation avec une personne. Aucun message n'est envoyé ici. */
  async start(userId: string, username: string, apiBase: string) {
    const [target] = await this.db.select().from(users).where(eq(users.username, username.trim().toLowerCase()));
    if (!target || target.status !== 'active' || target.id === userId || (await this.blocked(userId, target.id)).length) throw Errors.notFound('Personne');
    const key = [userId, target.id].sort().join(':');
    const [existing] = await this.db.select().from(conversations).where(eq(conversations.directKey, key));
    if (existing) {
      // Je reprends une conversation que j'avais refusée : elle revient dans mes messages.
      await this.db
        .update(conversationMembers)
        .set({ status: 'active' })
        .where(and(eq(conversationMembers.conversationId, existing.id), eq(conversationMembers.userId, userId), eq(conversationMembers.status, 'declined')));
      await this.minorShield(this.db, existing.id, userId, target.id);
      return this.summary(userId, existing.id, apiBase);
    }
    const followsMe = await this.follows(target.id, userId);
    // Moins de 18 ans, sans suivre l'auteur : la conversation s'ouvre normalement pour lui, elle ne reçoit rien.
    const withheld = !followsMe && ageOn(target.birthDate) < 18;
    const max = await this.limit('messages.new_conversations_daily_limit', 20);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await lockUserQuota(tx, 'conversations', userId);
      const [{ n }] = await tx.select({ n: count() }).from(conversations).where(and(eq(conversations.createdBy, userId), gt(conversations.createdAt, new Date(Date.now() - 24 * 3600_000))));
      if (n >= max) throw Errors.tooMany('Tu as commencé beaucoup de conversations aujourd’hui. Réessaie demain.', { reason: 'MESSAGES_NEW_CONVERSATIONS_LIMIT', limit: max });
      // Une conversation simultanée avec la même personne : l'index unique garde la première.
      const created = await tx.insert(conversations).values({ id, kind: 'direct', directKey: key, createdBy: userId }).onConflictDoNothing().returning({ id: conversations.id });
      if (!created.length) return;
      await tx.insert(conversationMembers).values([
        { conversationId: id, userId, status: 'active' },
        { conversationId: id, userId: target.id, status: followsMe ? 'active' : withheld ? 'withheld' : 'request' },
      ]);
    });
    const [conv] = await this.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.directKey, key));
    return this.summary(userId, conv.id, apiBase);
  }

  /**
   * 6-B — Écrire à une boutique (« Discuter » depuis un article, une offre ou le profil de la boutique). Les boutiques
   * reçoivent les messages de tous (ANALYSE.md §5) : jamais de demande. Seule la cliente ouvre la conversation.
   */
  async startWithShop(userId: string, input: { shopSlug: string; productId?: string; offerId?: string }, apiBase: string) {
    const shop = await this.reachableShop({ slug: input.shopSlug.trim().toLowerCase() }, userId);
    if (!shop) throw Errors.notFound('Boutique');
    const [member] = await this.db
      .select({ x: shopMembers.userId })
      .from(shopMembers)
      .where(and(eq(shopMembers.shopId, shop.id), eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt), isNotNull(shopMembers.acceptedAt)));
    if (member) throw Errors.conflict('OWN_SHOP', 'Tu fais partie de cette boutique : réponds à ses clients depuis l’espace boutique.');
    let contextProductId: string | null = null;
    let contextOfferId: string | null = null;
    if (input.productId) {
      const [card] = await this.bimshop.visibleCards([input.productId], apiBase, { rich: false });
      if (!card || card.shop.id !== shop.id) throw Errors.notFound('Article');
      contextProductId = card.id;
    }
    if (input.offerId) {
      // Une offre reçue pour un de mes projets, envoyée par cette boutique.
      const [o] = await this.db
        .select({ id: projectOffers.id })
        .from(projectOffers)
        .innerJoin(projects, eq(projects.id, projectOffers.projectId))
        .where(and(eq(projectOffers.id, input.offerId), eq(projectOffers.shopId, shop.id), eq(projects.userId, userId)));
      if (!o) throw Errors.notFound('Offre');
      contextOfferId = o.id;
    }
    const key = `shop:${shop.id}:${userId}`;
    const [existing] = await this.db.select().from(conversations).where(eq(conversations.directKey, key));
    if (existing) {
      if (contextProductId || contextOfferId) {
        await this.db
          .update(conversations)
          .set(contextProductId ? { contextProductId } : { contextOfferId })
          .where(eq(conversations.id, existing.id));
      }
      return this.summary(userId, existing.id, apiBase);
    }
    const max = await this.limit('messages.new_conversations_daily_limit', 20);
    await this.db.transaction(async (tx) => {
      await lockUserQuota(tx, 'conversations', userId);
      const [{ n }] = await tx.select({ n: count() }).from(conversations).where(and(eq(conversations.createdBy, userId), gt(conversations.createdAt, new Date(Date.now() - 24 * 3600_000))));
      if (n >= max) throw Errors.tooMany('Tu as commencé beaucoup de conversations aujourd’hui. Réessaie demain.', { reason: 'MESSAGES_NEW_CONVERSATIONS_LIMIT', limit: max });
      const id = uuidv7();
      const created = await tx
        .insert(conversations)
        .values({ id, kind: 'shop', directKey: key, shopId: shop.id, createdBy: userId, contextProductId, contextOfferId })
        .onConflictDoNothing()
        .returning({ id: conversations.id });
      if (created.length) await tx.insert(conversationMembers).values({ conversationId: id, userId, status: 'active' });
    });
    const [conv] = await this.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.directKey, key));
    return this.summary(userId, conv.id, apiBase);
  }

  /** Bandeau d'une conversation avec une boutique : l'article (disponible ou non, jamais le stock) ou l'offre. */
  async context(conv: ConversationRow, apiBase: string) {
    if (conv.kind !== 'shop') return null;
    const [product] = conv.contextProductId ? await this.bimshop.visibleCards([conv.contextProductId], apiBase, { rich: false }) : [];
    let offer: { id: string; projectTitle: string } | null = null;
    if (conv.contextOfferId) {
      // Jamais le titre saisi par la personne : la boutique le verrait (audit, E-1) ; titre recomposé comme les offres.
      const [o] = await this.db
        .select({ id: projectOffers.id, pattern: projectGoals.titlePattern, quantity: projects.targetQuantity, category: projectCategories.label })
        .from(projectOffers)
        .innerJoin(projects, eq(projects.id, projectOffers.projectId))
        .innerJoin(projectCategories, eq(projectCategories.code, projects.categoryCode))
        .leftJoin(projectGoals, eq(projectGoals.code, projects.goalCode))
        .where(eq(projectOffers.id, conv.contextOfferId));
      offer = o ? { id: o.id, projectTitle: generateTitle({ pattern: o.pattern, quantity: o.quantity, description: null, categoryLabel: o.category }) } : null;
    }
    return product || offer ? { product: product ?? null, offer } : null;
  }

  shopRef(s: ShopRow, logoUrl: string | null) {
    return { id: s.id, name: s.name, slug: s.slug, logoUrl, verified: !!s.verifiedAt };
  }

  /** Liste « Tous » (inbox) ou « Demandes » (requests), conversation la plus récente d'abord. */
  async list(userId: string, box: 'inbox' | 'requests', cursor: string | undefined, apiBase: string) {
    const status = box === 'requests' ? 'request' : 'active';
    const conds = [
      eq(conversationMembers.userId, userId),
      eq(conversationMembers.status, status),
      // Une conversation sans message n'apparaît que chez la personne qui l'a ouverte.
      sql`(EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = ${conversations.id}) OR ${conversations.createdBy} = ${userId})`,
      // L'autre partie : compte actif (ou boutique ouverte), aucun blocage.
      counterpartReachable(userId, conversations),
    ];
    if (cursor) {
      const [at, id] = cursor.split('|');
      const d = new Date(at);
      if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
      conds.push(sql`(date_trunc('milliseconds', ${conversations.lastMessageAt}), ${conversations.id}) < (${d}::timestamptz, ${id}::uuid)`);
    }
    const rows = await this.db
      .select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(...conds))
      .orderBy(desc(sql`date_trunc('milliseconds', ${conversations.lastMessageAt})`), desc(conversations.id))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const items = [];
    for (const r of page) items.push(await this.summary(userId, r.id, apiBase));
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > PAGE && last ? `${last.lastMessageAt.toISOString()}|${last.id}` : null };
  }

  /** Résumé d'une conversation pour la liste : l'autre personne (ou la boutique), le dernier message, les non-lus. */
  async summary(userId: string, conversationId: string, apiBase: string) {
    const { conv, me, other, otherUser, shop } = await this.access(userId, conversationId);
    const [[last], [{ unread }]] = await Promise.all([
      this.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.id)).limit(1),
      this.db
        .select({ unread: count() })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            ne(messages.senderId, userId),
            eq(messages.status, 'published'),
            me.lastReadMessageId ? gt(messages.id, me.lastReadMessageId) : undefined,
          ),
        ),
    ]);
    return {
      id: conversationId,
      /** direct : avec une personne · shop : avec une boutique (6-B). */
      kind: conv.kind,
      status: me.status,
      /** Ma demande n'a pas encore été acceptée (l'autre personne ne me suit pas) : je peux écrire, elle choisira. */
      pendingForOther: other?.status === 'request' || other?.status === 'withheld',
      person: otherUser ? this.person(otherUser, await this.url(otherUser.avatarKey, apiBase)) : null,
      shop: shop ? this.shopRef(shop, await this.url(shop.logoKey, apiBase)) : null,
      context: await this.context(conv, apiBase),
      /** V1 : groupe (nom, nombre de membres, mon rôle). */
      group: conv.kind === 'group' ? await this.groupInfo(conv, me) : null,
      lastMessage: last ? { senderIsMe: this.mine(last, userId), preview: this.preview(last), createdAt: last.createdAt } : null,
      unread,
      lastMessageAt: conv.lastMessageAt,
    };
  }

  /** Message écrit par cette personne en son nom (pas au nom d'une boutique). */
  private mine(m: MessageRow, userId: string) {
    return m.senderId === userId && m.senderShopId === null;
  }

  preview(m: MessageRow): string {
    if (m.status === 'deleted') return 'Message supprimé';
    if (m.status === 'hidden') return 'Message masqué par la modération';
    if (m.kind === 'photo') return 'Photo';
    if (m.kind === 'voice') return 'Message vocal';
    if (m.kind === 'system') return (m.text ?? '').slice(0, 120);
    if (m.kind === 'text') return (m.text ?? '').slice(0, 120);
    if (m.kind === 'order') return 'Proposition de commande';
    // Types à venir (cartes de commande, lot 7) : texte neutre, jamais de contenu interne.
    return 'Nouveau message';
  }

  /** Pastille de l'onglet Messages : conversations avec des non-lus, demandes en attente. */
  async unreadCount(userId: string) {
    const c = { id: sql.raw('c.id'), kind: sql.raw('c.kind'), shopId: sql.raw('c.shop_id') };
    const rows = await this.db.execute<{ status: string; n: number }>(sql`
      SELECT cm.status, count(*)::int AS n
      FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ${userId} AND cm.status IN ('active', 'request')
        AND ${counterpartReachable(userId, c)}
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = cm.conversation_id AND m.sender_id <> ${userId} AND m.status = 'published'
                      AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id))
      GROUP BY cm.status`);
    const by = new Map(rows.rows.map((r) => [r.status, Number(r.n)]));
    return { conversations: by.get('active') ?? 0, requests: by.get('request') ?? 0 };
  }

  async accept(userId: string, conversationId: string, apiBase: string) {
    const { me } = await this.access(userId, conversationId);
    if (me.status === 'request') {
      await this.db.update(conversationMembers).set({ status: 'active' }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    }
    return this.summary(userId, conversationId, apiBase);
  }

  /** Refuser une demande : elle disparaît ; l'autre personne n'en est pas avertie. */
  async decline(userId: string, conversationId: string) {
    const { me } = await this.access(userId, conversationId);
    if (me.status !== 'request') throw Errors.conflict('NOT_A_REQUEST', 'Cette conversation n’est pas une demande.');
    await this.db.update(conversationMembers).set({ status: 'declined' }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { status: 'declined' as const };
  }

  // ------------------------------------------------------------------------------------------------ Messages

  /** 6-C : le message a-t-il été écrit par cette partie ? */
  static byViewer(m: MessageRow, v: Viewer) {
    return v.shopId ? m.senderShopId === v.shopId : m.senderId === v.userId && m.senderShopId === null;
  }

  /** 6-C : message cité, vu par cette partie (aperçu actuel : « Message supprimé » si l'original l'est). */
  private async quoted(replyToId: string | null, v: Viewer) {
    if (!replyToId) return null;
    const [q] = await this.db.select().from(messages).where(eq(messages.id, replyToId)).limit(1);
    if (!q) return null;
    return { id: q.id, senderIsMe: MessagingService.byViewer(q, v), kind: q.kind, status: q.status, preview: this.preview(q) };
  }

  /** 6-C : réactions d'un message publié (par émoji, dans l'ordre de la liste) et celle de cette partie. */
  private async reactionsOf(messageId: string, v: Viewer) {
    const rows = await this.db.select().from(messageReactions).where(eq(messageReactions.messageId, messageId));
    const items = MESSAGE_REACTIONS.map((emoji) => ({ emoji, count: rows.filter((r) => r.emoji === emoji).length })).filter((x) => x.count > 0);
    const mine = rows.find((r) => (v.shopId ? r.shopId === v.shopId : r.userId === v.userId && r.shopId === null));
    return { items, mine: mine?.emoji ?? null };
  }

  /** Vue d'un message ; `mine` = écrit par moi (ou par ma boutique, côté boutique). */
  async view(m: MessageRow, mine: boolean, otherReadId: string | null, apiBase: string, viewer?: Viewer, group?: { blocked: Set<string> }) {
    // Groupe : le contenu d'une personne que j'ai bloquée (ou qui m'a bloqué) n'est pas montré.
    const blockedSender = !!group && !mine && group.blocked.has(m.senderId);
    const visible = m.status === 'published' && !blockedSender;
    const v = viewer ?? { userId: m.senderId, shopId: null };
    let sender: ReturnType<MessagingService['person']> | null = null;
    if (group && !mine && m.kind !== 'system') {
      const [u] = await this.db.select().from(users).where(eq(users.id, m.senderId)).limit(1);
      sender = u ? this.person(u, blockedSender ? null : await this.url(u.avatarKey, apiBase)) : null;
    }
    return {
      id: m.id,
      senderIsMe: mine,
      kind: m.kind,
      text: visible ? m.text : null,
      photoUrl: visible && m.kind === 'photo' ? await this.url(m.mediaKey, apiBase) : null,
      photo: visible && m.kind === 'photo' ? { width: m.mediaWidth, height: m.mediaHeight } : null,
      /** V1 : message vocal (lien temporaire, durée). */
      voiceUrl: visible && m.kind === 'voice' ? await this.url(m.mediaKey, apiBase) : null,
      durationMs: m.kind === 'voice' ? m.mediaDurationMs : null,
      /** V1 : groupe — auteur du message (null pour mes messages). */
      sender,
      /** V1 : groupe — message d'une personne bloquée, non affiché. */
      blockedSender,
      status: m.status,
      createdAt: m.createdAt,
      /** Mes messages : lus par l'autre partie. */
      read: mine ? !!otherReadId && otherReadId >= m.id : null,
      /** 7-B : carte d'une proposition de commande (l'état réel se lit dans la commande). */
      order: visible && m.kind === 'order' && m.orderId ? await this.orderCard(m.orderId) : null,
      /** 6-C : message cité (réponse citée). */
      replyTo: visible ? await this.quoted(m.replyToId, v) : null,
      /** 6-C : réactions (aucune sur un message supprimé ou masqué). */
      reactions: visible ? await this.reactionsOf(m.id, v) : { items: [], mine: null },
    };
  }

  private async orderCard(orderId: string) {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) return null;
    const items = await this.db.select({ title: orderItems.title }).from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position));
    // Proposition échue mais pas encore traitée par le worker : affichée expirée (le serveur l'expire à la prochaine action).
    const status = ['proposed', 'pending_shop'].includes(o.status) && o.expiresAt && o.expiresAt <= new Date() ? 'expired' : o.status;
    return { id: o.id, number: o.number, status, itemsTotalFcfa: o.itemsTotalFcfa, title: items.length ? (items.length > 1 ? `${items[0].title} + ${items.length - 1}` : items[0].title) : null, expiresAt: o.expiresAt };
  }

  /** Page de messages, du plus récent au plus ancien (`before` = identifiant du plus ancien déjà affiché). */
  async page(conversationId: string, before: string | undefined) {
    if (before && !/^[0-9a-f-]{36}$/.test(before)) throw Errors.validation({ fields: { before: ['Curseur invalide.'] } });
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), before ? lt(messages.id, before) : undefined))
      .orderBy(desc(messages.id))
      .limit(PAGE + 1);
    return { rows: rows.slice(0, PAGE), nextBefore: rows.length > PAGE ? rows[PAGE - 1].id : null };
  }

  /**
   * Enregistre un message (texte ou photo ré-encodée) sous la limite quotidienne de son auteur, puis `after` dans la
   * même transaction (état de lecture, archivage). La photo est effacée du stockage si l'enregistrement échoue.
   */
  async persist(
    p: { conversationId: string; senderId: string; senderShopId: string | null; text?: string; photo?: Express.Multer.File; voice?: Express.Multer.File; replyToId?: string; meta: RequestMeta },
    after: (tx: Tx, id: string, now: Date) => Promise<void>,
  ): Promise<MessageRow> {
    const text = p.text?.trim();
    if (!text && !p.photo && !p.voice) throw Errors.validation({ fields: { text: ['Écris un message, ajoute une photo ou enregistre un vocal.'] } });
    if ([text, p.photo, p.voice].filter(Boolean).length > 1) throw Errors.validation({ fields: { text: ['Un message contient un texte, une photo ou un vocal.'] } });
    if (text && text.length > 2000) throw Errors.validation({ fields: { text: ['2000 caractères au plus.'] } });
    if ((p.photo || p.voice) && !this.storage.available) throw Errors.notConfigured('Le stockage des fichiers');
    const voice = p.voice ? await this.checkVoice(p.voice) : null;
    if (p.replyToId) {
      // 6-C : on ne cite qu'un message publié de la même conversation.
      const [q] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, p.replyToId), eq(messages.conversationId, p.conversationId), eq(messages.status, 'published')));
      if (!q) throw Errors.validation({ fields: { replyToId: ['Ce message ne peut pas être cité.'] } });
    }
    const max = await this.limit('messages.daily_limit', 500);
    const id = uuidv7();
    let key: string | null = null;
    let img: Awaited<ReturnType<typeof encodePrivateImage>> | null = null;
    if (p.photo) {
      img = await encodePrivateImage(p.photo, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
      key = `messages/${p.conversationId}/${id}.jpg`;
      await this.storage.put(key, img.data, 'image/jpeg');
    } else if (voice) {
      key = `messages/${p.conversationId}/${id}.m4a`;
      await this.storage.put(key, voice.data, 'audio/mp4');
    }
    const kind = img ? 'photo' : voice ? 'voice' : 'text';
    try {
      await this.db.transaction(async (tx) => {
        await lockUserQuota(tx, 'messages', p.senderId);
        const [{ n }] = await tx.select({ n: count() }).from(messages).where(and(eq(messages.senderId, p.senderId), gt(messages.createdAt, new Date(Date.now() - 24 * 3600_000))));
        if (n >= max) throw Errors.tooMany('Tu as envoyé beaucoup de messages aujourd’hui. Réessaie plus tard.', { reason: 'MESSAGES_DAILY_LIMIT', limit: max });
        const now = new Date();
        await tx.insert(messages).values({
          id,
          conversationId: p.conversationId,
          senderId: p.senderId,
          senderShopId: p.senderShopId,
          kind,
          text: kind === 'text' ? text : null,
          mediaKey: key,
          mediaWidth: img?.width ?? null,
          mediaHeight: img?.height ?? null,
          mediaDurationMs: voice?.durationMs ?? null,
          replyToId: p.replyToId ?? null,
          createdAt: now,
        });
        await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, p.conversationId));
        await after(tx, id, now);
        await this.audit.log(
          {
            actorType: 'user',
            actorId: p.senderId,
            action: 'messages.message_sent',
            targetType: 'conversation',
            targetId: p.conversationId,
            ip: p.meta.ip,
            userAgent: p.meta.userAgent,
            metadata: { kind, ...(p.senderShopId ? { shopId: p.senderShopId } : {}), ...(p.replyToId ? { reply: true } : {}) },
          },
          tx,
        );
      });
    } catch (e) {
      if (key) await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    const [m] = await this.db.select().from(messages).where(eq(messages.id, id));
    return m;
  }

  /** Messages, du plus récent au plus ancien, 30 par page (`before` = identifiant du plus ancien déjà affiché). */
  async messages(userId: string, conversationId: string, before: string | undefined, apiBase: string) {
    const { conv, me, otherReadId } = await this.access(userId, conversationId);
    const { rows, nextBefore } = await this.page(conversationId, before);
    const group = conv.kind === 'group' ? { blocked: await this.blockedIds(userId) } : undefined;
    const items = [];
    // Groupe : une personne ajoutée ne lit pas les messages d'avant son arrivée.
    for (const m of rows) if (!group || m.createdAt >= me.joinedAt) items.push(await this.view(m, this.mine(m, userId), otherReadId, apiBase, { userId, shopId: null }, group));
    return { items, nextBefore };
  }

  /** Personnes bloquées par moi ou qui m'ont bloqué. */
  async blockedIds(userId: string) {
    const rows = await this.db
      .select({ a: userBlocks.blockerId, b: userBlocks.blockedId })
      .from(userBlocks)
      .where(sql`${userBlocks.blockerId} = ${userId} OR ${userBlocks.blockedId} = ${userId}`);
    return new Set(rows.map((r) => (r.a === userId ? r.b : r.a)));
  }

  /**
   * V1 — Message vocal : fichier M4A (AAC) enregistré par l'app, sans image ; durée lue dans le fichier, 2 minutes au
   * plus (réglage décidé) ; métadonnées effacées (appareil, logiciel, dates). Aucun transcodage, aucun service payant.
   */
  private async checkVoice(f: Express.Multer.File) {
    if (f.size > 5 * 1024 * 1024) throw Errors.validation({ fields: { voice: ['5 Mo au plus.'] } });
    let info;
    try {
      info = inspectMp4(f.buffer);
    } catch (e) {
      if (e instanceof Mp4Error) throw Errors.validation({ fields: { voice: ['Format non reconnu : un message vocal est un fichier M4A.'] } });
      throw e;
    }
    if (info.width !== null || info.metadataTrack) throw Errors.validation({ fields: { voice: ['Un message vocal ne contient que du son.'] } });
    const maxSeconds = await this.limit('messages.voice_max_seconds', 120);
    if (info.durationMs < 300) throw Errors.validation({ fields: { voice: ['Message vocal trop court.'] } });
    if (info.durationMs > maxSeconds * 1000 + 500) {
      throw new AppError('VOICE_TOO_LONG', `Un message vocal dure ${Math.round(maxSeconds / 60)} minutes au plus.`, HttpStatus.BAD_REQUEST, { maxSeconds });
    }
    return { data: scrubMp4Metadata(f.buffer), durationMs: info.durationMs };
  }

  async send(userId: string, conversationId: string, input: { text?: string; photo?: Express.Multer.File; voice?: Express.Multer.File; replyToId?: string }, meta: RequestMeta, apiBase: string) {
    const { conv, me, otherReadId } = await this.access(userId, conversationId);
    if (conv.kind === 'direct') {
      const other = (await this.db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId))).find((x) => x.userId !== userId);
      if (other) await this.minorShield(this.db, conversationId, userId, other.userId);
    }
    const m = await this.persist({ conversationId, senderId: userId, senderShopId: null, text: input.text, photo: input.photo, voice: input.voice, replyToId: input.replyToId, meta }, async (tx, id, now) => {
      // Répondre à une demande vaut acceptation ; mon propre message est lu.
      await tx
        .update(conversationMembers)
        .set({ status: me.status === 'request' ? 'active' : me.status, lastReadMessageId: id, lastReadAt: now })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
      // 6-B : une conversation archivée par la boutique revient dans « Tous » quand la cliente écrit.
      if (conv.kind === 'shop') await tx.update(conversations).set({ shopArchivedAt: null }).where(eq(conversations.id, conversationId));
      // L'autre personne avait refusé ma demande : le message reste invisible pour elle (elle n'est pas relancée).
    });
    return this.view(m, true, otherReadId, apiBase, { userId, shopId: null }, conv.kind === 'group' ? { blocked: new Set() } : undefined);
  }

  // ------------------------------------------------------------------------------------------------ Réactions (6-C)

  static checkReaction(emoji: string): Reaction {
    if (!(MESSAGE_REACTIONS as readonly string[]).includes(emoji)) throw Errors.validation({ fields: { emoji: [`Réactions possibles : ${MESSAGE_REACTIONS.join(' ')}`] } });
    return emoji as Reaction;
  }

  /**
   * Pose, change (`emoji`) ou retire (`null`) la réaction d'une partie sur un message publié. Une seule par partie :
   * l'index unique de la base départage deux requêtes simultanées.
   */
  async setReaction(tx: Database | Tx, messageId: string, v: Viewer, emoji: Reaction | null) {
    if (emoji === null) {
      await tx
        .delete(messageReactions)
        .where(and(eq(messageReactions.messageId, messageId), v.shopId ? eq(messageReactions.shopId, v.shopId) : and(eq(messageReactions.userId, v.userId), isNull(messageReactions.shopId))));
      return;
    }
    const values = { id: uuidv7(), messageId, userId: v.userId, shopId: v.shopId, emoji };
    if (v.shopId) {
      await tx
        .insert(messageReactions)
        .values(values)
        .onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.shopId], targetWhere: sql`shop_id IS NOT NULL`, set: { emoji, userId: v.userId, createdAt: new Date() } });
    } else {
      await tx
        .insert(messageReactions)
        .values(values)
        .onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.userId], targetWhere: sql`shop_id IS NULL`, set: { emoji, createdAt: new Date() } });
    }
  }

  /** Réagir (ou retirer ma réaction) à un message d'une conversation où j'écris en mon nom. */
  async react(userId: string, messageId: string, emoji: string | null, apiBase: string) {
    const [m] = await this.db.select().from(messages).where(eq(messages.id, messageId));
    if (!m) throw Errors.notFound('Message');
    const { conv, me, otherReadId } = await this.access(userId, m.conversationId);
    // Réagir à une demande préviendrait son auteur qu'elle a été lue (E10) : accepter d'abord.
    if (me.status === 'request') throw Errors.conflict('REQUEST_PENDING', 'Accepte d’abord cette demande pour réagir.');
    if (m.status !== 'published' || m.kind === 'system') throw Errors.notFound('Message');
    const group = conv.kind === 'group' ? { blocked: await this.blockedIds(userId) } : undefined;
    if (group?.blocked.has(m.senderId)) throw Errors.notFound('Message');
    await this.setReaction(this.db, m.id, { userId, shopId: null }, emoji === null ? null : MessagingService.checkReaction(emoji));
    return this.view(m, this.mine(m, userId), otherReadId, apiBase, { userId, shopId: null }, group);
  }

  /** Conversation lue jusqu'au dernier message (statut « Vu » chez l'autre personne). */
  async read(userId: string, conversationId: string) {
    const { me } = await this.access(userId, conversationId);
    // Une demande pas encore acceptée n'affiche jamais « Vu » chez l'autre (E10).
    if (me.status === 'request') return { lastReadMessageId: me.lastReadMessageId ?? null };
    const [last] = await this.db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.id)).limit(1);
    if (last) {
      await this.db
        .update(conversationMembers)
        .set({ lastReadMessageId: last.id, lastReadAt: new Date() })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
            sql`(${conversationMembers.lastReadMessageId} IS NULL OR ${conversationMembers.lastReadMessageId} < ${last.id})`,
          ),
        );
    }
    return { lastReadMessageId: last?.id ?? null };
  }

  /** Supprimer mon message : « Message supprimé » chez les deux, photo effacée du stockage. */
  async deleteMessage(userId: string, messageId: string) {
    const [m] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.senderId, userId), isNull(messages.senderShopId), eq(messages.status, 'published'), ne(messages.kind, 'system')));
    if (!m) throw Errors.notFound('Message');
    await this.access(userId, m.conversationId);
    // Signalé (signalement ouvert) : « Message supprimé » pour les deux, mais le contenu reste pour la modération.
    const evidence = await openReport(this.db, 'message', m.id);
    await this.db.update(messages).set({ status: 'deleted', ...(evidence ? {} : { text: null, mediaKey: null }) }).where(eq(messages.id, m.id));
    await this.db.delete(messageReactions).where(eq(messageReactions.messageId, m.id));
    if (m.mediaKey && !evidence) await this.storage.remove(m.mediaKey).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ Groupes (V1)

  /** Nom, nombre de membres actifs, mon rôle. */
  private async groupInfo(conv: ConversationRow, me: MemberRow) {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.status, 'active')));
    return { title: conv.title, memberCount: n, myRole: me.role, invited: me.status === 'request' };
  }

  private async groupMax() {
    return this.limit('messages.group_max_members', 32);
  }

  /** Message du système dans un groupe (création, arrivée, départ) : jamais de contenu personnel au-delà du nom. */
  private async systemMessage(tx: DbOrTx, conversationId: string, actorId: string, text: string) {
    const now = new Date();
    await tx.insert(messages).values({ id: uuidv7(), conversationId, senderId: actorId, kind: 'system', text: text.slice(0, 300), createdAt: now });
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  }

  /**
   * Personnes ajoutables à un groupe par `adderId` (décisions du 18/10/2026) : compte actif, aucun blocage ; une personne
   * de 16-17 ans seulement si elle suit la personne qui l'ajoute. Ceux qui ne suivent pas l'ajouteur reçoivent une
   * invitation (« request »), comme une demande de message. Aucune raison n'est donnée pour une personne écartée.
   */
  private async addable(adderId: string, usernames: string[]) {
    const names = [...new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean))];
    const rows = names.length ? await this.db.select().from(users).where(inArray(users.username, names)) : [];
    const blocked = await this.blockedIds(adderId);
    const ok: { id: string; name: string; status: 'active' | 'request' }[] = [];
    const notAdded: string[] = [];
    for (const name of names) {
      const u = rows.find((r) => r.username === name);
      if (!u || u.status !== 'active' || u.id === adderId || blocked.has(u.id)) {
        notAdded.push(name);
        continue;
      }
      const followsAdder = await this.follows(u.id, adderId);
      if (ageOn(u.birthDate) < 18 && !followsAdder) {
        notAdded.push(name);
        continue;
      }
      ok.push({ id: u.id, name: u.fullName.split(' ')[0], status: followsAdder ? 'active' : 'request' });
    }
    return { ok, notAdded };
  }

  /** Créer un groupe : réservé aux 18 ans et plus (décision du 18/10/2026) ; 32 personnes au plus, créateur compris. */
  async createGroup(userId: string, input: { title: string; usernames: string[] }, apiBase: string) {
    const title = input.title.trim();
    if (title.length < 1 || title.length > 60) throw Errors.validation({ fields: { title: ['Le nom du groupe compte 1 à 60 caractères.'] } });
    const [me] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!me || ageOn(me.birthDate) < 18) {
      throw new AppError('AGE_REQUIREMENT_NOT_MET', 'Créer un groupe est réservé aux personnes d’au moins 18 ans.', HttpStatus.FORBIDDEN, { capability: 'group_creation', minAge: 18 });
    }
    const max = await this.groupMax();
    const { ok, notAdded } = await this.addable(userId, input.usernames);
    if (!ok.length) throw Errors.validation({ fields: { usernames: ['Ajoute au moins une personne qui peut rejoindre le groupe.'] } });
    if (ok.length + 1 > max) throw Errors.validation({ fields: { usernames: [`${max} personnes au plus dans un groupe, toi compris.`] } });
    const dailyMax = await this.limit('messages.new_conversations_daily_limit', 20);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await lockUserQuota(tx, 'conversations', userId);
      const [{ n }] = await tx.select({ n: count() }).from(conversations).where(and(eq(conversations.createdBy, userId), gt(conversations.createdAt, new Date(Date.now() - 24 * 3600_000))));
      if (n >= dailyMax) throw Errors.tooMany('Tu as commencé beaucoup de conversations aujourd’hui. Réessaie demain.', { reason: 'MESSAGES_NEW_CONVERSATIONS_LIMIT', limit: dailyMax });
      await tx.insert(conversations).values({ id, kind: 'group', title, createdBy: userId });
      await tx.insert(conversationMembers).values([
        { conversationId: id, userId, status: 'active', role: 'admin' },
        ...ok.map((o) => ({ conversationId: id, userId: o.id, status: o.status, role: 'member', addedBy: userId })),
      ]);
      await this.systemMessage(tx, id, userId, `${me.fullName.split(' ')[0]} a créé le groupe « ${title} »`);
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'messages.group_created', targetType: 'conversation', targetId: id, metadata: { members: ok.length + 1 } }, tx);
    });
    return { conversation: await this.summary(userId, id, apiBase), notAdded };
  }

  /** Accès d'un membre actif au groupe ; `admin` : réservé aux administrateurs du groupe. */
  private async groupAccess(userId: string, conversationId: string, admin = false) {
    const a = await this.access(userId, conversationId);
    if (a.conv.kind !== 'group') throw Errors.notFound('Groupe');
    if (admin && (a.me.role !== 'admin' || a.me.status !== 'active')) throw new AppError('GROUP_ADMIN_ONLY', 'Seul un administrateur du groupe peut le faire.', HttpStatus.FORBIDDEN);
    return a;
  }

  /** Membres du groupe (actifs et invités), administrateurs d'abord. */
  async groupMembers(userId: string, conversationId: string, apiBase: string) {
    const { me } = await this.groupAccess(userId, conversationId);
    const rows = await this.db
      .select({ m: conversationMembers, u: users })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conversationId), inArray(conversationMembers.status, ['active', 'request'])))
      .orderBy(asc(conversationMembers.joinedAt));
    const blocked = await this.blockedIds(userId);
    const items = [];
    for (const r of rows.sort((x, y) => (x.m.role === y.m.role ? 0 : x.m.role === 'admin' ? -1 : 1))) {
      if (r.u.status !== 'active') continue;
      items.push({ ...this.person(r.u, blocked.has(r.u.id) ? null : await this.url(r.u.avatarKey, apiBase)), role: r.m.role, invited: r.m.status === 'request', isMe: r.u.id === userId });
    }
    return { items, myRole: me.role, maxMembers: await this.groupMax() };
  }

  /** Ajouter des personnes (administrateur) ; limite de taille vérifiée sous verrou. */
  async addGroupMembers(userId: string, conversationId: string, usernames: string[], apiBase: string) {
    await this.groupAccess(userId, conversationId, true);
    const { ok, notAdded } = await this.addable(userId, usernames);
    const [me] = await this.db.select().from(users).where(eq(users.id, userId));
    const max = await this.groupMax();
    await this.db.transaction(async (tx) => {
      await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).for('update');
      const current = await tx.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
      const present = new Set(current.filter((m) => m.status === 'active' || m.status === 'request').map((m) => m.userId));
      const fresh = ok.filter((o) => !present.has(o.id));
      if (present.size + fresh.length > max) throw Errors.validation({ fields: { usernames: [`${max} personnes au plus dans un groupe.`] } });
      for (const o of fresh) {
        const was = current.find((m) => m.userId === o.id);
        if (was) {
          await tx
            .update(conversationMembers)
            .set({ status: o.status, role: 'member', addedBy: userId, joinedAt: new Date(), lastReadMessageId: null })
            .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, o.id)));
        } else {
          await tx.insert(conversationMembers).values({ conversationId, userId: o.id, status: o.status, role: 'member', addedBy: userId });
        }
      }
      if (fresh.length) await this.systemMessage(tx, conversationId, userId, `${me.fullName.split(' ')[0]} a ajouté ${fresh.map((f) => f.name).join(', ')}`);
    });
    return { members: await this.groupMembers(userId, conversationId, apiBase), notAdded };
  }

  /** Retirer quelqu'un (administrateur), ou quitter le groupe soi-même. Le dernier administrateur qui part passe la main. */
  async leaveGroup(userId: string, conversationId: string, targetUsername?: string) {
    const { me } = await this.groupAccess(userId, conversationId, !!targetUsername);
    let targetId = userId;
    if (targetUsername) {
      const [t] = await this.db.select({ id: users.id }).from(users).where(eq(users.username, targetUsername.trim().toLowerCase()));
      if (!t || t.id === userId) throw Errors.notFound('Membre');
      targetId = t.id;
    }
    const [actor] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId));
    await this.db.transaction(async (tx) => {
      await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).for('update');
      const [t] = await tx
        .update(conversationMembers)
        .set({ status: 'left', role: 'member' })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, targetId), inArray(conversationMembers.status, ['active', 'request', 'declined'])))
        .returning();
      if (!t) throw Errors.notFound('Membre');
      const [tu] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, targetId));
      const first = (n: string) => n.split(' ')[0];
      await this.systemMessage(tx, conversationId, userId, targetUsername ? `${first(actor.fullName)} a retiré ${first(tu.fullName)}` : `${first(actor.fullName)} a quitté le groupe`);
      if (!targetUsername && me.role === 'admin') {
        const admins = await tx
          .select({ id: conversationMembers.userId })
          .from(conversationMembers)
          .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.role, 'admin'), eq(conversationMembers.status, 'active')));
        if (!admins.length) {
          const [next] = await tx
            .select({ id: conversationMembers.userId })
            .from(conversationMembers)
            .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.status, 'active')))
            .orderBy(asc(conversationMembers.joinedAt))
            .limit(1);
          if (next) await tx.update(conversationMembers).set({ role: 'admin' }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, next.id)));
        }
      }
    });
    return { status: 'left' as const };
  }

  /** Renommer le groupe (administrateur). */
  async renameGroup(userId: string, conversationId: string, title: string, apiBase: string) {
    await this.groupAccess(userId, conversationId, true);
    const t = title.trim();
    if (t.length < 1 || t.length > 60) throw Errors.validation({ fields: { title: ['Le nom du groupe compte 1 à 60 caractères.'] } });
    const [actor] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId));
    await this.db.transaction(async (tx) => {
      await tx.update(conversations).set({ title: t }).where(eq(conversations.id, conversationId));
      await this.systemMessage(tx, conversationId, userId, `${actor.fullName.split(' ')[0]} a renommé le groupe « ${t} »`);
    });
    return this.summary(userId, conversationId, apiBase);
  }

  // ------------------------------------------------------------------------------------------------ Signalement et modération

  /** Message signalable par un membre de la conversation (pas le sien) ; renvoie l'auteur signalé. */
  async reportableMessage(userId: string, messageId: string): Promise<string> {
    const [m] = await this.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.status, 'published'), ne(messages.senderId, userId), ne(messages.kind, 'system')));
    if (!m) throw Errors.notFound('Message');
    const [member] = await this.db
      .select({ s: conversationMembers.status })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, m.conversationId), eq(conversationMembers.userId, userId)));
    if (!member) throw Errors.notFound('Message');
    return m.senderId;
  }

  /** Contenus des messages signalés, pour la page Modération ; chaque lecture est journalisée. */
  async reportedMessages(adminId: string, ids: string[], meta: RequestMeta, apiBase: string) {
    if (!ids.length) return [];
    const rows = await this.db.select().from(messages).where(inArray(messages.id, ids));
    for (const m of rows) {
      await this.audit.log({ actorType: 'admin', actorId: adminId, action: 'admin.reported_message_viewed', targetType: 'message', targetId: m.id, ip: meta.ip, userAgent: meta.userAgent });
    }
    const out = [];
    for (const m of rows) out.push({ id: m.id, kind: m.kind, text: m.text, status: m.status, photoUrl: m.kind === 'photo' ? await this.url(m.mediaKey, apiBase) : null, voiceUrl: m.kind === 'voice' ? await this.url(m.mediaKey, apiBase) : null });
    return out;
  }
}
