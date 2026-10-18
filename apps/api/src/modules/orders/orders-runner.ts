import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { OrdersService } from './orders.service';
import { DeliveriesService } from './deliveries.service';
import { IncidentsService } from './incidents.service';
import { OnlinePaymentsService } from './online/online-payments.service';
import { PaymentsService } from './payments.service';

/**
 * Expiration des propositions et des commandes non confirmées, chaque minute, dans le processus du worker
 * (WORKER_MODE). Les lectures et les actions expirent aussi elles-mêmes une commande échue : rien ne dépend du worker
 * pour la justesse, seulement pour la ponctualité.
 */
@Injectable()
export class OrdersRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Commandes');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly deliveries: DeliveriesService,
    private readonly online: OnlinePaymentsService,
    private readonly incidents: IncidentsService,
  ) {}
  private lastPhotoPurge = 0;

  get active(): boolean {
    return this.cfg.WORKER_MODE === 'embedded' || (this.cfg.WORKER_MODE === 'standalone' && process.env.BIM_PROCESS === 'worker');
  }

  onApplicationBootstrap() {
    if (this.active) this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return 0;
    this.running = true;
    try {
      const expired = await this.orders.expireDue(now);
      await this.payments.queueOverdue(now);
      await this.deliveries.expireOffers(now);
      await this.online.expirePending(now);
      // Photos des problèmes : supprimées 30 jours après la clôture (une fois par heure suffit).
      if (now.getTime() - this.lastPhotoPurge >= 3_600_000) {
        this.lastPhotoPurge = now.getTime();
        await this.incidents.purgePhotos(now);
      }
      return expired;
    } catch (e) {
      this.logger.error(`Expiration des commandes : ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
