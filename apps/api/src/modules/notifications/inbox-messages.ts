/**
 * Textes du centre de notifications (lot 2, écran 17), produits à la lecture (règle R1), versionnés ici.
 * Voix de Peni pour ce qui concerne les projets ; « BIM » pour l'équipe. Jamais de culpabilisation (décision C8),
 * pas de donnée de santé (pas de mesure), seulement ce que la personne a elle-même saisi (titres).
 */
import { reminderMessage } from './reminders';

/**
 * v2 (15/10/2026) : suit les textes v3 des rappels. Le 16/10/2026 (lot 4), types sociaux ajoutés (j'aime, commentaire,
 * abonnement, contenu masqué) sans changer les textes existants : la version reste v2. Lot 9 : pièces reçues (ajout).
 */
export const INBOX_TEMPLATES_VERSION = 'v2';

export type InboxType = 'chest_opened' | 'report_answered' | 'task_reminder' | 'post_liked' | 'post_commented' | 'new_follower' | 'content_hidden' | 'merchant_approved' | 'merchant_rejected' | 'project_offer' | 'order_update' | 'coins_received';
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

const SOCIAL: InboxType[] = ['post_liked', 'post_commented', 'new_follower', 'coins_received'];
export const inboxCategory = (type: InboxType): InboxCategory =>
  type === 'report_answered' || type === 'content_hidden' || type === 'merchant_approved' || type === 'merchant_rejected' || type === 'order_update' ? 'support' : SOCIAL.includes(type) ? 'social' : 'projects';
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
    case 'coins_received': {
      const n = Number(s.chest ?? 0);
      const what = s.snippet === 'comment' ? 'ton commentaire' : 'ta publication';
      return `${s.actorName ?? 'Quelqu’un'} t’a envoyé ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} pièce${n > 1 ? 's' : ''} sur ${what}. Bravo !`;
    }
    case 'new_follower':
      return `${s.actorName ?? 'Quelqu’un'} s’est abonné·e à toi.`;
    case 'order_update': {
      const shop = `« ${s.actorName ?? 'La boutique'} »`;
      const n = s.chest ?? '';
      const texts: Record<string, string> = {
        proposed: `${shop} te propose une commande (${n}). Tu restes libre de l’accepter ou de la refuser.`,
        confirmed: `${shop} a confirmé ta commande ${n}.`,
        declined: `${shop} n’a pas pu accepter ta commande ${n}.`,
        ready: `Ta commande ${n} est prête.`,
        handed_over: `Ta commande ${n} t’a été remise. Merci !`,
        cancelled: `${shop} a annulé ta commande ${n}.`,
        proposal_withdrawn: `${shop} a retiré sa proposition ${n}.`,
        expired: `La commande ${n} a expiré sans confirmation.`,
        courier_assigned: `Un livreur a accepté de livrer ta commande ${n}.`,
        picked_up: `Ta commande ${n} est en route.`,
        courier_arrived: `Le livreur est arrivé avec ta commande ${n}. Vérifie l’article avant de donner ton code.`,
        delivered: `Ta commande ${n} est livrée. Merci !`,
      };
      return texts[s.snippet ?? ''] ?? `Ta commande ${n} a été mise à jour.`;
    }
    case 'project_offer':
      return `« ${s.snippet ?? ''} » te propose une offre pour ${quoted(s.projectTitle)}. Tu restes libre de la refuser.`;
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
