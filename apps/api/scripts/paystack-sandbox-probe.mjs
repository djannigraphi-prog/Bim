#!/usr/bin/env node
/**
 * Lot 8 — Sonde de l'environnement de TEST de Paystack (lancement manuel uniquement).
 *
 * But : répondre par des faits constatés, et non supposés, aux questions ouvertes du lot 8 :
 *   1. Paystack accepte-t-il, pour ce compte, une transaction en XOF par Mobile Money (mode test) ?
 *   2. La liste des banques (nécessaire aux sous-comptes, donc au paiement direct à la boutique, F4) couvre-t-elle la
 *      Côte d'Ivoire ?
 *   3. L'API des sous-comptes est-elle accessible à ce compte ?
 *
 * Garanties : clé de TEST seulement (`sk_test_…`, sinon arrêt immédiat) ; aucune clé ni donnée personnelle affichée ;
 * aucun paiement validé (la transaction de test est seulement initialisée puis vérifiée) ; aucune dépense.
 * Usage : PAYSTACK_TEST_SECRET_KEY=sk_test_… node scripts/paystack-sandbox-probe.mjs
 */
const key = process.env.PAYSTACK_TEST_SECRET_KEY ?? '';
if (!/^sk_test_[A-Za-z0-9]+$/.test(key)) {
  console.error('Arrêt : PAYSTACK_TEST_SECRET_KEY absente ou pas une clé de test (sk_test_…). Aucune clé de production n’est acceptée.');
  process.exit(2);
}
const BASE = 'https://api.paystack.co';

async function call(method, path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);
    return { http: res.status, ok: res.ok && json?.status === true, message: typeof json?.message === 'string' ? json.message.slice(0, 160) : null, data: json?.data ?? null };
  } catch (e) {
    return { http: 0, ok: false, message: `réseau : ${e.name}`, data: null };
  }
}

const report = { date: new Date().toISOString(), mode: 'test', checks: [] };
const add = (name, result, detail) => report.checks.push({ name, http: result.http, ok: result.ok, message: result.message, ...detail });

// 2. Banques (sous-comptes) : plusieurs écritures du pays, et la devise XOF.
for (const q of ['country=cote%20d%27ivoire', 'country=ivory%20coast', 'country=cote-d-ivoire', 'currency=XOF']) {
  const r = await call('GET', `/bank?${q}&perPage=100`);
  add(`Liste des banques (${decodeURIComponent(q)})`, r, { count: Array.isArray(r.data) ? r.data.length : null, examples: Array.isArray(r.data) ? r.data.slice(0, 5).map((b) => `${b.name} [${b.type ?? '?'}/${b.currency ?? '?'}]`) : [] });
}
const mm = await call('GET', '/bank?currency=XOF&type=mobile_money&perPage=100');
add('Opérateurs Mobile Money en XOF (type=mobile_money)', mm, { count: Array.isArray(mm.data) ? mm.data.length : null, examples: Array.isArray(mm.data) ? mm.data.slice(0, 10).map((b) => b.name) : [] });

// 3. Sous-comptes : accès à l'API (lecture seule, aucune création).
const subs = await call('GET', '/subaccount?perPage=1');
add('API des sous-comptes (lecture)', subs, { count: Array.isArray(subs.data) ? subs.data.length : null });

// 1. Transaction de test XOF, Mobile Money : initialisée puis vérifiée ; jamais validée.
const reference = `bim-probe-${Date.now()}`;
const init = await call('POST', '/transaction/initialize', { email: 'sonde@bim.invalid', amount: '10000', currency: 'XOF', channels: ['mobile_money'], reference });
add('Initialisation XOF / Mobile Money (100 F, test)', init, { pageReturned: typeof init.data?.authorization_url === 'string' });
if (init.ok) {
  const v = await call('GET', `/transaction/verify/${reference}`);
  add('Vérification serveur de la transaction de test', v, { status: v.data?.status ?? null, currency: v.data?.currency ?? null, amount: v.data?.amount ?? null });
}

const lines = [
  '## Sonde Paystack (environnement de test)',
  '',
  `Date : ${report.date}. Clé de test uniquement ; aucun paiement validé, aucune dépense.`,
  '',
  '| Vérification | HTTP | Réussie | Détail |',
  '| --- | --- | --- | --- |',
  ...report.checks.map((c) => {
    const { name, http, ok, message, ...rest } = c;
    return `| ${name} | ${http} | ${ok ? 'oui' : 'non'} | ${[message, JSON.stringify(rest)].filter(Boolean).join(' · ').replace(/\|/g, '/')} |`;
  }),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
