import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AccountPurgeService } from './account-purge.service';

/** Heure du passage quotidien, à l'heure d'Abidjan (UTC) : la nuit, charge négligeable. */
export const PURGE_HOUR_UTC = 3;

/**
 * Lance la purge une fois par jour, dans le même processus que le worker des rappels (WORKER_MODE) : rien ne tourne
 * avec WORKER_MODE=off (valeur par défaut). Même lancée, la purge ne fait rien tant que son réglage est désactivé,
 * et reste en simulation tant que le fondateur n'a pas validé la suppression réelle.
 */
@Injectable()
export class MaintenanceRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly purge: AccountPurgeService,
  ) {}

  get active(): boolean {
    return this.cfg.WORKER_MODE === 'embedded' || (this.cfg.WORKER_MODE === 'standalone' && process.env.BIM_PROCESS === 'worker');
  }

  onApplicationBootstrap() {
    if (!this.active) return;
    this.timer = setInterval(() => void this.runIfDue(), 10 * 60_000);
  }

  /** Appelée toutes les 10 minutes ; la purge elle-même garantit un seul passage par jour (verrou + journal). */
  async runIfDue(now: Date = new Date()) {
    if (this.running || now.getUTCHours() !== PURGE_HOUR_UTC) return null;
    this.running = true;
    try {
      return await this.purge.runScheduled();
    } catch (e) {
      this.logger.error({ msg: 'maintenance.account_purge.error', error: (e as Error).message });
      return null;
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
