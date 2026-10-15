/**
 * Textes du centre de notifications (lot 2, écran 17), produits à la lecture (règle R1), versionnés ici.
 * Voix de Peni pour ce qui concerne les projets ; « BIM » pour l'équipe. Jamais de culpabilisation (décision C8),
 * pas de donnée de santé (pas de mesure), seulement ce que la personne a elle-même saisi (titres).
 */
import { reminderMessage } from './reminders';

/** v2 (15/10/2026) : suit les textes v3 des rappels. */
export const INBOX_TEMPLATES_VERSION = 'v2';

export type InboxType = 'chest_opened' | 'report_answered' | 'task_reminder';
export type InboxCategory = 'projects' | 'support';

export interface InboxSource {
  type: InboxType;
  projectTitle: string | null;
  /** chest_opened : « week:N » ou « final ». */
  chest: string | null;
  taskTitle: string | null;
  attempt: number | null;
  lastAttempt: boolean;
}

export const inboxCategory = (type: InboxType): InboxCategory => (type === 'report_answered' ? 'support' : 'projects');
export const inboxSender = (type: InboxType): 'peni' | 'bim' => (type === 'report_answered' ? 'bim' : 'peni');

const quoted = (title: string | null) => (title ? `« ${title} »` : 'ton projet');

export function inboxText(s: InboxSource): string {
  switch (s.type) {
    case 'chest_opened': {
      if (s.chest === 'final') return `Tu as ouvert le grand coffre de ${quoted(s.projectTitle)}. Bravo, je suis fière de toi !`;
      const week = /^week:(\d+)$/.exec(s.chest ?? '')?.[1];
      return week ? `Coffre de la semaine ${week} ouvert pour ${quoted(s.projectTitle)}. Continue comme ça !` : `Coffre ouvert pour ${quoted(s.projectTitle)}. Bravo !`;
    }
    case 'report_answered':
      return 'L’équipe BIM a répondu à ton signalement.';
    case 'task_reminder':
      return reminderMessage(s.taskTitle ?? '', s.attempt ?? 0, s.lastAttempt).body;
  }
}
