import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { FcmPushSender, parseServiceAccount } from './fcm-push-sender';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DisabledPushSender, PUSH_SENDER, PushSender, RecordingPushSender } from './push-sender';
import { ReminderRunner } from './reminder-runner';
import { ReminderWorkerService } from './reminder-worker.service';
import { RemindersAdminController } from './reminders-admin.controller';

function pushSenderFactory(cfg: AppConfig): PushSender {
  switch (cfg.PUSH_PROVIDER) {
    case 'test':
      return new RecordingPushSender();
    case 'fcm':
      // Utilisable seulement avec un compte de service Firebase (projet à créer après accord du fondateur).
      return new FcmPushSender({
        account: parseServiceAccount(cfg.FCM_SERVICE_ACCOUNT_JSON),
        apiBaseUrl: cfg.FCM_API_BASE_URL || undefined,
        tokenUrl: cfg.FCM_TOKEN_URL || undefined,
      });
    default:
      return new DisabledPushSender();
  }
}

@Module({
  controllers: [NotificationsController, RemindersAdminController],
  providers: [
    NotificationsService,
    ReminderWorkerService,
    ReminderRunner,
    { provide: PUSH_SENDER, useFactory: pushSenderFactory, inject: [APP_CONFIG] },
  ],
  exports: [NotificationsService, ReminderWorkerService],
})
export class NotificationsModule {}
