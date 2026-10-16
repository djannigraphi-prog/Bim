/// <reference types="multer" />
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { stories, storyViews, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { CLOCK, Clock } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { notBlockedBetween } from './access';
import { PostsService } from './posts.service';

/** Durée de vie d'une story. */
export const STORY_HOURS = 24;
/** Les fichiers d'une story expirée sont gardés encore 24 h (signalement tardif), puis effacés par la maintenance. */
export const STORY_FILE_GRACE_HOURS = 24;

/**
 * Stories (lot 4-B, écran 10) : une photo visible 24 heures par la personne et par ses abonnés. Blocages, comptes
 * inactifs et modération appliqués comme pour les publications. « Vue » enregistrée seulement pour l'anneau du fil.
 */
@Injectable()
export class StoriesService {
  private readonly logger = new Logger('Stories');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly posts: PostsService,
    private readonly audit: AuditService,
  ) {}

  /** Story visible par `viewerId` : la sienne, ou celle d'une personne qu'il suit ; publiée, non expirée, sans blocage. */
  private visibleTo(viewerId: string) {
    return sql`(${stories.status} = 'published' AND ${stories.expiresAt} > ${this.clock.now()} AND ${users.status} = 'active' AND (
        ${stories.userId} = ${viewerId}
        OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = ${stories.userId})
      ) AND ${notBlockedBetween(viewerId, stories.userId)})`;
  }

  async create(userId: string, file: Express.Multer.File | undefined, meta: RequestMeta) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const s = await this.settings.get<number>('social.stories_daily_limit');
    const max = typeof s?.value === 'number' && s.value > 0 ? s.value : 20;
    const since = new Date(this.clock.now().getTime() - 24 * 3600_000);
    const checkLimit = async (db: Pick<Database, 'select'>) => {
      const [{ n }] = await db.select({ n: count() }).from(stories).where(and(eq(stories.userId, userId), gt(stories.createdAt, since)));
      if (n >= max) throw Errors.tooMany('Tu as déjà publié beaucoup de stories aujourd’hui 😊 Réessaie demain.', { reason: 'SOCIAL_STORIES_DAILY_LIMIT', limit: max });
    };
    await checkLimit(this.db);
    const img = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    const key = `stories/${userId}/${id}.jpg`;
    await this.storage.put(key, img.data, 'image/jpeg');
    try {
      await this.db.transaction(async (tx) => {
        // Recompte sous verrou (audit, défaut 1) ; en cas de refus, le fichier déjà stocké est effacé plus bas.
        await lockUserQuota(tx, 'stories', userId);
        await checkLimit(tx);
        await tx.insert(stories).values({ id, userId, storageKey: key, width: img.width, height: img.height, bytes: img.bytes, createdAt: now, expiresAt: new Date(now.getTime() + STORY_HOURS * 3600_000) });
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.story_created', targetType: 'story', targetId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
      });
    } catch (e) {
      await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    return { id, expiresAt: new Date(now.getTime() + STORY_HOURS * 3600_000) };
  }

  /** Bandeau des stories (écran 10) : les miennes d'abord, puis les personnes suivies, non vues d'abord. */
  async tray(viewerId: string, apiBase: string) {
    const rows = await this.db
      .select({ s: stories, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(stories)
      .innerJoin(users, eq(users.id, stories.userId))
      .where(this.visibleTo(viewerId))
      .orderBy(stories.createdAt);
    const seen = rows.length
      ? new Set(
          (await this.db.select({ id: storyViews.storyId }).from(storyViews).where(and(eq(storyViews.userId, viewerId), inArray(storyViews.storyId, rows.map((r) => r.s.id))))).map(
            (v) => v.id,
          ),
        )
      : new Set<string>();
    const groups = new Map<string, { author: { id: string; username: string; fullName: string; avatarUrl: string | null }; items: unknown[]; allSeen: boolean; latest: Date }>();
    for (const r of rows) {
      let g = groups.get(r.author.id);
      if (!g) {
        g = { author: { id: r.author.id, username: r.author.username, fullName: r.author.fullName, avatarUrl: await this.posts.avatarUrl(r.author.avatarKey, apiBase) }, items: [], allSeen: true, latest: r.s.createdAt };
        groups.set(r.author.id, g);
      }
      const isSeen = r.author.id === viewerId || seen.has(r.s.id);
      g.allSeen &&= isSeen;
      g.latest = r.s.createdAt;
      const link = await this.storage.temporaryUrl(r.s.storageKey, apiBase);
      g.items.push({ id: r.s.id, url: link.url, width: r.s.width, height: r.s.height, createdAt: r.s.createdAt, expiresAt: r.s.expiresAt, seen: isSeen });
    }
    const list = [...groups.values()];
    const mine = list.filter((g) => g.author.id === viewerId);
    const others = list.filter((g) => g.author.id !== viewerId).sort((a, b) => Number(a.allSeen) - Number(b.allSeen) || b.latest.getTime() - a.latest.getTime());
    return { mine: mine[0] ?? null, items: others.map(({ latest: _l, ...g }) => g) };
  }

  async markSeen(viewerId: string, storyId: string) {
    const [r] = await this.db.select({ id: stories.id }).from(stories).innerJoin(users, eq(users.id, stories.userId)).where(and(eq(stories.id, storyId), this.visibleTo(viewerId)));
    if (!r) throw Errors.notFound('Story');
    await this.db.insert(storyViews).values({ storyId, userId: viewerId }).onConflictDoNothing();
  }

  async remove(userId: string, storyId: string, meta: RequestMeta) {
    const [s] = await this.db.select().from(stories).where(and(eq(stories.id, storyId), eq(stories.userId, userId)));
    if (!s || s.status === 'deleted') throw Errors.notFound('Story');
    await this.db.transaction(async (tx) => {
      await tx.update(stories).set({ status: 'deleted' }).where(eq(stories.id, storyId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.story_deleted', targetType: 'story', targetId: storyId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    await this.storage.remove(s.storageKey).catch(() => undefined);
  }

  /** Story visible par `viewerId` (pour un signalement), sinon « introuvable ». */
  async visibleStory(viewerId: string, storyId: string) {
    const [r] = await this.db.select({ userId: stories.userId }).from(stories).innerJoin(users, eq(users.id, stories.userId)).where(and(eq(stories.id, storyId), this.visibleTo(viewerId)));
    if (!r) throw Errors.notFound('Story');
    return r;
  }

  /**
   * Maintenance quotidienne : efface les fichiers et les lignes des stories expirées depuis plus de 24 h, sauf celles
   * qui ont un signalement encore ouvert (la modération doit pouvoir les voir). Les stories supprimées par leur auteur
   * n'ont déjà plus de fichier.
   */
  async cleanupExpired(now: Date = this.clock.now()): Promise<{ deleted: number }> {
    const limit = new Date(now.getTime() - STORY_FILE_GRACE_HOURS * 3600_000);
    let deleted = 0;
    for (let i = 0; i < 50; i++) {
      const batch = await this.db
        .select({ id: stories.id, key: stories.storageKey, status: stories.status })
        .from(stories)
        .where(and(lt(stories.expiresAt, limit), sql`NOT EXISTS (SELECT 1 FROM content_reports r WHERE r.target_type = 'story' AND r.target_id = ${stories.id} AND r.status = 'open')`))
        .limit(500);
      if (!batch.length) break;
      for (const s of batch) if (s.status !== 'deleted') await this.storage.remove(s.key).catch(() => undefined);
      await this.db.delete(stories).where(inArray(stories.id, batch.map((s) => s.id)));
      deleted += batch.length;
    }
    if (deleted) this.logger.log({ msg: 'stories.cleanup', deleted });
    return { deleted };
  }
}
