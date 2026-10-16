import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { notificationPreferences, peniConversations, peniMessages, users } from '../../database/schema';
import { CLOCK, ProjectsService } from '../projects/projects.service';
import { today } from '../projects/plan';
import { userTimezone } from '../projects/timezone';
import { SettingsService } from '../settings/settings.service';
import { loadReminderSettings } from '../notifications/reminder-data';
import { inQuietHours, QuietWindow } from '../notifications/reminders';
import { EncouragementQueryDto, PeniMessageDto, StartPeniConversationDto } from './dto';
import { encouragement } from './encouragements';
import { explainTask } from './task-explanations';
import { EngineContext, EngineInput, EngineResult, handleInput, InvalidChoiceError, PENI_ENGINE_VERSION, PeniReply, PeniState, QuickReply, startConversation } from './engine';
import { LLM_PROVIDER, LlmProvider } from './llm-provider';
import { rephrase } from './llm/rephrase';

type Clock = { now(): Date };

/** Essais sans verrou avant le dernier essai entièrement sous verrou (voir `PeniService.send`). */
export const PENI_OPTIMISTIC_ATTEMPTS = 3;
type MessageRow = typeof peniMessages.$inferSelect;

/**
 * Peni (lot 3) : discussion guidée pour construire un projet (écran 25). Réponses écrites et versionnées dans le dépôt
 * (moteur `guided-v1`), sans modèle de langage : rien ne quitte la base de BIM. Peni propose un brouillon ; la personne
 * le vérifie et le confirme dans l'app, qui le crée avec `POST /v1/projects` (mêmes contrôles, règle R5).
 */
@Injectable()
export class PeniService {
  private readonly logger = new Logger('Peni');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly projects: ProjectsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Un fournisseur d'IA ne peut servir que s'il est branché ET autorisé par le fondateur (réglage « decided »).
   * Aujourd'hui toujours faux : aucun fournisseur n'existe (PENI_LLM_PROVIDER=none).
   */
  async llmAllowed(): Promise<boolean> {
    if (!this.llm.available) return false;
    const s = await this.settings.get<boolean>('peni.llm_enabled');
    return s?.value === true && s.decisionStatus === 'decided';
  }

  private async limit(key: string, fallback: number): Promise<number> {
    const s = await this.settings.get<number>(key);
    return typeof s?.value === 'number' && s.value > 0 ? s.value : fallback;
  }

  private async context(userId: string): Promise<EngineContext> {
    const [catalog, templates, tz, [u]] = await Promise.all([
      this.projects.catalog(),
      this.projects.publishedTemplates(),
      userTimezone(this.db, userId),
      this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)),
    ]);
    return {
      catalog: { categories: catalog.categories, durationsDays: catalog.durationsDays, budgetTiers: catalog.budgetTiers, templates },
      today: today(this.clock.now(), tz),
      firstName: (u?.fullName ?? '').trim().split(/\s+/)[0] ?? '',
    };
  }

  /** Limite sur 24 heures glissantes, comptée sur les messages de la personne (pas ceux de Peni). */
  private async checkDailyLimit(userId: string, db: Pick<Database, 'select'> = this.db) {
    const max = await this.limit('peni.daily_message_limit', 100);
    const since = new Date(this.clock.now().getTime() - 24 * 3600_000);
    const [{ n }] = await db
      .select({ n: count() })
      .from(peniMessages)
      .where(and(eq(peniMessages.userId, userId), eq(peniMessages.role, 'user'), gt(peniMessages.createdAt, since)));
    if (n >= max) throw Errors.tooMany('Tu as beaucoup discuté avec Peni aujourd’hui 😊 Reviens un peu plus tard pour continuer.', { reason: 'PENI_DAILY_LIMIT', limit: max });
  }

  async start(userId: string, dto: StartPeniConversationDto) {
    await this.checkDailyLimit(userId);
    const ctx = await this.context(userId);
    const r = startConversation(ctx, { mode: dto.mode, budget: dto.budget, categoryCode: dto.categoryCode }, dto.purpose);
    const id = uuidv7();
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.insert(peniConversations).values({ id, userId, purpose: dto.purpose, engine: PENI_ENGINE_VERSION, state: r.state, createdAt: now, updatedAt: now });
      await tx.insert(peniMessages).values(r.replies.map((reply, i) => this.peniRow(id, userId, i + 1, reply, now)));
    });
    return this.get(userId, id);
  }

  async get(userId: string, id: string) {
    const [c] = await this.db.select().from(peniConversations).where(and(eq(peniConversations.id, id), eq(peniConversations.userId, userId)));
    if (!c) throw Errors.notFound('Discussion');
    const messages = await this.db.select().from(peniMessages).where(eq(peniMessages.conversationId, id)).orderBy(asc(peniMessages.seq));
    return {
      id: c.id,
      purpose: c.purpose,
      status: c.status,
      engine: c.engine,
      draft: c.draft ?? null,
      createdAt: c.createdAt,
      messages: messages.map((m) => this.view(m)),
    };
  }

  async send(userId: string, id: string, dto: PeniMessageDto) {
    const text = dto.text?.trim();
    if ((text ? 1 : 0) + (dto.choice ? 1 : 0) !== 1) {
      throw Errors.validation({ fields: { text: ['Écris un message ou choisis une réponse.'] } });
    }
    await this.checkDailyLimit(userId);
    const ctx = await this.context(userId);
    const maxInConversation = await this.limit('peni.conversation_max_messages', 60);
    const input: EngineInput = dto.choice ? { choice: dto.choice } : { text: text! };

    // Traitement en deux temps (étape 1 de l'intégration de Peni IA) :
    //  1. lecture de la discussion puis calcul de la réponse, SANS transaction ni verrou : une réponse lente (un futur
    //     fournisseur d'IA) ne bloque ni la discussion ni les connexions de la base partagées par toute l'API ;
    //  2. écriture courte sous verrou, seulement si la discussion n'a pas bougé entre-temps (même dernier numéro
    //     d'ordre). Sinon la réponse est recalculée sur l'état à jour : jamais de doublon, de trou ni de mélange.
    // Si la discussion bouge encore (envois simultanés répétés), le dernier essai se fait entièrement sous verrou,
    // comme avant : le moteur guidé est local et instantané, et tous les messages sont traités l'un après l'autre.
    for (let attempt = 1; ; attempt++) {
      const underLock = attempt > PENI_OPTIMISTIC_ATTEMPTS;
      const created = await (underLock
        ? this.db.transaction(async (tx) => {
            const snap = await this.snapshot(tx, userId, id, true);
            const result = await this.respondChecked(snap, input, ctx, maxInConversation, true);
            return this.persist(tx, userId, id, snap.last, dto, result);
          })
        : this.snapshot(this.db, userId, id, false).then(async (snap) => {
            const result = await this.respondChecked(snap, input, ctx, maxInConversation, false);
            return this.db.transaction(async (tx) => {
              const now = await this.snapshot(tx, userId, id, true);
              if (now.last !== snap.last) return null; // un autre message est passé entre-temps : on recommence
              return this.persist(tx, userId, id, snap.last, dto, result);
            });
          }));
      if (!created) continue;
      if (created.result.replies.some((r) => r.safety === 'urgent')) this.logger.warn({ msg: 'peni.safety.urgent', conversationId: id });
      return {
        messages: created.rows.map((m) => this.view(m as MessageRow)),
        status: created.result.draft ? 'completed' : 'open',
        draft: created.result.draft,
      };
    }
  }

  /**
   * Calcule la réponse de Peni pour un message. Aujourd'hui le moteur guidé (local, sans IA). Appelé hors de toute
   * transaction, sauf au dernier essai d'un envoi très disputé (voir `send`). Point d'extension prévu pour l'étape 2.
   */
  protected async respond(state: PeniState, input: EngineInput, ctx: EngineContext): Promise<EngineResult> {
    return handleInput(state, input, ctx);
  }

  /**
   * État de la discussion et dernier numéro d'ordre, lus en une seule requête (instantané cohérent : l'état et les
   * messages sont écrits dans la même transaction). `lock` : verrouille la discussion jusqu'à la fin de la transaction.
   * Le verrou est pris par une requête à part, AVANT la lecture : une requête qui attend un verrou garde l'instantané
   * pris à son début pour ses sous-requêtes, et lirait un dernier numéro d'ordre périmé (détecté par le test e2e des
   * envois simultanés).
   */
  private async snapshot(db: Pick<Database, 'execute'>, userId: string, id: string, lock: boolean) {
    if (lock) {
      const locked = await db.execute(sql`SELECT id FROM peni_conversations WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`);
      if (!locked.rows.length) throw Errors.notFound('Discussion');
    }
    const r = await db.execute<{ state: PeniState; n: number; last: number }>(sql`SELECT c.state,
        (SELECT count(*) FROM peni_messages m WHERE m.conversation_id = c.id AND m.role = 'user')::int AS n,
        (SELECT coalesce(max(m.seq), 0) FROM peni_messages m WHERE m.conversation_id = c.id)::int AS last
      FROM peni_conversations c WHERE c.id = ${id} AND c.user_id = ${userId}`);
    if (!r.rows.length) throw Errors.notFound('Discussion');
    return r.rows[0];
  }

  private async respondChecked(snap: { state: PeniState; n: number }, input: EngineInput, ctx: EngineContext, maxInConversation: number, underLock: boolean) {
    if (snap.n >= maxInConversation) {
      throw Errors.conflict('PENI_CONVERSATION_TOO_LONG', 'Cette discussion est déjà bien longue 😊 Recommence une nouvelle discussion avec Peni.');
    }
    let result: EngineResult;
    try {
      result = await this.respond(snap.state, input, ctx);
    } catch (e) {
      if (e instanceof InvalidChoiceError) throw Errors.validation({ fields: { choice: ['Cette réponse n’est plus proposée. Choisis une des réponses affichées.'] } });
      throw e;
    }
    // Jamais d'IA sous verrou (dernier essai d'un envoi disputé) : la discussion ne reste pas bloquée pendant un appel.
    return underLock ? result : this.withAi(result, input, ctx);
  }

  /**
   * Peni IA (étape 2) : seulement si un fournisseur est branché ET autorisé par le fondateur (`llmAllowed`, faux
   * aujourd'hui). L'IA ne peut que reformuler les textes ; le reste vient du moteur guidé. Tout refus, erreur ou
   * délai dépassé laisse la réponse guidée intacte. Journal sans contenu (ni message, ni texte de l'IA).
   */
  private async withAi(result: EngineResult, input: EngineInput, ctx: EngineContext): Promise<EngineResult> {
    if (!(await this.llmAllowed())) return result;
    const r = await rephrase(this.llm, { state: result.state, input, replies: result.replies, ctx });
    this.logger.log({ msg: 'peni.llm', provider: this.llm.name, outcome: r.outcome, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, prompt: r.promptVersion });
    const texts = r.texts;
    return texts ? { ...result, replies: result.replies.map((reply, i) => ({ ...reply, text: texts[i] })) } : result;
  }

  /** Écriture courte, sous le verrou de la discussion : message de la personne, réponses de Peni, nouvel état. */
  private async persist(tx: Pick<Database, 'select' | 'insert' | 'update' | 'execute'>, userId: string, id: string, last: number, dto: PeniMessageDto, result: EngineResult) {
    // Recompte sous verrou : des messages simultanés (plusieurs discussions) ne dépassent pas la limite (audit, défaut 1).
    await lockUserQuota(tx, 'peni', userId);
    await this.checkDailyLimit(userId, tx);
    const now = this.clock.now();
    const label = dto.choice ? await this.choiceLabel(tx, id, dto.choice) : dto.text!.trim();
    const rows = [
      { id: uuidv7(now.getTime()), conversationId: id, userId, seq: last + 1, role: 'user', text: label.slice(0, 1000), choice: dto.choice ?? null, quickReplies: [], summary: null, pose: null, safety: null, createdAt: now },
      ...result.replies.map((reply, i) => this.peniRow(id, userId, last + 2 + i, reply, now)),
    ];
    await tx.insert(peniMessages).values(rows);
    await tx
      .update(peniConversations)
      .set({ state: result.state, draft: result.draft, status: result.draft ? 'completed' : 'open', updatedAt: now })
      .where(eq(peniConversations.id, id));
    return { rows, result };
  }

  /**
   * Encouragement de Peni pour la journée (écran 27) ou la carte (écran 26). Lecture seule, aucune notification :
   * le texte s'affiche dans l'app. Heures calmes de la personne (ou celles par défaut, 22 h – 6 h) respectées.
   */
  async encouragement(userId: string, projectId: string, q: EncouragementQueryDto) {
    const p = await this.projects.detail(userId, projectId);
    const dayStr = q.day ?? p.today;
    const day = p.days.find((d) => d.day === dayStr) ?? null;
    if (q.day && !day) throw Errors.validation({ fields: { day: ['Ce jour ne fait pas partie du programme.'] } });
    const tz = await userTimezone(this.db, userId);
    const [[u], [prefs], defaults] = await Promise.all([
      this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)),
      this.db.select({ start: notificationPreferences.quietStart, end: notificationPreferences.quietEnd }).from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
      this.settings.get<QuietWindow | null>('notifications.quiet_hours'),
    ]);
    const quietWindow = prefs?.start && prefs.end ? { start: prefs.start, end: prefs.end } : (defaults?.value ?? null);
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(this.clock.now());
    const todayIndex = p.days.find((d) => d.day === p.today)?.index ?? null;
    const previous = [...p.days].reverse().find((d) => d.day < p.today && d.due > 0 && d.state !== 'paused') ?? null;
    const weekChest =
      todayIndex === null ? null : (p.chests.find((c) => c.kind === 'week' && c.state === 'upcoming' && c.fromIndex <= todayIndex && todayIndex <= c.toIndex) ?? null);
    return encouragement({
      context: q.context,
      firstName: (u?.fullName ?? '').trim().split(/\s+/)[0] ?? '',
      projectId,
      projectStatus: p.status,
      durationDays: p.durationDays,
      day,
      today: p.today,
      previous,
      streak: p.streak,
      weekChest,
      localTime,
      quiet: inQuietHours(localTime, quietWindow),
    });
  }

  /**
   * Peni explique une tâche du programme (écran 24) : contenu réel du programme, jours et heure, conseils généraux de
   * prudence, ce qui se passe si elle n'est pas faite, rappels selon les préférences et les heures calmes. Lecture seule.
   */
  async explainTask(userId: string, projectId: string, taskId: string) {
    const p = await this.projects.detail(userId, projectId);
    const task = p.tasks.find((t) => t.id === taskId);
    if (!task) throw Errors.notFound('Tâche');
    const tz = await userTimezone(this.db, userId);
    const [[prefs], settings] = await Promise.all([
      this.db
        .select({ enabled: notificationPreferences.remindersEnabled, start: notificationPreferences.quietStart, end: notificationPreferences.quietEnd })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId)),
      loadReminderSettings(this.settings),
    ]);
    const quiet = prefs?.start && prefs.end ? { start: prefs.start, end: prefs.end } : settings.quiet;
    const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(this.clock.now());
    return explainTask({
      task,
      project: {
        status: p.status,
        pausedUntil: p.pausedUntil,
        categoryCode: p.categoryCode,
        categoryLabel: p.categoryLabel,
        goalLabel: p.goal?.label ?? null,
        programTitle: p.program?.title ?? null,
        validatedBy: p.program?.validatedBy ?? null,
      },
      reminders: { serviceOpen: settings.enabled, enabledByPerson: prefs?.enabled === true, offsets: settings.offsets, quiet },
      quietNow: inQuietHours(localTime, quiet),
    });
  }

  private async choiceLabel(tx: Pick<Database, 'select'>, conversationId: string, choice: string): Promise<string> {
    const [lastPeni] = await tx
      .select({ quickReplies: peniMessages.quickReplies })
      .from(peniMessages)
      .where(and(eq(peniMessages.conversationId, conversationId), eq(peniMessages.role, 'peni'), sql`jsonb_array_length(${peniMessages.quickReplies}) > 0`))
      .orderBy(sql`${peniMessages.seq} DESC`)
      .limit(1);
    return ((lastPeni?.quickReplies ?? []) as QuickReply[]).find((q) => q.id === choice)?.label ?? choice;
  }

  private peniRow(conversationId: string, userId: string, seq: number, reply: PeniReply, now: Date) {
    return {
      id: uuidv7(now.getTime()),
      conversationId,
      userId,
      seq,
      role: 'peni',
      text: reply.text,
      choice: null,
      quickReplies: reply.quickReplies,
      summary: reply.summary ?? null,
      pose: reply.pose,
      safety: reply.safety ?? null,
      createdAt: now,
    };
  }

  private view(m: MessageRow) {
    return {
      id: m.id,
      role: m.role as 'peni' | 'user',
      text: m.text,
      quickReplies: (m.quickReplies ?? []) as QuickReply[],
      summary: m.summary ?? null,
      pose: m.pose,
      safety: m.safety,
      createdAt: m.createdAt,
    };
  }
}
