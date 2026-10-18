/**
 * Données de la démonstration gratuite (ordinateur, NODE_ENV=development et DEMO_MODE) : trois comptes, des
 * publications, une boutique avec des articles, Premium, pièces et un Live programmé. Passe par l'API elle-même
 * (mêmes règles que l'app) ; les codes de vérification sont lus dans la boîte des envois factices. Ne fait rien si les
 * comptes existent déjà, et refuse de tourner hors démonstration.
 *
 * Usage (dans le conteneur de démo) : node dist/demo/seed.js
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import sharp from 'sharp';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { uuidv7 } from '../common/uuid';
import { loadConfig } from '../config/config';
import { DeliveryService } from '../modules/delivery/delivery.service';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DemoKey } from './accounts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  // Le remplissage fait plusieurs inscriptions d'affilée depuis la même adresse : pas de limitation pour ce processus.
  process.env.HTTP_THROTTLE_ENABLED = 'false';
  const cfg = loadConfig();
  if (cfg.NODE_ENV !== 'development' || !cfg.DEMO_MODE) throw new Error('Données de démo : NODE_ENV=development et DEMO_MODE=true obligatoires.');
  const pool = new Pool({ connectionString: cfg.DATABASE_URL, max: 2 });
  const exists = await pool.query('select 1 from users where username = $1', [DEMO_ACCOUNTS[0].username]);
  if (exists.rowCount) {
    console.log('Données de démo déjà présentes : rien à faire.');
    await pool.end();
    return;
  }

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const delivery = app.get(DeliveryService);

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Json> => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return text ? (JSON.parse(text) as Json) : {};
  };
  const lastCode = () => /(\d{6})/.exec(delivery.demoOutbox[0]?.body ?? '')?.[1] ?? '';
  const jpeg = (r: number, g: number, b: number) => sharp({ create: { width: 900, height: 1100, channels: 3, background: { r, g, b } } }).jpeg({ quality: 80 }).toBuffer();

  // 1. Comptes (inscription + code, comme dans l'app).
  const tokens = {} as Record<DemoKey, string>;
  for (const a of DEMO_ACCOUNTS) {
    const reg = await call('POST', '/v1/auth/register', {
      body: { fullName: a.fullName, username: a.username, birthDate: a.birthDate, city: a.city, phone: a.phone, password: DEMO_PASSWORD, interests: ['mode', 'sport_coaching', 'coiffure'] },
    });
    const ver = await call('POST', '/v1/auth/register/verify', { body: { challengeId: reg.verification.challengeId, code: lastCode() } });
    tokens[a.key] = ver.tokens.accessToken;
  }
  const users = Object.fromEntries((await pool.query('select id, username from users where username = any($1)', [DEMO_ACCOUNTS.map((a) => a.username)])).rows.map((r) => [r.username, r.id]));

  // 2. Publications d'Awa (photos aux couleurs de la marque), abonnements, j'aime, commentaires.
  const posts: string[] = [];
  const texts = ['Semaine 3 de ma routine sport : je lâche rien 💪', 'Nouvelle coiffure pour le mariage de ma cousine ✨', 'Mon BIM du mois : objectif atteint !'];
  const colors: Array<[number, number, number]> = [[242, 13, 58], [255, 200, 61], [16, 17, 22]];
  for (const [i, text] of texts.entries()) {
    const form = new FormData();
    form.append('text', text);
    form.append('visibility', 'public');
    form.append('images', new Blob([new Uint8Array(await jpeg(...colors[i]))], { type: 'image/jpeg' }), `p${i}.jpg`);
    posts.push((await call('POST', '/v1/posts', { token: tokens.awa, form })).id);
  }
  await call('PUT', '/v1/people/awa.demo/follow', { token: tokens.koffi });
  await call('PUT', '/v1/people/awa.demo/follow', { token: tokens.aminata });
  await call('PUT', '/v1/people/koffi.demo/follow', { token: tokens.awa });
  for (const p of posts) await call('PUT', `/v1/posts/${p}/like`, { token: tokens.koffi });
  await call('POST', `/v1/posts/${posts[0]}/comments`, { token: tokens.koffi, body: { text: 'Bravo Awa, tu m’inspires !' } });
  await call('POST', `/v1/posts/${posts[1]}/comments`, { token: tokens.aminata, body: { text: 'Superbe ! Passe à la boutique 😉' } });

  // 3. Premium (simulé) pour Awa ; 10 000 pièces (simulées) pour Koffi, qui encourage Awa.
  await call('POST', '/v1/premium/subscribe', { token: tokens.awa, body: { channel: 'demo' } });
  await call('POST', '/v1/wallet/purchases', { token: tokens.koffi, body: { coins: 10000, channel: 'demo', idempotencyKey: 'demo-seed-buy-1' } });
  await call('POST', '/v1/coins/gifts', { token: tokens.koffi, body: { targetType: 'post', targetId: posts[0], giftCode: 'chest_s', quantity: 2, idempotencyKey: 'demo-seed-gift-1' } });

  // 4. Boutique d'Aminata (validée directement : aucune pièce d'identité réelle dans la démo) et trois articles.
  const shopId = uuidv7();
  await pool.query(
    "insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Maison Aminata', 'maison-aminata', 'active', 'Abidjan', 'Marcory')",
    [shopId, users['aminata.demo']],
  );
  await pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, users['aminata.demo']]);
  const shop = (await call('POST', '/v1/auth/switch-space', { token: tokens.aminata, body: { type: 'merchant', id: shopId } })).accessToken as string;
  const items: Array<{ title: string; categoryCode: string; priceFcfa: number; promo?: number; color: [number, number, number] }> = [
    { title: 'Robe de soirée Lagune', categoryCode: 'vetements_soiree', priceFcfa: 35000, promo: 29000, color: [242, 13, 58] },
    { title: 'Ensemble de sport Ébrié', categoryCode: 'vetements_soiree', priceFcfa: 18000, color: [30, 164, 99] },
    { title: 'Sac en pagne', categoryCode: 'accessoires_sacs', priceFcfa: 12000, color: [255, 138, 31] },
  ];
  const productIds: string[] = [];
  for (const it of items) {
    const p = await call('POST', '/v1/shop/products', { token: shop, body: { title: it.title, categoryCode: it.categoryCode, priceFcfa: it.priceFcfa, ...(it.promo ? { promoPriceFcfa: it.promo } : {}) } });
    const form = new FormData();
    form.append('photos', new Blob([new Uint8Array(await jpeg(...it.color))], { type: 'image/jpeg' }), 'a.jpg');
    await call('POST', `/v1/shop/products/${p.id}/photos`, { token: shop, form });
    await call('POST', `/v1/shop/products/${p.id}/publish`, { token: shop });
    await call('PUT', `/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`, { token: shop, body: { quantity: 10 } });
    productIds.push(p.id);
  }

  // 5. Live programmé demain à 18 h (Awa).
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(18, 0, 0, 0);
  await call('POST', '/v1/lives', { token: tokens.awa, body: { title: 'Ma routine beauté en direct', scheduledAt: tomorrow.toISOString() } });

  console.log(`Données de démo créées : ${DEMO_ACCOUNTS.length} comptes, ${posts.length} publications, ${productIds.length} articles, 1 Live programmé.`);
  await app.close();
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
