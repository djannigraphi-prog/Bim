/**
 * Messages de Peni à l'ouverture d'un coffre (écran 26) et à la fin du programme (écran 30) — lot 3.
 *
 * Catalogue commun de Peni (règle R4) : textes écrits par l'équipe BIM, versionnés, sans modèle de langage ; mêmes
 * principes que les encouragements (positifs, jamais culpabilisants, aucune promesse de résultat ni avis médical).
 * Les coffres sont symboliques : aucune valeur financière n'est jamais évoquée.
 */
import type { Chest } from '../projects/plan';
import type { PeniPose } from './engine';
import { neededForChest } from './encouragements';

export const MILESTONES_VERSION = 'v1';

export interface Milestone {
  key: string;
  title: string;
  text: string;
  pose: PeniPose;
  version: string;
}

type Vars = { week: number | null; done: number; due: number; needed: number; title: string };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export const MILESTONE_CATALOG: Record<string, { pose: PeniPose; title: (v: Vars) => string; text: (v: Vars) => string }> = {
  chest_week_open: {
    pose: 'cheer',
    title: (v) => `Semaine ${v.week} tenue !`,
    text: (v) => `Bravo, tu as fait ${plural(v.done, 'tâche', 'tâches')} sur ${v.due} cette semaine. Je suis tellement fière de toi !`,
  },
  chest_week_missed: {
    pose: 'happy',
    title: (v) => `Coffre de la semaine ${v.week}`,
    text: (v) => `Cette semaine a été plus difficile, ce n’est pas grave. Tu peux encore rattraper les jours passés : il faut ${v.needed} tâches sur ${v.due}, tu en as fait ${v.done}.`,
  },
  chest_week_upcoming: {
    pose: 'think',
    title: (v) => `Coffre de la semaine ${v.week}`,
    text: (v) => `Fais au moins ${v.needed} des ${v.due} tâches prévues cette semaine pour l’ouvrir. Pour l’instant : ${v.done}.`,
  },
  chest_final_open: {
    pose: 'cheer',
    title: () => 'Programme terminé !',
    text: (v) => `Tu as fait ${plural(v.done, 'tâche', 'tâches')} sur ${v.due}. Tu peux être fier·ère de toi, moi je le suis !`,
  },
  chest_final_missed: {
    pose: 'happy',
    title: () => 'Coffre final',
    text: (v) => `Il manquait quelques tâches pour l’ouvrir (${v.done} sur ${v.due}). Tout ce que tu as accompli compte, et tu peux recommencer quand tu veux.`,
  },
  chest_final_upcoming: {
    pose: 'think',
    title: () => 'Coffre final',
    text: (v) => `Il s’ouvre le dernier jour si tu as fait au moins ${v.needed} des ${v.due} tâches du programme. Pour l’instant : ${v.done}.`,
  },
  program_completed: {
    pose: 'cheer',
    title: () => 'Programme terminé !',
    text: (v) => `Tu es allé·e au bout de « ${v.title} ». Je suis tellement fière de toi ❤️`,
  },
};

function render(key: string, v: Vars): Milestone {
  const e = MILESTONE_CATALOG[key];
  return { key, title: e.title(v), text: e.text(v), pose: e.pose, version: MILESTONES_VERSION };
}

/** Message de Peni pour un coffre, selon son état (ouvert, période en cours, période passée sous le seuil). */
export function chestMilestone(c: Chest): Milestone {
  return render(`chest_${c.kind}_${c.state}`, { week: c.week, done: c.done, due: c.due, needed: neededForChest(c), title: '' });
}

/** Message de Peni à la fin du programme (écran 30) ; null tant que le projet n'est pas terminé. */
export function completionMilestone(p: { status: string; title: string }): Milestone | null {
  return p.status === 'completed' ? render('program_completed', { week: null, done: 0, due: 0, needed: 0, title: p.title }) : null;
}
