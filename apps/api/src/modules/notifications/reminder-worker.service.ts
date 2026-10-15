import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { hostname } from 'node:os';
import { DEFAULT_TIMEZONE } from '../../common/timezone';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { notificationDeliveries, projectPauses, projects, projectTasks, pushDevices, taskCompletions, workerHeartbeats } from '../../database/schema';
import { dueTasks, isActiveOn } from '../projects/plan';
import { SettingsService } from '../settings/settings.service';
import { PUSH_SENDER, PushSender } from './push-sender';
import { loadReminderContexts, loadReminderSettings, ReminderSettings } from './reminder-data';
import { dueReminders, inQuietHours, isStale, reminderMessage } from './reminders';

/** Bail d'un rappel pris par un worker : au-delà, un worker arrêté en plein envoi rend la main (reprise). */
export const LEASE_SECONDS = 120;
/** Tentatives d'envoi en cas d'erreur passagère du service de notifications (attente 1, 2, 4 min). */
export const MAX_SEND_TRIES = 3;
const BATCH = 100;

export interface RemindersHealth {
  status: 'disabled' | 'ok' | 'degraded' | 'down';
  enabled: boolean;
  heartbeatAgeSeconds: number | null;
  /** Rappels qui auraient dû partir il y a plus de 2 minutes et ne sont pas traités. */
  overdue: number;
  lastHour: { sent: number; skipped: number; stale: number; failed: number };
}

type Settings = ReminderSettings;

/**
 * Worker des rappels (lot 2). Chaque minute : battement de cœur, reprise des baux expirés, planification de la fenêtre
 * récente (idempotente grâce à la clé unique), puis envoi. Toutes les méthodes reçoivent l'heure `now` : testables.
 *
 * Garanties : un rappel est enregistré une seule fois (clé unique) ; il n'est pris que par un worker à la fois
 * (verrou SKIP LOCKED + bail) ; il est revérifié juste avant l'envoi (tâche cochée, projet en pause, préférences,
 * heures calmes) ; trop en retard, il n'est pas envoyé (« stale ») ; un jeton refusé définitivement est supprimé.
 */
@Injectable()
export class ReminderWorkerService {
  private readonly logger = new Logger('Rappels');
  readonly workerId = `${hostname()}-${process.pid}`;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settingsService: SettingsService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  settings(): Promise<Settings> {
    return loadReminderSettings(this.settingsService);
  }

  /** Un tour complet du worker (appelé chaque minute). */
  async tick(now: Date = new Date()) {
    await this.beat(now);
    const s = await this.settings();
    if (!s.enabled) return { planned: 0, recovered: 0, dispatched: 0 };
    const recovered = await this.recover(now);
    const planned = await this.plan(now, s);
    let dispatched = 0;
    for (let i = 0; i < 50; i++) {
      const n = await this.dispatch(now, s);
      dispatched += n;
      if (n < BATCH) break;
    }
    return { planned, recovered, dispatched };
  }

  async beat(now: Date) {
    await this.db
      .insert(workerHeartbeats)
      .values({ name: 'reminders', lastBeatAt: now, startedAt: now, details: this.workerId })
      .onConflictDoUpdate({ target: workerHeartbeats.name, set: { lastBeatAt: now, details: this.workerId } });
  }

  /** Baux expirés (worker arrêté pendant un envoi) : les rappels redeviennent « à envoyer ». */
  async recover(now: Date): Promise<number> {
    const limit = new Date(now.getTime() - LEASE_SECONDS * 1000);
    const rows = await this.db
      .update(notificationDeliveries)
      .set({ status: 'pending', claimedAt: null, claimedBy: null })
      .where(and(eq(notificationDeliveries.status, 'sending'), sql`${notificationDeliveries.claimedAt} < ${limit}`))
      .returning({ id: notificationDeliveries.id });
    if (rows.length) this.logger.warn(`Reprise après panne : ${rows.length} rappel(s) remis en file`);
    return rows.length;
  }

  /**
   * Enregistre les rappels dont l'heure tombe dans ]now - délai maximal, now]. Rejouer la même fenêtre (deux workers,
   * redémarrage) ne crée aucun doublon : INSERT … ON CONFLICT (clé) DO NOTHING.
   */
  async plan(now: Date, s?: Settings): Promise<number> {
    s ??= await this.settings();
    if (!s.enabled) return 0;
    const from = new Date(now.getTime() - s.graceMinutes * 60_000);
    // Personnes joignables : au moins un appareil dont la session est valable, rappels activés par la personne
    // (désactivés par défaut : sans ligne de préférences, aucun rappel).
    const people = await this.db.execute<{ user_id: string; tz: string; quiet_start: string | null; quiet_end: string | null }>(sql`
      SELECT DISTINCT d.user_id, COALESCE(up.timezone, ${DEFAULT_TIMEZONE}) AS tz, np.quiet_start, np.quiet_end
      FROM push_devices d
      JOIN sessions se ON se.family_id = d.session_family_id AND se.revoked_at IS NULL AND se.rotated_at IS NULL AND se.expires_at > ${now}
      LEFT JOIN user_preferences up ON up.user_id = d.user_id
      LEFT JOIN notification_preferences np ON np.user_id = d.user_id
      WHERE np.reminders_enabled IS TRUE`);
    if (!people.rows.length) return 0;
    const byUser = new Map(people.rows.map((r) => [r.user_id, r]));
    const values = [];
    for (const { userId, ctx } of await loadReminderContexts(this.db, byUser, s, from)) {
      for (const r of dueReminders(ctx, from, now)) {
        values.push({ id: uuidv7(), key: r.key, userId, projectId: ctx.projectId, taskId: r.taskId, day: r.day, attempt: r.attempt, fireAt: r.fireAt });
      }
    }
    if (!values.length) return 0;
    const inserted = await this.db.insert(notificationDeliveries).values(values).onConflictDoNothing({ target: notificationDeliveries.key }).returning({ id: notificationDeliveries.id });
    return inserted.length;
  }

  /** Prend un lot de rappels dus (verrou SKIP LOCKED : jamais le même rappel pour deux workers) et les envoie. */
  async dispatch(now: Date, s?: Settings): Promise<number> {
    s ??= await this.settings();
    const claimed = await this.db.transaction(async (tx) => {
      const ids = await tx.execute<{ id: string }>(sql`
        SELECT id FROM notification_deliveries
        WHERE status = 'pending' AND fire_at <= ${now} AND (retry_at IS NULL OR retry_at <= ${now})
        ORDER BY fire_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`);
      if (!ids.rows.length) return [];
      return tx
        .update(notificationDeliveries)
        .set({ status: 'sending', claimedAt: now, claimedBy: this.workerId, sendTries: sql`${notificationDeliveries.sendTries} + 1` })
        .where(inArray(notificationDeliveries.id, ids.rows.map((r) => r.id)))
        .returning();
    });
    for (const d of claimed) await this.deliver(d, now, s);
    return claimed.length;
  }

  private async finish(id: string, status: 'sent' | 'skipped' | 'stale' | 'failed' | 'pending', reason: string | null, now: Date, retryAt?: Date) {
    await this.db
      .update(notificationDeliveries)
      .set({ status, reason, claimedAt: null, claimedBy: null, sentAt: status === 'sent' ? now : null, retryAt: retryAt ?? null })
      .where(eq(notificationDeliveries.id, id));
  }

  private async deliver(d: typeof notificationDeliveries.$inferSelect, now: Date, s: Settings) {
    if (isStale(d.fireAt, now, s.graceMinutes)) return this.finish(d.id, 'stale', 'too_late', now);
    if (!s.enabled) return this.finish(d.id, 'skipped', 'platform_disabled', now);
    // Revérification juste avant l'envoi : la situation a pu changer depuis la planification.
    const [p] = await this.db.select().from(projects).where(eq(projects.id, d.projectId!));
    if (!p || p.status !== 'active') return this.finish(d.id, 'skipped', 'project_inactive', now);
    const [task] = await this.db.select().from(projectTasks).where(eq(projectTasks.id, d.taskId!));
    const pauses = await this.db.select().from(projectPauses).where(eq(projectPauses.projectId, p.id));
    if (!task || !isActiveOn(task, d.day!) || !dueTasks(d.day!, [task], pauses).length) return this.finish(d.id, 'skipped', 'not_due', now);
    const [doneRow] = await this.db.select().from(taskCompletions).where(and(eq(taskCompletions.taskId, task.id), eq(taskCompletions.day, d.day!)));
    if (doneRow) return this.finish(d.id, 'skipped', 'done', now);
    const people = await this.db.execute<{ enabled: boolean | null; quiet_start: string | null; quiet_end: string | null; tz: string | null }>(sql`
      SELECT np.reminders_enabled AS enabled, np.quiet_start, np.quiet_end, up.timezone AS tz
      FROM users u LEFT JOIN notification_preferences np ON np.user_id = u.id LEFT JOIN user_preferences up ON up.user_id = u.id
      WHERE u.id = ${d.userId}`);
    const person = people.rows[0];
    if (!person || person.enabled !== true) return this.finish(d.id, 'skipped', 'disabled', now);
    const quiet = person.quiet_start && person.quiet_end ? { start: person.quiet_start, end: person.quiet_end } : s.quiet;
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: person.tz ?? DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    if (inQuietHours(local, quiet)) return this.finish(d.id, 'skipped', 'quiet', now);

    const devices = await this.db.execute<{ id: string; token: string; platform: 'android' | 'ios' }>(sql`
      SELECT DISTINCT d.id, d.token, d.platform FROM push_devices d
      JOIN sessions se ON se.family_id = d.session_family_id AND se.revoked_at IS NULL AND se.rotated_at IS NULL AND se.expires_at > ${now}
      WHERE d.user_id = ${d.userId}`);
    if (!devices.rows.length) return this.finish(d.id, 'skipped', 'no_device', now);

    const { pose, ...msg } = reminderMessage(task.title, d.attempt, d.attempt >= s.offsets.length - 1);
    let ok = false;
    let transient = false;
    for (const dev of devices.rows) {
      const r = await this.sender.send(
        { deviceId: dev.id, token: dev.token, platform: dev.platform },
        { ...msg, collapseKey: d.key, ttlSeconds: Math.max(60, Math.round((d.fireAt.getTime() + s.graceMinutes * 60_000 - now.getTime()) / 1000)), data: { type: 'task_reminder', projectId: p.id, taskId: task.id, day: d.day!, pose } },
      );
      if (r.ok) ok = true;
      else if (r.permanent) await this.db.delete(pushDevices).where(eq(pushDevices.id, dev.id));
      else transient = true;
    }
    if (ok) return this.finish(d.id, 'sent', null, now);
    if (transient && d.sendTries < MAX_SEND_TRIES) {
      const retryAt = new Date(now.getTime() + 60_000 * 2 ** (d.sendTries - 1));
      return this.finish(d.id, 'pending', 'retry', now, retryAt);
    }
    return this.finish(d.id, transient ? 'failed' : 'skipped', transient ? 'send_failed' : 'invalid_token', now);
  }

  /** État pour la surveillance (administration, journaux et alertes CloudWatch). */
  async health(now: Date = new Date()): Promise<RemindersHealth> {
    const s = await this.settings();
    const [hb] = await this.db.select().from(workerHeartbeats).where(eq(workerHeartbeats.name, 'reminders'));
    const age = hb ? Math.round((now.getTime() - hb.lastBeatAt.getTime()) / 1000) : null;
    const counts = await this.db.execute<{ overdue: number; sent: number; skipped: number; stale: number; failed: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending', 'sending') AND fire_at < ${new Date(now.getTime() - 120_000)} AND (retry_at IS NULL OR retry_at < ${new Date(now.getTime() - 120_000)}))::int AS overdue,
        COUNT(*) FILTER (WHERE status = 'sent' AND sent_at > ${new Date(now.getTime() - 3600_000)})::int AS sent,
        COUNT(*) FILTER (WHERE status = 'skipped' AND fire_at > ${new Date(now.getTime() - 3600_000)})::int AS skipped,
        COUNT(*) FILTER (WHERE status = 'stale' AND fire_at > ${new Date(now.getTime() - 3600_000)})::int AS stale,
        COUNT(*) FILTER (WHERE status = 'failed' AND fire_at > ${new Date(now.getTime() - 3600_000)})::int AS failed
      FROM notification_deliveries`);
    const c = counts.rows[0];
    let status: RemindersHealth['status'] = 'ok';
    if (!s.enabled) status = 'disabled';
    else if (age === null || age > 180) status = 'down';
    else if (c.overdue > 0 || c.failed > 0 || c.stale > 0) status = 'degraded';
    return { status, enabled: s.enabled, heartbeatAgeSeconds: age, overdue: c.overdue, lastHour: { sent: c.sent, skipped: c.skipped, stale: c.stale, failed: c.failed } };
  }
}
