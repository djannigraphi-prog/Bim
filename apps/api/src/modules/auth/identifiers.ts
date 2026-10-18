import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

/** Noms réservés : ne peuvent pas être pris comme nom d'utilisateur (usurpation de la marque ou du support). */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrateur', 'bim', 'bimshop', 'bim.shop', 'support', 'help', 'aide', 'peni', 'moderation',
  'moderateur', 'security', 'securite', 'root', 'system', 'official', 'officiel', 'staff', 'equipe',
]);

export const USERNAME_RE = /^[a-z0-9._]{3,30}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export function usernameProblem(username: string): 'format' | 'reserved' | null {
  if (!USERNAME_RE.test(username) || /^[._]|[._]$|\.\./.test(username)) return 'format';
  if (RESERVED_USERNAMES.has(username) || username.startsWith('bim_') || username.startsWith('bim.')) return 'reserved';
  return null;
}

/** Retourne le numéro au format E.164 (+225…) s'il est valide, sinon null. */
export function normalizePhone(raw: string, defaultRegion: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultRegion.toUpperCase() as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return EMAIL_RE.test(v) && v.length <= 254 ? v : null;
}

export type Identifier = { kind: 'email' | 'phone' | 'username'; value: string };

/** Un même champ « identifiant » accepte e-mail, téléphone ou @nom d'utilisateur (écran 03, Q12). */
export function classifyIdentifier(raw: string, defaultRegion: string): Identifier | null {
  const input = raw.trim();
  if (!input) return null;
  if (input.includes('@') && !input.startsWith('@')) {
    const email = normalizeEmail(input);
    return email ? { kind: 'email', value: email } : null;
  }
  if (/^[+\d][\d\s().-]{5,}$/.test(input)) {
    const phone = normalizePhone(input, defaultRegion);
    if (phone) return { kind: 'phone', value: phone };
  }
  const username = normalizeUsername(input);
  return usernameProblem(username) === 'format' ? null : { kind: 'username', value: username };
}

/** Masque une coordonnée pour l'affichage : +225 07 •• •• 44 65, y•••@gmail.com */
export function maskDestination(channel: 'phone' | 'email', value: string): string {
  // Numéros courts (moins de 11 caractères, certains territoires) : jamais de longueur négative (audit du 18/10/2026).
  if (channel === 'phone') return value.length > 10 ? `${value.slice(0, 6)}${'•'.repeat(value.length - 10)}${value.slice(-4)}` : `${value.slice(0, 3)}••••`;
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}
