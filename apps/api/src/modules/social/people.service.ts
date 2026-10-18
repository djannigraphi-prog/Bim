/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { contentReports, follows, postComments, posts, privacySettings, projects, userBlocks, users, messages, conversationMembers, conversations, shopMembers, reviews } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { notBlockedBetween, commentParentPublished } from './access';
import { ReportContentDto } from './dto';
import { PostsService } from './posts.service';
import { ReelsService } from './reels.service';
import { StoriesService } from './stories.service';

/**
 * Personnes (lot 4) : profil (écran 52), recherche, abonnements, blocages, photo de profil (écrans 05 et 52) et
 * signalement d'un contenu. Une personne bloquée (dans un sens ou dans l'autre), suspendue ou supprimée répond
 * « introuvable ». Jamais exposés : date de naissance, genre, coordonnées ; la ville seulement si la personne l'a
 * rendue publique (réglage de confidentialité existant).
 */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly posts: PostsService,
    private readonly stories: StoriesService,
    private readonly audit: AuditService,
    private readonly reels: ReelsService,
  ) {}

  /** Personne active et visible par `viewerId` (aucun blocage entre eux), par nom d'utilisateur ou identifiant. */
  async visiblePerson(viewerId: string, by: { username?: string; id?: string }) {
    const where = by.username ? eq(users.username, by.username.toLowerCase().replace(/^@/, '')) : eq(users.id, by.id!);
    const [u] = await this.db
      .select({ id: users.id, username: users.username, fullName: users.fullName, city: users.city, avatarKey: users.avatarKey })
      .from(users)
      .where(and(where, eq(users.status, 'active'), notBlockedBetween(viewerId, users.id)));
    if (!u) throw Errors.notFound('Profil');
    return u;
  }

  async profile(viewerId: string, username: string, apiBase: string) {
    const u = await this.visiblePerson(viewerId, { username });
    const isMe = u.id === viewerId;
    const [[bims], [followers], [following], [privacy], [followedByMe], [followsMe], [blocked]] = await Promise.all([
      this.db.select({ n: count() }).from(posts).where(and(eq(posts.userId, u.id), eq(posts.kind, 'bim'), eq(posts.status, 'published'), isMe ? sql`true` : eq(posts.visibility, 'public'))),
      this.db.select({ n: count() }).from(follows).innerJoin(users, eq(users.id, follows.followerId)).where(and(eq(follows.followeeId, u.id), eq(users.status, 'active'))),
      this.db.select({ n: count() }).from(follows).innerJoin(users, eq(users.id, follows.followeeId)).where(and(eq(follows.followerId, u.id), eq(users.status, 'active'))),
      this.db.select({ cityPublic: privacySettings.cityPublic }).from(privacySettings).where(eq(privacySettings.userId, u.id)),
      this.db.select({ x: follows.followerId }).from(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, u.id))),
      this.db.select({ x: follows.followerId }).from(follows).where(and(eq(follows.followerId, u.id), eq(follows.followeeId, viewerId))),
      this.db.select({ x: userBlocks.blockerId }).from(userBlocks).where(and(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, u.id))),
    ]);
    // Le nombre de projets est privé : seulement sur son propre profil.
    const [mine] = isMe
      ? await this.db.select({ n: count() }).from(projects).where(and(eq(projects.userId, u.id), inArray(projects.status, ['active', 'paused', 'completed'])))
      : [null];
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      city: isMe || privacy?.cityPublic ? u.city : null,
      avatarUrl: await this.posts.avatarUrl(u.avatarKey, apiBase),
      counts: { bims: bims.n, followers: followers.n, following: following.n, projects: mine ? mine.n : null },
      isMe,
      followedByMe: !!followedByMe,
      followsMe: !!followsMe,
      blockedByMe: !!blocked,
    };
  }

  /** Recherche de personnes par nom d'utilisateur ou nom complet (loupe de l'écran 10). */
  async search(viewerId: string, q: string, apiBase: string) {
    const term = q.trim().replace(/^@/, '').replace(/[%_\\]/g, '');
    if (term.length < 2) return { items: [] };
    const rows = await this.db
      .select({ id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey })
      .from(users)
      .where(and(eq(users.status, 'active'), ne(users.id, viewerId), notBlockedBetween(viewerId, users.id), or(ilike(users.username, `${term}%`), ilike(users.fullName, `%${term}%`))))
      // Nom d'utilisateur exact en premier, puis ceux qui commencent par la recherche, puis l'ordre alphabétique.
      .orderBy(sql`(${users.username} = ${term.toLowerCase()}) DESC`, sql`(${users.username} LIKE ${term.toLowerCase() + '%'}) DESC`, users.username)
      .limit(20);
    const followed = rows.length
      ? await this.db.select({ id: follows.followeeId }).from(follows).where(and(eq(follows.followerId, viewerId), inArray(follows.followeeId, rows.map((r) => r.id))))
      : [];
    const set = new Set(followed.map((f) => f.id));
    const items = [];
    for (const r of rows) items.push({ id: r.id, username: r.username, fullName: r.fullName, avatarUrl: await this.posts.avatarUrl(r.avatarKey, apiBase), followedByMe: set.has(r.id) });
    return { items };
  }

  /**
   * V1 — Personnes à suivre (décision du 18/10/2026 : abonnements, catégories des projets, j'aime ; aucune publicité).
   * Signaux publics seulement : personnes suivies par mes abonnements, auteurs de « J'ai fait mon BIM » publics dans
   * les catégories de mes projets, publications publiques appréciées ces 30 derniers jours. Jamais une personne de
   * moins de 18 ans (protection des mineurs), ni une personne bloquée, ni quelqu'un que je suis déjà.
   */
  async suggestions(viewerId: string, apiBase: string) {
    const rows = await this.db.execute<{ id: string; username: string; full_name: string; avatar_key: string | null; mutual: number; same_goals: boolean; likes: number }>(sql`
      WITH mine AS (SELECT followee_id FROM follows WHERE follower_id = ${viewerId}),
           cats AS (SELECT DISTINCT category_code FROM projects WHERE user_id = ${viewerId}),
           scored AS (
             SELECT u.id, u.username, u.full_name, u.avatar_key,
                    (SELECT count(*) FROM follows f WHERE f.followee_id = u.id AND f.follower_id IN (SELECT followee_id FROM mine))::int AS mutual,
                    EXISTS (SELECT 1 FROM posts p JOIN projects pr ON pr.id = p.project_id
                            WHERE p.user_id = u.id AND p.kind = 'bim' AND p.status = 'published' AND p.visibility = 'public'
                              AND pr.category_code IN (SELECT category_code FROM cats)) AS same_goals,
                    (SELECT count(*) FROM post_likes l JOIN posts p ON p.id = l.post_id
                      WHERE p.user_id = u.id AND p.status = 'published' AND p.visibility = 'public' AND l.created_at > now() - interval '30 days')::int AS likes
             FROM users u
             WHERE u.status = 'active' AND u.id <> ${viewerId}
               AND u.id NOT IN (SELECT followee_id FROM mine)
               AND u.birth_date <= (current_date - interval '18 years')
               AND ${notBlockedBetween(viewerId, sql.raw('u.id'))}
           )
      SELECT * FROM scored WHERE mutual > 0 OR same_goals OR likes > 0
      ORDER BY mutual * 10 + (CASE WHEN same_goals THEN 5 ELSE 0 END) + ln(1 + likes) DESC, username
      LIMIT 15`);
    const items = [];
    for (const r of rows.rows) {
      items.push({
        id: r.id,
        username: r.username,
        fullName: r.full_name,
        avatarUrl: await this.posts.avatarUrl(r.avatar_key, apiBase),
        reason: r.mutual > 0 ? 'followed_by_friends' : r.same_goals ? 'same_goals' : 'popular',
        mutualCount: Number(r.mutual),
      });
    }
    return { items };
  }

  async follow(viewerId: string, username: string, on: boolean) {
    const u = await this.visiblePerson(viewerId, { username });
    if (u.id === viewerId) throw Errors.validation({ fields: { username: ['Tu ne peux pas t’abonner à toi-même.'] } });
    if (on) await this.db.insert(follows).values({ followerId: viewerId, followeeId: u.id }).onConflictDoNothing();
    else await this.db.delete(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, u.id)));
    return { followedByMe: on };
  }

  async block(viewerId: string, username: string, on: boolean, meta: RequestMeta) {
    // Débloquer doit rester possible : la recherche ignore ici le blocage posé par la personne elle-même.
    const [u] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username.toLowerCase().replace(/^@/, '')), ne(users.status, 'deleted')));
    if (!u) throw Errors.notFound('Profil');
    if (u.id === viewerId) throw Errors.validation({ fields: { username: ['Tu ne peux pas te bloquer toi-même.'] } });
    if (on) {
      // Bloqué par l'autre : même réponse qu'une personne introuvable (on ne révèle pas le blocage).
      const [theyBlocked] = await this.db.select({ x: userBlocks.blockerId }).from(userBlocks).where(and(eq(userBlocks.blockerId, u.id), eq(userBlocks.blockedId, viewerId)));
      if (theyBlocked) throw Errors.notFound('Profil');
      await this.db.transaction(async (tx) => {
        await tx.insert(userBlocks).values({ blockerId: viewerId, blockedId: u.id }).onConflictDoNothing();
        // Plus d'abonnement dans un sens ni dans l'autre.
        await tx.delete(follows).where(or(and(eq(follows.followerId, viewerId), eq(follows.followeeId, u.id)), and(eq(follows.followerId, u.id), eq(follows.followeeId, viewerId))));
        await this.audit.log({ actorType: 'user', actorId: viewerId, action: 'social.user_blocked', targetType: 'user', targetId: u.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
      });
    } else {
      await this.db.delete(userBlocks).where(and(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, u.id)));
    }
    return { blockedByMe: on };
  }

  async blocked(viewerId: string, apiBase: string) {
    const rows = await this.db
      .select({ id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, viewerId));
    const items = [];
    for (const r of rows) items.push({ id: r.id, username: r.username, fullName: r.fullName, avatarUrl: await this.posts.avatarUrl(r.avatarKey, apiBase) });
    return { items };
  }

  // ------------------------------------------------------------------------------------------------ Photo de profil

  async setAvatar(userId: string, file: Express.Multer.File | undefined, meta: RequestMeta, apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const img = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
    const key = `avatars/${userId}/${uuidv7()}.jpg`;
    await this.storage.put(key, img.data, 'image/jpeg');
    const [prev] = await this.db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId));
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ avatarKey: key, updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'profile.avatar_changed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    if (prev?.key) await this.storage.remove(prev.key).catch(() => undefined);
    return { avatarUrl: await this.posts.avatarUrl(key, apiBase) };
  }

  async removeAvatar(userId: string, meta: RequestMeta) {
    const [prev] = await this.db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId));
    if (!prev?.key) return;
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ avatarKey: null, updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'profile.avatar_removed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    await this.storage.remove(prev.key).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ Signalements

  async report(viewerId: string, dto: ReportContentDto, meta: RequestMeta) {
    let targetUserId: string;
    if (dto.targetType === 'post') {
      targetUserId = (await this.posts.visible(viewerId, dto.targetId)).post.userId;
    } else if (dto.targetType === 'comment') {
      const [c] = await this.db.select().from(postComments).where(and(eq(postComments.id, dto.targetId), eq(postComments.status, 'published'), commentParentPublished()));
      if (!c) throw Errors.notFound('Commentaire');
      await this.posts.visible(viewerId, c.postId).catch(() => {
        throw Errors.notFound('Commentaire');
      });
      targetUserId = c.userId;
    } else if (dto.targetType === 'message') {
      // Lot 6-A : un message reçu, dans une conversation dont on est membre (jamais le sien).
      const [m] = await this.db
        .select({ senderId: messages.senderId })
        .from(messages)
        .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, viewerId)))
        .where(and(eq(messages.id, dto.targetId), eq(messages.status, 'published'), ne(messages.senderId, viewerId)));
      // Lot 6-B : une personne de l'équipe d'une boutique signale un message de la cliente (pas un message de la boutique).
      const [fromClient] = m
        ? []
        : await this.db
            .select({ senderId: messages.senderId })
            .from(messages)
            .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.kind, 'shop')))
            .innerJoin(shopMembers, and(eq(shopMembers.shopId, conversations.shopId), eq(shopMembers.userId, viewerId), isNull(shopMembers.revokedAt), isNotNull(shopMembers.acceptedAt)))
            .where(
              and(
                eq(messages.id, dto.targetId),
                eq(messages.status, 'published'),
                isNull(messages.senderShopId),
                ne(messages.senderId, viewerId),
                // 7-A : seul qui peut lire la boîte de la boutique (propriétaire ou permission « répondre aux messages »).
                sql`(${shopMembers.role} = 'owner' OR EXISTS (SELECT 1 FROM shop_member_permissions p WHERE p.shop_id = ${shopMembers.shopId} AND p.user_id = ${viewerId} AND p.permission = 'messages.reply'))`,
              ),
            );
      const found = m ?? fromClient;
      if (!found) throw Errors.notFound('Message');
      targetUserId = found.senderId;
    } else if (dto.targetType === 'reel') {
      targetUserId = (await this.reels.visible(viewerId, dto.targetId)).reel.userId;
    } else if (dto.targetType === 'story') {
      targetUserId = (await this.stories.visibleStory(viewerId, dto.targetId)).userId;
    } else if (dto.targetType === 'review') {
      // Lot 7-H : une évaluation publiée (article ou boutique), visible de tous.
      const [r] = await this.db.select({ authorId: reviews.authorId }).from(reviews).where(and(eq(reviews.id, dto.targetId), eq(reviews.status, 'published')));
      if (!r) throw Errors.notFound('Évaluation');
      targetUserId = r.authorId;
    } else {
      targetUserId = (await this.visiblePerson(viewerId, { id: dto.targetId })).id;
    }
    if (targetUserId === viewerId) throw Errors.validation({ fields: { targetId: ['Tu ne peux pas signaler ton propre contenu.'] } });
    const id = uuidv7();
    const inserted = await this.db
      .insert(contentReports)
      .values({ id, reporterId: viewerId, targetType: dto.targetType, targetId: dto.targetId, targetUserId, reason: dto.reason, message: dto.message?.trim() || null })
      .onConflictDoNothing()
      .returning({ id: contentReports.id });
    // Déjà signalé et pas encore traité : même réponse, sans doublon pour la modération.
    if (inserted.length) {
      await this.audit.log({ actorType: 'user', actorId: viewerId, action: 'social.content_reported', targetType: dto.targetType, targetId: dto.targetId, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: dto.reason } });
    }
    return { received: true };
  }
}
