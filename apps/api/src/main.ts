import 'reflect-metadata';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApi, createApp } from './bootstrap';
import { APP_CONFIG, AppConfig } from './config/config';

async function main(): Promise<void> {
  const app = await createApp();
  const cfg = app.get<AppConfig>(APP_CONFIG);
  // Documentation interactive : uniquement hors production.
  if (cfg.NODE_ENV !== 'production') SwaggerModule.setup('docs', app, buildOpenApi(app));
  await app.listen(cfg.PORT);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
