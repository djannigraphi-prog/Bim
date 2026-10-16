/**
 * Textes du centre de notifications (lot 2, écran 17), produits à la lecture (règle R1), versionnés ici.
 * Voix de Peni pour ce qui concerne les projets ; « BIM » pour l'équipe. Jamais de culpabilisation (décision C8),
 * pas de donnée de santé (pas de mesure), seulement ce que la personne a elle-même saisi (titres).
 */
import { reminderMessage } from './reminders';

/**
 * v2 (15/10/2026) : suit les textes v3 des rappels. Le 16/10/2026 (lot 4), types sociaux ajoutés (j'aime, commentaire,
 * abonnement, contenu masqué) sans changer les textes existants : la version reste v2.
 */
export const INBOX_TEMPLATES_VERSION = 'v2';

export type InboxType = 'chest_opened' | 'report_answered' | 'task_reminder' | 'post_liked' | 'post_commented' | 'new_follower' | 'content_hidden' | 'merchant_approved' | 'merchant_rejected';
export type InboxCategory = 'projects' | 'support' | 'social';

export interface InboxSource {
  type: InboxType;
  projectTitle: string | null;
  /** chest_opened : « week:N » ou « final ». */
  chest: string | null;
  taskTitle: string | null;
  attempt: number | null;
  lastAttempt: boolean;
  /** Social : nom de la personne qui a agi ; extrait du commentaire ; type de contenu masqué. */
  actorName?: string | null;
  snippet?: string | null;
}

const SOCIAL: InboxType[] = ['post_liked', 'post_commented', 'new_follower'];
export const inboxCategory = (type: InboxType): InboxCategory =>
  type === 'report_answered' || type === 'content_hidden' || type === 'merchant_approved' || type === 'merchant_rejected' ? 'support' : SOCIAL.includes(type) ? 'social' : 'projects';
export const inboxSender = (type: InboxType): 'peni' | 'bim' => (type === 'chest_opened' || type === 'task_reminder' ? 'peni' : 'bim');

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
    case 'post_liked':
      return `${s.actorName ?? 'Quelqu’un'} a aimé ta publication.`;
    case 'post_commented': {
      const t = (s.snippet ?? '').trim();
      return t ? `${s.actorName ?? 'Quelqu’un'} a commenté ta publication : « ${t.length > 80 ? `${t.slice(0, 79)}…` : t} »` : `${s.actorName ?? 'Quelqu’un'} a commenté ta publication.`;
    }
    case 'new_follower':
      return `${s.actorName ?? 'Quelqu’un'} s’est abonné·e à toi.`;
    case 'merchant_approved':
      return `Ta boutique « ${s.snippet ?? ''} » est validée par l’équipe BIM. Bienvenue parmi les marchands !`;
    case 'merchant_rejected':
      return `Ta demande pour « ${s.snippet ?? ''} » est à corriger avant d’ouvrir ta boutique. Consulte le motif dans ta demande.`;
    case 'content_hidden': {
      const what = s.snippet === 'comment' ? 'Un de tes commentaires a été masqué' : s.snippet === 'story' ? 'Une de tes stories a été masquée' : 'Une de tes publications a été masquée';
      return `${what} par la modération de BIM, après un signalement. Si tu penses que c’est une erreur, écris-nous depuis « Résoudre un problème ».`;
    }
  }
}
