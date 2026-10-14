/**
 * Calcul d'âge en années révolues à une date donnée, à partir d'une date de naissance « AAAA-MM-JJ ».
 * Le calendrier de référence est celui de la Côte d'Ivoire (UTC+0, sans heure d'été).
 */
export function ageOn(birthDate: string, on: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) throw new Error(`Date de naissance invalide : ${birthDate}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ty = on.getUTCFullYear();
  const tm = on.getUTCMonth() + 1;
  const td = on.getUTCDate();
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return age;
}

/** Vrai si la chaîne est une date calendaire réelle (refuse 2001-02-30). */
export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.getUTCFullYear() === Number(m[1]) && dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]);
}
