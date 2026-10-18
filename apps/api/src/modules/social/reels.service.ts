/// <reference types="multer" />
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DB, Database } from '../../database/database.module';
import { reelLikes, reels, reelViews, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { inspectMp4, Mp4Error, scrubMp4Metadata } from '../media/mp4';
import { StorageService } from '../media/storage';
import { CLOCK, Clock } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from '../wallet/wallet.service';
import { reelVisibleTo } from './access';

type Reel = typeof reels.$inferSelect;
type Author = { id: string; username: string; fullName: string; avatarKey: string | null };

const PAGE = 10;
const NO_VIEWER = '00000000-0000-0000-0000-000000000000';

/**
 * Lot 11 (prototype) — Reels : vidéos verticales courtes (écran 15), sans service vidéo payant ni transcodage. Le
 * fichier MP4 est contrôlé (format, durée, taille), ses métadonnées (dont la position) sont effacées, puis il est rangé
 * dans le stockage privé ; la lecture passe par un lien temporaire. Mêmes règles de visibilité que les publications.
 */
@Injectable()
export class ReelsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
  ) {}

  private async num(key: string, fallback: number) {
    const s = await this.settings.get<number>(key);
    return typeof s?.value === 'number' && s.value > 0 ? s.value : fallback;
  }

  private async checkDaily(db: Pick<Database, 'select'>, userId: string, max: number) {
    const since = new Date(this.clock.now().getTime() - 24 * 3600_000);
    const [{ n }] = await db.select({ n: count() }).from(reels).where(and(eq(reels.userId, userId), gt(reels.createdAt, since)));
    if (n >= max) throw Errors.tooMany('Tu as déjà publié beaucoup de Reels aujourd’hui 😊 Réessaie demain.', { reason: 'REELS_DAILY_LIMIT', limit: max });
  }

  async create(userId: string, file: Express.Multer.File | undefined, dto: { caption?: string; visibility?: 'public' | 'followers' }, meta: RequestMeta, apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des vidéos');
    if (!file) throw Errors.validation({ fields: { video: ['Choisis une vidéo.'] } });
    if (file.size > this.cfg.MEDIA_MAX_VIDEO_MB * 1024 * 1024) throw Errors.validation({ fields: { video: [`Vidéo trop lourde (${this.cfg.MEDIA_MAX_VIDEO_MB} Mo au plus).`] } });
    const [maxSeconds, daily] = await Promise.all([this.num('reels.max_seconds', 60), this.num('reels.daily_limit', 10)]);
    await this.checkDaily(this.db, userId, daily);
    let info;
    try {
      info = inspectMp4(file.buffer);
    } catch (e) {
      if (e instanceof Mp4Error) throw Errors.validation({ fields: { video: ['Format non reconnu : envoie une vidéo MP4.'] } });
      throw e;
    }
    if (info.metadataTrack) {
      throw new AppError('REEL_LOCATION_TRACK', 'Cette vidéo contient des données de position. Désactive la localisation de la caméra ou choisis une autre vidéo.', HttpStatus.BAD_REQUEST);
    }
    if (info.durationMs <= 0 || info.durationMs > maxSeconds * 1000 + 500) {
      throw new AppError('REEL_TOO_LONG', `Un Reel dure ${maxSeconds} secondes au plus.`, HttpStatus.BAD_REQUEST, { maxSeconds, durationMs: info.durationMs });
    }
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    const key = `reels/${userId}/${id}.mp4`;
    await this.storage.put(key, scrubMp4Metadata(file.buffer), 'video/mp4');
    try {
      await this.db.transaction(async (tx) => {
        await lockUserQuota(tx, 'reels', userId);
        await this.checkDaily(tx, userId, daily);
        await tx.insert(reels).values({
          id,
          userId,
          storageKey: key,
          caption: dto.caption?.trim() || null,
          visibility: dto.visibility ?? 'public',
          durationMs: info.durationMs,
          width: info.width,
          height: info.height,
          sizeBytes: file.size,
          createdAt: now,
        });
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.reel_created', targetType: 'reel', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { durationMs: info.durationMs, sizeBytes: file.size } }, tx);
      });
    } catch (e) {
      await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    return this.detail(userId, id, apiBase);
  }

  private select() {
    return this.db
      .select({ reel: reels, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(reels)
      .innerJoin(users, eq(users.id, reels.userId));
  }

  async visible(viewerId: string, reelId: string): Promise<{ reel: Reel; author: Author }> {
    const [r] = await this.select().where(and(eq(reels.id, reelId), reelVisibleTo(viewerId)));
    if (!r) throw Errors.notFound('Reel');
    return r;
  }

  private async views(viewerId: string, rows: Array<{ reel: Reel; author: Author }>, apiBase: string) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.reel.id);
    const authorIds = [...new Set(rows.map((r) => r.author.id))];
    const [liked, premium] = await Promise.all([
      this.db.select({ id: reelLikes.reelId }).from(reelLikes).where(and(eq(reelLikes.userId, viewerId), inArray(reelLikes.reelId, ids))),
      this.wallet.premiumUsers(authorIds),
    ]);
    const likedSet = new Set(liked.map((l) => l.id));
    const out = [];
    for (const { reel: r, author } of rows) {
      const video = await this.storage.temporaryUrl(r.storageKey, apiBase);
      const avatar = author.avatarKey ? (await this.storage.temporaryUrl(author.avatarKey, apiBase)).url : null;
      out.push({
        id: r.id,
        caption: r.caption,
        visibility: r.visibility,
        createdAt: r.createdAt,
        author: { id: author.id, username: author.username, fullName: author.fullName, avatarUrl: avatar },
        video: { url: video.url, expiresAt: video.expiresAt, durationMs: r.durationMs, width: r.width, height: r.height },
        likeCount: r.likeCount,
        likedByMe: likedSet.has(r.id),
        viewCount: r.viewCount,
        coinCount: r.coinCount,
        canGift: this.wallet.demo && viewerId !== NO_VIEWER && author.id !== viewerId && premium.has(author.id),
        isMine: author.id === viewerId,
      });
    }
    return out;
  }

  /** Fil des Reels : publics et ceux des personnes suivies, du plus récent au plus ancien. */
  async feed(viewerId: string, cursor: string | undefined, apiBase: string) {
    if (!this.storage.available) return { items: [], nextCursor: null };
    const conds = [reelVisibleTo(viewerId)];
    if (cursor) conds.push(lt(reels.id, cursor));
    const rows = await this.select().where(and(...conds)).orderBy(desc(reels.id)).limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    return { items: await this.views(viewerId, page, apiBase), nextCursor: rows.length > PAGE ? page[page.length - 1].reel.id : null };
  }

  async detail(viewerId: string, reelId: string, apiBase: string) {
    const [v] = await this.views(viewerId, [await this.visible(viewerId, reelId)], apiBase);
    return v;
  }

  /**
   * Suppression par l'auteur, même masqué par la modération. Un Reel masqué ou signalé (signalement ouvert) disparaît
   * pour tout le monde mais la vidéo est gardée pour la modération ; sinon elle est effacée.
   */
  async remove(userId: string, reelId: string, meta: RequestMeta) {
    const [reel] = await this.db.select().from(reels).where(and(eq(reels.id, reelId), eq(reels.userId, userId), inArray(reels.status, ['published', 'hidden'])));
    if (!reel) throw Errors.notFound('Reel');
    const [open] = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM content_reports WHERE target_type = 'reel' AND target_id = ${reelId} AND status = 'open'`).then((r) => r.rows);
    const keepForModeration = reel.status === 'hidden' || (open?.n ?? 0) > 0;
    await this.db.update(reels).set({ status: 'deleted' }).where(eq(reels.id, reelId));
    if (!keepForModeration) await this.storage.remove(reel.storageKey).catch(() => undefined);
    await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.reel_deleted', targetType: 'reel', targetId: reelId, ip: meta.ip, userAgent: meta.userAgent, metadata: { keptForModeration: keepForModeration } });
  }

  async like(viewerId: string, reelId: string, on: boolean) {
    await this.visible(viewerId, reelId);
    await this.db.transaction(async (tx) => {
      if (on) {
        const ins = await tx.insert(reelLikes).values({ reelId, userId: viewerId }).onConflictDoNothing().returning({ id: reelLikes.reelId });
        if (ins.length) await tx.update(reels).set({ likeCount: sql`${reels.likeCount} + 1` }).where(eq(reels.id, reelId));
      } else {
        const del = await tx.delete(reelLikes).where(and(eq(reelLikes.reelId, reelId), eq(reelLikes.userId, viewerId))).returning({ id: reelLikes.reelId });
        if (del.length) await tx.update(reels).set({ likeCount: sql`greatest(${reels.likeCount} - 1, 0)` }).where(eq(reels.id, reelId));
      }
    });
    const [r] = await this.db.select({ likeCount: reels.likeCount }).from(reels).where(eq(reels.id, reelId));
    return { likeCount: r.likeCount, likedByMe: on };
  }

  /** Une vue par personne (jamais la sienne). */
  async view(viewerId: string, reelId: string) {
    const { reel } = await this.visible(viewerId, reelId);
    if (reel.userId !== viewerId) {
      const ins = await this.db.insert(reelViews).values({ reelId, userId: viewerId }).onConflictDoNothing().returning({ id: reelViews.reelId });
      if (ins.length) await this.db.update(reels).set({ viewCount: sql`${reels.viewCount} + 1` }).where(eq(reels.id, reelId));
    }
    const [r] = await this.db.select({ viewCount: reels.viewCount }).from(reels).where(eq(reels.id, reelId));
    return { viewCount: r.viewCount };
  }
}
