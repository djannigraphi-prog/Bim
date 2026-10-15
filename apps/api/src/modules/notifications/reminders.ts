/**
 * Calcul des rappels (lot 2) : fonctions pures, sans base ni réseau, testées unitairement.
 *
 * Un rappel est une occurrence « tâche × jour × tentative » : la tentative n°0 part à l'heure de la tâche, les suivantes
 * après les délais du réglage `notifications.reminder_offsets_minutes` (proposition non validée : 0, +60, +120 min).
 * Chaque occurrence a une **clé stable** : elle sert d'identifiant anti-doublon jusqu'à l'envoi (une clé = un envoi au plus).
 * Le calcul se fait à l'heure locale de la personne (fuseau IANA) ; les jours de pause, les jours hors programme, les
 * tâches hors de leur période active, les tâches déjà cochées et les heures calmes ne donnent aucun rappel.
 */
import { zonedTime } from '../../common/timezone';
import { addDays, Day, dueTasks, PauseRange, PlanTask, today } from '../projects/plan';

export interface ReminderTask extends PlanTask {
  title: string;
  /** « HH:MM », heure locale. */
  timeOfDay: string;
}

export interface QuietWindow {
  start: string;
  end: string;
}

export interface ReminderContext {
  projectId: string;
  /** Seuls les projets « active » reçoivent des rappels (pas en pause, pas terminés, pas abandonnés). */
  status: string;
  startDate: Day;
  plannedEndDate: Day;
  tasks: ReminderTask[];
  pauses: PauseRange[];
  /** Clés « idTâche|jour » des occurrences cochées. */
  completions: Set<string>;
  timeZone: string;
  /** Délais en minutes après l'heure de la tâche, croissants (ex. [0, 60, 120]). */
  offsets: number[];
  /** Heures calmes à l'heure locale (null = aucune). */
  quiet: QuietWindow | null;
}

export interface ReminderOccurrence {
  /** Clé anti-doublon : « projet|tâche|jour|tentative ». */
  key: string;
  projectId: string;
  taskId: string;
  day: Day;
  attempt: number;
  fireAt: Date;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** L'heure locale « HH:MM » tombe-t-elle dans les heures calmes ? (fenêtre qui peut passer minuit, ex. 22:00 → 06:00) */
export function inQuietHours(localHHMM: string, quiet: QuietWindow | null): boolean {
  if (!quiet) return false;
  const t = minutesOf(localHHMM);
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
function localHHMM(at: Date, timeZone: string): string {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(timeZone, f);
  }
  return f.format(at);
}

export function reminderKey(projectId: string, taskId: string, day: Day, attempt: number): string {
  return `${projectId}|${taskId}|${day}|${attempt}`;
}

/**
 * Rappels dont l'heure d'envoi tombe dans ]from, to]. Appelée chaque minute par le planificateur : chaque occurrence
 * n'apparaît que dans une seule fenêtre, et la clé empêche tout doublon si deux planificateurs se recouvrent.
 */
export function dueReminders(ctx: ReminderContext, from: Date, to: Date): ReminderOccurrence[] {
  if (ctx.status !== 'active' || to <= from) return [];
  const out: ReminderOccurrence[] = [];
  const maxOffset = Math.max(0, ...ctx.offsets);
  // Jours locaux à examiner : la fenêtre, élargie du plus long délai (un rappel « +2 h » d'une tâche de la veille).
  const firstDay = today(new Date(from.getTime() - maxOffset * 60_000 - 24 * 3600_000), ctx.timeZone);
  const lastDay = today(to, ctx.timeZone);
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    if (day < ctx.startDate || day > ctx.plannedEndDate) continue;
    for (const task of dueTasks(day, ctx.tasks, ctx.pauses)) {
      if (ctx.completions.has(`${task.id}|${day}`)) continue;
      const base = zonedTime(day, task.timeOfDay, ctx.timeZone).getTime();
      ctx.offsets.forEach((offset, attempt) => {
        const fireAt = new Date(base + offset * 60_000);
        if (fireAt <= from || fireAt > to) return;
        if (inQuietHours(localHHMM(fireAt, ctx.timeZone), ctx.quiet)) return;
        out.push({ key: reminderKey(ctx.projectId, task.id, day, attempt), projectId: ctx.projectId, taskId: task.id, day, attempt, fireAt });
      });
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

/** Un rappel trop en retard (panne, reprise) n'est plus envoyé : il serait inutile, voire gênant. */
export function isStale(fireAt: Date, now: Date, graceMinutes: number): boolean {
  return now.getTime() - fireAt.getTime() > graceMinutes * 60_000;
}

/**
 * Texte d'un rappel dans la voix de Peni (règle R1 de docs/DEPENDANCES_LOTS_2_3.md : produit à l'envoi, versionné ici).
 * Jamais de donnée sensible sur l'écran verrouillé : pas de santé, pas de mesure ; le titre de la tâche choisi par la personne.
 */
export const REMINDER_TEMPLATES_VERSION = 'v1';
export function reminderMessage(taskTitle: string, attempt: number, lastAttempt: boolean): { title: string; body: string } {
  const task = taskTitle.length > 60 ? `${taskTitle.slice(0, 57)}…` : taskTitle;
  if (attempt === 0) return { title: 'Peni', body: `C’est l’heure : ${task}. On y va ?` };
  if (!lastAttempt) return { title: 'Peni', body: `Petit rappel : ${task} t’attend encore aujourd’hui.` };
  return { title: 'Peni', body: `${task} : il est encore temps. Je crois en toi !` };
}
