/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { conversationMembers, conversations, messages, shopMembers, shopQuickReplies, shops, users } from '../../database/schema';
import { StorageService } from '../media/storage';
import { MessagingService } from './messaging.service';

const PAGE = 30;
const MAX_QUICK_REPLIES = 10;
export type ShopInboxBox = 'all' | 'unread' | 'archived' | 'marked';

/**
 * Lot 6-B — Boîte de la boutique (écran 51) et conversation côté boutique (écran 48), depuis l'espace boutique.
 *
 * Règles :
 * - la boutique ne démarche personne : elle répond seulement aux conversations ouvertes par une cliente ;
 * - tous les membres actifs de la boutique (propriétaire et équipe) partagent la boîte : lu, archivé, marqué ;
 * - chaque message garde la personne de l'équipe qui l'a écrit (`sender_id`, limite quotidienne et journal d'audit) ;
 * - une cliente au compte inactif, ou un blocage entre la cliente et le propriétaire : la conversation disparaît ;
 * - aucune notification sur le téléphone (Firebase non activé) : compteur de non-lus dans l'espace boutique.
 * L'appartenance à la boutique est revérifiée à chaque requête par la garde des espaces (`SpacesService.canUse`).
 */
@Injectable()
export class ShopInboxService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly messaging: MessagingService,
    private readonly storage: StorageService,
  ) {}

  /** Conversation de cette boutique, cliente active, sans blocage avec le propriétaire ; sinon 404. */
  private async access(shopId: string, conversationId: string) {
    const [row] = await this.db
      .select({ conv: conversations, client: conversationMembers, owner: shops.ownerUserId })
      .from(conversations)
      .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
      .innerJoin(shops, eq(shops.id, conversations.shopId))
      .where(and(eq(conversations.id, conversationId), eq(conversations.kind, 'shop'), eq(conversations.shopId, shopId)));
    if (!row) throw Errors.notFound('Conversation');
    const [client] = await this.db.select().from(users).where(eq(users.id, row.client.userId));
    if (!client || client.status !== 'active' || (await this.messaging.blocked(client.id, row.owner)).length) throw Errors.notFound('Conversation');
    return { conv: row.conv, member: row.client, client };
  }

  /** Conditions communes : conversation de la boutique, au moins un message, cliente joignable. */
  private visible(shopId: string) {
    return and(
      eq(conversations.kind, 'shop'),
      eq(conversations.shopId, shopId),
      sql`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = ${conversations.id})`,
      sql`EXISTS (SELECT 1 FROM conversation_members cm JOIN users cu ON cu.id = cm.user_id JOIN shops s ON s.id = ${conversations.shopId}
                  WHERE cm.conversation_id = ${conversations.id} AND cu.status = 'active'
                    AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = cu.id AND b.blocked_id = s.owner_user_id) OR (b.blocker_id = s.owner_user_id AND b.blocked_id = cu.id)))`,
    )!;
  }

  /** Messages de la cliente pas encore lus par la boutique. */
  private unreadSql() {
    return sql`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = ${conversations.id} AND m.sender_shop_id IS NULL AND m.status = 'published'
                         AND (${conversations.shopLastReadMessageId} IS NULL OR m.id > ${conversations.shopLastReadMessageId}))`;
  }

  /** Écran 51 : « Tous » (hors archivés), « Non lus », « Archivés », « Marqués » ; la plus récente d'abord. */
  async list(shopId: string, box: ShopInboxBox, cursor: string | undefined, apiBase: string) {
    const conds = [this.visible(shopId)];
    if (box === 'archived') conds.push(isNotNull(conversations.shopArchivedAt));
    else conds.push(isNull(conversations.shopArchivedAt));
    if (box === 'unread') conds.push(this.unreadSql());
    if (box === 'marked') conds.push(isNotNull(conversations.shopMarkedAt));
    if (cursor) {
      const [at, id] = cursor.split('|');
      const d = new Date(at);
      if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
      conds.push(sql`(date_trunc('milliseconds', ${conversations.lastMessageAt}), ${conversations.id}) < (${d}::timestamptz, ${id}::uuid)`);
    }
    const rows = await this.db
      .select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .where(and(...conds))
      .orderBy(desc(sql`date_trunc('milliseconds', ${conversations.lastMessageAt})`), desc(conversations.id))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const items = [];
    for (const r of page) items.push(await this.summary(shopId, r.id, apiBase));
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > PAGE && last ? `${last.lastMessageAt.toISOString()}|${last.id}` : null };
  }

  /** Pastille « Messages » de l'espace boutique et compteurs des onglets. */
  async unreadCount(shopId: string) {
    const [[{ unread }], [{ all }]] = await Promise.all([
      this.db.select({ unread: count() }).from(conversations).where(and(this.visible(shopId), this.unreadSql())),
      this.db.select({ all: count() }).from(conversations).where(and(this.visible(shopId), isNull(conversations.shopArchivedAt))),
    ]);
    return { unread, all };
  }

  async summary(shopId: string, conversationId: string, apiBase: string) {
    const { conv, client } = await this.access(shopId, conversationId);
    const [[last], [{ unread }]] = await Promise.all([
      this.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.id)).limit(1),
      this.db
        .select({ unread: count() })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            isNull(messages.senderShopId),
            eq(messages.status, 'published'),
            conv.shopLastReadMessageId ? gt(messages.id, conv.shopLastReadMessageId) : undefined,
          ),
        ),
    ]);
    return {
      id: conversationId,
      kind: 'shop' as const,
      person: this.messaging.person(client, await this.messaging.url(client.avatarKey, apiBase)),
      context: await this.messaging.context(conv, apiBase),
      lastMessage: last ? { senderIsMe: last.senderShopId === shopId, preview: this.messaging.preview(last), createdAt: last.createdAt } : null,
      unread,
      archived: !!conv.shopArchivedAt,
      marked: !!conv.shopMarkedAt,
      lastMessageAt: conv.lastMessageAt,
    };
  }

  async messages(shopId: string, conversationId: string, before: string | undefined, apiBase: string) {
    const { member } = await this.access(shopId, conversationId);
    const { rows, nextBefore } = await this.messaging.page(conversationId, before);
    const items = [];
    for (const m of rows) items.push(await this.messaging.view(m, m.senderShopId === shopId, member.lastReadMessageId, apiBase));
    return { items, nextBefore };
  }

  /** Répondre au nom de la boutique ; la conversation est lue par la boutique jusqu'à ce message. */
  async send(userId: string, shopId: string, conversationId: string, input: { text?: string; photo?: Express.Multer.File }, meta: RequestMeta, apiBase: string) {
    const { member } = await this.access(shopId, conversationId);
    const m = await this.messaging.persist({ conversationId, senderId: userId, senderShopId: shopId, text: input.text, photo: input.photo, meta }, async (tx, id) => {
      await tx.update(conversations).set({ shopLastReadMessageId: id }).where(eq(conversations.id, conversationId));
    });
    return this.messaging.view(m, true, member.lastReadMessageId, apiBase);
  }

  /** Conversation lue par la boutique (statut « Vu » chez la cliente). */
  async read(shopId: string, conversationId: string) {
    await this.access(shopId, conversationId);
    const [last] = await this.db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.id)).limit(1);
    if (last) {
      await this.db
        .update(conversations)
        .set({ shopLastReadMessageId: last.id })
        .where(and(eq(conversations.id, conversationId), sql`(${conversations.shopLastReadMessageId} IS NULL OR ${conversations.shopLastReadMessageId} < ${last.id})`));
    }
    return { lastReadMessageId: last?.id ?? null };
  }

  async setArchived(shopId: string, conversationId: string, on: boolean, apiBase: string) {
    await this.access(shopId, conversationId);
    await this.db.update(conversations).set({ shopArchivedAt: on ? new Date() : null }).where(eq(conversations.id, conversationId));
    return this.summary(shopId, conversationId, apiBase);
  }

  async setMarked(shopId: string, conversationId: string, on: boolean, apiBase: string) {
    await this.access(shopId, conversationId);
    await this.db.update(conversations).set({ shopMarkedAt: on ? new Date() : null }).where(eq(conversations.id, conversationId));
    return this.summary(shopId, conversationId, apiBase);
  }

  /** Supprimer un message de la boutique : par la personne qui l'a écrit, ou par le propriétaire. */
  async deleteMessage(userId: string, shopId: string, messageId: string) {
    const [m] = await this.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.senderShopId, shopId), eq(messages.status, 'published')));
    if (!m) throw Errors.notFound('Message');
    await this.access(shopId, m.conversationId);
    if (m.senderId !== userId) {
      const [owner] = await this.db
        .select({ x: shopMembers.userId })
        .from(shopMembers)
        .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId), eq(shopMembers.role, 'owner'), isNull(shopMembers.revokedAt)));
      if (!owner) throw Errors.forbidden('Seule la personne qui a écrit ce message, ou le propriétaire de la boutique, peut le supprimer.');
    }
    await this.db.update(messages).set({ status: 'deleted', text: null, mediaKey: null }).where(eq(messages.id, m.id));
    if (m.mediaKey) await this.storage.remove(m.mediaKey).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ Réponses rapides

  async quickReplies(shopId: string) {
    const rows = await this.db.select({ id: shopQuickReplies.id, text: shopQuickReplies.text }).from(shopQuickReplies).where(eq(shopQuickReplies.shopId, shopId)).orderBy(asc(shopQuickReplies.createdAt), asc(shopQuickReplies.id));
    return { items: rows, max: MAX_QUICK_REPLIES };
  }

  async addQuickReply(shopId: string, text: string) {
    const t = text.trim();
    if (!t) throw Errors.validation({ fields: { text: ['Écris la réponse rapide.'] } });
    await this.db.transaction(async (tx) => {
      // Ajouts simultanés : verrou par boutique, puis recomptage.
      await lockUserQuota(tx, 'quick_replies', shopId);
      const [{ n }] = await tx.select({ n: count() }).from(shopQuickReplies).where(eq(shopQuickReplies.shopId, shopId));
      if (n >= MAX_QUICK_REPLIES) throw Errors.conflict('QUICK_REPLIES_LIMIT', `${MAX_QUICK_REPLIES} réponses rapides au plus.`);
      await tx.insert(shopQuickReplies).values({ id: uuidv7(), shopId, text: t });
    });
    return this.quickReplies(shopId);
  }

  async removeQuickReply(shopId: string, id: string) {
    await this.db.delete(shopQuickReplies).where(and(eq(shopQuickReplies.id, id), eq(shopQuickReplies.shopId, shopId)));
    return this.quickReplies(shopId);
  }
}
