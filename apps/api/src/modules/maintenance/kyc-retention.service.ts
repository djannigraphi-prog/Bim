import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { auditLogs, maintenanceRuns } from '../../database/schema';
import { StorageService } from '../media/storage';
import { SettingsService } from '../settings/settings.service';

export const KYC_RETENTION_JOB = 'kyc_retention';
/** Garde-fou : jamais moins de 30 jours après la fermeture du compte. */
export const KYC_RETENTION_MIN_DAYS = 30;
const BATCH = 200;

/**
 * Décision du 17/10/2026 (18 h 50) — Pièces d'identité et selfies (demandes de boutique, comptes livreurs) : conservés
 * **tant que le compte existe**, puis supprimés `kyc.document_retention_days` jours (365, décidé) **après la fermeture
 * du compte** (`users.deleted_at`) : fichier chiffré effacé du stockage, puis la ligne. Passage quotidien, un seul
 * serveur à la fois ; journal sans donnée personnelle (nombres seulement).
 */
@Injectable()
export class KycRetentionService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  async config() {
    const s = await this.settings.get<number | null>('kyc.document_retention_days');
    const days = Number.isInteger(s?.value) ? (s!.value as number) : null;
    const decided = s?.decisionStatus === 'decided';
    return { retentionDays: days, decided, active: decided && days !== null && days >= KYC_RETENTION_MIN_DAYS };
  }

  private expired(days: number) {
    return sql`
      SELECT d.id, d.storage_key AS key, 'merchant' AS source FROM merchant_documents d
        JOIN merchant_applications a ON a.id = d.application_id JOIN users u ON u.id = a.user_id
        WHERE u.deleted_at IS NOT NULL AND u.deleted_at < now() - make_interval(days => ${days}::int)
      UNION ALL
      SELECT d.id, d.storage_key AS key, 'courier' AS source FROM courier_documents d
        JOIN courier_accounts c ON c.id = d.courier_id JOIN users u ON u.id = c.user_id
        WHERE u.deleted_at IS NOT NULL AND u.deleted_at < now() - make_interval(days => ${days}::int)
      LIMIT ${BATCH}`;
  }

  async runScheduled(): Promise<{ status: 'not_configured' | 'locked' | 'already_done' | 'ok'; deleted: number }> {
    const cfg = await this.config();
    if (!cfg.active) return { status: 'not_configured', deleted: 0 };
    const startedAt = new Date();
    // Verrou de transaction (audit du 18/10/2026) : un verrou de session pris sur une connexion du pool pouvait ne
    // jamais être rendu (déverrouillage sur une autre connexion), bloquant toutes les suppressions suivantes.
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('bim:maintenance:kyc_retention')) AS ok`);
      if (!lock.rows[0]?.ok) return { status: 'locked' as const, deleted: 0 };
      const done = await tx.execute(sql`SELECT 1 FROM maintenance_runs WHERE job = ${KYC_RETENTION_JOB} AND trigger = 'schedule' AND started_at > now() - interval '20 hours' LIMIT 1`);
      if (done.rows.length) return { status: 'already_done' as const, deleted: 0 };
      let deleted = 0;
      for (let i = 0; i < 50; i++) {
        const rows = (await tx.execute<{ id: string; key: string; source: 'merchant' | 'courier' }>(this.expired(cfg.retentionDays!))).rows;
        if (!rows.length) break;
        for (const r of rows) {
          // Le fichier d'abord : une ligne sans fichier serait relancée au passage suivant, jamais l'inverse.
          await this.storage.remove(r.key);
          await tx.execute(r.source === 'merchant' ? sql`DELETE FROM merchant_documents WHERE id = ${r.id}` : sql`DELETE FROM courier_documents WHERE id = ${r.id}`);
          deleted++;
        }
        if (rows.length < BATCH) break;
      }
      const runId = uuidv7();
      await tx.insert(maintenanceRuns).values({ id: runId, job: KYC_RETENTION_JOB, mode: 'real', status: 'ok', trigger: 'schedule', candidates: deleted, deleted, details: { retentionDays: cfg.retentionDays }, startedAt, finishedAt: new Date() });
      await tx.insert(auditLogs).values({ id: uuidv7(), actorType: 'system', action: 'maintenance.kyc_retention', targetType: 'maintenance_run', targetId: runId, metadata: { retentionDays: cfg.retentionDays, deleted } });
      this.logger.log({ msg: 'maintenance.kyc_retention', deleted, retentionDays: cfg.retentionDays });
      return { status: 'ok' as const, deleted };
    });
  }
}
