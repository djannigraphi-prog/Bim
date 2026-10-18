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
  await editor.getByLabel('Mode de projet visé').selectOption({ label: 'Projet économique' });
  await editor.getByLabel('Habitudes du jour').fill('1: Conseil de test du premier jour\nConseil général de test');
  await editor.getByLabel('Titre de la tâche 1').fill('Tâche de test');
  await editor.getByLabel('Heure de la tâche 1').fill('08:30');
  await editor.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  const row = page.getByRole('row', { name: /Programme de test navigateur/ });
  await expect(row).toContainText('Brouillon');
  await expect(row).toContainText('Projet économique');
  await expect(row).toContainText('2 habitude(s) du jour');
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

test('catégories : création d’une catégorie et d’un objectif chiffré, contrôles', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Catégories et objectifs' }).click();
  await expect(page.getByRole('row', { name: /Sport/ }).first()).toBeVisible();
  const code = `test_${Date.now() % 100000}`;
  const cat = page.getByLabel('Nouvelle catégorie');
  await cat.getByLabel('Code').fill(code);
  await cat.getByLabel('Libellé').fill('Catégorie navigateur');
  await cat.getByRole('button', { name: 'Créer la catégorie' }).click();
  await expect(page.getByRole('row', { name: /Catégorie navigateur/ })).toBeVisible();
  const goal = page.getByLabel('Nouvel objectif');
  await goal.getByLabel('Catégorie').selectOption({ label: 'Catégorie navigateur' });
  await goal.getByLabel('Code').fill(`${code}_g`);
  await goal.getByLabel('Libellé').fill('Objectif navigateur');
  await goal.getByLabel('Unité (facultatif, ex. kg)').fill('cm');
  await goal.getByLabel('Minimum').fill('1');
  await goal.getByLabel('Maximum').fill('20');
  await goal.getByLabel(/Nom de projet généré/).fill('Gagner des cm');
  await goal.getByRole('button', { name: "Créer l'objectif" }).click();
  await expect(page.getByRole('alert')).toContainText('{q}');
  await goal.getByLabel(/Nom de projet généré/).fill('Gagner {q} cm');
  await goal.getByRole('button', { name: "Créer l'objectif" }).click();
  await expect(page.getByRole('row', { name: /Catégorie navigateur/ })).toContainText('Objectif navigateur · 1–20 cm');
});

test('signalements : réponse à la personne puis clôture', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Signalements' }).click();
  // Signalement général (« Résoudre un problème ») : l'image jointe est réellement chargée par le navigateur.
  const general = page.getByLabel(`Signalement général de @${APP_USERNAME}`);
  await expect(general).toContainText("Difficulté avec l'application");
  await expect(general).toContainText('Le bouton Continuer ne réagit pas (test)');
  const img = general.getByRole('img', { name: 'Image jointe au signalement' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(320);
  const card = page.getByLabel(`Signalement de @${APP_USERNAME} sur « Projet de test »`);
  await expect(card).toContainText('Lieu ou intervenant indisponible');
  await expect(card).toContainText('Salle fermée (test)');
  await card.getByLabel('Réponse à la personne').fill('Merci, nous avons prévenu la salle (test).');
  await card.getByRole('button', { name: 'Répondre et clore' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Traités' }).click();
  await expect(page.getByLabel(`Signalement de @${APP_USERNAME} sur « Projet de test »`)).toContainText('Réponse : Merci, nous avons prévenu la salle (test).');
});

test('modération (lot 4) : publication signalée, photo affichée, masquée puis rétablie', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Modération' }).click();
  const card = page.getByLabel(`Publication signalée : Spam ou publicité, de @${APP_USERNAME}`);
  await expect(card).toContainText('Achetez mes produits miracles (test)');
  await expect(card).toContainText('« Publicité (test) »');
  await expect(card).toContainText('État du contenu : en ligne');
  const img = card.getByRole('img', { name: 'Image de la publication signalée' });
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(240);
  await expect(card.getByRole('button', { name: 'Masquer le contenu' })).toBeDisabled();
  await card.getByLabel('Motif de la décision (journal d’audit)').fill('Spam commercial (test)');
  await card.getByRole('button', { name: 'Masquer le contenu' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Traités' }).click();
  const done = page.getByLabel(`Publication signalée : Spam ou publicité, de @${APP_USERNAME}`);
  await expect(done).toContainText('Décision : contenu masqué — Spam commercial (test)');
  await expect(done).toContainText('État du contenu : masqué');
  await page.screenshot({ path: 'test-results/captures/moderation.png' });
  await done.getByRole('button', { name: 'Rétablir le contenu' }).click();
  await expect(done).toContainText('État du contenu : en ligne');
});

test('boutiques (lot 5) : demande examinée, pièces déchiffrées affichées, validation', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Boutiques' }).click();
  const card = page.getByLabel('Demande de boutique « Boutique Test E2E »');
  await expect(card).toContainText('Carte nationale d’identité · Wave confirmé par SMS');
  await card.getByRole('button', { name: 'Examiner' }).click();
  await expect(card).toContainText('Numéro Mobile Money : +2250102030405 (Wave)');
  for (const alt of ['Pièce d’identité, recto', 'Pièce d’identité, verso', 'Selfie']) {
    const img = card.getByRole('img', { name: alt });
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(200);
  }
  await expect(card.getByRole('button', { name: 'Demander une correction' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/captures/boutiques.png' });
  await card.getByRole('button', { name: 'Valider et ouvrir la boutique' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Validées' }).click();
  await expect(page.getByLabel('Demande de boutique « Boutique Test E2E »')).toBeVisible();
});

test('tarifs de livraison (7-D) : commune, grille publiée en vigueur, simulation du calcul', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Tarifs de livraison' }).click();
  const commune = `Commune E2E ${Date.now()}`;
  await page.getByLabel('Commune', { exact: true }).fill(commune);
  await page.getByRole('button', { name: 'Ajouter la commune' }).click();
  await expect(page.getByRole('cell', { name: commune, exact: true })).toBeVisible();

  const values = ['500', '40', '1000', '25', '5', '50', '15'];
  const labels = ['Prise en charge (F)', 'Prix par minute (F)', 'Minimum (F)', "Pas d'arrondi (F)", 'Attente gratuite (min)', "Prix par minute d'attente (F)", "Plafond d'attente (min)"];
  for (const [i, l] of labels.entries()) await page.getByLabel(`${l} (Rapide)`, { exact: true }).fill(values[i]);
  await page.getByRole('button', { name: 'Enregistrer le brouillon Rapide' }).click();
  const card = page.getByLabel('Grille Rapide');
  const publish = card.getByRole('button', { name: /^Publier la version \d+$/ });
  await expect(publish).toBeVisible();
  const version = (await publish.textContent())!.replace(/\D/g, '');
  await publish.click();
  await expect(card.getByRole('heading', { name: `Rapide — version ${version} en vigueur` })).toBeVisible();
  await card.getByLabel(`Minutes à simuler, version ${version} Rapide`).fill('30');
  await card.getByRole('row', { name: new RegExp(`^${version} En vigueur`) }).getByRole('button', { name: 'Simuler' }).click();
  await expect(card.getByText('1700 F')).toBeVisible();
  await page.screenshot({ path: 'test-results/captures/tarifs-livraison.png' });
});

test('paiements à vérifier (7-C) : page accessible, aucune confirmation implicite annoncée', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Paiements à vérifier' }).click();
  await expect(page.getByRole('heading', { name: 'Paiements à vérifier' })).toBeVisible();
  await expect(page.getByText('Aucune confirmation implicite')).toBeVisible();
  await expect(page.getByText('Aucun paiement à vérifier.')).toBeVisible();
});

test('incidents (7-G) : page accessible au support, aucune sanction automatique annoncée', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
  await expect(page.getByText('Aucune pénalité, aucun frais ni remboursement automatique')).toBeVisible();
  await expect(page.getByText('Aucun incident.')).toBeVisible();
  await page.getByRole('tab', { name: 'Résolus' }).click();
  await expect(page.getByRole('tab', { name: 'Résolus' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Aucun incident.')).toBeVisible();
});

test('paiements en ligne (lot 8) : page accessible, aucun prestataire annoncé, aucun paiement', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Paiements en ligne' }).click();
  await expect(page.getByRole('heading', { name: 'Paiements en ligne' })).toBeVisible();
  await expect(page.getByText('aucun (paiement en ligne fermé)')).toBeVisible();
  await expect(page.getByText('Aucun paiement en ligne.')).toBeVisible();
});

test('retraits de pièces (lot 9, prototype) : page accessible, versement simulé seulement, file vide', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Retraits de pièces' }).click();
  await expect(page.getByRole('heading', { name: 'Retraits de pièces' })).toBeVisible();
  await expect(page.getByText('Commission BIM : 0 F', { exact: false })).toBeVisible();
  await expect(page.getByText('Aucun retrait.')).toBeVisible();
});

test('livreurs (7-E) : page de vérification accessible, aucune demande au départ', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Livreurs' }).click();
  await expect(page.getByRole('heading', { name: 'Livreurs' })).toBeVisible();
  await expect(page.getByText('Aucune demande.')).toBeVisible();
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

test('maintenance : purge des comptes jamais vérifiés désactivée, en simulation ; simulation à la demande sans suppression', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Maintenance' }).click();
  await expect(page.getByText('Purge quotidienne : désactivée')).toBeVisible();
  await expect(page.getByText('simulation (rien n’est supprimé)')).toBeVisible();
  await expect(page.getByText(/plus de 30 jours/)).toBeVisible();
  await page.getByRole('button', { name: 'Lancer une simulation' }).click();
  const row = page.getByRole('row', { name: /Administration/ }).first();
  await expect(row).toContainText('Simulation');
  await expect(row).toContainText('Terminé');
  await expect(row.getByRole('cell').last()).toHaveText('0');
  // Décision D-2010 (17/10/2026) : discussions avec Peni supprimées après 1 an sans activité.
  await expect(page.getByTestId('peni-retention')).toContainText('Durée réglée : 365 jours sans activité (suppression automatique active)');
  await page.screenshot({ path: 'test-results/captures/maintenance.png' });
});
