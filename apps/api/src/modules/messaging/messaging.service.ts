/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { conversationMembers, conversations, follows, messages, projectOffers, projects, shopMembers, shops, userBlocks, users } from '../../database/schema';
import { ageOn } from '../age-policy/age';
import { AuditService } from '../audit/audit.service';
import { BimShopService } from '../catalog/bimshop.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { SettingsService } from '../settings/settings.service';

const PAGE = 30;
type MessageRow = typeof messages.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;
type ShopRow = typeof shops.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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
    if (!me || (me.status === 'declined' && !allowDeclined)) throw Errors.notFound('Conversation');
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
      return this.summary(userId, existing.id, apiBase);
    }
    const followsMe = await this.follows(target.id, userId);
    if (!followsMe && ageOn(target.birthDate) < 18) {
      throw Errors.forbidden('Cette personne ne peut recevoir de messages que des comptes qu’elle suit.');
    }
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
        { conversationId: id, userId: target.id, status: followsMe ? 'active' : 'request' },
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
      const [card] = await this.bimshop.visibleCards([input.productId], apiBase);
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
    const [product] = conv.contextProductId ? await this.bimshop.visibleCards([conv.contextProductId], apiBase) : [];
    let offer: { id: string; projectTitle: string } | null = null;
    if (conv.contextOfferId) {
      const [o] = await this.db
        .select({ id: projectOffers.id, projectTitle: projects.title })
        .from(projectOffers)
        .innerJoin(projects, eq(projects.id, projectOffers.projectId))
        .where(eq(projectOffers.id, conv.contextOfferId));
      offer = o ?? null;
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
      pendingForOther: other?.status === 'request',
      person: otherUser ? this.person(otherUser, await this.url(otherUser.avatarKey, apiBase)) : null,
      shop: shop ? this.shopRef(shop, await this.url(shop.logoKey, apiBase)) : null,
      context: await this.context(conv, apiBase),
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
    if (m.kind === 'text') return (m.text ?? '').slice(0, 120);
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

  /** Vue d'un message ; `mine` = écrit par moi (ou par ma boutique, côté boutique). */
  async view(m: MessageRow, mine: boolean, otherReadId: string | null, apiBase: string) {
    const visible = m.status === 'published';
    return {
      id: m.id,
      senderIsMe: mine,
      kind: m.kind,
      text: visible ? m.text : null,
      photoUrl: visible && m.kind === 'photo' ? await this.url(m.mediaKey, apiBase) : null,
      photo: visible && m.kind === 'photo' ? { width: m.mediaWidth, height: m.mediaHeight } : null,
      status: m.status,
      createdAt: m.createdAt,
      /** Mes messages : lus par l'autre partie. */
      read: mine ? !!otherReadId && otherReadId >= m.id : null,
    };
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
    p: { conversationId: string; senderId: string; senderShopId: string | null; text?: string; photo?: Express.Multer.File; meta: RequestMeta },
    after: (tx: Tx, id: string, now: Date) => Promise<void>,
  ): Promise<MessageRow> {
    const text = p.text?.trim();
    if (!text && !p.photo) throw Errors.validation({ fields: { text: ['Écris un message ou ajoute une photo.'] } });
    if (text && p.photo) throw Errors.validation({ fields: { text: ['Un message contient un texte ou une photo.'] } });
    if (text && text.length > 2000) throw Errors.validation({ fields: { text: ['2000 caractères au plus.'] } });
    if (p.photo && !this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const max = await this.limit('messages.daily_limit', 500);
    const id = uuidv7();
    let key: string | null = null;
    let img: Awaited<ReturnType<typeof encodePrivateImage>> | null = null;
    if (p.photo) {
      img = await encodePrivateImage(p.photo, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
      key = `messages/${p.conversationId}/${id}.jpg`;
      await this.storage.put(key, img.data, 'image/jpeg');
    }
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
          kind: img ? 'photo' : 'text',
          text: img ? null : text,
          mediaKey: key,
          mediaWidth: img?.width ?? null,
          mediaHeight: img?.height ?? null,
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
            metadata: { kind: img ? 'photo' : 'text', ...(p.senderShopId ? { shopId: p.senderShopId } : {}) },
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
    const { otherReadId } = await this.access(userId, conversationId);
    const { rows, nextBefore } = await this.page(conversationId, before);
    const items = [];
    for (const m of rows) items.push(await this.view(m, this.mine(m, userId), otherReadId, apiBase));
    return { items, nextBefore };
  }

  async send(userId: string, conversationId: string, input: { text?: string; photo?: Express.Multer.File }, meta: RequestMeta, apiBase: string) {
    const { conv, me, otherReadId } = await this.access(userId, conversationId);
    const m = await this.persist({ conversationId, senderId: userId, senderShopId: null, text: input.text, photo: input.photo, meta }, async (tx, id, now) => {
      // Répondre à une demande vaut acceptation ; mon propre message est lu.
      await tx
        .update(conversationMembers)
        .set({ status: me.status === 'request' ? 'active' : me.status, lastReadMessageId: id, lastReadAt: now })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
      // 6-B : une conversation archivée par la boutique revient dans « Tous » quand la cliente écrit.
      if (conv.kind === 'shop') await tx.update(conversations).set({ shopArchivedAt: null }).where(eq(conversations.id, conversationId));
      // L'autre personne avait refusé ma demande : le message reste invisible pour elle (elle n'est pas relancée).
    });
    return this.view(m, true, otherReadId, apiBase);
  }

  /** Conversation lue jusqu'au dernier message (statut « Vu » chez l'autre personne). */
  async read(userId: string, conversationId: string) {
    await this.access(userId, conversationId);
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
      .where(and(eq(messages.id, messageId), eq(messages.senderId, userId), isNull(messages.senderShopId), eq(messages.status, 'published')));
    if (!m) throw Errors.notFound('Message');
    await this.access(userId, m.conversationId);
    await this.db.update(messages).set({ status: 'deleted', text: null, mediaKey: null }).where(eq(messages.id, m.id));
    if (m.mediaKey) await this.storage.remove(m.mediaKey).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ Signalement et modération

  /** Message signalable par un membre de la conversation (pas le sien) ; renvoie l'auteur signalé. */
  async reportableMessage(userId: string, messageId: string): Promise<string> {
    const [m] = await this.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.status, 'published'), ne(messages.senderId, userId)));
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
    for (const m of rows) out.push({ id: m.id, kind: m.kind, text: m.text, status: m.status, photoUrl: m.kind === 'photo' ? await this.url(m.mediaKey, apiBase) : null });
    return out;
  }
}
