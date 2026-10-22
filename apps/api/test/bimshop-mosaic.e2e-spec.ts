import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';
import { testMp4 } from './mp4-fixture';

type Auth = Record<string, string>;

/**
 * V1 (19/10/2026) — BimShop façon Pinterest (décision du fondateur) : photos carrées ou portrait (une photo en paysage
 * est recadrée), une vidéo d'une minute au plus au même format, compteurs recommandations / j'aime / avis sur les
 * cartes et la fiche (jamais de note moyenne, A17).
 */
describe('BimShop en mosaïque : formats, vidéo, compteurs (e2e)', () => {
  let h: Harness;
  const city = `Mosaique${Date.now()}`;

  async function setAge(value: number | null, status = 'decided') {
    await h.pool.query("update app_settings set value = $1::jsonb, decision_status = $2 where key = 'age.min_other_payments'", [JSON.stringify(value), status]);
    h.settings.invalidate();
  }
  beforeAll(async () => {
    h = await startHarness();
    await setAge(18);
  });
  afterAll(async () => {
    await setAge(null, 'pending');
    await h.close();
  });

  async function person() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  async function shop() {
    const owner = await person();
    const shopId = uuidv7();
    const slug = `mosaique-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Boutique Mosaïque', $3, 'active', $4, 'Cocody')", [shopId, owner.userId, slug, city]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200);
    return { shopId, slug, owner, auth: bearer(sw.body.accessToken) as Auth };
  }

  const jpeg = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: 'olive' } }).jpeg().toBuffer();

  async function product(s: { auth: Auth }, photo: { width: number; height: number } = { width: 800, height: 1000 }) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Robe soirée à plumes', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    const withPhoto = (await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(photo.width, photo.height), 'a.jpg').expect(201)).body;
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s.auth).send({ quantity: 10 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    return { id: p.id as string, variant: p.variants[0].id as string, photos: withPhoto.photos as { width: number; height: number }[] };
  }

  const card = async (id: string) => (await h.http().get(`/v1/bimshop/products?q=${encodeURIComponent('Robe soirée')}`).expect(200)).body.items.find((c: { id: string }) => c.id === id);

  it('photos : paysage recadré en carré, portrait trop haut ramené à 2:3, portrait normal gardé ; taille donnée à la mosaïque', async () => {
    const s = await shop();
    const wide = await product(s, { width: 1200, height: 800 });
    expect(wide.photos[0]).toMatchObject({ width: 800, height: 800 });
    const tall = await product(s, { width: 600, height: 1500 });
    expect(tall.photos[0]).toMatchObject({ width: 600, height: 900 });
    const normal = await product(s, { width: 800, height: 1000 });
    expect(normal.photos[0]).toMatchObject({ width: 800, height: 1000 });
    expect(await card(normal.id)).toMatchObject({ imageWidth: 800, imageHeight: 1000, video: null, counts: { recommendations: 0, likes: 0, reviews: 0 } });
  });

  it('vidéo : une seule, 60 s au plus, carrée ou portrait (rotation du téléphone comprise) ; jamais en paysage ; effacée avec l’article', async () => {
    const s = await shop();
    const p = await product(s);
    const put = (buf: Buffer, auth: Auth = s.auth) => h.http().put(`/v1/shop/products/${p.id}/video`).set(auth).attach('video', buf, { filename: 'v.mp4', contentType: 'video/mp4' });
    expect((await put(testMp4({ seconds: 20, width: 1920, height: 1080 })).expect(400)).body.error.code).toBe('PRODUCT_VIDEO_FORMAT');
    expect((await put(testMp4({ seconds: 61, width: 720, height: 1280 })).expect(400)).body.error.code).toBe('PRODUCT_VIDEO_TOO_LONG');
    // V1 : portrait 9:20 des téléphones récents (1080 × 2400) accepté ; plus étroit, refusé sans parler de paysage.
    expect((await put(testMp4({ seconds: 12, width: 1080, height: 2400 })).expect(200)).body.video).toMatchObject({ width: 1080, height: 2400 });
    const narrow = (await put(testMp4({ seconds: 12, width: 1080, height: 2700 })).expect(400)).body.error;
    expect(narrow.code).toBe('PRODUCT_VIDEO_FORMAT');
    expect(narrow.message).not.toMatch(/paysage/);
    expect((await put(testMp4({ seconds: 20, width: 1920, height: 1080 })).expect(400)).body.error.message).toMatch(/paysage/);
    // Filmée en portrait au téléphone, enregistrée « couchée » avec un quart de tour : acceptée en portrait.
    const first = (await put(testMp4({ seconds: 15, width: 1920, height: 1080, rotate90: true })).expect(200)).body;
    expect(first.video).toMatchObject({ width: 1080, height: 1920, durationMs: 15000, url: expect.any(String) });
    const firstKey = (await h.pool.query('select storage_key from product_videos where product_id = $1', [p.id])).rows[0].storage_key;
    // Une nouvelle vidéo remplace l'ancienne (une seule par article) ; métadonnées effacées.
    const square = testMp4({ seconds: 30, width: 1080, height: 1080, gps: '+05.3600-004.0083/' });
    expect((await put(square).expect(200)).body.video).toMatchObject({ width: 1080, height: 1080, durationMs: 30000 });
    const rows = (await h.pool.query('select storage_key from product_videos where product_id = $1', [p.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].storage_key).not.toBe(firstKey);
    expect(await card(p.id)).toMatchObject({ video: { width: 1080, height: 1080, durationMs: 30000 } });
    expect((await h.http().get(`/v1/bimshop/products/${p.id}`).expect(200)).body.video).toMatchObject({ durationMs: 30000 });
    // Un client ne touche pas à la vidéo d'un article.
    const client = await person();
    await put(testMp4({ seconds: 10 }), client.auth).expect(403);
    // Retirer la vidéo, puis l'article : plus rien en base.
    expect((await h.http().delete(`/v1/shop/products/${p.id}/video`).set(s.auth).expect(200)).body.video).toBeNull();
    await h.http().delete(`/v1/shop/products/${p.id}/video`).set(s.auth).expect(404);
    await put(square).expect(200);
    await h.http().delete(`/v1/shop/products/${p.id}`).set(s.auth).expect(204);
    expect((await h.pool.query('select count(*)::int n from product_videos where product_id = $1', [p.id])).rows[0].n).toBe(0);
  });

  it('compteurs : recommandation (une par personne, jamais sa propre boutique), j’aime, avis ; pas de note moyenne', async () => {
    const s = await shop();
    const p = await product(s);
    const a = await person();
    const b = await person();
    expect((await h.http().put(`/v1/bimshop/products/${p.id}/recommend`).set(a.auth).expect(200)).body).toMatchObject({ recommended: true, counts: { recommendations: 1 } });
    await h.http().put(`/v1/bimshop/products/${p.id}/recommend`).set(a.auth).expect(200);
    await h.http().put(`/v1/bimshop/products/${p.id}/recommend`).set(b.auth).expect(200);
    expect((await h.http().put(`/v1/bimshop/products/${p.id}/recommend`).set(s.owner.auth).expect(409)).body.error.code).toBe('OWN_PRODUCT');
    // Une invitation dans l'équipe pas encore acceptée ne fait pas partie de la boutique : la recommandation compte.
    const invited = await person();
    await h.pool.query("insert into shop_members (shop_id, user_id, role, accepted_at) values ($1, $2, 'staff', null)", [s.shopId, invited.userId]);
    await h.http().put(`/v1/bimshop/products/${p.id}/recommend`).set(invited.auth).expect(200);
    await h.http().delete(`/v1/bimshop/products/${p.id}/recommend`).set(invited.auth).expect(200);
    await h.http().put(`/v1/bimshop/products/${p.id}/favorite`).set(a.auth).expect(200);
    expect((await h.http().get(`/v1/bimshop/products/${p.id}/me`).set(a.auth).expect(200)).body).toMatchObject({ favorite: true, recommended: true });
    expect((await card(p.id)).counts).toEqual({ recommendations: 2, likes: 1, reviews: 0 });
    await h.http().delete(`/v1/bimshop/products/${p.id}/recommend`).set(b.auth).expect(200);
    // Un avis publié après la remise compte ; la note elle-même n'est jamais additionnée ni moyennée.
    const o = (
      await h
        .http()
        .post('/v1/orders')
        .set(a.auth)
        .send({ shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', paymentMethod: 'mobile_money', expectedTotalFcfa: 20000, idempotencyKey: uuidv7().replace(/-/g, '') })
        .expect(201)
    ).body;
    for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
    const code = (await h.http().get(`/v1/orders/${o.id}`).set(a.auth)).body.handoverCode;
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(200);
    await h.http().post(`/v1/orders/${o.id}/reviews/items/0`).set(a.auth).send({ rating: 5, comment: 'Très belle robe' }).expect(201);
    const detail = (await h.http().get(`/v1/bimshop/products/${p.id}`).expect(200)).body;
    expect(detail.counts).toEqual({ recommendations: 1, likes: 1, reviews: 1 });
    expect(JSON.stringify(await card(p.id))).not.toMatch(/rating|average|moyenne/i);
  });

  it('étoiles de la boutique (jamais d’un article) : moyenne des avis sur la boutique, à partir de 3 avis', async () => {
    const s = await shop();
    const p = await product(s);
    const handedOver = async (client: { auth: Auth }) => {
      const o = (
        await h
          .http()
          .post('/v1/orders')
          .set(client.auth)
          .send({ shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', paymentMethod: 'mobile_money', expectedTotalFcfa: 20000, idempotencyKey: uuidv7().replace(/-/g, '') })
          .expect(201)
      ).body;
      for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
      const code = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.handoverCode;
      await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(200);
      return o.id as string;
    };
    const rating = async () => (await h.http().get(`/v1/bimshop/products/${p.id}`).expect(200)).body.shop.rating;
    expect(await rating()).toEqual({ average: null, reviews: 0 });
    const notes = [5, 4, 4];
    for (const [i, n] of notes.entries()) {
      const c = await person();
      const orderId = await handedOver(c);
      await h.http().post(`/v1/orders/${orderId}/reviews/shop`).set(c.auth).send({ rating: n }).expect(201);
      // Une note sur l'article ne compte jamais pour la boutique.
      await h.http().post(`/v1/orders/${orderId}/reviews/items/0`).set(c.auth).send({ rating: 1 }).expect(201);
      if (i < 2) expect(await rating()).toEqual({ average: null, reviews: i + 1 });
    }
    expect(await rating()).toEqual({ average: 4.3, reviews: 3 });
    expect((await h.http().get(`/v1/bimshop/shops/${s.slug}`).expect(200)).body.rating).toEqual({ average: 4.3, reviews: 3 });
    // Un avis masqué par la modération ne compte plus.
    await h.pool.query("update reviews set status = 'hidden' where shop_id = $1 and kind = 'shop' and rating = 5", [s.shopId]);
    expect(await rating()).toEqual({ average: null, reviews: 2 });
    // Aucune étoile sur la carte d'un article.
    expect(JSON.stringify(await card(p.id))).not.toMatch(/rating|average/);
  });

  it('V1-1910-C : badge de certification seulement pour les comptes Premium (boutique : son propriétaire), plus de Gold', async () => {
    const s = await shop();
    const p = await product(s);
    const premium = (userId: string, end: string) =>
      h.pool.query(`insert into subscriptions (id, user_id, plan, channel, price_fcfa, started_at, current_period_end) values ($1, $2, 'user_premium', 'demo', 2000, now(), now() + $3::interval)`, [uuidv7(), userId, end]);
    const detail = async () => (await h.http().get(`/v1/bimshop/products/${p.id}`).expect(200)).body.shop;
    const profile = async () => (await h.http().get(`/v1/bimshop/shops/${s.slug}`).expect(200)).body;
    // Boutique ouverte sans Premium : pas de badge (ses étoiles grises s'affichent dans l'app).
    expect(await detail()).toMatchObject({ certified: false });
    expect((await card(p.id)).shop.certified).toBe(false);
    expect((await profile()).certified).toBe(false);
    expect((await h.http().get('/v1/shop').set(s.auth).expect(200)).body.certified).toBe(false);
    // Le propriétaire passe Premium : la boutique est certifiée partout.
    await premium(s.owner.userId, '30 days');
    expect(await detail()).toMatchObject({ certified: true });
    expect((await card(p.id)).shop.certified).toBe(true);
    expect((await profile()).certified).toBe(true);
    expect((await h.http().get('/v1/shop').set(s.auth).expect(200)).body.certified).toBe(true);
    // Une personne Premium a le badge sur son profil et ses publications ; un abonnement terminé ne compte plus.
    const u = await person();
    const me = { username: u.body.username as string };
    const view = async () => (await h.http().get(`/v1/people/${me.username}`).set(s.owner.auth).expect(200)).body.certified;
    expect(await view()).toBe(false);
    await premium(u.userId, '30 days');
    expect(await view()).toBe(true);
    const post = (await h.http().post('/v1/posts').set(u.auth).field('text', 'Badge').field('visibility', 'public').expect(201)).body;
    expect((await h.http().get(`/v1/posts/${post.id}`).set(s.owner.auth).expect(200)).body.author.certified).toBe(true);
    await h.pool.query(`update subscriptions set current_period_end = now() - interval '1 minute' where user_id = $1`, [u.userId]);
    expect(await view()).toBe(false);
    expect(JSON.stringify(await profile())).not.toMatch(/gold/i);
  });

  it('V1 : partager un article à quelqu’un dans BIM (carte cliquable ; disparaît si l’article n’est plus en ligne)', async () => {
    const s = await shop();
    const p = await product(s);
    const a = await person();
    const b = await person();
    const conv = (await h.http().post('/v1/conversations').set(a.auth).send({ username: b.body.username }).expect(201)).body.id as string;
    const send = (body: Record<string, unknown>) => h.http().post(`/v1/conversations/${conv}/messages`).set(a.auth).send(body);
    const sent = (await send({ productId: p.id }).expect(201)).body;
    expect(sent).toMatchObject({ kind: 'product', text: null, product: { id: p.id, title: 'Robe soirée à plumes', shop: { slug: s.slug } } });
    // Un article et un texte dans le même message : refusé ; un article inconnu : introuvable.
    await send({ productId: p.id, text: 'Regarde' }).expect(400);
    await send({ productId: uuidv7() }).expect(404);
    const seen = (await h.http().get(`/v1/conversations/${conv}/messages`).set(b.auth).expect(200)).body.items;
    expect(seen[0]).toMatchObject({ kind: 'product', product: { id: p.id } });
    const list = (await h.http().get('/v1/conversations?box=requests').set(b.auth).expect(200)).body.items;
    expect(list.find((c: { id: string }) => c.id === conv).lastMessage.preview).toBe('Article partagé');
    // Article retiré de la vente : le message reste, sans carte.
    await h.http().post(`/v1/shop/products/${p.id}/unpublish`).set(s.auth).expect(200);
    expect((await h.http().get(`/v1/conversations/${conv}/messages`).set(b.auth).expect(200)).body.items[0]).toMatchObject({ kind: 'product', product: null });
  });
});
