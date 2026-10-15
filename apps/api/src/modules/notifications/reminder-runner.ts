import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { ReminderWorkerService } from './reminder-worker.service';

/**
 * Lance le worker des rappels chaque minute, sans chevauchement :
 * - WORKER_MODE=embedded : dans le processus de l'API (tests, bêta fermée) ;
 * - WORKER_MODE=standalone : seulement dans le processus `dist/worker.js` (service séparé recommandé).
 * Chaque tour publie une ligne de journal « reminders.metrics » (base des alertes CloudWatch).
 */
@Injectable()
export class ReminderRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Rappels');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly worker: ReminderWorkerService,
  ) {}

  get active(): boolean {
    return this.cfg.WORKER_MODE === 'embedded' || (this.cfg.WORKER_MODE === 'standalone' && process.env.BIM_PROCESS === 'worker');
  }

  onApplicationBootstrap() {
    if (!this.active) return;
    this.logger.log(`Worker des rappels démarré (${this.cfg.WORKER_MODE}, envoi : ${this.cfg.PUSH_PROVIDER}, ${this.worker.workerId})`);
    this.timer = setInterval(() => void this.runOnce(), 60_000);
    void this.runOnce();
  }

  async runOnce(now: Date = new Date()) {
    if (this.running) return; // un tour encore en cours : on ne le double pas
    this.running = true;
    try {
      const r = await this.worker.tick(now);
      const h = await this.worker.health(now);
      this.logger.log({ msg: 'reminders.metrics', ...r, status: h.status, overdue: h.overdue, ...h.lastHour });
    } catch (e) {
      this.logger.error({ msg: 'reminders.error', error: (e as Error).message });
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
