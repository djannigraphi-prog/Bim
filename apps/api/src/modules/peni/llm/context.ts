/**
 * Contexte minimal envoyé à un fournisseur d'IA (étape 2, sans fournisseur réel). Principe : n'envoyer que ce qui sert
 * à reformuler la réponse de Peni.
 *
 * Jamais envoyé : identifiants (personne, discussion, projet), prénom (remplacé par {prenom}), description libre du
 * projet, historique de la discussion, numéros de téléphone, adresses e-mail et liens (masqués dans le message de la
 * personne). Le message de la personne n'est envoyé que s'il est écrit (pas pour un bouton) et coupé à 300 caractères.
 */
import type { EngineContext, EngineInput, PeniReply, PeniState } from '../engine';

export const NAME_PLACEHOLDER = '{prenom}';
const MAX_USER_TEXT = 300;

export interface PeniAiContext {
  etape: string;
  deja_compris: Record<string, string | number>;
  message_personne?: string;
  reponses: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Masque prénom, e-mails, liens et numéros de téléphone (8 chiffres ou plus, espaces et points compris). */
export function scrub(text: string, firstName: string): string {
  let t = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail masqué]')
    .replace(/\b(https?:\/\/|www\.)[^\s,;!?)]+/gi, '[lien masqué]')
    .replace(/(\+?\d[\d\s.-]{6,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[numéro masqué]' : m));
  const name = firstName.trim();
  if (name.length >= 2) t = t.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, 'giu'), `$1${NAME_PLACEHOLDER}`);
  return t;
}

/** Ce que Peni a compris, en libellés (pas d'identifiant interne, pas de texte libre). */
function understood(state: PeniState, ctx: EngineContext): Record<string, string | number> {
  const s = state.slots;
  const out: Record<string, string | number> = {};
  const cat = ctx.catalog.categories.find((c) => c.code === s.categoryCode);
  if (cat) out.domaine = cat.label;
  const goal = cat?.goals.find((g) => g.code === s.goalCode);
  if (goal) out.objectif = goal.label;
  if (s.targetQuantity !== undefined) out.quantite = s.targetQuantity;
  if (s.sessionsPerWeek !== undefined) out.seances_par_semaine = s.sessionsPerWeek;
  if (s.availability) out.moment = { morning: 'le matin', noon: 'à midi', afternoon: 'l’après-midi' }[s.availability];
  if (s.mode) out.mode = s.mode === 'eco' ? 'Éco' : 'Premium';
  if (s.durationDays !== undefined) out.duree_jours = s.durationDays;
  return out;
}

export function buildContext(state: PeniState, input: EngineInput, replies: PeniReply[], ctx: EngineContext): PeniAiContext {
  const c: PeniAiContext = { etape: state.step, deja_compris: understood(state, ctx), reponses: replies.map((r) => scrub(r.text, ctx.firstName)) };
  if (input.text) c.message_personne = scrub(input.text.slice(0, MAX_USER_TEXT), ctx.firstName);
  return c;
}
