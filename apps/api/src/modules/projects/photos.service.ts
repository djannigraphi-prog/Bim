/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { projectPhotos, projects } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { today } from './plan';
import { userTimezone } from './timezone';

/**
 * Photos « avant » et « après » (écrans 22 et 31) : privées, visibles seulement par la personne.
 * Chaque image est ré-encodée en JPEG (orientation corrigée, 1600 px max) : les métadonnées, dont la position GPS,
 * sont supprimées. Une nouvelle photo du même type remplace l'ancienne, qui est effacée du stockage.
 */
@Injectable()
export class ProjectPhotosService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async owned(userId: string, projectId: string) {
    const [p] = await this.db.select({ id: projects.id, status: projects.status }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!p || p.status === 'abandoned') throw Errors.notFound('Projet');
    return p;
  }

  async upload(userId: string, projectId: string, kind: string, file: Express.Multer.File | undefined, meta: RequestMeta, apiBase: string) {
    if (kind !== 'before' && kind !== 'after') throw Errors.validation({ fields: { kind: ['« before » ou « after ».'] } });
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    await this.owned(userId, projectId);
    const out = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');

    const id = uuidv7();
    const key = `projects/${projectId}/${id}.jpg`;
    await this.storage.put(key, out.data, 'image/jpeg');
    const previous = await this.db
      .select({ id: projectPhotos.id, key: projectPhotos.storageKey })
      .from(projectPhotos)
      .where(and(eq(projectPhotos.projectId, projectId), eq(projectPhotos.kind, kind), isNull(projectPhotos.deletedAt)));
    await this.db.transaction(async (tx) => {
      await tx.insert(projectPhotos).values({ id, projectId, userId, kind, storageKey: key, width: out.width, height: out.height, bytes: out.bytes, takenDay: today(new Date(), await userTimezone(this.db, userId)) });
      for (const p of previous) await tx.update(projectPhotos).set({ deletedAt: new Date() }).where(eq(projectPhotos.id, p.id));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'project.photo_added', targetType: 'project', targetId: projectId, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind } }, tx);
    });
    for (const p of previous) await this.storage.remove(p.key);
    return this.list(userId, projectId, apiBase);
  }

  async list(userId: string, projectId: string, apiBase: string) {
    await this.owned(userId, projectId);
    if (!this.storage.available) return { available: false, items: [] };
    const rows = await this.db
      .select()
      .from(projectPhotos)
      .where(and(eq(projectPhotos.projectId, projectId), isNull(projectPhotos.deletedAt)))
      .orderBy(desc(projectPhotos.createdAt));
    const items = [];
    for (const r of rows) {
      const link = await this.storage.temporaryUrl(r.storageKey, apiBase);
      items.push({ id: r.id, kind: r.kind, takenDay: r.takenDay, width: r.width, height: r.height, ...link });
    }
    return { available: true, items };
  }

  async remove(userId: string, projectId: string, photoId: string, meta: RequestMeta) {
    await this.owned(userId, projectId);
    const [p] = await this.db
      .select()
      .from(projectPhotos)
      .where(and(eq(projectPhotos.id, photoId), eq(projectPhotos.projectId, projectId), isNull(projectPhotos.deletedAt)));
    if (!p) throw Errors.notFound('Photo');
    await this.db.update(projectPhotos).set({ deletedAt: new Date() }).where(eq(projectPhotos.id, photoId));
    await this.storage.remove(p.storageKey);
    await this.audit.log({ actorType: 'user', actorId: userId, action: 'project.photo_deleted', targetType: 'project', targetId: projectId, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind: p.kind } });
  }

  /** Projet supprimé : ses photos sont effacées du stockage (données sensibles, conservation limitée). */
  async purgeProject(projectId: string) {
    const rows = await this.db.select().from(projectPhotos).where(and(eq(projectPhotos.projectId, projectId), isNull(projectPhotos.deletedAt)));
    for (const r of rows) {
      await this.db.update(projectPhotos).set({ deletedAt: new Date() }).where(eq(projectPhotos.id, r.id));
      await this.storage.remove(r.storageKey);
    }
  }
}
