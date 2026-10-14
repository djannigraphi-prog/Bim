import { createHmac } from 'node:crypto';
import { expect, Page, test } from '@playwright/test';

/** Parcours réel : connexion + double authentification, réglages, programmes types, utilisateurs, audit, administrateurs. */

const EMAIL = process.env.ADMIN_E2E_EMAIL!;
const PASSWORD = process.env.ADMIN_E2E_PASSWORD!;
const APP_USERNAME = process.env.ADMIN_E2E_APP_USERNAME!;

function base32Decode(text: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, '')) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Code TOTP calculé comme le ferait l'application d'authentification du téléphone. */
function totp(secret: string, offsetSteps = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return (bin % 1_000_000).toString().padStart(6, '0');
}

let secret = '';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuer' }).click();
  const enroll = page.getByTestId('totp-secret');
  const prompt = page.getByText('Saisis le code à 6 chiffres');
  await expect(enroll.or(prompt)).toBeVisible();
  if (await enroll.isVisible()) {
    await expect(page.getByRole('img', { name: 'QR code de double authentification' })).toBeVisible();
    await page.screenshot({ path: 'test-results/captures/enrolement.png' });
    secret = (await enroll.textContent())!.trim();
  } else {
    // Un code ne sert qu'une fois : on attend le pas suivant.
    await page.waitForTimeout(31_000 - (Date.now() % 30_000));
  }
  await page.getByLabel('Code').fill(totp(secret));
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('BIM · Administration')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Réglages' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('connexion refusée avec un mauvais mot de passe', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('alert')).toHaveText('E-mail ou mot de passe incorrect.');
});

test('première connexion : enrôlement TOTP, puis réglages modifiables et contrôlés', async ({ page }) => {
  await signIn(page);
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByRole('link', { name: 'Réglages' }).click();
  await expect(page.getByText('age.min_registration')).toBeVisible();
  await page.getByRole('button', { name: 'Modifier projects.pause_max_days' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier projects.pause_max_days' });
  await dialog.getByLabel('Valeur (JSON)').fill('1000');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Entier entre 1 et 365');
  await dialog.getByLabel('Valeur (JSON)').fill('30');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('row', { name: /projects\.pause_max_days/ })).toContainText('30');
  await page.screenshot({ path: 'test-results/captures/reglages.png', fullPage: true });
});

test('programme type : brouillon puis publication avec le nom du validateur', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Programmes types' }).click();
  await page.getByRole('button', { name: 'Nouveau programme' }).click();
  const editor = page.getByLabel('Éditeur de programme');
  await editor.getByLabel('Catégorie du programme').selectOption({ label: 'Maquillage' });
  await editor.getByLabel('Titre du programme').fill('Programme de test navigateur');
  await editor.getByLabel('Durée (jours)').fill('14');
  await editor.getByLabel('Titre de la tâche 1').fill('Tâche de test');
  await editor.getByLabel('Heure de la tâche 1').fill('08:30');
  await editor.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  const row = page.getByRole('row', { name: /Programme de test navigateur/ });
  await expect(row).toContainText('Brouillon');
  page.once('dialog', (d) => d.accept('Personne de test, maquilleuse'));
  await row.getByRole('button', { name: 'Publier' }).click();
  await expect(row).toContainText('Publié');
  await expect(row).toContainText('Validé par Personne de test, maquilleuse');
  await page.screenshot({ path: 'test-results/captures/programmes.png', fullPage: true });
  await row.getByRole('button', { name: 'Archiver' }).click();
  await expect(row).toContainText('Archivé');
});

test('utilisateurs : recherche, fiche masquée, suspension motivée, puis audit', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Utilisateurs' }).click();
  await page.getByPlaceholder("Nom d'utilisateur, nom, téléphone ou e-mail").fill(APP_USERNAME);
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await page.getByRole('button', { name: new RegExp(`@${APP_USERNAME}`) }).click();
  await expect(page.getByText(/Téléphone : \+225\d{2}••••/)).toBeVisible();
  const suspend = page.getByRole('button', { name: 'Suspendre le compte' });
  await expect(suspend).toBeDisabled();
  await page.getByLabel('Motif (obligatoire, conservé dans le journal)').fill('Test navigateur de suspension');
  await suspend.click();
  await expect(page.getByText('Statut : suspended')).toBeVisible();
  await page.getByLabel('Motif (obligatoire, conservé dans le journal)').fill('Fin du test navigateur');
  await page.getByRole('button', { name: 'Réactiver le compte' }).click();
  await expect(page.getByText('Statut : active')).toBeVisible();

  await page.getByRole('link', { name: "Journal d'audit" }).click();
  await page.getByPlaceholder(/Action/).fill('admin.user_');
  await page.getByRole('button', { name: 'Filtrer' }).click();
  await expect(page.getByRole('cell', { name: 'admin.user_suspended' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'admin.user_reactivated' })).toBeVisible();
  await page.screenshot({ path: 'test-results/captures/audit.png', fullPage: true });
});

test('administrateurs : création d’un compte support, double authentification à configurer', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Administrateurs' }).click();
  const email = `support.${Date.now()}@bim.test`;
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Nom').fill('Support test');
  await page.getByLabel('Mot de passe initial (12 caractères min.)').fill('Support-Test-2026-long');
  await page.getByLabel('Support client').check();
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  const row = page.getByRole('row', { name: new RegExp(email.replace('.', '\\.')) });
  await expect(row).toContainText('À configurer à la première connexion');
  await expect(row).toContainText('Support client');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Continuer' })).toBeVisible();
});
