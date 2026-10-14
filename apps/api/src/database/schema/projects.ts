import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * Module Projets BIM (lot 1, écrans 18 à 31).
 * - Catégories et objectifs : référentiels administrables (écrans 20 et 21).
 * - Modèles de programmes : rédigés et publiés par l'équipe BIM ; aucun n'est livré tant que le fondateur
 *   ne les a pas validés. Sans modèle publié, le programme est construit à partir des réponses de la personne.
 * - Un projet contient des routines (tâche + heure + jours de la semaine) ; chaque case cochée est un événement daté.
 * - Aucun paiement dans un projet (décision F4).
 */

export const projectCategories = pgTable('project_categories', {
  code: varchar('code', { length: 40 }).primaryKey(),
  label: varchar('label', { length: 60 }).notNull(),
  icon: varchar('icon', { length: 40 }).notNull(),
  /** Couleur de fond de la tuile (écran 20), au format #RRGGBB. */
  tint: varchar('tint', { length: 7 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const projectGoals = pgTable(
  'project_goals',
  {
    code: varchar('code', { length: 40 }).primaryKey(),
    categoryCode: varchar('category_code', { length: 40 })
      .notNull()
      .references(() => projectCategories.code),
    label: varchar('label', { length: 60 }).notNull(),
    /** Objectif chiffré (curseur de l'écran 21), ex. « kg ». Null = pas de quantité. */
    quantityUnit: varchar('quantity_unit', { length: 12 }),
    quantityMin: integer('quantity_min'),
    quantityMax: integer('quantity_max'),
    /** Formule du nom généré (E5) : {q} est remplacé par la quantité. Ex. « Perdre {q} kg ». */
    titlePattern: varchar('title_pattern', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('project_goals_category_idx').on(t.categoryCode, t.sortOrder)],
);

export const templateStatus = pgEnum('program_template_status', ['draft', 'published', 'archived']);

export const programTemplates = pgTable(
  'program_templates',
  {
    id: uuid('id').primaryKey(),
    categoryCode: varchar('category_code', { length: 40 })
      .notNull()
      .references(() => projectCategories.code),
    goalCode: varchar('goal_code', { length: 40 }).references(() => projectGoals.code),
    title: varchar('title', { length: 120 }).notNull(),
    durationDays: smallint('duration_days').notNull(),
    /**
     * Mode de projet auquel le programme s'adresse : eco (exercices, astuces, conseils, sans achat nécessaire),
     * premium (peut intégrer des produits, accessoires ou services), any (les deux). Sans lien avec l'abonnement (C6).
     */
    mode: varchar('mode', { length: 8 }).notNull().default('any'),
    status: templateStatus('status').notNull().default('draft'),
    /** Qui a validé le contenu (obligatoire pour publier). */
    validatedBy: varchar('validated_by', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('program_templates_lookup_idx').on(t.categoryCode, t.goalCode, t.status),
    check('program_templates_duration_ck', sql`${t.durationDays} BETWEEN 7 AND 365`),
    check('program_templates_published_validated_ck', sql`${t.status} <> 'published' OR ${t.validatedBy} IS NOT NULL`),
    check('program_templates_mode_ck', sql`${t.mode} IN ('any', 'eco', 'premium')`),
  ],
);

export const programTemplateTasks = pgTable('program_template_tasks', {
  id: uuid('id').primaryKey(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => programTemplates.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 80 }).notNull(),
  detail: varchar('detail', { length: 200 }),
  icon: varchar('icon', { length: 40 }).notNull().default('check'),
  /** Heure locale « HH:MM » (Abidjan, UTC+0). */
  timeOfDay: varchar('time_of_day', { length: 5 }).notNull(),
  /** Jours de la semaine : bit 0 = lundi … bit 6 = dimanche. 127 = tous les jours. */
  weekdays: smallint('weekdays').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * « Habitude du jour » (écran 27) : conseils rédigés dans un programme type validé. Jamais affichés pour un programme
 * construit depuis les réponses (aucun conseil n'est inventé par l'app). day = jour de programme (1 = premier jour) ;
 * un conseil sans jour précis (null) sert de conseil général, choisi selon le jour.
 */
export const programTemplateTips = pgTable(
  'program_template_tips',
  {
    id: uuid('id').primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => programTemplates.id, { onDelete: 'cascade' }),
    day: smallint('day'),
    text: varchar('text', { length: 240 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('program_template_tips_template_idx').on(t.templateId)],
);

export const projectMode = pgEnum('project_mode', ['eco', 'premium']);
export const projectBudget = pgEnum('project_budget', ['small', 'medium', 'boosted']);
export const projectLevel = pgEnum('project_level', ['beginner', 'intermediate', 'advanced']);
export const projectAvailability = pgEnum('project_availability', ['morning', 'noon', 'afternoon']);
export const projectStatus = pgEnum('project_status', ['active', 'paused', 'completed', 'abandoned']);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryCode: varchar('category_code', { length: 40 })
      .notNull()
      .references(() => projectCategories.code),
    goalCode: varchar('goal_code', { length: 40 }).references(() => projectGoals.code),
    templateId: uuid('template_id').references(() => programTemplates.id),
    title: varchar('title', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }),
    targetQuantity: integer('target_quantity'),
    mode: projectMode('mode').notNull(),
    budget: projectBudget('budget'),
    /** Écran 21 : enregistré dès maintenant ; les offres des marchands arrivent avec le lot 5. */
    receiveMerchantOffers: boolean('receive_merchant_offers').notNull().default(false),
    // Écran 23 — données privées, jamais affichées publiquement.
    heightCm: smallint('height_cm'),
    weightKg: smallint('weight_kg'),
    level: projectLevel('level'),
    availability: projectAvailability('availability'),
    sessionsPerWeek: smallint('sessions_per_week'),
    healthNote: varchar('health_note', { length: 300 }),
    isPublic: boolean('is_public').notNull().default(false),
    status: projectStatus('status').notNull().default('active'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    durationDays: smallint('duration_days').notNull(),
    /** Fin prévue = début + durée + jours de pause (écran 29 : « fin prévue le 16 déc. au lieu du 13 »). */
    plannedEndDate: date('planned_end_date', { mode: 'string' }).notNull(),
    pausedUntil: date('paused_until', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('projects_user_status_idx').on(t.userId, t.status),
    check('projects_duration_ck', sql`${t.durationDays} BETWEEN 7 AND 365`),
    check('projects_sessions_ck', sql`${t.sessionsPerWeek} IS NULL OR ${t.sessionsPerWeek} BETWEEN 1 AND 7`),
    check('projects_budget_mode_ck', sql`${t.mode} = 'premium' OR ${t.budget} IS NULL`),
    check('projects_height_ck', sql`${t.heightCm} IS NULL OR ${t.heightCm} BETWEEN 50 AND 250`),
    check('projects_weight_ck', sql`${t.weightKg} IS NULL OR ${t.weightKg} BETWEEN 20 AND 400`),
    check('projects_dates_ck', sql`${t.plannedEndDate} >= ${t.startDate}`),
  ],
);

export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 80 }).notNull(),
    detail: varchar('detail', { length: 200 }),
    icon: varchar('icon', { length: 40 }).notNull().default('check'),
    timeOfDay: varchar('time_of_day', { length: 5 }).notNull(),
    weekdays: smallint('weekdays').notNull(),
    /** template = issu d'un modèle validé ; answers = construit depuis les réponses de l'écran 23 ; user = ajouté par la personne. */
    origin: varchar('origin', { length: 10 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_tasks_project_idx').on(t.projectId),
    check('project_tasks_weekdays_ck', sql`${t.weekdays} BETWEEN 1 AND 127`),
    check('project_tasks_time_ck', sql`${t.timeOfDay} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('project_tasks_origin_ck', sql`${t.origin} IN ('template', 'answers', 'user')`),
  ],
);

/** Une ligne par occurrence cochée (tâche × jour). Décocher supprime la ligne. */
export const taskCompletions = pgTable(
  'task_completions',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.day] })],
);

/** Pauses (écran 29) : aucune tâche n'est due pendant une pause, la fin prévue est décalée d'autant. */
export const projectPauses = pgTable(
  'project_pauses',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    startDay: date('start_day', { mode: 'string' }).notNull(),
    endDay: date('end_day', { mode: 'string' }).notNull(),
    endedEarlyAt: timestamp('ended_early_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_pauses_project_idx').on(t.projectId),
    check('project_pauses_range_ck', sql`${t.endDay} >= ${t.startDay}`),
  ],
);

export const projectEvents = pgTable(
  'project_events',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    payload: text('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_events_project_idx').on(t.projectId, t.createdAt)],
);


/** Signalement d'un problème depuis la journée (écran 27), traité par le support dans l'administration. */
export const projectReports = pgTable(
  'project_reports',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    taskId: uuid('task_id').references(() => projectTasks.id, { onDelete: 'set null' }),
    /** unavailable (salle fermée, coach absent…) · too_hard · health (douleur, malaise) · content (tâche inadaptée) · other */
    reason: varchar('reason', { length: 16 }).notNull(),
    message: varchar('message', { length: 500 }),
    status: varchar('status', { length: 10 }).notNull().default('open'),
    resolution: varchar('resolution', { length: 500 }),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_reports_status_idx').on(t.status, t.createdAt),
    check('project_reports_reason_ck', sql`${t.reason} IN ('unavailable', 'too_hard', 'health', 'content', 'other')`),
    check('project_reports_status_ck', sql`${t.status} IN ('open', 'resolved')`),
  ],
);

/** Mesures déclarées par la personne (ex. poids) pour suivre un objectif chiffré ; jamais publiques. */
export const projectMeasurements = pgTable(
  'project_measurements',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Valeur en dixièmes d'unité (84,5 kg → 845), pour éviter les arrondis. */
    valueTenths: integer('value_tenths').notNull(),
    unit: varchar('unit', { length: 12 }).notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_measurements_project_idx').on(t.projectId, t.day), check('project_measurements_value_ck', sql`${t.valueTenths} > 0`)],
);

/**
 * Photos privées d'un projet (avant / après, écrans 22 et 31). Le fichier est ré-encodé (métadonnées et position GPS
 * supprimées) puis rangé dans un stockage privé ; il n'est servi que par des liens temporaires.
 */
export const projectPhotos = pgTable(
  'project_photos',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).notNull(),
    storageKey: varchar('storage_key', { length: 200 }).notNull().unique(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    takenDay: date('taken_day', { mode: 'string' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_photos_project_idx').on(t.projectId, t.kind), check('project_photos_kind_ck', sql`${t.kind} IN ('before', 'after')`)],
);
