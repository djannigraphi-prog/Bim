/**
 * Peni explique une tâche du programme (lot 3, écran 24). Fonction pure, textes écrits et versionnés ici, sans modèle
 * de langage.
 *
 * Règles :
 * - Aucun contenu de coaching inventé (décision C7 : le contenu des programmes est rédigé et validé par l'équipe BIM).
 *   Peni explique ce que contient vraiment le programme (tâche d'un programme validé, construite depuis les réponses,
 *   ou ajoutée par la personne), quand elle a lieu, ce qui se passe si elle n'est pas faite, et les rappels prévus.
 *   Les « bons réflexes » par catégorie sont des conseils généraux de prudence, pas un programme d'exercices
 *   (à relire par l'équipe BIM avec les programmes types).
 * - Aucun avis médical (R4) ; jamais culpabilisant (C8).
 * - Pauses, heures calmes et préférences de rappel de la personne : prises en compte dans le texte ; pendant les heures
 *   calmes, Peni n'invite pas à faire la tâche maintenant.
 */
import type { PeniPose } from './engine';

export const TASK_EXPLANATIONS_VERSION = 'v1';

export interface ExplainInput {
  task: { id: string; title: string; detail: string | null; timeOfDay: string; weekdays: number; origin: 'template' | 'answers' | 'user' | string };
  project: {
    status: string;
    /** Dernier jour de pause (inclus), si le projet est en pause. */
    pausedUntil: string | null;
    categoryCode: string;
    categoryLabel: string;
    goalLabel: string | null;
    programTitle: string | null;
    validatedBy: string | null;
  };
  reminders: {
    /** Service des rappels ouvert par BIM (réglage de la plateforme). */
    serviceOpen: boolean;
    /** Choix de la personne (désactivé par défaut). */
    enabledByPerson: boolean;
    /** Délais en minutes après l'heure de la tâche (ex. [0, 60, 120]). */
    offsets: number[];
    /** Heures calmes de la personne (ou celles par défaut), null = aucune. */
    quiet: { start: string; end: string } | null;
  };
  /** La personne consulte l'explication pendant ses heures calmes. */
  quietNow: boolean;
}

export interface ExplanationSection {
  id: 'what' | 'when' | 'how' | 'missed' | 'reminders';
  question: string;
  answer: string;
}

export interface TaskExplanation {
  taskId: string;
  title: string;
  intro: string;
  pose: PeniPose;
  sections: ExplanationSection[];
  version: string;
}

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** « 15 h », « 7 h 30 ». */
export function hourFr(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return m === '00' ? `${h} h` : `${h} h ${m}`;
}

/** « tous les jours », « le samedi et le dimanche », « le lundi, le mercredi et le vendredi ». */
export function weekdaysFr(weekdays: number): string {
  if (weekdays === 127) return 'tous les jours';
  const days = DAY_NAMES.filter((_, i) => (weekdays & (1 << i)) !== 0).map((d) => `le ${d}`);
  return days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} et ${days[days.length - 1]}`;
}

const countDays = (weekdays: number) => DAY_NAMES.filter((_, i) => (weekdays & (1 << i)) !== 0).length;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
function inQuiet(minutes: number, quiet: { start: string; end: string } | null): boolean {
  if (!quiet) return false;
  const t = ((minutes % 1440) + 1440) % 1440;
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}
const hhmmOf = (minutes: number) => {
  const t = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Bons réflexes généraux par catégorie (prudence, pas d'exercice prescrit). */
const GOOD_HABITS: Record<string, string> = {
  sport: 'Commence doucement : quelques minutes pour t’échauffer, puis va à ton rythme. Bois de l’eau, et arrête-toi si tu as mal. Au moindre doute sur ta santé, demande l’avis d’un professionnel de santé.',
  style_look: 'Prépare tes affaires la veille et prends quelques minutes devant le miroir. Pas besoin d’acheter : commence avec ce que tu as déjà.',
  visage_peau: 'Garde une routine simple et régulière. Avant un nouveau produit, essaie-le sur une petite zone de peau ; en cas de réaction, arrête et demande conseil à un professionnel.',
  cheveux_coiffure: 'Sois doux avec tes cheveux : peu de chaleur, pas de tension trop forte. Note ce qui te réussit.',
  ongles_mains: 'Garde tes mains et tes outils bien propres. Un petit moment régulier vaut mieux qu’un long de temps en temps.',
  maquillage: 'Commence par une base simple, devant une bonne lumière, et pense à bien te démaquiller le soir.',
  bien_etre_spa: 'Installe-toi au calme, respire tranquillement, sans écran si possible : ce moment est pour toi.',
};
const DEFAULT_HABIT = 'Va à ton rythme : l’important, c’est d’essayer.';

export function explainTask(i: ExplainInput): TaskExplanation {
  const { task, project, reminders } = i;
  const paused = project.status === 'paused';
  const intro = paused
    ? `Ton projet est en pause${project.pausedUntil ? ` jusqu’au ${frDate(project.pausedUntil)} inclus` : ''} : « ${task.title} » reprendra ensuite. Voici ce qu’il faut savoir 👇`
    : i.quietNow
      ? `Voici « ${task.title} » expliquée simplement 👇 Il est tard : rien ne presse, on s’y remet demain 🌙`
      : `Bonne question ! Voici « ${task.title} » expliquée simplement 👇`;

  // C'est quoi ?
  let what: string;
  if (task.origin === 'template') {
    const source = project.programTitle
      ? `Elle fait partie du programme type « ${project.programTitle} »${project.validatedBy ? `, validé par ${project.validatedBy}` : ''}.`
      : 'Elle fait partie d’un programme type de l’équipe BIM.';
    what = task.detail ? `${source} Le programme prévoit : ${task.detail}` : source;
  } else if (task.origin === 'user') {
    what = task.detail ? `C’est une tâche que tu as ajoutée toi-même : « ${task.detail} ». C’est toi qui décides de son contenu.` : 'C’est une tâche que tu as ajoutée toi-même : c’est toi qui décides de son contenu.';
  } else {
    const subject = project.goalLabel ? `${project.categoryLabel.toLowerCase()} · ${project.goalLabel.toLowerCase()}` : project.categoryLabel.toLowerCase();
    what =
      `C’est ta séance de ${subject}. Je l’ai préparée à partir de tes réponses. Le détail des exercices n’est pas encore rédigé par l’équipe BIM ` +
      'pour cette catégorie : en attendant, tu choisis ce que tu fais, à ton rythme.';
  }

  // Quand ?
  const n = countDays(task.weekdays);
  const when = `À ${hourFr(task.timeOfDay)}, ${weekdaysFr(task.weekdays)}${task.weekdays === 127 ? '' : ` : ${n} fois par semaine`}.${paused ? ' Rien n’est prévu pendant la pause.' : ''}`;

  // Comment m'y prendre ?
  const how = `${GOOD_HABITS[project.categoryCode] ?? DEFAULT_HABIT} Quand c’est fait, coche la tâche dans ta journée ✅`;

  // Et si je ne peux pas ?
  const missed =
    'Pas grave 💛 Une tâche non cochée ne te fait rien perdre : ton programme continue. Pour ouvrir le coffre de la semaine, ' +
    'il suffit d’en faire 70 %. Et si tu as besoin de souffler, tu peux mettre ton projet en pause depuis ta journée.';

  // Vais-je avoir un rappel ?
  let reminder: string;
  if (paused) reminder = 'Aucun rappel pendant la pause. Ils reprendront avec ton projet.';
  else if (!reminders.serviceOpen) reminder = 'Les rappels de Peni ne sont pas encore en service. Quand ils le seront, tu pourras les activer dans Paramètres → Rappels.';
  else if (!reminders.enabledByPerson) reminder = 'Tes rappels sont désactivés. Tu peux les activer quand tu veux dans Paramètres → Rappels.';
  else {
    const base = minutesOf(task.timeOfDay);
    const relaunches = reminders.offsets.filter((o) => o > 0);
    const kept = relaunches.filter((o) => !inQuiet(base + o, reminders.quiet)).map((o) => hourFr(hhmmOf(base + o)));
    const dropped = relaunches.length - kept.length;
    const quietLabel = reminders.quiet ? ` (${hourFr(reminders.quiet.start)} – ${hourFr(reminders.quiet.end)})` : '';
    reminder = `Je te rappelle à ${hourFr(task.timeOfDay)}`;
    if (kept.length) reminder += `, puis à ${kept.join(' et ')} si la tâche n’est pas cochée`;
    reminder += '.';
    if (dropped) reminder += ` ${dropped === relaunches.length ? 'Pas de relance ensuite' : 'Pas d’autre relance'} : elle${dropped > 1 ? 's' : ''} tomberai${dropped > 1 ? 'en' : ''}t pendant tes heures calmes${quietLabel}.`;
  }

  return {
    taskId: task.id,
    title: task.title,
    intro,
    pose: paused || i.quietNow ? 'happy' : 'think',
    sections: [
      { id: 'what', question: 'C’est quoi ?', answer: what },
      { id: 'when', question: 'Quand ?', answer: when },
      { id: 'how', question: 'Comment m’y prendre ?', answer: how },
      { id: 'missed', question: 'Et si je ne peux pas ?', answer: missed },
      { id: 'reminders', question: 'Vais-je avoir un rappel ?', answer: reminder },
    ],
    version: TASK_EXPLANATIONS_VERSION,
  };
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function frDate(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`;
}
