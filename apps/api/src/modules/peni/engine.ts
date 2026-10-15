/**
 * Discussion guidée de Peni (lot 3, écran 25) : fonctions pures, sans base, sans réseau et sans modèle de langage.
 *
 * Peni pose une question à la fois (objectif, quantité, séances, moment, mode, budget, durée), comprend des phrases
 * simples grâce au vocabulaire versionné (`lexicon.ts`) et propose des réponses rapides. À la fin, il rend un
 * **brouillon au format de `POST /v1/projects`** (règle R6) : la personne le vérifie et le confirme dans l'app ;
 * la création passe par les mêmes contrôles que l'écran normal (règle R5).
 *
 * Santé (règle R4) : aucun avis médical ; au moindre sujet de santé, Peni conseille un professionnel ; en cas
 * d'urgence, il donne les numéros du SAMU (185) et des pompiers (180) et ne poursuit pas le projet.
 */
import { Day, diffDays } from '../projects/plan';
import { pickTemplate, TemplateRef } from '../projects/templates';
import { CATEGORY_WORDS, GOAL_WORDS, hasAny, HEALTH_WORDS, MONTHS, normalize, NUMBER_WORDS, URGENT_WORDS, WEEKDAYS } from './lexicon';

export const PENI_ENGINE_VERSION = 'guided-v1';

export type PeniPose = 'cheer' | 'happy' | 'sad' | 'think' | 'wave';
export type Mode = 'eco' | 'premium';
export type Budget = 'small' | 'medium' | 'boosted';
export type Availability = 'morning' | 'noon' | 'afternoon';

export interface CatalogGoal {
  code: string;
  label: string;
  quantityUnit: string | null;
  quantityMin: number | null;
  quantityMax: number | null;
}
export interface CatalogCategory {
  code: string;
  label: string;
  goals: CatalogGoal[];
}
export interface PeniCatalog {
  categories: CatalogCategory[];
  durationsDays: number[];
  budgetTiers: Record<string, string>;
  templates: TemplateRef[];
}
export interface EngineContext {
  catalog: PeniCatalog;
  /** Jour local de la personne. */
  today: Day;
  firstName: string;
}

export interface Slots {
  categoryCode?: string;
  /** null : « autre chose » (objectif décrit avec ses mots). */
  goalCode?: string | null;
  description?: string;
  targetQuantity?: number;
  sessionsPerWeek?: number;
  availability?: Availability;
  mode?: Mode;
  budget?: Budget;
  durationDays?: number;
  /** Échéance citée (« avant décembre ») : jours restants au début du mois cité. */
  deadlineDays?: number;
}

export type Step = 'category' | 'goal' | 'describe' | 'quantity' | 'sessions' | 'availability' | 'mode' | 'budget' | 'duration' | 'done';

export interface PeniState {
  version: string;
  step: Step;
  slots: Slots;
  /** Identifiants des réponses rapides proposées par le dernier message (seules acceptées en « choice »). */
  offered: string[];
  misses: number;
}

export interface QuickReply {
  id: string;
  label: string;
}
export interface SummaryRow {
  label: string;
  value: string;
}
export interface PeniReply {
  text: string;
  pose: PeniPose;
  quickReplies: QuickReply[];
  summary?: SummaryRow[];
  safety?: 'health' | 'urgent';
}

/** Brouillon au format de `CreateProjectDto` (POST /v1/projects). */
export interface ProjectDraft {
  mode: Mode;
  budget?: Budget;
  categoryCode: string;
  goalCode?: string;
  targetQuantity?: number;
  description?: string;
  sessionsPerWeek: number;
  availability: Availability;
  durationDays?: number;
}

export interface EngineResult {
  state: PeniState;
  replies: PeniReply[];
  draft: ProjectDraft | null;
}

export interface EngineInput {
  text?: string;
  choice?: string;
}

export class InvalidChoiceError extends Error {}

const AVAILABILITY_LABEL: Record<Availability, string> = { morning: 'Le matin', noon: 'À midi', afternoon: 'L’après-midi' };
const BUDGET_LABEL: Record<Budget, string> = { small: 'petit', medium: 'moyen', boosted: 'boosté' };

// ------------------------------------------------------------------------------------------------ Démarrage

export function startConversation(ctx: EngineContext, known: { mode?: Mode; budget?: Budget } = {}): EngineResult {
  const slots: Slots = {};
  if (known.mode === 'eco') slots.mode = 'eco';
  if (known.mode === 'premium') {
    slots.mode = 'premium';
    if (known.budget && known.budget in BUDGET_LABEL) slots.budget = known.budget;
  }
  const name = ctx.firstName.trim();
  const reply: PeniReply = {
    text: `Coucou${name ? ` ${name}` : ''} ! 🥰 Raconte-moi : qu’est-ce que tu aimerais changer ?`,
    pose: 'wave',
    quickReplies: ctx.catalog.categories.map((c) => ({ id: `cat:${c.code}`, label: c.label })),
  };
  const state: PeniState = { version: PENI_ENGINE_VERSION, step: 'category', slots, offered: reply.quickReplies.map((q) => q.id), misses: 0 };
  return { state, replies: [reply], draft: null };
}

// ------------------------------------------------------------------------------------------------ Tour de parole

export function handleInput(prev: PeniState, input: EngineInput, ctx: EngineContext): EngineResult {
  const state: PeniState = { ...prev, slots: { ...prev.slots }, offered: [...prev.offered] };
  const replies: PeniReply[] = [];
  const before = JSON.stringify(state.slots);
  let prefix = '';

  if (input.choice !== undefined) {
    if (!state.offered.includes(input.choice)) throw new InvalidChoiceError(input.choice);
    if (input.choice === 'restart') {
      const fresh = startConversation(ctx);
      return { state: fresh.state, replies: [{ ...fresh.replies[0], text: 'On recommence ! 😊 Qu’est-ce que tu aimerais changer ?' }], draft: null };
    }
    if (input.choice !== 'continue') applyChoice(state, input.choice);
  } else {
    const text = (input.text ?? '').trim();
    const n = normalize(text);
    if (hasAny(n, URGENT_WORDS)) {
      const urgent: PeniReply = {
        text:
          'Ce que tu me dis est important 💛 Si tu es en danger ou si c’est urgent, appelle tout de suite le SAMU au 185 ou les pompiers au 180. ' +
          'Tu peux aussi en parler à une personne de confiance. Je reste là pour ton projet quand tu veux.',
        pose: 'think',
        quickReplies: [{ id: 'continue', label: 'Reprendre mon projet' }],
        safety: 'urgent',
      };
      state.offered = ['continue'];
      return { state, replies: [urgent], draft: null };
    }
    if (hasAny(n, HEALTH_WORDS)) {
      replies.push({
        text:
          'Merci de me le dire 💛 Je ne peux pas donner d’avis médical : avant de commencer, parles-en à un médecin ou à un professionnel de santé. ' +
          'Tu pourras le noter dans ton projet, c’est privé.',
        pose: 'think',
        quickReplies: [],
        safety: 'health',
      });
    }
    if (state.step !== 'done') {
      prefix = extract(state, text, n, ctx);
    }
  }

  // Durée déduite d'une échéance quand aucun modèle validé n'impose la sienne.
  const s = state.slots;
  if (s.deadlineDays !== undefined && s.durationDays === undefined && s.categoryCode && s.mode && !templateFor(s, ctx)) {
    s.durationDays = durationForDeadline(s.deadlineDays, ctx.catalog.durationsDays);
  }

  const progressed = JSON.stringify(state.slots) !== before;
  const wasDone = state.step === 'done';
  state.step = nextStep(state.slots, ctx);
  if (state.step === 'done') {
    const draft = buildDraft(state.slots, ctx);
    const summary = summarize(state.slots, ctx);
    const text = wasDone ? 'Ton programme est prêt 👇 Vérifie-le avec « Voir mon programme », ou recommence.' : `${prefix}Top ! J’ai noté tout ça 👇`;
    const reply: PeniReply = { text: text.trim(), pose: 'cheer', quickReplies: [{ id: 'restart', label: 'Recommencer' }], summary };
    replies.push(reply);
    state.offered = ['restart'];
    state.misses = 0;
    return { state, replies, draft };
  }
  state.misses = progressed || input.choice === 'continue' ? 0 : state.misses + 1;
  const q = question(state, ctx);
  const lead = !progressed && input.choice !== 'continue' && !replies.length ? 'Je n’ai pas bien compris 😅 ' : prefix;
  replies.push({ ...q, text: `${lead}${q.text}`.trim() });
  state.offered = q.quickReplies.map((r) => r.id);
  return { state, replies, draft: null };
}

// ------------------------------------------------------------------------------------------------ Réponses rapides

function applyChoice(state: PeniState, choice: string) {
  const [kind, value] = choice.split(':', 2);
  const s = state.slots;
  switch (kind) {
    case 'cat': {
      if (s.categoryCode !== value) {
        delete s.goalCode;
        delete s.targetQuantity;
      }
      s.categoryCode = value;
      break;
    }
    case 'goal':
      s.goalCode = value === 'other' ? null : value;
      delete s.targetQuantity;
      break;
    case 'qty':
      s.targetQuantity = Number(value);
      break;
    case 'sessions':
      s.sessionsPerWeek = Number(value);
      break;
    case 'avail':
      s.availability = value as Availability;
      break;
    case 'mode':
      s.mode = value as Mode;
      if (value === 'eco') delete s.budget;
      break;
    case 'budget':
      s.budget = value as Budget;
      break;
    case 'dur':
      s.durationDays = Number(value);
      break;
  }
}

// ------------------------------------------------------------------------------------------------ Compréhension

/** Remplit les informations trouvées dans le texte ; renvoie une petite phrase de réaction (ou une chaîne vide). */
function extract(state: PeniState, raw: string, n: string, ctx: EngineContext): string {
  const s = state.slots;
  const reactions: string[] = [];
  const cats = ctx.catalog.categories;

  // Objectif décrit avec ses mots : gardé comme description du projet (titre si aucun objectif de la liste), seulement
  // s'il décrit vraiment un objectif (domaine reconnu) ou s'il répond à « dis-moi en quelques mots ».
  if (state.step === 'describe' && raw.length >= 3) s.description = raw.slice(0, 500);
  if (!s.categoryCode) {
    const found = Object.keys(CATEGORY_WORDS).find((code) => cats.some((c) => c.code === code) && hasAny(n, CATEGORY_WORDS[code]));
    if (found) {
      s.categoryCode = found;
      if (s.description === undefined && raw.length >= 3) s.description = raw.slice(0, 500);
    }
  }
  const cat = cats.find((c) => c.code === s.categoryCode);

  // Objectif et quantité (« perdre 5 kg », « prendre 3 kilos »).
  if (cat && cat.goals.length && s.goalCode === undefined) {
    const kg = /\s(\d{1,3})\s?(kg|kilos?)\s/.exec(n);
    const has = (code: string) => cat.goals.some((g) => g.code === code);
    if (kg && /\s(perdre|maigrir|mincir|enlever)\s/.test(n) && has('sport_perte_poids')) s.goalCode = 'sport_perte_poids';
    else if (kg && /\s(prendre|grossir)\s/.test(n) && has('sport_prise_masse')) s.goalCode = 'sport_prise_masse';
    else {
      const g = Object.keys(GOAL_WORDS).find((code) => has(code) && hasAny(n, GOAL_WORDS[code]));
      if (g) s.goalCode = g;
    }
    if (s.goalCode && kg) setQuantity(s, cat, Number(kg[1]));
  }
  const goal = cat?.goals.find((g) => g.code === s.goalCode);
  if (goal?.quantityUnit && s.targetQuantity === undefined && state.step === 'quantity') {
    const num = /\s(\d{1,3})\s/.exec(n);
    if (num) setQuantity(s, cat!, Number(num[1]));
  }

  // Échéance (« avant mon mariage en décembre »).
  if (s.deadlineDays === undefined) {
    const m = MONTHS.findIndex((month) => n.includes(` ${month} `));
    if (m >= 0) {
      const [y, cm] = ctx.today.split('-').map(Number);
      const month = m + 1;
      // Mois à venir : début de ce mois ; mois en cours : fin du mois ; mois passé : l'année suivante.
      const target =
        month === cm ? (cm === 12 ? `${y + 1}-01-01` : `${y}-${String(cm + 1).padStart(2, '0')}-01`) : `${month > cm ? y : y + 1}-${String(month).padStart(2, '0')}-01`;
      const days = diffDays(target, ctx.today);
      if (days > 0) {
        s.deadlineDays = days;
        reactions.push(eventReaction(n), `On a environ ${Math.max(1, Math.round(days / 7))} semaines, c’est parfait.`);
      }
    }
  }

  // Séances par semaine.
  if (s.sessionsPerWeek === undefined) {
    const sessions = parseSessions(n, state.step === 'sessions');
    if (sessions) s.sessionsPerWeek = sessions;
  }

  // Moment de la journée.
  if (s.availability === undefined) {
    if (hasAny(n, ['apres midi', 'aprem', 'soir', 'soiree', 'apres le travail', 'apres le boulot'])) s.availability = 'afternoon';
    else if (hasAny(n, ['matin', 'matinee', 'tot le matin', 'reveil'])) s.availability = 'morning';
    else if (hasAny(n, ['midi', 'pause dejeuner', 'dejeuner'])) s.availability = 'noon';
  }

  // Mode et budget.
  if (s.mode === undefined) {
    if (hasAny(n, ['gratuit', 'gratuite', 'gratuits', 'gratuites', 'economique', 'eco', 'sans acheter', 'sans depenser', 'pas d argent'])) s.mode = 'eco';
    else if (hasAny(n, ['premium', 'acheter', 'produits', 'achats'])) s.mode = 'premium';
  }
  if (s.mode === 'premium' && s.budget === undefined && (state.step === 'budget' || state.step === 'mode')) {
    if (hasAny(n, ['petit', 'petite', 'faible', 'bas'])) s.budget = 'small';
    else if (hasAny(n, ['moyen', 'moyenne', 'normal'])) s.budget = 'medium';
    else if (hasAny(n, ['boost', 'booste', 'gros', 'grand', 'maximum', 'max'])) s.budget = 'boosted';
  }

  // Durée.
  if (s.durationDays === undefined) {
    const allowed = ctx.catalog.durationsDays;
    const d = /\s(\d{2,3})\s?jours?\s/.exec(n);
    const months = /\s(\d|un|deux|trois|quatre|six)\s?mois\s/.exec(n);
    const bare = state.step === 'duration' ? /\s(\d{2,3})\s/.exec(n) : null;
    const value = d ? Number(d[1]) : months ? (NUMBER_WORDS[months[1]] ?? Number(months[1])) * 30 : bare ? Number(bare[1]) : null;
    if (value && allowed.includes(value)) s.durationDays = value;
  }

  return reactions.filter(Boolean).join(' ') + (reactions.length ? ' ' : '');
}

function setQuantity(s: Slots, cat: CatalogCategory, q: number) {
  const g = cat.goals.find((x) => x.code === s.goalCode);
  if (!g?.quantityUnit) return;
  if ((g.quantityMin == null || q >= g.quantityMin) && (g.quantityMax == null || q <= g.quantityMax)) s.targetQuantity = q;
}

function parseSessions(n: string, bareNumberAllowed: boolean): number | undefined {
  if (hasAny(n, ['tous les jours', 'chaque jour', 'quotidien', 'quotidiennement'])) return 7;
  const m = /\s(\d|un|une|deux|trois|quatre|cinq|six|sept)\s?(fois|seances?|jours?)\s/.exec(n);
  if (m) {
    const v = NUMBER_WORDS[m[1]] ?? Number(m[1]);
    if (v >= 1 && v <= 7) return v;
  }
  const days = WEEKDAYS.filter((d) => n.includes(` ${d} `) || n.includes(` ${d}s `)).length;
  if (days) return days;
  if (hasAny(n, ['week end', 'weekend', 'weekends'])) return 2;
  if (bareNumberAllowed) {
    const b = /\s(\d)\s/.exec(n);
    if (b && Number(b[1]) >= 1 && Number(b[1]) <= 7) return Number(b[1]);
    const w = Object.keys(NUMBER_WORDS).find((k) => n.includes(` ${k} `));
    if (w) return NUMBER_WORDS[w];
  }
  return undefined;
}

function eventReaction(n: string): string {
  if (hasAny(n, ['mariage', 'marier', 'dot'])) return 'Félicitations pour le mariage !! 💍';
  if (hasAny(n, ['anniversaire', 'anniv'])) return 'Joyeux anniversaire en avance ! 🎂';
  if (hasAny(n, ['vacances', 'plage'])) return 'Les vacances, ça se prépare ! 🌴';
  if (hasAny(n, ['fete', 'fetes', 'noel', 'nouvel an', 'soiree'])) return 'Ça va être une belle fête ! 🎉';
  return '';
}

export function durationForDeadline(days: number, allowed: number[]): number {
  const sorted = [...allowed].sort((a, b) => a - b);
  const fitting = sorted.filter((d) => d <= days);
  return fitting.length ? fitting[fitting.length - 1] : sorted[0];
}

// ------------------------------------------------------------------------------------------------ Étapes

function templateFor(s: Slots, ctx: EngineContext) {
  if (!s.categoryCode || !s.mode) return null;
  return pickTemplate(ctx.catalog.templates, s.categoryCode, s.goalCode ?? null, s.mode);
}

export function nextStep(s: Slots, ctx: EngineContext): Step {
  const cat = ctx.catalog.categories.find((c) => c.code === s.categoryCode);
  if (!cat) return 'category';
  if (cat.goals.length && s.goalCode === undefined) return 'goal';
  if (!s.goalCode && (s.description ?? '').trim().length < 3) return 'describe';
  const goal = cat.goals.find((g) => g.code === s.goalCode);
  if (goal?.quantityUnit && s.targetQuantity === undefined) return 'quantity';
  if (s.sessionsPerWeek === undefined) return 'sessions';
  if (s.availability === undefined) return 'availability';
  if (s.mode === undefined) return 'mode';
  if (s.mode === 'premium' && s.budget === undefined) return 'budget';
  if (!templateFor(s, ctx) && (s.durationDays === undefined || !ctx.catalog.durationsDays.includes(s.durationDays))) return 'duration';
  return 'done';
}

function question(state: PeniState, ctx: EngineContext): PeniReply {
  const s = state.slots;
  const cat = ctx.catalog.categories.find((c) => c.code === s.categoryCode);
  const goal = cat?.goals.find((g) => g.code === s.goalCode);
  switch (state.step) {
    case 'category':
      return {
        text: state.misses ? 'C’est plutôt dans quel domaine ? Choisis ci-dessous 👇' : 'C’est plutôt dans quel domaine ?',
        pose: 'think',
        quickReplies: ctx.catalog.categories.map((c) => ({ id: `cat:${c.code}`, label: c.label })),
      };
    case 'goal':
      return {
        text: `Super ! En ${cat!.label.toLowerCase()}, qu’est-ce que tu vises ?`,
        pose: 'happy',
        quickReplies: [...cat!.goals.map((g) => ({ id: `goal:${g.code}`, label: g.label })), { id: 'goal:other', label: 'Autre chose' }],
      };
    case 'describe':
      return { text: 'Dis-moi en quelques mots ce que tu aimerais obtenir.', pose: 'think', quickReplies: [] };
    case 'quantity': {
      const min = goal!.quantityMin ?? 1;
      const max = goal!.quantityMax ?? 500;
      const verb = goal!.code === 'sport_prise_masse' ? 'prendre' : 'perdre';
      const options = [3, 5, 10, 15].filter((v) => v >= min && v <= max);
      return {
        text: `Combien de ${goal!.quantityUnit} aimerais-tu ${verb} ? (entre ${min} et ${max})`,
        pose: 'think',
        quickReplies: options.map((v) => ({ id: `qty:${v}`, label: `${v} ${goal!.quantityUnit}` })),
      };
    }
    case 'sessions':
      return {
        text: 'Combien de fois par semaine peux-tu t’y mettre ?',
        pose: 'think',
        quickReplies: [2, 3, 4, 5].map((v) => ({ id: `sessions:${v}`, label: `${v} fois` })),
      };
    case 'availability':
      return {
        text: 'Plutôt le matin, à midi ou l’après-midi ?',
        pose: 'think',
        quickReplies: (Object.keys(AVAILABILITY_LABEL) as Availability[]).map((a) => ({ id: `avail:${a}`, label: AVAILABILITY_LABEL[a] })),
      };
    case 'mode':
      return {
        text: 'Tu préfères un projet économique, avec des solutions gratuites, ou Premium, avec des idées d’achats ? Le choix est gratuit.',
        pose: 'think',
        quickReplies: [
          { id: 'mode:eco', label: 'Économique' },
          { id: 'mode:premium', label: 'Premium' },
        ],
      };
    case 'budget':
      return {
        text: 'Quel budget indicatif ? Rien n’est payé dans BIM.',
        pose: 'think',
        quickReplies: (['small', 'medium', 'boosted'] as Budget[]).map((b) => ({
          id: `budget:${b}`,
          label: ctx.catalog.budgetTiers[b] ? `${capitalize(BUDGET_LABEL[b])} · ${ctx.catalog.budgetTiers[b]}` : capitalize(BUDGET_LABEL[b]),
        })),
      };
    case 'duration':
      return {
        text: 'Sur combien de temps veux-tu suivre ton programme ?',
        pose: 'think',
        quickReplies: ctx.catalog.durationsDays.map((d) => ({ id: `dur:${d}`, label: `${d} jours` })),
      };
    default:
      return { text: '', pose: 'happy', quickReplies: [] };
  }
}

// ------------------------------------------------------------------------------------------------ Résultat

export function buildDraft(s: Slots, ctx: EngineContext): ProjectDraft {
  const template = templateFor(s, ctx);
  return {
    mode: s.mode!,
    ...(s.mode === 'premium' ? { budget: s.budget } : {}),
    categoryCode: s.categoryCode!,
    ...(s.goalCode ? { goalCode: s.goalCode } : {}),
    ...(s.targetQuantity !== undefined ? { targetQuantity: s.targetQuantity } : {}),
    ...(s.description ? { description: s.description } : {}),
    sessionsPerWeek: s.sessionsPerWeek!,
    availability: s.availability!,
    ...(template ? {} : { durationDays: s.durationDays }),
  };
}

function summarize(s: Slots, ctx: EngineContext): SummaryRow[] {
  const cat = ctx.catalog.categories.find((c) => c.code === s.categoryCode)!;
  const goal = cat.goals.find((g) => g.code === s.goalCode);
  const template = templateFor(s, ctx);
  const rows: SummaryRow[] = [{ label: 'Catégorie', value: goal ? `${cat.label} · ${goal.label}` : cat.label }];
  if (goal?.quantityUnit && s.targetQuantity !== undefined) rows.push({ label: 'Objectif', value: `${s.targetQuantity} ${goal.quantityUnit}` });
  rows.push(
    { label: 'Durée', value: `${template ? template.durationDays : s.durationDays} jours` },
    { label: 'Séances', value: `${s.sessionsPerWeek} / semaine` },
    { label: 'Moment', value: AVAILABILITY_LABEL[s.availability!] },
    { label: 'Mode', value: s.mode === 'premium' ? `Premium · ${BUDGET_LABEL[s.budget!]}` : 'Économique' },
  );
  return rows;
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
