import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AccountPurgeService, PurgeResult } from './account-purge.service';
import { StoriesService } from '../social/stories.service';
import { PeniRetentionResult, PeniRetentionService } from './peni-retention.service';

/** Heure du passage quotidien, à l'heure d'Abidjan (UTC) : la nuit, charge négligeable. */
export const PURGE_HOUR_UTC = 3;

/**
 * Lance les tâches de maintenance une fois par jour (purge des comptes, conservation des discussions avec Peni), dans
 * le même processus que le worker des rappels (WORKER_MODE) : rien ne tourne avec WORKER_MODE=off (valeur par défaut).
 * Même lancées, la purge ne fait rien tant que son réglage est désactivé (et reste en simulation sans validation), et
 * la conservation des discussions ne supprime rien tant que sa durée n'est pas validée.
 */
@Injectable()
export class MaintenanceRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly purge: AccountPurgeService,
    private readonly peniRetention: PeniRetentionService,
    private readonly stories: StoriesService,
  ) {}

  get active(): boolean {
    return this.cfg.WORKER_MODE === 'embedded' || (this.cfg.WORKER_MODE === 'standalone' && process.env.BIM_PROCESS === 'worker');
  }

  onApplicationBootstrap() {
    if (!this.active) return;
    this.timer = setInterval(() => void this.runIfDue(), 10 * 60_000);
  }

  /**
   * Appelée toutes les 10 minutes ; chaque tâche garantit elle-même un seul passage par jour (verrou + journal).
   * Une tâche en erreur n'empêche pas l'autre.
   */
  async runIfDue(now: Date = new Date()): Promise<{ purge: PurgeResult | null; peniRetention: PeniRetentionResult | null; stories: { deleted: number } | null } | null> {
    if (this.running || now.getUTCHours() !== PURGE_HOUR_UTC) return null;
    this.running = true;
    try {
      const purge = await this.purge.runScheduled().catch((e: Error) => {
        this.logger.error({ msg: 'maintenance.account_purge.error', error: e.message });
        return null;
      });
      const peniRetention = await this.peniRetention.runScheduled().catch((e: Error) => {
        this.logger.error({ msg: 'maintenance.peni_retention.error', error: e.message });
        return null;
      });
      // Stories (lot 4-B) : elles durent 24 h ; leurs fichiers sont effacés 24 h après l'expiration (sauf signalement ouvert).
      const stories = await this.stories.cleanupExpired(now).catch((e: Error) => {
        this.logger.error({ msg: 'maintenance.stories.error', error: e.message });
        return null;
      });
      return { purge, peniRetention, stories };
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
