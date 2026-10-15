import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
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
      // Branché à l'étape suivante (projet Firebase à créer et à valider par le fondateur).
      throw new Error('PUSH_PROVIDER=fcm : envoi Firebase pas encore configuré');
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
