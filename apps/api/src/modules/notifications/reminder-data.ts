import { and, eq, inArray, sql } from 'drizzle-orm';
import { Database } from '../../database/database.module';
import { projectPauses, projects, projectTasks, taskCompletions } from '../../database/schema';
import { SettingsService } from '../settings/settings.service';
import { QuietWindow, ReminderContext } from './reminders';

/**
 * Données communes au calcul des rappels, utilisées par le worker (envoi par le serveur) et par la liste des rappels
 * à venir (notifications programmées sur le téléphone) : un seul calcul, les mêmes règles et les mêmes textes.
 */

export type ReminderSettings = { enabled: boolean; offsets: number[]; quiet: QuietWindow | null; graceMinutes: number };

export async function loadReminderSettings(settings: SettingsService): Promise<ReminderSettings> {
  const [enabled, offsets, quiet, grace] = await Promise.all([
    settings.get<boolean>('notifications.reminders_enabled'),
    settings.get<number[]>('notifications.reminder_offsets_minutes'),
    settings.get<QuietWindow | null>('notifications.quiet_hours'),
    settings.get<number>('notifications.reminder_grace_minutes'),
  ]);
  return { enabled: enabled?.value === true, offsets: offsets?.value ?? [0], quiet: quiet?.value ?? null, graceMinutes: grace?.value ?? 30 };
}

/** Fuseau et heures calmes personnelles d'une personne (null = valeur de la plateforme). */
export interface ReminderPerson {
  tz: string;
  quiet_start: string | null;
  quiet_end: string | null;
}

/**
 * Contextes de calcul des projets actifs de ces personnes. `since` borne la lecture des tâches cochées
 * (deux jours avant : un rappel « +2 h » d'une tâche de la veille reste connu).
 */
export async function loadReminderContexts(
  db: Database,
  people: Map<string, ReminderPerson>,
  s: ReminderSettings,
  since: Date,
): Promise<Array<{ userId: string; ctx: ReminderContext }>> {
  if (!people.size) return [];
  // Audit du 18/10/2026 : un projet reste « paused » en base tant que la personne ne l'a pas rouvert, même après la fin
  // de la pause. Les jours de pause sont exclus par date (dueTasks) : les projets en pause sont donc lus aussi.
  const projectRows = await db.select().from(projects).where(and(inArray(projects.status, ['active', 'paused']), inArray(projects.userId, [...people.keys()])));
  if (!projectRows.length) return [];
  const ids = projectRows.map((p) => p.id);
  const [tasks, pauses] = await Promise.all([
    db.select().from(projectTasks).where(inArray(projectTasks.projectId, ids)),
    db.select().from(projectPauses).where(inArray(projectPauses.projectId, ids)),
  ]);
  const done = tasks.length
    ? await db
        .select({ taskId: taskCompletions.taskId, day: taskCompletions.day })
        .from(taskCompletions)
        .where(and(inArray(taskCompletions.taskId, tasks.map((t) => t.id)), sql`${taskCompletions.day} >= (${since}::timestamptz - interval '2 days')::date`))
    : [];
  const completions = new Set(done.map((c) => `${c.taskId}|${c.day}`));
  return projectRows.map((p) => {
    const person = people.get(p.userId)!;
    return {
      userId: p.userId,
      ctx: {
        projectId: p.id,
        status: p.status,
        startDate: p.startDate,
        plannedEndDate: p.plannedEndDate,
        tasks: tasks.filter((t) => t.projectId === p.id),
        pauses: pauses.filter((x) => x.projectId === p.id),
        completions,
        timeZone: person.tz,
        offsets: s.offsets,
        quiet: person.quiet_start && person.quiet_end ? { start: person.quiet_start, end: person.quiet_end } : s.quiet,
      },
    };
  });
}
