import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { peniConversations, peniMessages, users } from '../../database/schema';
import { CLOCK, ProjectsService } from '../projects/projects.service';
import { today } from '../projects/plan';
import { userTimezone } from '../projects/timezone';
import { SettingsService } from '../settings/settings.service';
import { PeniMessageDto, StartPeniConversationDto } from './dto';
import { EngineContext, handleInput, InvalidChoiceError, PENI_ENGINE_VERSION, PeniReply, PeniState, QuickReply, startConversation } from './engine';
import { LLM_PROVIDER, LlmProvider } from './llm-provider';

type Clock = { now(): Date };
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
  private async checkDailyLimit(userId: string) {
    const max = await this.limit('peni.daily_message_limit', 100);
    const since = new Date(this.clock.now().getTime() - 24 * 3600_000);
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(peniMessages)
      .where(and(eq(peniMessages.userId, userId), eq(peniMessages.role, 'user'), gt(peniMessages.createdAt, since)));
    if (n >= max) throw Errors.tooMany('Tu as beaucoup discuté avec Peni aujourd’hui 😊 Reviens un peu plus tard pour continuer.', { reason: 'PENI_DAILY_LIMIT', limit: max });
  }

  async start(userId: string, dto: StartPeniConversationDto) {
    await this.checkDailyLimit(userId);
    const ctx = await this.context(userId);
    const r = startConversation(ctx, { mode: dto.mode, budget: dto.budget });
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
    const created = await this.db.transaction(async (tx) => {
      // Un message à la fois par discussion (deux envois simultanés ne se mélangent pas).
      const locked = await tx.execute<{ id: string }>(sql`SELECT id FROM peni_conversations WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`);
      if (!locked.rows.length) throw Errors.notFound('Discussion');
      const [c] = await tx.select().from(peniConversations).where(eq(peniConversations.id, id));
      const [{ n, last }] = await tx
        .select({ n: sql<number>`count(*) FILTER (WHERE ${peniMessages.role} = 'user')`.mapWith(Number), last: sql<number>`coalesce(max(${peniMessages.seq}), 0)`.mapWith(Number) })
        .from(peniMessages)
        .where(eq(peniMessages.conversationId, id));
      if (n >= maxInConversation) {
        throw Errors.conflict('PENI_CONVERSATION_TOO_LONG', 'Cette discussion est déjà bien longue 😊 Recommence une nouvelle discussion avec Peni.');
      }
      const state = c.state as PeniState;
      let result;
      try {
        result = handleInput(state, dto.choice ? { choice: dto.choice } : { text }, ctx);
      } catch (e) {
        if (e instanceof InvalidChoiceError) throw Errors.validation({ fields: { choice: ['Cette réponse n’est plus proposée. Choisis une des réponses affichées.'] } });
        throw e;
      }
      const now = this.clock.now();
      const label = dto.choice ? await this.choiceLabel(tx, id, dto.choice) : text!;
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
    });
    if (created.result.replies.some((r) => r.safety === 'urgent')) this.logger.warn({ msg: 'peni.safety.urgent', conversationId: id });
    return {
      messages: created.rows.map((m) => this.view(m as MessageRow)),
      status: created.result.draft ? 'completed' : 'open',
      draft: created.result.draft,
    };
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
