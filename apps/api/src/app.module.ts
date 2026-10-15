import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AdminModule } from './modules/admin/admin.module';
import { AgePolicyModule } from './modules/age-policy/age-policy.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { InterestsModule } from './modules/interests/interests.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PeniModule } from './modules/peni/peni.module';
import { SocialModule } from './modules/social/social.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SpacesModule } from './modules/spaces/spaces.module';

/**
 * Monolithe modulaire : un module par domaine. Les modules transverses (configuration, base, réglages, audit,
 * envoi des messages, politique d'âge, espaces) sont globaux ; les modules métier n'importent jamais un contrôleur d'un autre.
 * Les lots suivants ajouteront ici : reminders, peni, social, catalog, orders, deliveries, payments, wallet, live, messaging…
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        pinoHttp: {
          level: cfg.LOG_LEVEL,
          // Journaux structurés (JSON) ; jamais d'en-tête d'autorisation, de mot de passe ni de code dans les journaux.
          redact: {
            paths: ['req.headers.authorization', 'req.headers["x-step-up-token"]', 'req.headers.cookie', 'req.body.password', 'req.body.newPassword', 'req.body.code', 'req.body.refreshToken', 'req.body.loginToken', 'req.body.secret'],
            censor: '[masqué]',
          },
          transport: cfg.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          autoLogging: cfg.NODE_ENV !== 'test',
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        skipIf: () => !cfg.HTTP_THROTTLE_ENABLED,
      }),
    }),
    DatabaseModule,
    SettingsModule,
    AuditModule,
    DeliveryModule,
    AgePolicyModule,
    SpacesModule,
    HealthModule,
    InterestsModule,
    AuthModule,
    MediaModule,
    ProjectsModule,
    NotificationsModule,
    MaintenanceModule,
    PeniModule,
    SocialModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
