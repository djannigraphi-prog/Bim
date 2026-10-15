/// <reference types="multer" />
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { projectReports, projects, projectTasks } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { encodePrivateImage, PrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { SendReportDto } from './dto';
import { isValidDay, today } from './plan';
import { CLOCK, Clock } from './projects.service';
import { userTimezone } from './timezone';

export const PROJECT_REASONS = ['unavailable', 'too_hard', 'health', 'content', 'other'] as const;
export const GENERAL_REASONS = ['app', 'product', 'health', 'other'] as const;
/** Au-delà, l'envoi est refusé pour 24 h (protection du support et du stockage). */
export const MAX_REPORTS_PER_DAY = 20;

/**
 * Signalements (écrans 21 et 27) : un seul système pour un problème lié à un projet ou un problème général
 * (« Résoudre un problème »), avec une image facultative. Traités par le support dans l'administration.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async send(userId: string, dto: SendReportDto, file: Express.Multer.File | undefined, meta: RequestMeta) {
    const message = dto.message?.trim() || null;
    const context = dto.projectId ? 'project' : 'general';
    let day: string | null = null;

    if (context === 'project') {
      if (!(PROJECT_REASONS as readonly string[]).includes(dto.reason)) throw Errors.validation({ fields: { reason: ['Motif non prévu pour un projet.'] } });
      if (!dto.day || !isValidDay(dto.day)) throw Errors.validation({ fields: { day: ['Date invalide.'] } });
      const [p] = await this.db
        .select({ id: projects.id, status: projects.status, startDate: projects.startDate, plannedEndDate: projects.plannedEndDate })
        .from(projects)
        .where(and(eq(projects.id, dto.projectId!), eq(projects.userId, userId)));
      if (!p || p.status === 'abandoned') throw Errors.notFound('Projet');
      if (dto.day < p.startDate || dto.day > p.plannedEndDate || dto.day > today(this.clock.now(), await userTimezone(this.db, userId))) {
        throw Errors.validation({ fields: { day: ['Ce jour ne fait pas partie du programme ou n’est pas encore arrivé.'] } });
      }
      if (dto.taskId) {
        const [t] = await this.db.select({ id: projectTasks.id }).from(projectTasks).where(and(eq(projectTasks.id, dto.taskId), eq(projectTasks.projectId, p.id)));
        if (!t) throw Errors.notFound('Tâche');
      }
      day = dto.day;
    } else {
      if (!(GENERAL_REASONS as readonly string[]).includes(dto.reason)) throw Errors.validation({ fields: { reason: ['Motif non prévu.'] } });
      if (dto.taskId || dto.day) throw Errors.validation({ fields: { projectId: ['Une tâche ou un jour se signalent depuis le projet.'] } });
      if (!message || message.length < 10) throw Errors.validation({ fields: { message: ['Décris ton problème en quelques mots (10 caractères au moins).'] } });
    }

    const since = new Date(this.clock.now().getTime() - 24 * 3600 * 1000);
    const [{ n }] = await this.db.select({ n: count() }).from(projectReports).where(and(eq(projectReports.userId, userId), gte(projectReports.createdAt, since)));
    if (n >= MAX_REPORTS_PER_DAY) throw Errors.tooMany('Tu as envoyé beaucoup de signalements aujourd’hui. Réessaie demain, l’équipe traite ceux déjà reçus.');

    // Image facultative : contrôlée et ré-encodée AVANT tout enregistrement ; en cas d'erreur, rien n'est créé.
    let image: PrivateImage | null = null;
    if (file) {
      if (!this.storage.available) throw Errors.notConfigured('L’envoi d’images');
      image = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'image');
    }
    const id = uuidv7();
    const key = image ? `reports/${userId}/${id}.jpg` : null;
    if (image && key) {
      try {
        await this.storage.put(key, image.data, 'image/jpeg');
      } catch (e) {
        this.logger.error(`Envoi de l'image du signalement impossible : ${(e as Error).message}`);
        throw Errors.notConfigured('L’envoi d’images');
      }
    }
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(projectReports).values({
          id,
          context,
          projectId: dto.projectId ?? null,
          userId,
          day,
          taskId: dto.taskId ?? null,
          reason: dto.reason,
          message,
          attachmentKey: key,
          attachmentWidth: image?.width ?? null,
          attachmentHeight: image?.height ?? null,
          attachmentBytes: image?.bytes ?? null,
        });
        await this.audit.log(
          {
            actorType: 'user',
            actorId: userId,
            action: 'report.sent',
            targetType: context === 'project' ? 'project' : 'report',
            targetId: dto.projectId ?? id,
            ip: meta.ip,
            userAgent: meta.userAgent,
            metadata: { reason: dto.reason, context, image: !!image },
          },
          tx,
        );
      });
    } catch (e) {
      // Le signalement n'a pas été enregistré : l'image envoyée ne doit pas rester orpheline.
      if (key) await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    return {
      id,
      status: 'open',
      // Douleur ou malaise : BIM ne donne pas d'avis médical, la personne est orientée vers un professionnel.
      healthAdvice: dto.reason === 'health',
    };
  }

  /** Mes signalements (tous, ou ceux d'un projet), avec la réponse du support et un lien temporaire vers l'image. */
  async mine(userId: string, apiBase: string, projectId?: string) {
    if (projectId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) throw Errors.validation({ fields: { projectId: ['Identifiant invalide.'] } });
      const [p] = await this.db.select({ id: projects.id, status: projects.status }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
      if (!p || p.status === 'abandoned') throw Errors.notFound('Projet');
    }
    const rows = await this.db
      .select({ r: projectReports, projectTitle: projects.title })
      .from(projectReports)
      .leftJoin(projects, eq(projects.id, projectReports.projectId))
      .where(projectId ? and(eq(projectReports.userId, userId), eq(projectReports.projectId, projectId)) : eq(projectReports.userId, userId))
      .orderBy(desc(projectReports.createdAt))
      .limit(100);
    const items = [];
    for (const { r, projectTitle } of rows) items.push(await this.view(r, apiBase, projectTitle));
    return { items };
  }

  async view(r: typeof projectReports.$inferSelect, apiBase: string, projectTitle: string | null = null) {
    return {
      id: r.id,
      context: r.context,
      projectId: r.projectId,
      projectTitle,
      day: r.day,
      taskId: r.taskId,
      reason: r.reason,
      message: r.message,
      image: r.attachmentKey && this.storage.available ? { ...(await this.storage.temporaryUrl(r.attachmentKey, apiBase)), width: r.attachmentWidth, height: r.attachmentHeight } : null,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    };
  }
}
