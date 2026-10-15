/**
 * Calendrier d'un projet : fonctions pures (sans base), testées unitairement.
 * Les jours sont des dates « AAAA-MM-JJ » à l'heure d'Abidjan (UTC+0, sans heure d'été).
 * Jours de la semaine : bit 0 = lundi … bit 6 = dimanche.
 */

export type Day = string;

export interface PlanTask {
  id: string;
  weekdays: number;
  /** Premier jour où la tâche fait partie du programme (null ou absent = depuis le début). */
  activeFrom?: Day | null;
  /** Jour à partir duquel elle n'en fait plus partie (exclu ; null ou absent = toujours). */
  activeUntil?: Day | null;
}

/** La tâche faisait-elle partie du programme ce jour-là ? (tâches ajoutées ou retirées en cours de route) */
export function isActiveOn(task: PlanTask, day: Day): boolean {
  return (!task.activeFrom || day >= task.activeFrom) && (!task.activeUntil || day < task.activeUntil);
}

export interface PauseRange {
  startDay: Day;
  endDay: Day;
}

export type DayState = 'done' | 'missed' | 'partial' | 'today' | 'upcoming' | 'rest' | 'paused';

export function today(now: Date = new Date()): Day {
  return now.toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: Day, b: Day): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function isValidDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && today(new Date(`${day}T00:00:00Z`)) === day;
}

/** Bit du jour de la semaine (lundi = 1, dimanche = 64). */
export function weekdayBit(day: Day): number {
  const js = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  return 1 << ((js + 6) % 7);
}

export function isPaused(day: Day, pauses: PauseRange[]): boolean {
  return pauses.some((p) => day >= p.startDay && day <= p.endDay);
}

export function dueTasks<T extends PlanTask>(day: Day, tasks: T[], pauses: PauseRange[]): T[] {
  if (isPaused(day, pauses)) return [];
  const bit = weekdayBit(day);
  return tasks.filter((t) => (t.weekdays & bit) !== 0 && isActiveOn(t, day));
}

/**
 * Jours de séance répartis dans la semaine selon le nombre choisi (écran 23).
 * 3 → lundi, mercredi, vendredi ; 2 → mardi, samedi ; etc.
 */
export function spreadWeekdays(sessionsPerWeek: number): number {
  const patterns: Record<number, number[]> = {
    1: [2],
    2: [1, 5],
    3: [0, 2, 4],
    4: [0, 1, 3, 5],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return (patterns[sessionsPerWeek] ?? patterns[3]).reduce((acc, i) => acc | (1 << i), 0);
}

export interface PlanInput {
  startDate: Day;
  plannedEndDate: Day;
  tasks: PlanTask[];
  pauses: PauseRange[];
  /** Clés « idTâche|jour » des occurrences cochées. */
  completions: Set<string>;
  today: Day;
}

export interface DaySummary {
  day: Day;
  /** Numéro du jour de programme (les jours de pause ne comptent pas) ; null pendant une pause. */
  index: number | null;
  due: number;
  done: number;
  state: DayState;
}

export interface PlanStats {
  days: DaySummary[];
  totalOccurrences: number;
  completedOccurrences: number;
  /** 0 à 100, arrondi à l'entier inférieur. */
  progress: number;
  /** Jour de programme d'aujourd'hui (borné à la durée). */
  currentDayIndex: number;
  /** Jours consécutifs entièrement réalisés, jusqu'à aujourd'hui (aujourd'hui compte s'il est terminé). */
  streak: number;
  bestStreak: number;
  /** Coffres du chemin (écran 26, C8). */
  chests: Chest[];
}

/**
 * Coffre (écran 26, décision du fondateur du 15/10/2026) : récompense symbolique (badge et message de Peni),
 * jamais financière. Un coffre par semaine complète de programme (jours 1-7, 8-14… ; les jours de pause ne comptent
 * pas) et un coffre final pour tout le programme. Un coffre s'ouvre quand au moins 70 % des tâches prévues sur sa
 * période sont réellement cochées ; seules comptent les tâches qui faisaient partie du programme ce jour-là
 * (pas de tâche ajoutée après coup, pas de jour de pause, aucun jour de repos). Le coffre final ne s'ouvre qu'une
 * fois le dernier jour atteint. Le rattrapage d'un jour passé, déjà permis, compte.
 */
export interface Chest {
  kind: 'week' | 'final';
  /** Numéro de semaine (coffre de semaine), null pour le coffre final. */
  week: number | null;
  /** Jour du chemin où le coffre est posé (dernier jour de sa période). */
  day: Day;
  /** Numéros des jours de programme couverts. */
  fromIndex: number;
  toIndex: number;
  due: number;
  done: number;
  /** open : ouvert · upcoming : période en cours · missed : période passée sous le seuil (peut encore s'ouvrir par rattrapage). */
  state: 'open' | 'upcoming' | 'missed';
}

/** Seuil validé par le fondateur le 15/10/2026 : 70 % des tâches prévues de la période. */
export const CHEST_THRESHOLD_PERCENT = 70;

export function chestReached(done: number, due: number): boolean {
  // Calcul en entiers (pas d'arrondi) : 7 tâches sur 10 ouvrent le coffre, 6 sur 9 non (66 %).
  return due > 0 && done * 100 >= due * CHEST_THRESHOLD_PERCENT;
}

export function computeChests(days: DaySummary[], today: Day): Chest[] {
  const program = days.filter((d) => d.index !== null);
  const chests: Chest[] = [];
  const make = (kind: Chest['kind'], week: number | null, period: DaySummary[]): Chest | null => {
    const due = period.reduce((n, d) => n + d.due, 0);
    if (due === 0) return null; // aucune tâche prévue sur la période : pas de coffre
    const done = period.reduce((n, d) => n + d.done, 0);
    const last = period[period.length - 1];
    const ended = last.day < today;
    // Le coffre final attend le dernier jour : « Programme terminé » ne s'affiche jamais avant la fin.
    const open = chestReached(done, due) && (kind === 'week' || last.day <= today);
    return { kind, week, day: last.day, fromIndex: period[0].index!, toIndex: last.index!, due, done, state: open ? 'open' : ended ? 'missed' : 'upcoming' };
  };
  for (let w = 1; w * 7 <= program.length; w++) {
    const c = make('week', w, program.slice((w - 1) * 7, w * 7));
    if (c) chests.push(c);
  }
  if (program.length) {
    const c = make('final', null, program);
    if (c) chests.push(c);
  }
  return chests;
}

export function computePlan(input: PlanInput): PlanStats {
  const days: DaySummary[] = [];
  let total = 0;
  let completed = 0;
  let index = 0;
  for (let d = input.startDate; d <= input.plannedEndDate; d = addDays(d, 1)) {
    if (isPaused(d, input.pauses)) {
      days.push({ day: d, index: null, due: 0, done: 0, state: 'paused' });
      continue;
    }
    index += 1;
    const due = dueTasks(d, input.tasks, input.pauses);
    const done = due.filter((t) => input.completions.has(`${t.id}|${d}`)).length;
    total += due.length;
    completed += done;
    let state: DayState;
    if (due.length === 0) state = 'rest';
    else if (done === due.length) state = 'done';
    else if (d === input.today) state = 'today';
    else if (d > input.today) state = 'upcoming';
    else state = done > 0 ? 'partial' : 'missed';
    days.push({ day: d, index, due: due.length, done, state });
  }

  const past = days.filter((s) => s.day <= input.today && s.state !== 'paused' && s.due > 0);
  let streak = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const s = past[i];
    if (s.state === 'done') streak++;
    else if (s.day === input.today) continue; // aujourd'hui pas encore terminé : la série n'est pas rompue
    else break;
  }
  let best = 0;
  let run = 0;
  for (const s of past) {
    run = s.state === 'done' ? run + 1 : s.day === input.today ? run : 0;
    best = Math.max(best, run);
  }

  const reached = days.filter((s) => s.index !== null && s.day <= input.today);
  const currentDayIndex = reached.length ? (reached[reached.length - 1].index ?? 1) : 1;

  return {
    days,
    totalOccurrences: total,
    completedOccurrences: completed,
    progress: total === 0 ? 0 : Math.floor((completed * 100) / total),
    currentDayIndex,
    streak,
    bestStreak: best,
    chests: computeChests(days, input.today),
  };
}

/** Titre généré (E5) : depuis l'objectif choisi, sinon la description, sinon la catégorie. Modifiable ensuite. */
export function generateTitle(opts: { pattern?: string | null; quantity?: number | null; description?: string | null; categoryLabel: string }): string {
  if (opts.pattern) {
    return opts.pattern.includes('{q}') ? opts.pattern.replace('{q}', String(opts.quantity ?? '')).replace(/\s+/g, ' ').trim() : opts.pattern;
  }
  const desc = opts.description?.trim();
  if (desc) return desc.length <= 60 ? desc : `${desc.slice(0, 57).trimEnd()}…`;
  return `Mon projet ${opts.categoryLabel}`;
}
