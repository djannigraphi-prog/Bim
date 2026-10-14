import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C6 (décision du fondateur, 14/10/2026) : le mode d'un projet (économique / Premium) est gratuit, ouvert à tous
 * et indépendant de l'abonnement Premium. Ce test empêche qu'une modification future fasse dépendre les projets
 * d'un abonnement, d'un droit payant ou d'un paiement.
 */
const files = [
  ...readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => join(__dirname, f)),
  join(__dirname, '../../database/schema/projects.ts'),
];

/** Code seul : sans commentaires ni textes affichés (qui peuvent légitimement dire « aucun paiement »). */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

describe('C6 — mode de projet indépendant de l’abonnement', () => {
  it.each(files)('%s ne lit aucun abonnement, droit payant ni paiement', (file) => {
    const code = codeOnly(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(/subscri|entitlement|abonnement|payment|paiement|wallet|coin|price|amount|checkout/i);
  });

  it.each(files)('%s n’importe que les modules autorisés', (file) => {
    const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((m) => m.startsWith('.'));
    const allowed = /^(\.\/|\.\.\/\.\.\/common\/|\.\.\/\.\.\/database\/|\.\.\/audit\/|\.\.\/settings\/|\.\.\/auth\/auth\.decorators$|\.\/identity$)/;
    for (const i of imports) expect(i).toMatch(allowed);
  });
});
