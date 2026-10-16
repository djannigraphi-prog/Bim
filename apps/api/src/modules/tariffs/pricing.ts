/**
 * 7-D — Calcul des frais de livraison (LOT7_CONCEPTION §7.1, §7.3). Fonctions pures : aucune valeur dans le code,
 * tout vient de la grille publiée. Montants entiers en FCFA.
 */
export type DeliveryMode = 'express' | 'economy';
export const DELIVERY_MODES: readonly DeliveryMode[] = ['express', 'economy'];

export interface TariffValues {
  baseFcfa: number;
  perMinuteFcfa: number;
  minimumFcfa: number;
  roundingFcfa: number;
  freeWaitMinutes: number;
  waitPerMinuteFcfa: number;
  waitCapMinutes: number;
}

/** frais = arrondi_supérieur(max(minimum, prise_en_charge + prix_minute × durée), pas). */
export function deliveryFee(t: TariffValues, minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('Durée invalide');
  const raw = Math.max(t.minimumFcfa, t.baseFcfa + t.perMinuteFcfa * minutes);
  return Math.ceil(raw / t.roundingFcfa) * t.roundingFcfa;
}

/**
 * Frais d'attente : au-delà de l'attente gratuite, prix par minute, plafonné. Nuls si la facturation de l'attente
 * n'est pas activée (A2-c : enregistrée seulement au lancement). Minutes entamées non comptées (minutes pleines).
 */
export function waitFee(t: TariffValues, waitedSeconds: number, billed: boolean): { billableMinutes: number; feeFcfa: number } {
  const waited = Math.max(0, Math.floor(waitedSeconds / 60));
  const billableMinutes = Math.min(Math.max(0, waited - t.freeWaitMinutes), t.waitCapMinutes);
  return { billableMinutes, feeFcfa: billed ? billableMinutes * t.waitPerMinuteFcfa : 0 };
}

/** Code stable d'une commune : ville et commune sans accents, en minuscules (`abidjan-cocody`). */
export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function communeCode(city: string, name: string): string {
  return `${slug(city)}-${slug(name)}`;
}
