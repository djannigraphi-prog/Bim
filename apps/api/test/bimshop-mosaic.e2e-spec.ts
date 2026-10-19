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
});
