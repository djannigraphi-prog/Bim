/**
 * Encouragements de Peni dans la journée (écran 27) et sur la carte du projet (écran 26) — lot 3.
 *
 * Fonctions pures : textes écrits par l'équipe BIM et versionnés ici (catalogue commun de Peni, règle R4), sans modèle
 * de langage. Principes (décisions C8 et du 15/10/2026) : positifs, naturels, jamais culpabilisants ; aucun avis
 * médical ni promesse de résultat. Pendant les heures calmes (22 h – 6 h par défaut, ou celles de la personne), Peni
 * n'incite jamais à faire une tâche : il souhaite une bonne nuit ou invite à attendre le matin. Ces messages
 * s'affichent dans l'app seulement : aucune notification n'est envoyée.
 */
import type { Chest, DaySummary } from '../projects/plan';
import type { PeniPose } from './engine';

export const ENCOURAGEMENTS_VERSION = 'v1';

export interface EncouragementInput {
  context: 'day' | 'map';
  firstName: string;
  projectId: string;
  projectStatus: string;
  durationDays: number;
  /** Jour concerné : celui de l'écran 27, ou aujourd'hui sur la carte (null si hors du programme). */
  day: DaySummary | null;
  today: string;
  /** Dernier jour avec des tâches avant aujourd'hui (null s'il n'y en a pas). */
  previous: DaySummary | null;
  streak: number;
  /** Coffre de la semaine en cours (période pas encore terminée), s'il y en a un. */
  weekChest: Chest | null;
  /** Heure locale « HH:MM » de la personne. */
  localTime: string;
  /** Vrai pendant les heures calmes de la personne. */
  quiet: boolean;
}

export interface Encouragement {
  /** Situation reconnue (stable, pour les tests et les statistiques futures). */
  key: string;
  text: string;
  pose: PeniPose;
  version: string;
}

type Variant = (v: Vars) => string;
interface Vars {
  name: string;
  done: number;
  total: number;
  remaining: number;
  streak: number;
  left: number;
  needed: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Catalogue : plusieurs tournures par situation, choisies de façon stable pour la journée (ni répétitif, ni aléatoire). */
export const CATALOG: Record<string, { pose: PeniPose; variants: Variant[] }> = {
  quiet_done: { pose: 'cheer', variants: [() => 'Tout est fait pour aujourd’hui 🌙 Bravo, et bonne nuit !'] },
  quiet_night: {
    pose: 'happy',
    variants: [() => 'Il se fait tard 🌙 Repose-toi bien, on se retrouve demain.', () => 'C’est l’heure de se reposer 🌙 Demain est un nouveau jour, à ton rythme.'],
  },
  quiet_early: { pose: 'happy', variants: [() => 'Il est encore tôt 🌙 Rien ne presse : on s’y met quand la journée commence.'] },
  quiet_calm: { pose: 'happy', variants: [() => 'C’est ton moment calme 😌 Rien ne presse : on s’y remet plus tard.'] },
  completed: { pose: 'cheer', variants: [() => 'Programme terminé ! Bravo pour tout ce chemin 🎉'] },
  paused: { pose: 'happy', variants: [() => 'Ton projet est en pause. Repose-toi bien, je t’attends ! 💛'] },
  rest: {
    pose: 'happy',
    variants: [() => 'Pas de tâche prévue aujourd’hui : profite de ta journée de repos 😌', () => 'Journée de repos ! Recharge tes batteries, on reprend bientôt 🙂'],
  },
  not_started_yet: { pose: 'think', variants: [() => 'Ton programme commence bientôt. J’ai hâte qu’on s’y mette ensemble 🙂'] },
  future_day: { pose: 'think', variants: [() => 'Cette journée n’a pas encore commencé. On s’en occupera le moment venu 🙂'] },
  past_done: { pose: 'cheer', variants: [() => 'Journée réussie ✅ Bravo !'] },
  past_partial: { pose: 'happy', variants: [(v) => `${v.done} sur ${v.total} ce jour-là : chaque pas compte 👏`] },
  past_missed: { pose: 'happy', variants: [() => 'Ce jour-là n’a pas été coché. Pas grave : ce qui compte, c’est aujourd’hui 💛'] },
  today_done_streak: { pose: 'cheer', variants: [(v) => `Tout est fait, et ça fait ${v.streak} jours d’affilée 🔥 Bravo !`] },
  today_done: {
    pose: 'cheer',
    variants: [() => 'Tout est fait pour aujourd’hui. Bravo, je suis fière de toi ! 🎉', () => 'Mission du jour accomplie 💪 Tu peux être fier·ère de toi.'],
  },
  first_day: { pose: 'wave', variants: [() => 'C’est le premier jour ! 🎉 On commence ensemble ?'] },
  final_stretch: { pose: 'happy', variants: [(v) => `Plus que ${plural(v.left, 'jour', 'jours')} avant la fin du programme : tu y es presque ! 💪`] },
  chest_close: { pose: 'happy', variants: [(v) => `Plus que ${plural(v.needed, 'tâche', 'tâches')} cette semaine pour ouvrir ton coffre 🎁`] },
  comeback: {
    pose: 'wave',
    variants: [() => 'Nouveau jour, nouvelle chance ☀️ On reprend tranquillement ?', () => 'Contente de te revoir ! Aujourd’hui est une belle journée pour avancer 🙂'],
  },
  partial: {
    pose: 'happy',
    variants: [
      (v) => `${v.done} sur ${v.total}, c’est un bon début 👏 On continue ?`,
      (v) => `Déjà ${plural(v.done, 'tâche faite', 'tâches faites')} ! Il en reste ${v.remaining}, tu gères 💪`,
    ],
  },
  morning: { pose: 'wave', variants: [(v) => `Bonjour${v.name ? ` ${v.name}` : ''} ☀️ ${plural(v.total, 'tâche', 'tâches')} au programme aujourd’hui. On commence tranquillement ?`] },
  afternoon: { pose: 'happy', variants: [(v) => `${plural(v.total, 'tâche', 'tâches')} au programme aujourd’hui. Un petit pas suffit pour commencer 🙂`] },
  evening: { pose: 'think', variants: [() => 'Il reste encore un peu de temps aujourd’hui 🙂 Même une seule tâche, c’est déjà bien.'] },
};

/** Mots interdits dans tout encouragement (vérifiés par les tests sur toutes les situations). */
export const FORBIDDEN = /rat[ée]|[ée]chec|honte|d[ée]çu|nul\b|paress|dommage|tu n’as pas|tu n'as pas|supplie|dernier avertissement|perdu/i;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Situation du jour, par ordre de priorité. */
export function situation(i: EncouragementInput): string {
  if (i.projectStatus === 'completed') return 'completed';
  const d = i.day;
  if (!d) return i.projectStatus === 'paused' ? 'paused' : 'not_started_yet';
  if (d.state === 'paused') return 'paused';
  if (d.day < i.today) {
    if (d.state === 'rest') return 'rest';
    return d.state === 'done' ? 'past_done' : d.state === 'partial' ? 'past_partial' : 'past_missed';
  }
  if (i.projectStatus === 'paused') return 'paused';
  if (d.day > i.today) return 'future_day';
  if (d.state === 'rest') return 'rest';
  const hour = Number(i.localTime.slice(0, 2));
  const allDone = d.due > 0 && d.done === d.due;
  if (i.quiet) return allDone ? 'quiet_done' : hour >= 18 || hour < 4 ? 'quiet_night' : hour < 12 ? 'quiet_early' : 'quiet_calm';
  if (allDone) return i.streak >= 3 ? 'today_done_streak' : 'today_done';
  if (d.done === 0 && d.index === 1) return 'first_day';
  if (d.done === 0 && d.index !== null && i.durationDays - d.index + 1 <= 3) return 'final_stretch';
  if (i.context === 'map' && i.weekChest && i.weekChest.state === 'upcoming') {
    const missing = neededForChest(i.weekChest) - i.weekChest.done;
    if (missing > 0 && missing <= 3) return 'chest_close';
  }
  if (d.done > 0) return 'partial';
  if (i.previous && (i.previous.state === 'missed' || i.previous.state === 'partial')) return 'comeback';
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/** Tâches à cocher sur la période pour ouvrir le coffre (seuil de 70 %, calcul en entiers comme `chestReached`). */
export function neededForChest(c: Chest): number {
  return Math.ceil((c.due * 70) / 100);
}

export function encouragement(i: EncouragementInput): Encouragement {
  const key = situation(i);
  const entry = CATALOG[key];
  const d = i.day;
  const vars: Vars = {
    name: i.firstName,
    done: d?.done ?? 0,
    total: d?.due ?? 0,
    remaining: d ? d.due - d.done : 0,
    streak: i.streak,
    left: d?.index != null ? i.durationDays - d.index + 1 : 0,
    needed: i.weekChest ? neededForChest(i.weekChest) - i.weekChest.done : 0,
  };
  // Même tournure toute la journée pour un projet donné ; elle change d'un jour à l'autre.
  const variant = entry.variants[hash(`${i.projectId}|${d?.day ?? i.today}|${key}`) % entry.variants.length];
  return { key, text: variant(vars), pose: entry.pose, version: ENCOURAGEMENTS_VERSION };
}
