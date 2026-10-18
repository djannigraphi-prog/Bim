/**
 * Calcul des rappels (lot 2) : fonctions pures, sans base ni réseau, testées unitairement.
 *
 * Un rappel est une occurrence « tâche × jour × tentative » : la tentative n°0 part à l'heure de la tâche, les suivantes
 * après les délais du réglage `notifications.reminder_offsets_minutes` (proposition non validée : 0, +60, +120 min).
 * Chaque occurrence a une **clé stable** : elle sert d'identifiant anti-doublon jusqu'à l'envoi (une clé = un envoi au plus).
 * Le calcul se fait à l'heure locale de la personne (fuseau IANA) ; les jours de pause, les jours hors programme, les
 * tâches hors de leur période active et les tâches déjà cochées ne donnent aucun rappel.
 *
 * Heures calmes, option B (décision du fondateur du 15/10/2026, 15 h 44) : le rappel **à l'heure choisie** (tentative 0)
 * part même pendant les heures calmes, puisque c'est la personne qui a placé sa tâche à cette heure ; les relances
 * (tentatives 1 et suivantes) qui y tombent sont **supprimées**, jamais reportées.
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

/** Option B : seul le rappel à l'heure choisie (tentative 0) est permis pendant les heures calmes. */
export function quietExempt(attempt: number): boolean {
  return attempt === 0;
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
  // « paused » accepté : les jours de pause sont exclus par date (audit du 18/10/2026, statut resté en base après la pause).
  if ((ctx.status !== 'active' && ctx.status !== 'paused') || to <= from) return [];
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
        if (!quietExempt(attempt) && inQuietHours(localHHMM(fireAt, ctx.timeZone), ctx.quiet)) return;
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
 * Texte d'un rappel dans la voix de Peni (règle R1 de docs/DEPENDANCES_LOTS_2_3.md : produit à l'envoi, versionné ici),
 * avec la pose de Peni affichée par le téléphone (R1 : « la pose de Peni » fait partie de la notification).
 * Jamais de donnée sensible sur l'écran verrouillé : pas de santé, pas de mesure ; le titre de la tâche choisi par la personne.
 *
 * v2 (15/10/2026) : rapprochée de la maquette 28.
 * v3 (15/10/2026, décision du fondateur de 15 h 44 : principe des textes validé, **provisoires** jusqu'à la vérification
 * sur vrais téléphones) : encourageants, jamais culpabilisants ; la tâche est **au début** du texte, car Android n'affiche
 * qu'environ 40 caractères d'une notification repliée ; la pose triste du dernier rappel est remplacée par la joyeuse.
 */
export const REMINDER_TEMPLATES_VERSION = 'v3';
export type PeniPose = 'happy' | 'think' | 'sad';
export function reminderMessage(taskTitle: string, attempt: number, lastAttempt: boolean): { title: string; body: string; pose: PeniPose } {
  const task = taskTitle.length > 60 ? `${taskTitle.slice(0, 57)}…` : taskTitle;
  if (attempt === 0) return { title: 'Peni', body: `${task} : c’est l’heure ! 💪 Tu vas tout déchirer.`, pose: 'happy' };
  if (!lastAttempt) return { title: 'Peni', body: `${task} t’attend encore. Un petit pas aujourd’hui, c’est déjà gagné 🙂`, pose: 'think' };
  return { title: 'Peni', body: `${task} : encore un peu de temps ! Et sinon, demain est une nouvelle chance 💛`, pose: 'happy' };
}
