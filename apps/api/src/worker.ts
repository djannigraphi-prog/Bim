import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createServer } from 'node:http';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/config';
import { ReminderWorkerService } from './modules/notifications/reminder-worker.service';

/**
 * Service séparé des rappels (WORKER_MODE=standalone, option recommandée) : même code et même image que l'API,
 * sans accès public. Expose seulement un contrôle de santé local pour le conteneur (port WORKER_HEALTH_PORT) :
 * 200 si le worker tourne (état ok, disabled ou degraded), 503 s'il est arrêté (« down »).
 */
async function main(): Promise<void> {
  process.env.BIM_PROCESS = 'worker';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();
  const cfg = app.get<AppConfig>(APP_CONFIG);
  if (cfg.WORKER_MODE !== 'standalone') throw new Error('dist/worker.js demande WORKER_MODE=standalone');
  const worker = app.get(ReminderWorkerService);
  createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    worker
      .health()
      .then((h) => res.writeHead(h.status === 'down' ? 503 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(h)))
      .catch(() => res.writeHead(503).end());
  }).listen(cfg.WORKER_HEALTH_PORT);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
