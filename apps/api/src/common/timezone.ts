/**
 * Fuseaux horaires (lot 2, T-025) : lancement en Côte d'Ivoire, architecture prête pour d'autres pays.
 * Chaque personne a un fuseau IANA ; « aujourd'hui » et l'heure des rappels se calculent à son heure locale.
 */

/** Abidjan : UTC+0, sans heure d'été. */
export const DEFAULT_TIMEZONE = 'Africa/Abidjan';

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Jour « AAAA-MM-JJ » à l'heure locale du fuseau. */
export function localDay(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  if (timeZone === DEFAULT_TIMEZONE || timeZone === 'UTC') return now.toISOString().slice(0, 10);
  let f = dayFormatters.get(timeZone);
  if (!f) {
    // en-CA formate les dates en AAAA-MM-JJ.
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, f);
  }
  return f.format(now);
}

/** Fuseau IANA reconnu (ex. « Africa/Abidjan », « Africa/Douala »). */
export function isValidTimeZone(tz: string): boolean {
  if (tz !== 'UTC' && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Décalage (minutes) entre l'heure locale du fuseau et UTC à l'instant donné (ex. +60 pour Douala). */
export function offsetMinutes(at: Date, timeZone: string): number {
  if (timeZone === DEFAULT_TIMEZONE || timeZone === 'UTC') return 0;
  let f = offsetFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    offsetFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Instant UTC correspondant à « jour + heure locale » dans le fuseau (ex. 2026-10-15 15:00 à Douala → 14:00 UTC). */
export function zonedTime(day: string, hhmm: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const naive = new Date(`${day}T${hhmm}:00Z`);
  // Deux passes : correct aussi autour d'un changement d'heure (pays avec heure d'été).
  const first = new Date(naive.getTime() - offsetMinutes(naive, timeZone) * 60_000);
  return new Date(naive.getTime() - offsetMinutes(first, timeZone) * 60_000);
}
