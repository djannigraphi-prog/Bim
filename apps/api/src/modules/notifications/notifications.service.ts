import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { notificationPreferences, pushDevices, sessions } from '../../database/schema';
import { SettingsService } from '../settings/settings.service';
import { NotificationPreferencesDto, RegisterDeviceDto } from './dto';
import { loadReminderContexts, loadReminderSettings } from './reminder-data';
import { dueReminders, REMINDER_TEMPLATES_VERSION, reminderMessage } from './reminders';
import { DEFAULT_TIMEZONE } from '../../common/timezone';
import { userPreferences } from '../../database/schema';

/** Horizon des rappels programmés sur le téléphone ; l'app resynchronise à chaque ouverture et après chaque changement. */
export const UPCOMING_HORIZON_HOURS = 48;
/** Plafond par appel : largement au-dessus d'un usage normal, et loin de la limite d'Android (500 alarmes par app). */
export const UPCOMING_MAX = 60;

/** Décision du fondateur (15/10/2026) : sans choix explicite de la personne, aucun rappel. */
export const REMINDERS_ENABLED_BY_DEFAULT = false;

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
      remindersEnabled: row?.remindersEnabled ?? REMINDERS_ENABLED_BY_DEFAULT,
      quietHours: personal ?? (await this.defaultQuietHours()),
      quietHoursSource: personal ? 'personal' : 'default',
      /** Les rappels ne sont pas encore en service sur la plateforme : l'app l'indique honnêtement. */
      remindersAvailable: platform?.value === true,
    };
  }

  /**
   * Rappels des prochaines heures pour CET appareil, à programmer sur le téléphone (notifications programmées classiques,
   * non exactes : décision du 15/10/2026). Même calcul et mêmes textes que l'envoi par le serveur.
   * Un seul canal par appareil : si cet appareil reçoit les notifications du serveur (jeton enregistré), la liste est vide
   * (« push ») pour éviter tout doublon. Vide aussi tant que le service n'est pas ouvert ou que la personne n'a pas activé
   * ses rappels.
   */
  async upcoming(userId: string, sessionId: string, now: Date = new Date()) {
    const familyId = await this.familyOf(sessionId);
    const [s, [prefs], [device], [up]] = await Promise.all([
      loadReminderSettings(this.settings),
      this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1),
      this.db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.sessionFamilyId, familyId)).limit(1),
      this.db.select({ timezone: userPreferences.timezone }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
    ]);
    const enabled = prefs?.remindersEnabled ?? REMINDERS_ENABLED_BY_DEFAULT;
    const channel: 'push' | 'local' = device ? 'push' : 'local';
    const base = { available: s.enabled, enabled, channel, templatesVersion: REMINDER_TEMPLATES_VERSION, horizonHours: UPCOMING_HORIZON_HOURS };
    if (!s.enabled || !enabled || channel === 'push') return { ...base, reminders: [] };
    const to = new Date(now.getTime() + UPCOMING_HORIZON_HOURS * 3600_000);
    const person = { tz: up?.timezone ?? DEFAULT_TIMEZONE, quiet_start: prefs?.quietStart ?? null, quiet_end: prefs?.quietEnd ?? null };
    const reminders = [];
    for (const { ctx } of await loadReminderContexts(this.db, new Map([[userId, person]]), s, now)) {
      const titles = new Map(ctx.tasks.map((t) => [t.id, t.title]));
      for (const r of dueReminders(ctx, now, to)) {
        const msg = reminderMessage(titles.get(r.taskId) ?? '', r.attempt, r.attempt >= s.offsets.length - 1);
        reminders.push({ key: r.key, projectId: r.projectId, taskId: r.taskId, day: r.day, attempt: r.attempt, fireAt: r.fireAt.toISOString(), ...msg });
      }
    }
    reminders.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
    return { ...base, reminders: reminders.slice(0, UPCOMING_MAX) };
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
