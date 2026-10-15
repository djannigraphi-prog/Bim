import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { notificationPreferences, pushDevices, sessions } from '../../database/schema';
import { SettingsService } from '../settings/settings.service';
import { NotificationPreferencesDto, RegisterDeviceDto } from './dto';

export interface QuietHours {
  start: string;
  end: string;
}

/** Appareils et préférences de notification (lot 2). Aucun envoi ici : voir le worker de rappels. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  private async familyOf(sessionId: string): Promise<string> {
    const [s] = await this.db.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!s) throw Errors.unauthenticated();
    return s.familyId;
  }

  /** Enregistre (ou remplace) le jeton de l'appareil connecté. Un jeton n'appartient qu'à un seul appareil connecté. */
  async registerDevice(userId: string, sessionId: string, dto: RegisterDeviceDto) {
    const familyId = await this.familyOf(sessionId);
    await this.db.transaction(async (tx) => {
      // Même téléphone reconnecté sous un autre compte : l'ancien rattachement du jeton disparaît.
      await tx.delete(pushDevices).where(and(eq(pushDevices.token, dto.token), ne(pushDevices.sessionFamilyId, familyId)));
      await tx
        .insert(pushDevices)
        .values({ id: uuidv7(), userId, sessionFamilyId: familyId, platform: dto.platform, token: dto.token, appVersion: dto.appVersion ?? null })
        .onConflictDoUpdate({
          target: pushDevices.sessionFamilyId,
          set: { userId, platform: dto.platform, token: dto.token, appVersion: dto.appVersion ?? null, lastSeenAt: new Date() },
        });
    });
    return { registered: true };
  }

  async removeDevice(sessionId: string) {
    const familyId = await this.familyOf(sessionId);
    await this.db.delete(pushDevices).where(eq(pushDevices.sessionFamilyId, familyId));
  }

  /** Heures calmes de la plateforme (réglage administrable ; proposition non validée tant que le fondateur ne l'a pas confirmée). */
  async defaultQuietHours(): Promise<QuietHours | null> {
    const s = await this.settings.get<QuietHours | null>('notifications.quiet_hours');
    return s?.value ?? null;
  }

  async preferences(userId: string) {
    const [row] = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
    const personal = row?.quietStart && row.quietEnd ? { start: row.quietStart, end: row.quietEnd } : null;
    const platform = await this.settings.get<boolean>('notifications.reminders_enabled');
    return {
      remindersEnabled: row?.remindersEnabled ?? true,
      quietHours: personal ?? (await this.defaultQuietHours()),
      quietHoursSource: personal ? 'personal' : 'default',
      /** Les rappels ne sont pas encore en service sur la plateforme : l'app l'indique honnêtement. */
      remindersAvailable: platform?.value === true,
    };
  }

  async updatePreferences(userId: string, dto: NotificationPreferencesDto) {
    const touchesQuiet = dto.quietStart !== undefined || dto.quietEnd !== undefined;
    if (touchesQuiet && (dto.quietStart === null) !== (dto.quietEnd === null)) {
      throw Errors.validation({ fields: { quietEnd: ['Indique le début et la fin des heures calmes, ou aucune des deux.'] } });
    }
    if (touchesQuiet && (dto.quietStart === undefined || dto.quietEnd === undefined)) {
      throw Errors.validation({ fields: { quietEnd: ['Indique le début et la fin des heures calmes ensemble.'] } });
    }
    if (dto.quietStart && dto.quietStart === dto.quietEnd) {
      throw Errors.validation({ fields: { quietEnd: ['Le début et la fin des heures calmes doivent être différents.'] } });
    }
    const set = {
      ...(dto.remindersEnabled !== undefined ? { remindersEnabled: dto.remindersEnabled } : {}),
      ...(touchesQuiet ? { quietStart: dto.quietStart ?? null, quietEnd: dto.quietEnd ?? null } : {}),
    };
    if (Object.keys(set).length) {
      await this.db
        .insert(notificationPreferences)
        .values({ userId, ...set })
        .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...set, updatedAt: new Date() } });
    }
    return this.preferences(userId);
  }
}
