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
  actor_name: string | null;
  actor_username: string | null;
  post_id: string | null;
  snippet: string | null;
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
             e.payload AS chest, NULL::text AS task_title, NULL::text AS day, NULL::int AS attempt,
             NULL::text AS actor_name, NULL::text AS actor_username, NULL::text AS post_id, NULL::text AS snippet
      FROM project_events e JOIN projects p ON p.id = e.project_id
      WHERE p.user_id = ${userId} AND e.type = 'chest_opened' AND e.created_at > ${since}
      UNION ALL
      SELECT 'report:' || r.id, 'report_answered', r.resolved_at, r.project_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM project_reports r
      WHERE r.user_id = ${userId} AND r.status = 'resolved' AND r.resolved_at > ${since}
      UNION ALL
      SELECT 'reminder:' || d.id, 'task_reminder', d.sent_at, d.project_id, NULL, NULL, t.title, d.day::text, d.attempt, NULL, NULL, NULL, NULL
      FROM notification_deliveries d JOIN project_tasks t ON t.id = d.task_id
      WHERE d.user_id = ${userId} AND d.status = 'sent' AND d.sent_at > ${since}
      -- Lot 4 : social. Personnes actives seulement, aucun blocage entre les deux, jamais ses propres actions.
      UNION ALL
      SELECT 'like:' || l.post_id || ':' || l.user_id, 'post_liked', l.created_at, NULL, NULL, NULL, NULL, NULL, NULL, u.full_name, u.username, p.id::text, NULL
      FROM post_likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
      WHERE p.user_id = ${userId} AND l.user_id <> ${userId} AND p.status = 'published' AND u.status = 'active' AND l.created_at > ${since}
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${userId}))
      UNION ALL
      SELECT 'comment:' || c.id, 'post_commented', c.created_at, NULL, NULL, NULL, NULL, NULL, NULL, u.full_name, u.username, p.id::text, left(c.text, 120)
      FROM post_comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
      WHERE p.user_id = ${userId} AND c.user_id <> ${userId} AND c.status = 'published' AND p.status = 'published' AND u.status = 'active' AND c.created_at > ${since}
        AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM post_comments pc WHERE pc.id = c.parent_id AND pc.status = 'published'))
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${userId}))
      UNION ALL
      SELECT 'follow:' || f.follower_id, 'new_follower', f.created_at, NULL, NULL, NULL, NULL, NULL, NULL, u.full_name, u.username, NULL, NULL
      FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ${userId} AND u.status = 'active' AND f.created_at > ${since}
      UNION ALL
      SELECT 'moderation:' || r.target_type || ':' || r.target_id, 'content_hidden', max(r.resolved_at), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, r.target_type
      FROM content_reports r
      WHERE r.target_user_id = ${userId} AND r.action = 'hidden' AND r.resolved_at > ${since}
      GROUP BY r.target_type, r.target_id
      -- Lot 5 : décision sur une demande d'ouverture de boutique.
      UNION ALL
      SELECT 'merchant:' || m.id || ':' || m.status, CASE WHEN m.status = 'approved' THEN 'merchant_approved' ELSE 'merchant_rejected' END, m.reviewed_at,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, s.name
      FROM merchant_applications m JOIN shops s ON s.id = m.shop_id
      WHERE m.user_id = ${userId} AND m.status IN ('approved', 'rejected') AND m.reviewed_at > ${since}
      -- Lot 5-D : offre d'une boutique (ouverte) pour un de mes projets.
      UNION ALL
      SELECT 'offer:' || o.id, 'project_offer', o.created_at, p.id, p.title, NULL, NULL, NULL, NULL, NULL, NULL, NULL, s.name
      FROM project_offers o JOIN projects p ON p.id = o.project_id JOIN shops s ON s.id = o.shop_id JOIN users so ON so.id = s.owner_user_id
      WHERE p.user_id = ${userId} AND o.status = 'sent' AND s.status = 'active' AND so.status = 'active' AND o.created_at > ${since}
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = so.id) OR (b.blocker_id = so.id AND b.blocked_id = ${userId}))
      -- Lot 7-B : ce qui arrive à mes commandes du fait de la boutique ou du délai (jamais mes propres actions).
      UNION ALL
      SELECT 'order:' || e.id, 'order_update', e.created_at, NULL, NULL, o.number, NULL, NULL, NULL, s.name, NULL, o.id::text, e.type
      FROM order_events e JOIN orders o ON o.id = e.order_id JOIN shops s ON s.id = o.shop_id
      WHERE o.customer_id = ${userId} AND e.actor_type IN ('shop', 'system', 'courier') AND e.created_at > ${since}
        AND e.type IN ('proposed', 'confirmed', 'declined', 'ready', 'handed_over', 'cancelled', 'proposal_withdrawn', 'expired', 'courier_assigned', 'picked_up', 'courier_arrived', 'delivered')
      -- Lot 9 : pièces reçues sur une publication ou un commentaire (nom caché si l'envoi est anonyme).
      UNION ALL
      SELECT 'gift:' || g.id, 'coins_received', g.created_at, NULL, NULL, g.coins::text, NULL, NULL, NULL,
             CASE WHEN g.anonymous THEN NULL ELSE u.full_name END, NULL, g.post_id::text, g.target_type
      FROM coin_gifts g JOIN users u ON u.id = g.sender_id
      WHERE g.recipient_id = ${userId} AND u.status = 'active' AND g.created_at > ${since}
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${userId}))`;
  }

  private async seenUntil(userId: string): Promise<Date | null> {
    const rows = await this.db.select({ seenUntil: notificationInbox.seenUntil }).from(notificationInbox).where(sql`${notificationInbox.userId} = ${userId}`);
    return rows[0]?.seenUntil ?? null;
  }

  async list(userId: string, opts: { category?: InboxCategory; before?: Date; beforeId?: string; limit?: number }, now: Date = new Date()) {
    const since = new Date(now.getTime() - INBOX_DAYS * 86_400_000);
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), INBOX_PAGE_MAX);
    const [seen, offsets, rows] = await Promise.all([
      this.seenUntil(userId),
      this.settings.get<number[]>('notifications.reminder_offsets_minutes'),
      this.db.execute<Row>(sql`
        SELECT * FROM (${this.sources(userId, since)}) x
        WHERE (${opts.category ?? null}::text IS NULL
               OR (CASE WHEN x.type IN ('report_answered', 'content_hidden', 'merchant_approved', 'merchant_rejected', 'order_update') THEN 'support'
                        WHEN x.type IN ('post_liked', 'post_commented', 'new_follower', 'coins_received') THEN 'social'
                        ELSE 'projects' END) = ${opts.category ?? null}::text)
          -- Page suivante : position (date à la milliseconde, identifiant) du dernier élément vu ; aucun élément de même
          -- date n'est sauté (audit, défaut 4). Sans beforeId (anciennes versions de l'app) : comportement d'origine.
          AND (${opts.before ?? null}::timestamptz IS NULL
               OR (${opts.beforeId ?? null}::text IS NULL AND date_trunc('milliseconds', x.at) < ${opts.before ?? null}::timestamptz)
               OR (${opts.beforeId ?? null}::text IS NOT NULL
                   AND (date_trunc('milliseconds', x.at), x.id) < (${opts.before ?? null}::timestamptz, ${opts.beforeId ?? null}::text)))
        ORDER BY date_trunc('milliseconds', x.at) DESC, x.id DESC
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
            actorName: r.actor_name,
            snippet: r.snippet,
          }),
          at: at.toISOString(),
          unread: seen === null || at > seen,
          link: link(r),
        };
      }),
      nextBefore: rows.rows.length > limit ? new Date(page[page.length - 1].at).toISOString() : null,
      nextBeforeId: rows.rows.length > limit ? page[page.length - 1].id : null,
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
    case 'post_liked':
    case 'post_commented':
    case 'coins_received':
      return r.post_id ? `/posts/${r.post_id}` : null;
    case 'new_follower':
      return r.actor_username ? `/people/${r.actor_username}` : null;
    case 'content_hidden':
      return null;
    case 'merchant_approved':
    case 'merchant_rejected':
      return '/merchant/apply';
    case 'project_offer':
      return r.project_id ? `/projects/${r.project_id}/offers` : null;
    case 'order_update':
      return r.post_id ? `/orders/${r.post_id}` : null;
  }
}
