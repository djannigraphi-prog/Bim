import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { recountComments } from './access';
import type { RequestMeta } from '../../common/request-meta';
import { DB, Database } from '../../database/database.module';
import { contentReports, messages, postComments, postMedia, posts, reels, reviews, stories, users } from '../../database/schema';
import { AdminContext } from '../admin/admin.decorators';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../media/storage';

/**
 * Modération du social (lot 4) dans l'administration : signalements de contenus, regroupés par contenu signalé, avec
 * un aperçu du contenu. Décision : rien à reprocher, ou contenu masqué (publication ou commentaire). Masquer est
 * réversible (« Rétablir »). Pour une personne, la mesure reste la suspension du compte (écran Utilisateurs).
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(status: 'open' | 'resolved', apiBase: string, admin?: AdminContext, meta?: RequestMeta) {
    const rows = await this.db
      .select({ r: contentReports, reporter: users.username })
      .from(contentReports)
      .innerJoin(users, eq(users.id, contentReports.reporterId))
      .where(eq(contentReports.status, status))
      .orderBy(status === 'open' ? asc(contentReports.createdAt) : desc(contentReports.resolvedAt))
      .limit(200);
    const postIds = rows.filter((x) => x.r.targetType === 'post').map((x) => x.r.targetId);
    const commentIds = rows.filter((x) => x.r.targetType === 'comment').map((x) => x.r.targetId);
    const storyIds = rows.filter((x) => x.r.targetType === 'story').map((x) => x.r.targetId);
    const reelIds = rows.filter((x) => x.r.targetType === 'reel').map((x) => x.r.targetId);
    const rl = reelIds.length ? await this.db.select().from(reels).where(inArray(reels.id, reelIds)) : [];
    // Lot 6-A : un message privé n'est montré à l'équipe que s'il a été signalé ; chaque lecture est journalisée.
    const messageIds = [...new Set(rows.filter((x) => x.r.targetType === 'message').map((x) => x.r.targetId))];
    const ms = messageIds.length ? await this.db.select().from(messages).where(inArray(messages.id, messageIds)) : [];
    for (const m of ms) {
      await this.audit.log({ actorType: 'admin', actorId: admin?.adminId ?? null, action: 'admin.reported_message_viewed', targetType: 'message', targetId: m.id, ip: meta?.ip ?? null, userAgent: meta?.userAgent ?? null });
    }
    // Lot 7-H : évaluations d'articles et de boutiques signalées.
    const reviewIds = rows.filter((x) => x.r.targetType === 'review').map((x) => x.r.targetId);
    const rs = reviewIds.length ? await this.db.select().from(reviews).where(inArray(reviews.id, reviewIds)) : [];
    const userIds = [...new Set(rows.map((x) => x.r.targetUserId).filter((x): x is string => !!x))];
    const ss = storyIds.length ? await this.db.select().from(stories).where(inArray(stories.id, storyIds)) : [];
    const [ps, cs, us, media] = await Promise.all([
      postIds.length ? this.db.select().from(posts).where(inArray(posts.id, postIds)) : [],
      commentIds.length ? this.db.select().from(postComments).where(inArray(postComments.id, commentIds)) : [],
      userIds.length ? this.db.select({ id: users.id, username: users.username, fullName: users.fullName, status: users.status }).from(users).where(inArray(users.id, userIds)) : [],
      postIds.length ? this.db.select().from(postMedia).where(inArray(postMedia.postId, postIds)).orderBy(asc(postMedia.position)) : [],
    ]);
    const items = [];
    for (const { r, reporter } of rows) {
      const p = r.targetType === 'post' ? ps.find((x) => x.id === r.targetId) : undefined;
      const c = r.targetType === 'comment' ? cs.find((x) => x.id === r.targetId) : undefined;
      const st = r.targetType === 'story' ? ss.find((x) => x.id === r.targetId) : undefined;
      const msg = r.targetType === 'message' ? ms.find((x) => x.id === r.targetId) : undefined;
      const rv = r.targetType === 'review' ? rs.find((x) => x.id === r.targetId) : undefined;
      const reel = r.targetType === 'reel' ? rl.find((x) => x.id === r.targetId) : undefined;
      const images: string[] = [];
      if (msg?.kind === 'photo' && msg.mediaKey && this.storage.available) images.push((await this.storage.temporaryUrl(msg.mediaKey, apiBase)).url);
      if (st && st.status !== 'deleted' && this.storage.available) images.push((await this.storage.temporaryUrl(st.storageKey, apiBase)).url);
      if (p && this.storage.available) {
        for (const m of media.filter((x) => x.postId === p.id)) images.push((await this.storage.temporaryUrl(m.storageKey, apiBase)).url);
      }
      items.push({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        message: r.message,
        reporter,
        author: us.find((x) => x.id === r.targetUserId) ?? null,
        content: p
          ? { kind: p.kind, text: p.text, status: p.status, images, visibility: p.visibility }
          : c
            ? { kind: 'comment', text: c.text, status: c.status, images: [], postId: c.postId }
            : st
              ? { kind: 'story', text: null, status: st.status, images }
              : msg
                ? { kind: 'message', text: msg.text, status: msg.status, images }
                : reel
                  ? {
                      kind: 'reel',
                      text: reel.caption,
                      status: reel.status,
                      images: [],
                      videoUrl: reel.status !== 'deleted' && this.storage.available ? (await this.storage.temporaryUrl(reel.storageKey, apiBase)).url : null,
                    }
                  : rv
                  ? { kind: 'review', text: `${rv.rating}/5${rv.productReference ? ` · ${rv.productReference}` : ' · boutique'}${rv.comment ? ` — ${rv.comment}` : ''}`, status: rv.status, images: [] }
                  : { kind: 'user', text: null, status: null, images: [] },
        status: r.status,
        action: r.action,
        resolution: r.resolution,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
      });
    }
    return { items };
  }

  async resolve(a: AdminContext, id: string, action: 'none' | 'hidden', resolution: string, meta: RequestMeta) {
    const [r] = await this.db.select().from(contentReports).where(and(eq(contentReports.id, id), eq(contentReports.status, 'open')));
    if (!r) throw Errors.conflict('REPORT_NOT_OPEN', 'Ce signalement est introuvable ou déjà traité.');
    if (action === 'hidden' && r.targetType === 'user') {
      throw Errors.validation({ fields: { action: ['Pour une personne, suspends son compte depuis l’écran Utilisateurs.'] } });
    }
    await this.db.transaction(async (tx) => {
      if (action === 'hidden') await this.setVisibility(tx, r.targetType as 'post' | 'comment' | 'story' | 'message' | 'review' | 'reel', r.targetId, 'hidden', resolution);
      // Tous les signalements ouverts sur ce même contenu sont clos par la même décision.
      await tx
        .update(contentReports)
        .set({ status: 'resolved', action, resolution: resolution.trim(), resolvedBy: a.adminId, resolvedAt: new Date() })
        .where(and(eq(contentReports.targetType, r.targetType), eq(contentReports.targetId, r.targetId), eq(contentReports.status, 'open')));
      await this.audit.log(
        { actorType: 'admin', actorId: a.adminId, action: 'admin.content_report_resolved', targetType: r.targetType, targetId: r.targetId, ip: meta.ip, userAgent: meta.userAgent, metadata: { action, reportId: id } },
        tx,
      );
    });
    return { id, status: 'resolved', action };
  }

  /** Rétablir un contenu masqué par erreur. */
  async restore(a: AdminContext, type: 'post' | 'comment' | 'story' | 'message' | 'review' | 'reel', id: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const changed = await this.setVisibility(tx, type, id, 'published', null);
      if (!changed) throw Errors.conflict('NOT_HIDDEN', 'Ce contenu n’est pas masqué.');
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.content_restored', targetType: type, targetId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return { id, status: 'published' };
  }

  /** Passe un contenu de publié à masqué (ou l'inverse) en gardant le compteur de commentaires exact. */
  private async setVisibility(tx: Pick<Database, 'update' | 'execute'>, type: 'post' | 'comment' | 'story' | 'message' | 'review' | 'reel', id: string, to: 'hidden' | 'published', note: string | null): Promise<boolean> {
    const from = to === 'hidden' ? 'published' : 'hidden';
    if (type === 'message') {
      const done = await tx.update(messages).set({ status: to }).where(and(eq(messages.id, id), eq(messages.status, from))).returning({ id: messages.id });
      return done.length > 0;
    }
    if (type === 'review') {
      const done = await tx.update(reviews).set({ status: to }).where(and(eq(reviews.id, id), eq(reviews.status, from))).returning({ id: reviews.id });
      return done.length > 0;
    }
    if (type === 'reel') {
      const done = await tx.update(reels).set({ status: to }).where(and(eq(reels.id, id), eq(reels.status, from))).returning({ id: reels.id });
      return done.length > 0;
    }
    if (type === 'story') {
      const done = await tx.update(stories).set({ status: to }).where(and(eq(stories.id, id), eq(stories.status, from))).returning({ id: stories.id });
      return done.length > 0;
    }
    if (type === 'post') {
      const done = await tx.update(posts).set({ status: to, moderationNote: note, updatedAt: new Date() }).where(and(eq(posts.id, id), eq(posts.status, from))).returning({ id: posts.id });
      return done.length > 0;
    }
    const done = await tx.update(postComments).set({ status: to }).where(and(eq(postComments.id, id), eq(postComments.status, from))).returning({ postId: postComments.postId });
    // Compteur recalculé : un commentaire masqué emporte ses réponses, rétabli il les ramène (audit, défaut 3).
    if (done.length) await recountComments(tx, done[0].postId);
    return done.length > 0;
  }
}
