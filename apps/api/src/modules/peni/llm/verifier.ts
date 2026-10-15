/**
 * Vérification de la réponse d'un fournisseur d'IA avant tout affichage (étape 2). Tout ou rien : un seul texte refusé
 * et c'est la réponse écrite du moteur guidé qui part, intacte. Le refus donne une raison courte (journal, sans contenu).
 *
 * Refusé : JSON absent ou mal formé ; nombre de textes différent ; texte vide ou de plus de 600 caractères ; mise en
 * forme (astérisques, dièses, liens, listes) ; lien, e-mail ou numéro de téléphone ; chiffre absent du texte d'origine
 * (rien d'inventé : quantité, prix, dose…) ; mot de santé absent du texte d'origine (aucun avis médical) ; question
 * perdue ; consignes recopiées (marqueur) ; {prenom} ajouté là où il n'était pas.
 */
import { hasAny, HEALTH_WORDS, normalize } from '../lexicon';
import { NAME_PLACEHOLDER } from './context';
import { PROMPT_CANARY } from './prompt';

export const MAX_AI_TEXT = 600;

export type Verdict = { ok: true; texts: string[] } | { ok: false; reason: string };

const numbers = (t: string) => t.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** Vérifie un texte reformulé `ai` par rapport au texte d'origine `original` (déjà masqué) et au message de la personne. */
export function checkText(ai: unknown, original: string, userText = ''): string | null {
  if (typeof ai !== 'string') return 'not_text';
  const t = ai.trim();
  if (!t) return 'empty';
  if (t.length > MAX_AI_TEXT) return 'too_long';
  if (t.includes(PROMPT_CANARY)) return 'prompt_leak';
  if (/[*_`#|]|^\s*[-•>]\s|\]\(|<\/?[a-z]/im.test(t)) return 'markup';
  if (/\b(https?:\/\/|www\.)|\b[\w-]+\.(com|net|org|ci|fr|io|app)\b/i.test(t)) return 'link';
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) return 'email';
  const allowed = new Set([...numbers(original), ...numbers(userText)]);
  if (numbers(t).some((n) => !allowed.has(n))) return 'invented_number';
  const n = normalize(t);
  if (hasAny(n, HEALTH_WORDS) && !HEALTH_WORDS.filter((w) => n.includes(` ${w} `)).every((w) => normalize(original).includes(` ${w} `))) return 'health';
  if (original.includes('?') && !t.includes('?')) return 'lost_question';
  if (t.includes(NAME_PLACEHOLDER) && !original.includes(NAME_PLACEHOLDER)) return 'name_added';
  if (/[{}]/.test(t.replaceAll(NAME_PLACEHOLDER, ''))) return 'markup';
  return null;
}

/** Lit la réponse brute du fournisseur : `{"textes": [...]}`, éventuellement entourée d'espaces. */
export function verify(raw: string, originals: string[], userText = ''): Verdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const texts = (parsed as { textes?: unknown })?.textes;
  if (!Array.isArray(texts)) return { ok: false, reason: 'bad_shape' };
  if (texts.length !== originals.length) return { ok: false, reason: 'wrong_count' };
  for (let i = 0; i < texts.length; i++) {
    const reason = checkText(texts[i], originals[i], userText);
    if (reason) return { ok: false, reason };
  }
  return { ok: true, texts: texts.map((t: string) => t.trim()) };
}
