import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, Database } from '../../database/database.module';
import { notificationInbox } from '../../database/schema';
import { SettingsService } from '../settings/settings.service';
import { INBOX_TEMPLATES_VERSION, InboxCategory, inboxCategory, inboxSender, inboxText, InboxType } from './inbox-messages';

/** Le centre de notifications montre les 30 derniers jours. */
export const INBOX_DAYS = 30;
export const INBOX_PAGE_MAX = 50;

type Row = {
  id: string;
  type: InboxType;
  at: Date;
  project_id: string | null;
  project_title: string | null;
  chest: string | null;
  task_title: string | null;
  day: string | null;
  attempt: number | null;
};

/**
 * Centre de notifications (lot 2, écran 17). Lu dans les sources existantes : coffres ouverts (journal des projets),
 * réponses du support aux signalements, rappels réellement envoyés par le serveur. Seul l'état « vu » est enregistré.
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  private sources(userId: string, since: Date) {
    return sql`
      SELECT 'chest:' || e.id AS id, 'chest_opened' AS type, e.created_at AS at, p.id AS project_id, p.title AS project_title,
             e.payload AS chest, NULL::text AS task_title, NULL::text AS day, NULL::int AS attempt
      FROM project_events e JOIN projects p ON p.id = e.project_id
      WHERE p.user_id = ${userId} AND e.type = 'chest_opened' AND e.created_at > ${since}
      UNION ALL
      SELECT 'report:' || r.id, 'report_answered', r.resolved_at, r.project_id, NULL, NULL, NULL, NULL, NULL
      FROM project_reports r
      WHERE r.user_id = ${userId} AND r.status = 'resolved' AND r.resolved_at > ${since}
      UNION ALL
      SELECT 'reminder:' || d.id, 'task_reminder', d.sent_at, d.project_id, NULL, NULL, t.title, d.day::text, d.attempt
      FROM notification_deliveries d JOIN project_tasks t ON t.id = d.task_id
      WHERE d.user_id = ${userId} AND d.status = 'sent' AND d.sent_at > ${since}`;
  }

  private async seenUntil(userId: string): Promise<Date | null> {
    const rows = await this.db.select({ seenUntil: notificationInbox.seenUntil }).from(notificationInbox).where(sql`${notificationInbox.userId} = ${userId}`);
    return rows[0]?.seenUntil ?? null;
  }

  async list(userId: string, opts: { category?: InboxCategory; before?: Date; limit?: number }, now: Date = new Date()) {
    const since = new Date(now.getTime() - INBOX_DAYS * 86_400_000);
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), INBOX_PAGE_MAX);
    const [seen, offsets, rows] = await Promise.all([
      this.seenUntil(userId),
      this.settings.get<number[]>('notifications.reminder_offsets_minutes'),
      this.db.execute<Row>(sql`
        SELECT * FROM (${this.sources(userId, since)}) x
        WHERE (${opts.category ?? null}::text IS NULL
               OR (CASE WHEN x.type = 'report_answered' THEN 'support' ELSE 'projects' END) = ${opts.category ?? null}::text)
          AND (${opts.before ?? null}::timestamptz IS NULL OR x.at < ${opts.before ?? null}::timestamptz)
        ORDER BY x.at DESC, x.id DESC
        LIMIT ${limit + 1}`),
    ]);
    const attempts = offsets?.value?.length ?? 1;
    const page = rows.rows.slice(0, limit);
    return {
      templatesVersion: INBOX_TEMPLATES_VERSION,
      items: page.map((r) => {
        const at = new Date(r.at);
        return {
          id: r.id,
          type: r.type,
          category: inboxCategory(r.type),
          sender: inboxSender(r.type),
          text: inboxText({
            type: r.type,
            projectTitle: r.project_title,
            chest: r.chest,
            taskTitle: r.task_title,
            attempt: r.attempt,
            lastAttempt: (r.attempt ?? 0) >= attempts - 1,
          }),
          at: at.toISOString(),
          unread: seen === null || at > seen,
          link: link(r),
        };
      }),
      nextBefore: rows.rows.length > limit ? new Date(page[page.length - 1].at).toISOString() : null,
    };
  }

  async unreadCount(userId: string, now: Date = new Date()) {
    const seen = await this.seenUntil(userId);
    const since = new Date(Math.max(now.getTime() - INBOX_DAYS * 86_400_000, seen?.getTime() ?? 0));
    const r = await this.db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM (${this.sources(userId, since)}) x`);
    return { count: r.rows[0]?.n ?? 0 };
  }

  /** Tout ce qui est arrivé jusqu'à maintenant devient « vu » (à l'ouverture du centre de notifications). */
  async markSeen(userId: string, now: Date = new Date()) {
    await this.db
      .insert(notificationInbox)
      .values({ userId, seenUntil: now })
      .onConflictDoUpdate({ target: notificationInbox.userId, set: { seenUntil: now, updatedAt: now } });
    return { seenUntil: now.toISOString() };
  }
}

/** Écran de l'app ouvert en touchant la notification. */
function link(r: Row): string | null {
  switch (r.type) {
    case 'chest_opened':
      return r.project_id ? `/projects/${r.project_id}` : null;
    case 'task_reminder':
      return r.project_id && r.day ? `/projects/${r.project_id}/day/${r.day}` : null;
    case 'report_answered':
      return '/reports';
  }
}
