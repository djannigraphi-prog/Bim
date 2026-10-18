/** Comptes de la démonstration gratuite (données inventées ; jamais créés hors démonstration). */
export const DEMO_PASSWORD = 'Demo-BIM-2026!';

export const DEMO_ACCOUNTS = [
  { key: 'awa', fullName: 'Awa Koné', username: 'awa.demo', phone: '0700000101', birthDate: '1996-04-12', city: 'Cocody', role: 'Créatrice, Premium' },
  { key: 'koffi', fullName: 'Koffi Yao', username: 'koffi.demo', phone: '0700000102', birthDate: '1994-09-03', city: 'Yopougon', role: 'Fan, 10 000 pièces' },
  { key: 'aminata', fullName: 'Aminata Traoré', username: 'aminata.demo', phone: '0700000103', birthDate: '1990-01-21', city: 'Marcory', role: 'Marchande (boutique Maison Aminata)' },
] as const;

export type DemoKey = (typeof DEMO_ACCOUNTS)[number]['key'];
