import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { appValidationPipe } from './common/validation.pipe';
import { APP_CONFIG, AppConfig } from './config/config';

/** Configuration commune à l'exécution réelle et aux tests e2e (mêmes filtres, mêmes protections). */
export function configureApp(app: INestApplication): void {
  const cfg = app.get<AppConfig>(APP_CONFIG);
  const express = app.getHttpAdapter().getInstance() as Express;
  // Nombre de proxys de confiance (jamais « true ») : voir TRUST_PROXY dans docs/ENVIRONMENT.md.
  express.set('trust proxy', cfg.TRUST_PROXY);
  express.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({ origin: cfg.CORS_ORIGINS ? cfg.CORS_ORIGINS.split(',').map((o) => o.trim()) : false });
  app.useGlobalPipes(appValidationPipe);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('API BIM')
    .setDescription('API de l’application BIM (Beauté, Image, Motivation). Erreurs au format { error: { code, message, details } } — voir docs/API_ERRORS.md.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export async function createApp(): Promise<INestApplication> {
  // rawBody : la signature des notifications des prestataires de paiement se vérifie sur le corps reçu tel quel.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  return app;
}
