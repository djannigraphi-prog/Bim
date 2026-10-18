import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { auditLogs, maintenanceRuns } from '../../database/schema';
import { SettingsService } from '../settings/settings.service';

export const PURGE_JOB = 'account_purge';
/** Délai minimal (décision du fondateur du 15/10/2026 : 30 jours) : un réglage plus court est ignoré. */
export const PURGE_MIN_DAYS = 30;
/** Plafond par passage : au-delà, rien n'est supprimé, le passage est arrêté et une alerte est journalisée. */
export const PURGE_MAX_PER_RUN = 500;
/** Une vérification en cours n'est jamais coupée : aucun code envoyé dans les dernières 24 heures. */
export const PURGE_RECENT_CODE_HOURS = 24;

/**
 * Tables liées à un compte et vérifiées avant toute suppression : la moindre ligne protège le compte.
 * Un test compare cette liste et la suivante aux clés étrangères réelles de la base : une nouvelle table liée aux
 * comptes (lots suivants) fait échouer les tests tant qu'elle n'est pas classée ici.
 */
export const PURGE_BLOCKING_TABLES = [
  'sessions',
  'auth_identities',
  'projects',
  'project_photos',
  'project_reports',
  'shops',
  'shop_members',
  'courier_accounts',
  'push_devices',
  'notification_deliveries',
  'peni_conversations',
  'peni_messages',
  // Lot 4 (social) : publier, commenter, aimer, suivre, bloquer ou signaler est une activité.
  'posts',
  'post_comments',
  'post_likes',
  'comment_likes',
  'follows',
  'user_blocks',
  'content_reports',
  'stories',
  'story_views',
  // Lot 5 : une demande d'ouverture de boutique est une activité.
  'merchant_applications',
  // Lot 5-B : gérer un stock, suivre une boutique ou mettre un article de côté est une activité.
  'inventory_movements',
  'shop_follows',
  'product_favorites',
  // Lot 7-A : faire partie de l'équipe d'une boutique, modifier un article.
  'shop_member_permissions',
  'product_revisions',
  // Lot 6 : écrire ou recevoir des messages est une activité.
  'conversations',
  'conversation_members',
  'messages',
  // Lot 7-B : commander, proposer ou remettre une commande est une activité.
  'orders',
  'order_handover_codes',
  // Lot 7-C : un paiement constaté ou décidé est une activité.
  'order_payments',
  // Lot 7-E : proposer ou terminer une relation avec un livreur est une activité.
  'courier_shop_partnerships',
  // Lot 7-H : évaluer est une activité.
  'reviews',
  // Lot 7-F : solliciter un livreur est une activité.
  'delivery_offers',
  // Lot 7 : confirmer le retour d'un colis en boutique est une activité.
  'deliveries',
  // Joindre une photo à un problème signalé est une activité.
  'incident_photos',
  // Lot 6-C : réagir à un message est une activité.
  'message_reactions',
  // Lot 8 : lancer un paiement en ligne est une activité.
  'payment_intents',
  // Lot 9 : un abonnement, un portefeuille, un achat, un envoi ou un retrait de pièces est une activité (et un compte
  // financier : jamais supprimé automatiquement).
  'subscriptions',
  'wallets',
  'coin_ledger',
  'coin_purchases',
  'store_purchases',
  'coin_gifts',
  'withdrawals',
  // Lot 10 : animer, commenter ou regarder un Live est une activité.
  'lives',
  'live_comments',
  'live_viewers',
  // Lot 11 : publier, aimer ou regarder un Reel est une activité.
  'reels',
  'reel_likes',
  'reel_views',
] as const;

/** Colonnes qui relient chaque table bloquante au compte (user_id par défaut). */
const BLOCKING_COLUMNS: Partial<Record<(typeof PURGE_BLOCKING_TABLES)[number], string[]>> = {
  shops: ['owner_user_id'],
  follows: ['follower_id', 'followee_id'],
  user_blocks: ['blocker_id', 'blocked_id'],
  content_reports: ['reporter_id', 'target_user_id'],
  inventory_movements: ['created_by'],
  conversations: ['created_by'],
  messages: ['sender_id'],
  shop_member_permissions: ['user_id', 'granted_by'],
  product_revisions: ['changed_by'],
  shop_members: ['user_id', 'invited_by'],
  orders: ['customer_id', 'created_by'],
  order_handover_codes: ['used_by'],
  order_payments: ['cash_observed_by', 'decided_by'],
  courier_shop_partnerships: ['invited_by', 'ended_by'],
  reviews: ['author_id'],
  delivery_offers: ['offered_by'],
  deliveries: ['return_confirmed_by'],
  incident_photos: ['uploaded_by'],
  payment_intents: ['created_by'],
  coin_gifts: ['sender_id', 'recipient_id'],
  lives: ['host_user_id'],
};
/** Tables supprimées avec le compte (données d'inscription, sans activité) ; contrôles particuliers indiqués. */
export const PURGE_CASCADED_TABLES = [
  'user_contacts', // seulement si aucune coordonnée n'est vérifiée
  'verification_codes', // seulement si aucun code n'a été envoyé dans les dernières 24 h
  'privacy_settings',
  'user_interests',
  'user_preferences',
  'notification_preferences',
  'notification_inbox',
  'step_up_grants',
] as const;

export type PurgeMode = 'simulation' | 'real';
export type PurgeTrigger = 'schedule' | 'admin';

export interface PurgeConfig {
  enabled: boolean;
  /** Mode demandé dans les réglages. */
  mode: PurgeMode;
  /** Suppression réelle permise : interrupteur à true, mode « real », et ces deux réglages validés (« decided »). */
  realDeletionAllowed: boolean;
  afterDays: number;
  maxPerRun: number;
}

export interface PurgeResult {
  status: 'disabled' | 'locked' | 'already_done' | 'ok' | 'aborted';
  mode: PurgeMode;
  candidates: number;
  deleted: number;
  runId: string | null;
}

/**
 * Purge des comptes jamais vérifiés (lot 2). **Désactivée et en simulation par défaut** ; la suppression réelle
 * n'est possible qu'après validation explicite du fondateur, enregistrée dans les réglages (voir `config`).
 *
 * Un compte n'est concerné que si toutes ces conditions sont vraies, revérifiées dans la requête de suppression :
 * statut « pending_verification », jamais connecté, non supprimé, créé il y a plus de 30 jours (heure de la base),
 * aucune coordonnée vérifiée, aucun code envoyé dans les dernières 24 h, et aucune ligne dans les tables d'activité
 * (`PURGE_BLOCKING_TABLES`). Un passage à la fois (verrou PostgreSQL), 500 comptes au plus, journal d'audit sans
 * nom, téléphone ni e-mail.
 */
@Injectable()
export class AccountPurgeService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  async config(): Promise<PurgeConfig> {
    const [enabled, mode, days] = await Promise.all([
      this.settings.get<boolean>('maintenance.account_purge_enabled'),
      this.settings.get<string>('maintenance.account_purge_mode'),
      this.settings.get<number>('maintenance.account_purge_after_days'),
    ]);
    const on = enabled?.value === true;
    const requested: PurgeMode = mode?.value === 'real' ? 'real' : 'simulation';
    const afterDays = Math.max(PURGE_MIN_DAYS, Number.isInteger(days?.value) ? (days!.value as number) : PURGE_MIN_DAYS);
    const realDeletionAllowed = on && requested === 'real' && enabled?.decisionStatus === 'decided' && mode?.decisionStatus === 'decided';
    return { enabled: on, mode: requested, realDeletionAllowed, afterDays, maxPerRun: PURGE_MAX_PER_RUN };
  }

  /** Conditions d'un compte à purger, à l'heure de la base de données (jamais celle du serveur). */
  private eligible(afterDays: number) {
    const blocking = sql.join(
      PURGE_BLOCKING_TABLES.flatMap((t) => (BLOCKING_COLUMNS[t] ?? ['user_id']).map((col) => sql`AND NOT EXISTS (SELECT 1 FROM ${sql.identifier(t)} x WHERE x.${sql.identifier(col)} = u.id)`)),
      sql` `,
    );
    return sql`u.status = 'pending_verification'
      AND u.deleted_at IS NULL
      AND u.last_login_at IS NULL
      AND u.created_at < now() - make_interval(days => ${afterDays}::int)
      AND NOT EXISTS (SELECT 1 FROM user_contacts c WHERE c.user_id = u.id AND c.verified_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM verification_codes v WHERE v.user_id = u.id AND v.last_sent_at > now() - make_interval(hours => ${PURGE_RECENT_CODE_HOURS}::int))
      ${blocking}`;
  }

  /** Passage quotidien : au plus un par jour, quel que soit le nombre de serveurs. */
  runScheduled(): Promise<PurgeResult> {
    return this.run('schedule');
  }

  /** Simulation demandée depuis l'administration : ne supprime jamais rien, même si le mode réel est validé. */
  simulate(adminId: string): Promise<PurgeResult> {
    return this.run('admin', adminId);
  }

  private async run(trigger: PurgeTrigger, adminId?: string): Promise<PurgeResult> {
    const cfg = await this.config();
    const mode: PurgeMode = trigger === 'schedule' && cfg.realDeletionAllowed ? 'real' : 'simulation';
    if (trigger === 'schedule' && !cfg.enabled) return { status: 'disabled', mode, candidates: 0, deleted: 0, runId: null };
    const startedAt = new Date();
    return this.db.transaction(async (tx) => {
      // Un seul passage à la fois, tous serveurs confondus ; le verrou est libéré à la fin de la transaction.
      const lock = await tx.execute<{ ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('bim:maintenance:account_purge')) AS ok`);
      if (!lock.rows[0]?.ok) return { status: 'locked', mode, candidates: 0, deleted: 0, runId: null } satisfies PurgeResult;
      if (trigger === 'schedule') {
        const done = await tx.execute(sql`SELECT 1 FROM maintenance_runs WHERE job = ${PURGE_JOB} AND trigger = 'schedule' AND started_at > now() - interval '20 hours' LIMIT 1`);
        if (done.rows.length) return { status: 'already_done', mode, candidates: 0, deleted: 0, runId: null } satisfies PurgeResult;
      }
      const found = await tx.execute<{ id: string }>(sql`
        SELECT u.id FROM users u WHERE ${this.eligible(cfg.afterDays)}
        ORDER BY u.created_at LIMIT ${cfg.maxPerRun + 1} FOR UPDATE OF u SKIP LOCKED`);
      const ids = found.rows.map((r) => r.id);
      const runId = uuidv7();
      let status: PurgeResult['status'] = 'ok';
      let deleted: string[] = [];
      if (ids.length > cfg.maxPerRun) {
        status = 'aborted';
        this.logger.error({ msg: 'maintenance.account_purge.aborted', candidates: ids.length, maxPerRun: cfg.maxPerRun, mode });
      } else if (mode === 'real' && ids.length) {
        // Conditions revérifiées dans la suppression elle-même (défense en profondeur).
        const del = await tx.execute<{ id: string }>(sql`DELETE FROM users u WHERE u.id = ANY(${`{${ids.join(',')}}`}::uuid[]) AND ${this.eligible(cfg.afterDays)} RETURNING u.id`);
        deleted = del.rows.map((r) => r.id);
        await tx.insert(auditLogs).values(
          deleted.map((id) => ({ id: uuidv7(), actorType: 'system' as const, action: 'user.purged', targetType: 'user', targetId: id, metadata: { reason: 'never_verified', afterDays: cfg.afterDays, runId } })),
        );
      }
      // Plafond dépassé : 501 signifie « plus de 500 » (la recherche s'arrête là).
      const candidates = ids.length;
      const details = { afterDays: cfg.afterDays, maxPerRun: cfg.maxPerRun, requestedMode: cfg.mode, ...(status === 'aborted' ? { reason: 'cap_exceeded' } : {}) };
      await tx.insert(maintenanceRuns).values({ id: runId, job: PURGE_JOB, mode, status, trigger, candidates, deleted: deleted.length, details, startedAt, finishedAt: new Date() });
      await tx.insert(auditLogs).values({
        id: uuidv7(),
        actorType: adminId ? 'admin' : 'system',
        actorId: adminId ?? null,
        action: 'maintenance.account_purge',
        targetType: 'maintenance_run',
        targetId: runId,
        metadata: { mode, status, trigger, candidates, deleted: deleted.length },
      });
      this.logger.log({ msg: 'maintenance.account_purge', mode, status, trigger, candidates, deleted: deleted.length });
      return { status, mode, candidates, deleted: deleted.length, runId } satisfies PurgeResult;
    });
  }

  /** État pour l'administration : réglages effectifs et derniers passages (aucune donnée personnelle). */
  async overview() {
    const cfg = await this.config();
    const runs = await this.db.select().from(maintenanceRuns).where(eq(maintenanceRuns.job, PURGE_JOB)).orderBy(desc(maintenanceRuns.startedAt)).limit(10);
    return {
      ...cfg,
      effectiveMode: cfg.realDeletionAllowed ? ('real' as const) : ('simulation' as const),
      runs: runs.map((r) => ({ id: r.id, mode: r.mode, status: r.status, trigger: r.trigger, candidates: r.candidates, deleted: r.deleted, startedAt: r.startedAt, finishedAt: r.finishedAt })),
    };
  }
}
