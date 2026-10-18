import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 10 (prototype) — Lives sans service vidéo : programmation, lancement, commentaires, cœurs, cadeaux, article épinglé. */
describe('Lives : mode démonstration fermé (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ DEMO_MODE: 'false' });
  });
  afterAll(async () => h.close());

  it('sans DEMO_MODE : aucune liste, aucun lancement', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    expect((await h.http().get('/v1/lives').set(auth).expect(200)).body).toEqual({ available: false, live: [], upcoming: [] });
    expect((await h.http().post('/v1/lives').set(auth).send({ title: 'Mon Live' }).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('Lives : prototype (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ DEMO_MODE: 'true' });
  });
  afterAll(async () => h.close());

  async function user(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  const jpeg = () => sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 200, g: 40, b: 90 } } }).jpeg().toBuffer();
  async function merchant() {
    const u = await user();
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Maison Awa', $3, 'active', 'Abidjan', 'Cocody')", [shopId, u.userId, `l-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, u.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(u.auth).send({ type: 'merchant', id: shopId }).expect(200);
    const shop = bearer(sw.body.accessToken);
    const p = (await h.http().post('/v1/shop/products').set(shop).send({ categoryCode: 'vetements_soiree', priceFcfa: 25000, title: 'Robe de Live' }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(shop).attach('photos', await jpeg(), 'a.jpg').expect(201);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(shop).expect(200);
    return { ...u, shopId, shop, productId: p.id as string };
  }
  const state = async (auth: Record<string, string>, id: string, q = '') => (await h.http().get(`/v1/lives/${id}/state${q}`).set(auth).expect(200)).body;

  it('Live simple : lancement, spectateurs, commentaires, cœurs, cadeaux (Premium), notification, fin', async () => {
    const host = await user({ fullName: 'Awa Koné' });
    const fan = await user({ fullName: 'Koffi Yao' });
    await h.http().put(`/v1/people/${host.me.username}/follow`).set(fan.auth).expect(200);

    const live = (await h.http().post('/v1/lives').set(host.auth).send({ title: 'Routine du matin' }).expect(201)).body;
    expect(live).toMatchObject({ kind: 'simple', status: 'live', title: 'Routine du matin', isMine: true, canGift: false, video: 'unavailable', host: { id: host.userId } });
    expect((await h.http().post('/v1/lives').set(host.auth).send({ title: 'Deuxième' }).expect(409)).body.error.code).toBe('LIVE_ALREADY_RUNNING');

    const list = (await h.http().get('/v1/lives').set(fan.auth).expect(200)).body;
    expect(list.live.map((l: { id: string }) => l.id)).toContain(live.id);

    // Le spectateur lit l'état : il est compté ; commentaires et cœurs.
    let s = await state(fan.auth, live.id);
    expect(s.live).toMatchObject({ viewers: 1, heartCount: 0, isMine: false, canGift: false });
    expect(s.pollSeconds).toBe(2);
    await h.http().post(`/v1/lives/${live.id}/comments`).set(fan.auth).send({ text: 'Bravo Awa !' }).expect(201);
    await h.http().post(`/v1/lives/${live.id}/comments`).set(host.auth).send({ text: 'Merci à vous' }).expect(201);
    expect((await h.http().post(`/v1/lives/${live.id}/hearts`).set(fan.auth).send({ count: 5 }).expect(200)).body).toEqual({ heartCount: 5 });
    await h.http().post(`/v1/lives/${live.id}/hearts`).set(fan.auth).send({ count: 500 }).expect(400);
    s = await state(host.auth, live.id);
    expect(s.comments.map((c: { text: string }) => c.text)).toEqual(['Bravo Awa !', 'Merci à vous']);
    expect(s.live).toMatchObject({ viewers: 1, heartCount: 5, isMine: true });
    const next = await state(host.auth, live.id, `?after=${s.nextAfter}`);
    expect(next.comments).toEqual([]);

    // L'hôte retire un commentaire.
    await h.http().delete(`/v1/lives/${live.id}/comments/${s.comments[0].id}`).set(host.auth).expect(204);
    await h.http().delete(`/v1/lives/${live.id}/comments/${s.comments[1].id}`).set(fan.auth).expect(404);
    expect((await state(fan.auth, live.id)).comments.map((c: { text: string }) => c.text)).toEqual(['Merci à vous']);

    // Cadeaux : l'hôte doit être Premium ; animation visible par tous (liste des cadeaux récents).
    await h.http().post('/v1/wallet/purchases').set(fan.auth).send({ coins: 1000, channel: 'demo', idempotencyKey: `live-buy-${Date.now()}` }).expect(201);
    const gift = (code: string) => h.http().post('/v1/coins/gifts').set(fan.auth).send({ targetType: 'live', targetId: live.id, giftCode: code, quantity: 1, idempotencyKey: `g-${code}-${Date.now()}` });
    expect((await gift('safe').expect(409)).body.error.code).toBe('RECIPIENT_NOT_PREMIUM');
    await h.http().post('/v1/premium/subscribe').set(host.auth).send({ channel: 'demo' }).expect(200);
    expect((await state(fan.auth, live.id)).live.canGift).toBe(true);
    expect((await gift('safe').expect(201)).body.targetCoinCount).toBe(1000);
    s = await state(host.auth, live.id);
    expect(s.live.coinCount).toBe(1000);
    expect(s.gifts).toEqual([expect.objectContaining({ giftCode: 'safe', coins: 1000, from: 'Koffi Yao' })]);
    expect((await state(host.auth, live.id, `?giftsAfter=${s.nextGiftsAfter}`)).gifts).toEqual([]);
    expect((await h.http().get('/v1/wallet').set(host.auth).expect(200)).body.balance.received).toBe(1000);

    // Notifications : l'abonné voit « en direct », l'hôte voit les pièces reçues.
    const fanInbox = (await h.http().get('/v1/me/notifications').set(fan.auth).expect(200)).body.items;
    expect(fanInbox.find((i: { type: string }) => i.type === 'live_started')).toMatchObject({ text: 'Awa Koné est en direct : « Routine du matin ». Viens l’encourager !', link: `/lives/${live.id}` });
    const hostInbox = (await h.http().get('/v1/me/notifications').set(host.auth).expect(200)).body.items;
    expect(hostInbox.map((i: { text: string }) => i.text)).toContain('Koffi Yao t’a envoyé 1 000 pièces sur ton Live. Bravo !');

    // Fin : plus de commentaires, de cœurs ni de cadeaux.
    expect((await h.http().post(`/v1/lives/${live.id}/end`).set(fan.auth).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await h.http().post(`/v1/lives/${live.id}/end`).set(host.auth).expect(200)).body).toMatchObject({ status: 'ended', viewers: 0, peakViewers: 1 });
    expect((await h.http().post(`/v1/lives/${live.id}/comments`).set(fan.auth).send({ text: 'Encore' }).expect(409)).body.error.code).toBe('LIVE_NOT_RUNNING');
    expect((await gift('coin1').expect(409)).body.error.code).toBe('LIVE_NOT_RUNNING');
    expect((await state(fan.auth, live.id)).pollSeconds).toBe(10);
  });

  it('programmation : date future obligatoire, lancement par l’hôte, annulation', async () => {
    const host = await user();
    await h.http().post('/v1/lives').set(host.auth).send({ title: 'Plus tard', scheduledAt: new Date(Date.now() - 60_000).toISOString() }).expect(400);
    await h.http().post('/v1/lives').set(host.auth).send({ title: 'Trop loin', scheduledAt: new Date(Date.now() + 40 * 86_400_000).toISOString() }).expect(400);
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const l = (await h.http().post('/v1/lives').set(host.auth).send({ title: 'Demain 18 h', scheduledAt: at }).expect(201)).body;
    expect(l).toMatchObject({ status: 'scheduled', startedAt: null });
    const other = await user();
    expect((await h.http().get('/v1/lives').set(other.auth).expect(200)).body.upcoming.map((x: { id: string }) => x.id)).toContain(l.id);
    await h.http().post(`/v1/lives/${l.id}/comments`).set(other.auth).send({ text: 'Hâte !' }).expect(409);
    await h.http().post(`/v1/lives/${l.id}/start`).set(other.auth).expect(404);
    expect((await h.http().post(`/v1/lives/${l.id}/start`).set(host.auth).expect(200)).body.status).toBe('live');
    expect((await h.http().post(`/v1/lives/${l.id}/start`).set(host.auth).expect(409)).body.error.code).toBe('LIVE_NOT_SCHEDULED');
    await h.http().post(`/v1/lives/${l.id}/end`).set(host.auth).expect(200);

    const c = (await h.http().post('/v1/lives').set(host.auth).send({ title: 'À annuler', scheduledAt: at }).expect(201)).body;
    expect((await h.http().post(`/v1/lives/${c.id}/end`).set(host.auth).expect(200)).body.status).toBe('ended');
  });

  it('Live vente : boutique active (propriétaire), article publié épinglé, Live simple sans épingle', async () => {
    const m = await merchant();
    const viewer = await user();
    await h.http().post('/v1/shop/lives').set(m.auth).send({ title: 'Soldes' }).expect(403); // espace utilisateur
    await h.http().post('/v1/shop/lives').set(m.shop).send({ title: 'Soldes', productId: uuidv7() }).expect(400);
    const l = (await h.http().post('/v1/shop/lives').set(m.shop).send({ title: 'Soldes de la semaine', productId: m.productId }).expect(201)).body;
    expect(l).toMatchObject({ kind: 'sale', status: 'live', shop: { id: m.shopId, name: 'Maison Awa' }, pinnedProduct: { id: m.productId, title: 'Robe de Live', priceFcfa: 25000 } });
    expect((await state(viewer.auth, l.id)).live.pinnedProduct.id).toBe(m.productId);
    expect((await h.http().put(`/v1/lives/${l.id}/pinned-product`).set(m.shop).send({ productId: null }).expect(200)).body.pinnedProduct).toBeNull();
    await h.http().put(`/v1/lives/${l.id}/pinned-product`).set(viewer.auth).send({ productId: m.productId }).expect(404);
    await h.http().post(`/v1/lives/${l.id}/end`).set(m.shop).expect(200);

    const simple = (await h.http().post('/v1/lives').set(viewer.auth).send({ title: 'Simple' }).expect(201)).body;
    expect((await h.http().put(`/v1/lives/${simple.id}/pinned-product`).set(viewer.auth).send({ productId: m.productId }).expect(409)).body.error.code).toBe('LIVE_NOT_SALE');
    await h.http().post(`/v1/lives/${simple.id}/end`).set(viewer.auth).expect(200);
  });

  it('blocage : le Live d’une personne bloquée est introuvable ; fin automatique après 4 heures', async () => {
    const host = await user();
    const blocked = await user();
    const l = (await h.http().post('/v1/lives').set(host.auth).send({ title: 'Privé' }).expect(201)).body;
    await h.http().put(`/v1/people/${blocked.me.username}/block`).set(host.auth).expect(200);
    await h.http().get(`/v1/lives/${l.id}`).set(blocked.auth).expect(404);
    expect((await h.http().get('/v1/lives').set(blocked.auth).expect(200)).body.live.map((x: { id: string }) => x.id)).not.toContain(l.id);
    await h.pool.query(`update lives set started_at = now() - interval '5 hours' where id = $1`, [l.id]);
    expect((await h.http().get(`/v1/lives/${l.id}`).set(host.auth).expect(200)).body.status).toBe('ended');
    // Un nouveau Live est de nouveau possible.
    const again = (await h.http().post('/v1/lives').set(host.auth).send({ title: 'Nouveau' }).expect(201)).body;
    await h.http().post(`/v1/lives/${again.id}/end`).set(host.auth).expect(200);
  });
});
