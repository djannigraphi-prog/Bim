/**
 * Contrôle des valeurs de réglages saisies dans l'administration. Une valeur hors règle est refusée,
 * pour qu'une faute de frappe ne puisse pas ouvrir une fonctionnalité à tort (ex. âge minimum à 1 an).
 * null = « règle non décidée » : la fonctionnalité reste fermée (F15).
 */
type Rule = (v: unknown) => string | null;

const intIn = (min: number, max: number, nullable = false): Rule => (v) =>
  (nullable && v === null) || (Number.isInteger(v) && (v as number) >= min && (v as number) <= max)
    ? null
    : `Entier entre ${min} et ${max}${nullable ? ', ou null (non décidé)' : ''}.`;

const RULES: Array<[RegExp, Rule]> = [
  [/^age\./, intIn(13, 99, true)],
  [/^auth\.registration_min_interests$/, intIn(1, 10)],
  [/^auth\.recovery_preferred_channel$/, (v) => (v === 'phone' || v === 'email' ? null : '« phone » ou « email ».')],
  [/^projects\.max_active$/, intIn(1, 50, true)],
  [/^projects\.pause_max_days$/, intIn(1, 365, true)],
  [
    /^projects\.durations_days$/,
    (v) => (Array.isArray(v) && v.length > 0 && v.every((x) => Number.isInteger(x) && x >= 7 && x <= 365) ? null : 'Liste de durées en jours, entre 7 et 365.'),
  ],
  [
    /^projects\.availability_times$/,
    (v) =>
      v && typeof v === 'object' && !Array.isArray(v) && ['morning', 'noon', 'afternoon'].every((k) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String((v as Record<string, unknown>)[k])))
        ? null
        : 'Heures « HH:MM » pour morning, noon et afternoon.',
  ],
  [
    /^projects\.budget_tiers$/,
    (v) =>
      v && typeof v === 'object' && !Array.isArray(v) && ['small', 'medium', 'boosted'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string')
        ? null
        : 'Libellés pour small, medium et boosted.',
  ],
];

export function validateSettingValue(key: string, value: unknown): string | null {
  if (value === undefined) return 'Valeur manquante.';
  const rule = RULES.find(([re]) => re.test(key));
  return rule ? rule[1](value) : null;
}
