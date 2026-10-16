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
  [/^notifications\.reminders_enabled$/, (v) => (typeof v === 'boolean' ? null : 'true ou false.')],
  [
    /^notifications\.reminder_offsets_minutes$/,
    (v) =>
      Array.isArray(v) && v.length >= 1 && v.length <= 5 && v.every((x, i) => Number.isInteger(x) && x >= 0 && x <= 360 && (i === 0 || x > (v[i - 1] as number)))
        ? null
        : 'Liste croissante de 1 à 5 délais en minutes (0 à 360), ex. [0, 60, 120].',
  ],
  [
    /^notifications\.quiet_hours$/,
    (v) =>
      v === null ||
      (v && typeof v === 'object' && !Array.isArray(v) && ['start', 'end'].every((k) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String((v as Record<string, unknown>)[k]))))
        ? null
        : '{"start": "HH:MM", "end": "HH:MM"} ou null (pas d’heures calmes).',
  ],
  [/^notifications\.reminder_grace_minutes$/, intIn(5, 180)],
  [/^maintenance\.account_purge_enabled$/, (v) => (typeof v === 'boolean' ? null : 'true ou false.')],
  [/^maintenance\.account_purge_mode$/, (v) => (v === 'simulation' || v === 'real' ? null : '« simulation » ou « real ».')],
  [/^maintenance\.account_purge_after_days$/, intIn(30, 3650)],
  [/^peni\.llm_enabled$/, (v) => (typeof v === 'boolean' ? null : 'true ou false.')],
  [/^peni\.daily_message_limit$/, intIn(1, 1000)],
  [/^peni\.conversation_max_messages$/, intIn(5, 500)],
  // Durée de conservation des discussions avec Peni : null tant qu'elle n'est pas validée (aucune suppression).
  [/^peni\.conversation_retention_days$/, intIn(7, 3650, true)],
  [/^social\.posts_daily_limit$/, intIn(1, 500)],
  [/^social\.comments_daily_limit$/, intIn(1, 5000)],
  [/^social\.stories_daily_limit$/, intIn(1, 200)],
  // Conservation des pièces d'identité : null tant qu'elle n'est pas validée (aucune suppression).
  [/^kyc\.document_retention_days$/, intIn(30, 3650, true)],
  [/^offers\.max_per_shop_per_day$/, intIn(1, 500)],
  [/^messages\.daily_limit$/, intIn(1, 10000)],
  [/^messages\.new_conversations_daily_limit$/, intIn(1, 500)],
  // Conservation des messages privés : null tant qu'elle n'est pas validée (aucune suppression).
  [/^messages\.retention_days$/, intIn(30, 3650, true)],
  [/^orders\.(proposal_ttl_hours|shop_confirm_ttl_hours)$/, intIn(1, 168)],
  [/^orders\.handover_code_max_attempts$/, intIn(3, 10)],
  [/^reviews\.window_days$/, intIn(1, 365)],
  [/^deliveries\.(mission_accept_minutes|client_absent_after_minutes)$/, intIn(1, 240)],
  [/^delivery\.wait_fees_enabled$/, (v) => (typeof v === 'boolean' ? null : 'true ou false.')],
];

export function validateSettingValue(key: string, value: unknown): string | null {
  if (value === undefined) return 'Valeur manquante.';
  const rule = RULES.find(([re]) => re.test(key));
  return rule ? rule[1](value) : null;
}
