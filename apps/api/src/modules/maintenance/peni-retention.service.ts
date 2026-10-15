import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { auditLogs, maintenanceRuns } from '../../database/schema';
import { SettingsService } from '../settings/settings.service';

export const PENI_RETENTION_JOB = 'peni_retention';
/** Garde-fou : une durée plus courte est refusée (une erreur de saisie ne peut pas tout effacer). */
export const PENI_RETENTION_MIN_DAYS = 7;
/** Suppression par lots, pour ne jamais bloquer la base longtemps. */
export const PENI_RETENTION_BATCH = 1000;
const MAX_BATCHES_PER_RUN = 50;

export interface PeniRetentionConfig {
  /** Durée réglée (jours depuis la dernière activité de la discussion), ou null. */
  retentionDays: number | null;
  decided: boolean;
  /** Suppression active : durée valide (≥ 7 jours) ET réglage validé par le fondateur (« decided »). */
  active: boolean;
}

export interface PeniRetentionResult {
  status: 'not_configured' | 'locked' | 'already_done' | 'ok';
  deleted: number;
  runId: string | null;
}

/**
 * Conservation des discussions avec Peni (lot 3) : une discussion sans activité depuis la durée réglée est supprimée,
 * avec ses messages (cascade). **Aucune durée n'est fixée** : le réglage `peni.conversation_retention_days` vaut null
 * (« pending ») tant que le fondateur ne l'a pas validé ; d'ici là, rien n'est supprimé.
 */
@Injectable()
export class PeniRetentionService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  async config(): Promise<PeniRetentionConfig> {
    const s = await this.settings.get<number | null>('peni.conversation_retention_days');
    const days = Number.isInteger(s?.value) ? (s!.value as number) : null;
    const decided = s?.decisionStatus === 'decided';
    return { retentionDays: days, decided, active: decided && days !== null && days >= PENI_RETENTION_MIN_DAYS };
  }

  /** Nombre de discussions qui seraient supprimées avec la durée réglée (même non validée), heure de la base. */
  async expiredCount(): Promise<number | null> {
    const { retentionDays } = await this.config();
    if (retentionDays === null || retentionDays < PENI_RETENTION_MIN_DAYS) return null;
    const r = await this.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM peni_conversations WHERE updated_at < now() - make_interval(days => ${retentionDays}::int)`,
    );
    return r.rows[0].n;
  }

  /** Passage quotidien : au plus un par jour, un seul serveur à la fois. */
  async runScheduled(): Promise<PeniRetentionResult> {
    const cfg = await this.config();
    if (!cfg.active) return { status: 'not_configured', deleted: 0, runId: null };
    const startedAt = new Date();
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('bim:maintenance:peni_retention')) AS ok`);
      if (!lock.rows[0]?.ok) return { status: 'locked', deleted: 0, runId: null } satisfies PeniRetentionResult;
      const done = await tx.execute(sql`SELECT 1 FROM maintenance_runs WHERE job = ${PENI_RETENTION_JOB} AND trigger = 'schedule' AND started_at > now() - interval '20 hours' LIMIT 1`);
      if (done.rows.length) return { status: 'already_done', deleted: 0, runId: null } satisfies PeniRetentionResult;
      let deleted = 0;
      for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
        const r = await tx.execute<{ id: string }>(sql`
          DELETE FROM peni_conversations WHERE id IN (
            SELECT id FROM peni_conversations WHERE updated_at < now() - make_interval(days => ${cfg.retentionDays}::int)
            ORDER BY updated_at LIMIT ${PENI_RETENTION_BATCH}
          ) RETURNING id`);
        deleted += r.rows.length;
        if (r.rows.length < PENI_RETENTION_BATCH) break;
      }
      const runId = uuidv7();
      await tx.insert(maintenanceRuns).values({
        id: runId,
        job: PENI_RETENTION_JOB,
        mode: 'real',
        status: 'ok',
        trigger: 'schedule',
        candidates: deleted,
        deleted,
        details: { retentionDays: cfg.retentionDays },
        startedAt,
        finishedAt: new Date(),
      });
      // Journal d'audit : nombre seulement, aucun contenu ni identifiant de personne.
      await tx.insert(auditLogs).values({
        id: uuidv7(),
        actorType: 'system',
        action: 'maintenance.peni_retention',
        targetType: 'maintenance_run',
        targetId: runId,
        metadata: { retentionDays: cfg.retentionDays, deleted },
      });
      this.logger.log({ msg: 'maintenance.peni_retention', deleted, retentionDays: cfg.retentionDays });
      return { status: 'ok', deleted, runId } satisfies PeniRetentionResult;
    });
  }

  async overview() {
    const [cfg, expired, runs] = await Promise.all([
      this.config(),
      this.expiredCount(),
      this.db.select().from(maintenanceRuns).where(eq(maintenanceRuns.job, PENI_RETENTION_JOB)).orderBy(desc(maintenanceRuns.startedAt)).limit(10),
    ]);
    return {
      ...cfg,
      minDays: PENI_RETENTION_MIN_DAYS,
      expired,
      runs: runs.map((r) => ({ id: r.id, status: r.status, deleted: r.deleted, startedAt: r.startedAt })),
    };
  }
}
