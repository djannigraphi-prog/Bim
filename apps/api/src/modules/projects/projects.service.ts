import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import {
  programTemplates,
  programTemplateTasks,
  projectCategories,
  projectEvents,
  projectGoals,
  projectPauses,
  projects,
  projectTasks,
  taskCompletions,
} from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AddTaskDto, CreateProjectDto, PauseDto, UpdateProjectDto } from './dto';
import { addDays, computePlan, diffDays, dueTasks, generateTitle, isPaused, isValidDay, spreadWeekdays, today } from './plan';

type ProjectRow = typeof projects.$inferSelect;
type TaskRow = typeof projectTasks.$inferSelect;
type PauseRow = typeof projectPauses.$inferSelect;

const OPEN_STATUSES = ['active', 'paused'] as const;

/** Horloge remplaçable dans les tests. */
export const CLOCK = Symbol('CLOCK');
export interface Clock {
  now(): Date;
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private today(): string {
    return today(this.clock.now());
  }

  private async setting<T>(key: string, fallback: T): Promise<T> {
    const s = await this.settings.get<T>(key);
    return s?.value ?? fallback;
  }

  // ---------------------------------------------------------------- Référentiels

  async catalog() {
    const [cats, goals, durations, budgetTiers, availabilityTimes, maxActive, templates] = await Promise.all([
      this.db.select().from(projectCategories).where(eq(projectCategories.active, true)).orderBy(asc(projectCategories.sortOrder)),
      this.db.select().from(projectGoals).where(eq(projectGoals.active, true)).orderBy(asc(projectGoals.sortOrder)),
      this.setting<number[]>('projects.durations_days', [30, 60, 90]),
      this.setting<Record<string, string>>('projects.budget_tiers', {}),
      this.setting<Record<string, string>>('projects.availability_times', {}),
      this.setting<number | null>('projects.max_active', null),
      this.db
        .select({ categoryCode: programTemplates.categoryCode, goalCode: programTemplates.goalCode })
        .from(programTemplates)
        .where(eq(programTemplates.status, 'published')),
    ]);
    return {
      categories: cats.map((c) => ({
        code: c.code,
        label: c.label,
        icon: c.icon,
        tint: c.tint,
        goals: goals
          .filter((g) => g.categoryCode === c.code)
          .map((g) => ({ code: g.code, label: g.label, quantityUnit: g.quantityUnit, quantityMin: g.quantityMin, quantityMax: g.quantityMax })),
        hasValidatedPrograms: templates.some((t) => t.categoryCode === c.code),
      })),
      durationsDays: durations,
      budgetTiers,
      availabilityTimes,
      maxActive,
    };
  }

  // ---------------------------------------------------------------- Création

  async create(userId: string, dto: CreateProjectDto, meta: RequestMeta) {
    const errors: Record<string, string[]> = {};
    const [category] = await this.db.select().from(projectCategories).where(and(eq(projectCategories.code, dto.categoryCode), eq(projectCategories.active, true)));
    if (!category) errors.categoryCode = ['Catégorie inconnue.'];
    let goal: typeof projectGoals.$inferSelect | undefined;
    if (dto.goalCode) {
      [goal] = await this.db.select().from(projectGoals).where(and(eq(projectGoals.code, dto.goalCode), eq(projectGoals.active, true)));
      if (!goal || goal.categoryCode !== dto.categoryCode) errors.goalCode = ["Cet objectif n'appartient pas à la catégorie choisie."];
    }
    if (category && !goal && !dto.description?.trim()) {
      errors.description = ['Choisis un objectif ou décris-le.'];
    }
    if (goal?.quantityUnit) {
      const q = dto.targetQuantity;
      if (q == null || (goal.quantityMin != null && q < goal.quantityMin) || (goal.quantityMax != null && q > goal.quantityMax)) {
        errors.targetQuantity = [`Indique une valeur entre ${goal.quantityMin} et ${goal.quantityMax} ${goal.quantityUnit}.`];
      }
    }
    if (dto.mode === 'premium' && !dto.budget) errors.budget = ['Choisis un budget.'];
    if (dto.mode === 'eco' && dto.budget) errors.budget = ['Le projet économique ne comporte pas de budget.'];

    // Modèle validé et publié pour cette catégorie (et cet objectif s'il y en a un), sinon programme construit depuis les réponses.
    const template = category ? await this.findTemplate(dto.categoryCode, dto.goalCode ?? null) : null;
    let durationDays: number;
    if (template) {
      durationDays = template.durationDays;
    } else {
      const allowed = await this.setting<number[]>('projects.durations_days', [30, 60, 90]);
      durationDays = dto.durationDays ?? 0;
      if (!allowed.includes(durationDays)) errors.durationDays = [`Choisis une durée parmi : ${allowed.join(', ')} jours.`];
    }
    if (Object.keys(errors).length) throw Errors.validation({ fields: errors });

    const maxActive = await this.setting<number | null>('projects.max_active', null);
    const times = await this.setting<Record<string, string>>('projects.availability_times', {});
    const start = this.today();
    const projectId = uuidv7();
    const title = generateTitle({
      pattern: goal?.titlePattern,
      quantity: goal?.quantityUnit ? dto.targetQuantity : null,
      description: dto.description,
      categoryLabel: category!.label,
    });

    await this.db.transaction(async (tx) => {
      // Verrou par personne : deux créations simultanées ne peuvent pas dépasser la limite.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'projects:' + userId}))`);
      if (maxActive != null) {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(projects)
          .where(and(eq(projects.userId, userId), inArray(projects.status, [...OPEN_STATUSES])));
        if (n >= maxActive) {
          throw Errors.conflict('PROJECT_LIMIT_REACHED', `Tu as déjà ${maxActive} projets en cours. Termine ou supprime un projet pour en créer un nouveau.`);
        }
      }
      await tx.insert(projects).values({
        id: projectId,
        userId,
        categoryCode: dto.categoryCode,
        goalCode: goal?.code ?? null,
        templateId: template?.id ?? null,
        title,
        description: dto.description?.trim() || null,
        targetQuantity: goal?.quantityUnit ? dto.targetQuantity! : null,
        mode: dto.mode,
        budget: dto.mode === 'premium' ? dto.budget! : null,
        receiveMerchantOffers: dto.receiveMerchantOffers ?? false,
        heightCm: dto.heightCm ?? null,
        weightKg: dto.weightKg ?? null,
        level: dto.level ?? null,
        availability: dto.availability ?? null,
        sessionsPerWeek: dto.sessionsPerWeek ?? null,
        healthNote: dto.healthNote?.trim() || null,
        isPublic: dto.isPublic ?? false,
        startDate: start,
        durationDays,
        plannedEndDate: addDays(start, durationDays - 1),
      });

      if (template) {
        const rows = await tx.select().from(programTemplateTasks).where(eq(programTemplateTasks.templateId, template.id)).orderBy(asc(programTemplateTasks.sortOrder));
        if (rows.length) {
          await tx.insert(projectTasks).values(
            rows.map((r, i) => ({
              id: uuidv7(),
              projectId,
              title: r.title,
              detail: r.detail,
              icon: r.icon,
              timeOfDay: r.timeOfDay,
              weekdays: r.weekdays,
              origin: 'template',
              sortOrder: i,
            })),
          );
        }
      } else {
        // Sans modèle validé : une séance aux jours et à l'heure choisis à l'écran 23. Aucun contenu de coaching inventé.
        await tx.insert(projectTasks).values({
          id: uuidv7(),
          projectId,
          title: `Séance · ${goal?.label ?? category!.label}`,
          detail: 'Créée à partir de tes réponses. Modifie ton programme ou ajoute tes propres tâches.',
          icon: category!.icon,
          timeOfDay: times[dto.availability ?? 'afternoon'] ?? '15:00',
          weekdays: spreadWeekdays(dto.sessionsPerWeek ?? 3),
          origin: 'answers',
          sortOrder: 0,
        });
      }
      await tx.insert(projectEvents).values({ id: uuidv7(), projectId, type: 'created', payload: template ? `template:${template.id}` : 'answers' });
      await this.audit.log(
        { actorType: 'user', actorId: userId, action: 'project.created', targetType: 'project', targetId: projectId, ip: meta.ip, userAgent: meta.userAgent, metadata: { category: dto.categoryCode, mode: dto.mode } },
        tx,
      );
    });
    return this.detail(userId, projectId);
  }

  private async findTemplate(categoryCode: string, goalCode: string | null) {
    const published = await this.db
      .select()
      .from(programTemplates)
      .where(and(eq(programTemplates.categoryCode, categoryCode), eq(programTemplates.status, 'published')));
    return published.find((t) => t.goalCode === goalCode) ?? published.find((t) => t.goalCode === null) ?? null;
  }

  // ---------------------------------------------------------------- Lecture

  /** Charge un projet de la personne (404 sinon) et applique les transitions dues au temps (fin de pause, fin du programme). */
  private async load(userId: string, projectId: string): Promise<ProjectRow> {
    const [p] = await this.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!p || p.status === 'abandoned') throw Errors.notFound('Projet');
    const t = this.today();
    if (p.status === 'paused' && p.pausedUntil && t > p.pausedUntil) {
      const [u] = await this.db
        .update(projects)
        .set({ status: 'active', pausedUntil: null, updatedAt: new Date() })
        .where(and(eq(projects.id, p.id), eq(projects.status, 'paused')))
        .returning();
      if (u) return this.load(userId, projectId);
    }
    if (p.status === 'active' && t > p.plannedEndDate) {
      await this.db.transaction(async (tx) => {
        const [u] = await tx
          .update(projects)
          .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(projects.id, p.id), eq(projects.status, 'active')))
          .returning({ id: projects.id });
        if (u) await tx.insert(projectEvents).values({ id: uuidv7(), projectId: p.id, type: 'completed' });
      });
      return this.load(userId, projectId);
    }
    return p;
  }

  private async parts(projectId: string) {
    const [tasks, pauses] = await Promise.all([
      this.db.select().from(projectTasks).where(and(eq(projectTasks.projectId, projectId), isNull(projectTasks.removedAt))).orderBy(asc(projectTasks.timeOfDay), asc(projectTasks.sortOrder)),
      this.db.select().from(projectPauses).where(eq(projectPauses.projectId, projectId)),
    ]);
    const completions = tasks.length
      ? await this.db
          .select({ taskId: taskCompletions.taskId, day: taskCompletions.day })
          .from(taskCompletions)
          .where(inArray(taskCompletions.taskId, tasks.map((t) => t.id)))
      : [];
    return { tasks, pauses, completions: new Set(completions.map((c) => `${c.taskId}|${c.day}`)) };
  }

  private stats(p: ProjectRow, parts: { tasks: TaskRow[]; pauses: PauseRow[]; completions: Set<string> }) {
    return computePlan({
      startDate: p.startDate,
      plannedEndDate: p.plannedEndDate,
      tasks: parts.tasks,
      pauses: parts.pauses,
      completions: parts.completions,
      today: this.today(),
    });
  }

  private summary(p: ProjectRow, category: { label: string; icon: string } | undefined, s: ReturnType<ProjectsService['stats']>) {
    return {
      id: p.id,
      title: p.title,
      categoryCode: p.categoryCode,
      categoryLabel: category?.label ?? p.categoryCode,
      icon: category?.icon ?? 'check',
      mode: p.mode,
      status: p.status,
      isPublic: p.isPublic,
      startDate: p.startDate,
      plannedEndDate: p.plannedEndDate,
      pausedUntil: p.pausedUntil,
      durationDays: p.durationDays,
      currentDay: Math.min(s.currentDayIndex, p.durationDays),
      progress: s.progress,
      streak: s.streak,
    };
  }

  async list(userId: string) {
    const ids = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), inArray(projects.status, ['active', 'paused', 'completed'])))
      .orderBy(asc(projects.createdAt));
    const cats = await this.db.select().from(projectCategories);
    const items = [];
    for (const { id } of ids) {
      const p = await this.load(userId, id);
      items.push(this.summary(p, cats.find((c) => c.code === p.categoryCode), this.stats(p, await this.parts(p.id))));
    }
    // Écran 18 : projets en cours d'abord, puis terminés.
    items.sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));
    const maxActive = await this.setting<number | null>('projects.max_active', null);
    return { items, activeCount: items.filter((i) => i.status !== 'completed').length, maxActive, today: this.today() };
  }

  async detail(userId: string, projectId: string) {
    const p = await this.load(userId, projectId);
    const parts = await this.parts(p.id);
    const s = this.stats(p, parts);
    const [category] = await this.db.select().from(projectCategories).where(eq(projectCategories.code, p.categoryCode));
    const [goal] = p.goalCode ? await this.db.select().from(projectGoals).where(eq(projectGoals.code, p.goalCode)) : [];
    const doneSessions = s.completedOccurrences;
    return {
      ...this.summary(p, category, s),
      goal: goal ? { code: goal.code, label: goal.label, quantityUnit: goal.quantityUnit } : null,
      targetQuantity: p.targetQuantity,
      description: p.description,
      budget: p.budget,
      receiveMerchantOffers: p.receiveMerchantOffers,
      level: p.level,
      availability: p.availability,
      sessionsPerWeek: p.sessionsPerWeek,
      heightCm: p.heightCm,
      weightKg: p.weightKg,
      healthNote: p.healthNote,
      programSource: p.templateId ? 'template' : 'answers',
      totalSteps: s.totalOccurrences,
      completedSteps: doneSessions,
      bestStreak: s.bestStreak,
      tasks: parts.tasks.map((t) => ({ id: t.id, title: t.title, detail: t.detail, icon: t.icon, timeOfDay: t.timeOfDay, weekdays: t.weekdays, origin: t.origin })),
      days: s.days,
      today: this.today(),
    };
  }

  async day(userId: string, projectId: string, day: string) {
    if (!isValidDay(day)) throw Errors.validation({ fields: { day: ['Date invalide (AAAA-MM-JJ).'] } });
    const p = await this.load(userId, projectId);
    const parts = await this.parts(p.id);
    const s = this.stats(p, parts);
    const summary = s.days.find((d) => d.day === day);
    if (!summary) throw Errors.validation({ fields: { day: ['Ce jour ne fait pas partie du programme.'] } });
    const due = dueTasks(day, parts.tasks, parts.pauses);
    return {
      day,
      index: summary.index,
      durationDays: p.durationDays,
      state: summary.state,
      paused: summary.state === 'paused',
      editable: this.canCheck(p, day, parts.pauses),
      tasks: due.map((t) => ({ id: t.id, title: t.title, detail: t.detail, icon: t.icon, timeOfDay: t.timeOfDay, done: parts.completions.has(`${t.id}|${day}`) })),
    };
  }

  /** On coche le jour même ou un jour passé du programme (pas l'avenir), hors pause, sur un projet en cours. */
  private canCheck(p: ProjectRow, day: string, pauses: PauseRow[]): boolean {
    return p.status === 'active' && day >= p.startDate && day <= this.today() && day <= p.plannedEndDate && !isPaused(day, pauses);
  }

  // ---------------------------------------------------------------- Actions

  async setCompletion(userId: string, projectId: string, taskId: string, day: string, done: boolean) {
    if (!isValidDay(day)) throw Errors.validation({ fields: { day: ['Date invalide (AAAA-MM-JJ).'] } });
    const p = await this.load(userId, projectId);
    const parts = await this.parts(p.id);
    const task = parts.tasks.find((t) => t.id === taskId);
    if (!task) throw Errors.notFound('Tâche');
    if (!dueTasks(day, [task], []).length) throw Errors.conflict('TASK_NOT_DUE', "Cette tâche n'est pas prévue ce jour-là.");
    if (!this.canCheck(p, day, parts.pauses)) {
      throw Errors.conflict('DAY_NOT_EDITABLE', p.status === 'paused' ? 'Ton projet est en pause.' : 'Ce jour ne peut pas être modifié.');
    }
    if (done) {
      await this.db.insert(taskCompletions).values({ taskId, day }).onConflictDoNothing();
    } else {
      await this.db.delete(taskCompletions).where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.day, day)));
    }
    return this.day(userId, projectId, day);
  }

  /**
   * Le mode du projet (économique / Premium) est un choix gratuit, ouvert à toute personne, abonnée ou non (C6) :
   * il ne lit aucun droit d'abonnement et ne crée aucun paiement. Il change seulement le type de recommandations.
   */
  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const p = await this.load(userId, projectId);
    const set: Partial<ProjectRow> = { updatedAt: new Date() };
    if (dto.title !== undefined) set.title = dto.title.trim();
    if (dto.isPublic !== undefined) set.isPublic = dto.isPublic;
    if (dto.mode !== undefined || dto.budget !== undefined) {
      const mode = dto.mode ?? p.mode;
      const budget = mode === 'premium' ? (dto.budget ?? p.budget) : null;
      if (mode === 'eco' && dto.budget) throw Errors.validation({ fields: { budget: ['Le projet économique ne comporte pas de budget.'] } });
      if (mode === 'premium' && !budget) throw Errors.validation({ fields: { budget: ['Choisis un budget.'] } });
      set.mode = mode;
      set.budget = budget;
    }
    await this.db.update(projects).set(set).where(eq(projects.id, projectId));
    return this.detail(userId, projectId);
  }

  async addTask(userId: string, projectId: string, dto: AddTaskDto) {
    const p = await this.load(userId, projectId);
    if (p.status === 'completed') throw Errors.conflict('PROJECT_COMPLETED', 'Ce projet est terminé.');
    await this.db.insert(projectTasks).values({
      id: uuidv7(),
      projectId,
      title: dto.title.trim(),
      detail: dto.detail?.trim() || null,
      icon: 'check',
      timeOfDay: dto.timeOfDay,
      weekdays: dto.weekdays,
      origin: 'user',
      sortOrder: 100,
    });
    return this.detail(userId, projectId);
  }

  /** Retrait logique : l'historique des cases cochées reste en base. */
  async removeTask(userId: string, projectId: string, taskId: string) {
    const p = await this.load(userId, projectId);
    if (p.status === 'completed') throw Errors.conflict('PROJECT_COMPLETED', 'Ce projet est terminé.');
    const parts = await this.parts(p.id);
    if (!parts.tasks.some((t) => t.id === taskId)) throw Errors.notFound('Tâche');
    if (parts.tasks.length <= 1) throw Errors.conflict('LAST_TASK', 'Un programme garde au moins une tâche.');
    await this.db.update(projectTasks).set({ removedAt: new Date() }).where(eq(projectTasks.id, taskId));
    return this.detail(userId, projectId);
  }

  /** Écran 29 : la pause commence aujourd'hui ; la fin prévue est décalée d'autant de jours. */
  async pause(userId: string, projectId: string, dto: PauseDto, meta: RequestMeta) {
    const p = await this.load(userId, projectId);
    if (p.status !== 'active') throw Errors.conflict('PROJECT_NOT_ACTIVE', p.status === 'paused' ? 'Ton projet est déjà en pause.' : "Ce projet n'est pas en cours.");
    const max = await this.setting<number | null>('projects.pause_max_days', null);
    if (max != null && dto.days > max) throw Errors.validation({ fields: { days: [`Une pause dure au plus ${max} jours.`] } });
    const start = this.today();
    const end = addDays(start, dto.days - 1);
    await this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(projects)
        .set({ status: 'paused', pausedUntil: end, plannedEndDate: addDays(p.plannedEndDate, dto.days), updatedAt: new Date() })
        .where(and(eq(projects.id, p.id), eq(projects.status, 'active')))
        .returning({ id: projects.id });
      if (!u) throw Errors.conflict('PROJECT_NOT_ACTIVE', "Ce projet n'est pas en cours.");
      await tx.insert(projectPauses).values({ id: uuidv7(), projectId: p.id, startDay: start, endDay: end });
      await tx.insert(projectEvents).values({ id: uuidv7(), projectId: p.id, type: 'paused', payload: String(dto.days) });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'project.paused', targetType: 'project', targetId: p.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { days: dto.days } }, tx);
    });
    return this.detail(userId, projectId);
  }

  /** Reprise avant la fin de la pause : les jours non utilisés sont rendus (la fin prévue avance d'autant). */
  async resume(userId: string, projectId: string) {
    const p = await this.load(userId, projectId);
    if (p.status !== 'paused' || !p.pausedUntil) throw Errors.conflict('PROJECT_NOT_PAUSED', "Ce projet n'est pas en pause.");
    const t = this.today();
    await this.db.transaction(async (tx) => {
      const [pause] = await tx
        .select()
        .from(projectPauses)
        .where(and(eq(projectPauses.projectId, p.id), eq(projectPauses.endDay, p.pausedUntil!)))
        .limit(1);
      const unused = diffDays(p.pausedUntil!, t) + 1; // aujourd'hui redevient un jour de programme
      if (pause) {
        if (pause.startDay >= t) await tx.delete(projectPauses).where(eq(projectPauses.id, pause.id));
        else await tx.update(projectPauses).set({ endDay: addDays(t, -1), endedEarlyAt: new Date() }).where(eq(projectPauses.id, pause.id));
      }
      await tx
        .update(projects)
        .set({ status: 'active', pausedUntil: null, plannedEndDate: addDays(p.plannedEndDate, -Math.max(0, unused)), updatedAt: new Date() })
        .where(eq(projects.id, p.id));
      await tx.insert(projectEvents).values({ id: uuidv7(), projectId: p.id, type: 'resumed' });
    });
    return this.detail(userId, projectId);
  }

  /** E6 : suppression après confirmation (dans l'app) ; logique, l'historique est conservé. */
  async abandon(userId: string, projectId: string, meta: RequestMeta) {
    const p = await this.load(userId, projectId);
    await this.db.transaction(async (tx) => {
      await tx.update(projects).set({ status: 'abandoned', abandonedAt: new Date(), pausedUntil: null, updatedAt: new Date() }).where(eq(projects.id, p.id));
      await tx.insert(projectEvents).values({ id: uuidv7(), projectId: p.id, type: 'abandoned' });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'project.abandoned', targetType: 'project', targetId: p.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
  }
}
