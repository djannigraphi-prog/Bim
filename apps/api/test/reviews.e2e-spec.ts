import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;

/**
 * Lot 7-H (sans livraison) — Évaluations : article par ligne de commande (référence et version), boutique par
 * commande ; seulement le client, après la remise, dans le délai, une fois ; jamais un membre de la boutique ;
 * aucune moyenne affichée (A17) ; signalement et modération.
 */
describe('Évaluations (e2e)', () => {
  let h: Harness;
  const city = `Avis${Date.now()}`;

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
    const slug = `avis-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Boutique Élégance', $3, 'active', $4, 'Cocody')", [shopId, owner.userId, slug, city]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200);
    return { shopId, slug, auth: bearer(sw.body.accessToken) as Auth };
  }

  async function product(s: { auth: Auth }) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Robe soirée à plumes', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: 'olive' } }).jpeg().toBuffer();
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', img, 'a.jpg').expect(201);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s.auth).send({ quantity: 10 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    return { id: p.id as string, variant: p.variants[0].id as string, reference: p.reference as string };
  }

  /** Commande au retrait, remise avec le code du client (paiement Mobile Money à confirmer). */
  async function handedOver(s: { shopId: string; auth: Auth }, client: { auth: Auth }, p: { id: string; variant: string }) {
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
    return { id: o.id as string, code: code as string };
  }

  it('après la remise seulement ; une fois par ligne et par commande ; référence et version enregistrées ; aucune moyenne', async () => {
    const s = await shop();
    const p = await product(s);
    const client = await person();
    const o = await handedOver(s, client, p);
    // Avant la remise : refusé.
    expect((await h.http().post(`/v1/orders/${o.id}/reviews/items/0`).set(client.auth).send({ rating: 5 }).expect(409)).body.error.code).toBe('REVIEW_NOT_ALLOWED');
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: o.code }).expect(200);
    let mine = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body;
    expect(mine.reviews).toMatchObject({ open: true, items: [{ position: 0, review: null }], shop: null });
    await h.http().post(`/v1/orders/${o.id}/reviews/items/0`).set(client.auth).send({ rating: 6 }).expect(400);
    mine = (await h.http().post(`/v1/orders/${o.id}/reviews/items/0`).set(client.auth).send({ rating: 4, comment: 'Belle robe, plumes un peu fragiles' }).expect(201)).body;
    expect(mine.reviews.items[0].review).toMatchObject({ rating: 4, status: 'published' });
    expect((await h.http().post(`/v1/orders/${o.id}/reviews/items/0`).set(client.auth).send({ rating: 1 }).expect(409)).body.error.code).toBe('ALREADY_REVIEWED');
    await h.http().post(`/v1/orders/${o.id}/reviews/items/7`).set(client.auth).send({ rating: 3 }).expect(404);
    await h.http().post(`/v1/orders/${o.id}/reviews/shop`).set(client.auth).send({ rating: 5 }).expect(201);
    await h.http().post(`/v1/orders/${o.id}/reviews/shop`).set(client.auth).send({ rating: 5 }).expect(409);
    // Une autre personne n'évalue pas la commande d'autrui.
    const stranger = await person();
    await h.http().post(`/v1/orders/${o.id}/reviews/shop`).set(stranger.auth).send({ rating: 1 }).expect(404);

    const row = (await h.pool.query("select product_reference, content_version from reviews where order_id = $1 and kind = 'item'", [o.id])).rows[0];
    expect(row).toEqual({ product_reference: p.reference, content_version: 1 });
    // Public : la liste, sans aucune moyenne ni note globale.
    const pub = (await h.http().get(`/v1/bimshop/products/${p.id}/reviews`).expect(200)).body;
    expect(pub.items).toEqual([expect.objectContaining({ rating: 4, comment: 'Belle robe, plumes un peu fragiles', reference: p.reference, aboutCurrentVersion: true, author: { fullName: 'Awa Koné', username: client.body.username } })]);
    expect(Object.keys(pub).sort()).toEqual(['items', 'nextBefore']);
    expect((await h.http().get(`/v1/bimshop/shops/${s.slug}/reviews`).expect(200)).body.items).toEqual([expect.objectContaining({ rating: 5 })]);
    // La note et le texte ne se réécrivent pas ; rien ne se supprime (base).
    await expect(h.pool.query("update reviews set rating = 1 where order_id = $1 and kind = 'item'", [o.id])).rejects.toThrow(/réécrit/);
    await expect(h.pool.query('delete from reviews where order_id = $1', [o.id])).rejects.toThrow(/supprime/);
    // L'auteur retire son évaluation : elle disparaît de la liste publique.
    const id = (await h.pool.query("select id from reviews where order_id = $1 and kind = 'shop'", [o.id])).rows[0].id;
    await h.http().delete(`/v1/reviews/${id}`).set(stranger.auth).expect(404);
    await h.http().delete(`/v1/reviews/${id}`).set(client.auth).expect(204);
    expect((await h.http().get(`/v1/bimshop/shops/${s.slug}/reviews`).expect(200)).body.items).toEqual([]);
  });

  it('délai dépassé, paiement contesté, membre de la boutique : refusé', async () => {
    const s = await shop();
    const p = await product(s);
    const client = await person();
    const late = await handedOver(s, client, p);
    await h.http().post(`/v1/shop/orders/${late.id}/handover`).set(s.auth).send({ code: late.code }).expect(200);
    await h.pool.query("update orders set delivered_at = now() - interval '31 days' where id = $1", [late.id]);
    expect((await h.http().post(`/v1/orders/${late.id}/reviews/shop`).set(client.auth).send({ rating: 2 }).expect(409)).body.error.message).toMatch(/délai/);

    const contested = await handedOver(s, client, p);
    await h.http().post(`/v1/shop/orders/${contested.id}/handover`).set(s.auth).send({ code: contested.code }).expect(200);
    await h.http().post(`/v1/shop/orders/${contested.id}/payment/contest`).set(s.auth).send({ reason: 'Rien reçu' }).expect(200);
    expect((await h.http().post(`/v1/orders/${contested.id}/reviews/shop`).set(client.auth).send({ rating: 1 }).expect(409)).body.error.message).toMatch(/contesté/);

    const third = await handedOver(s, client, p);
    await h.http().post(`/v1/shop/orders/${third.id}/handover`).set(s.auth).send({ code: third.code }).expect(200);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s.shopId, client.userId]);
    expect((await h.http().post(`/v1/orders/${third.id}/reviews/shop`).set(client.auth).send({ rating: 5 }).expect(409)).body.error.message).toMatch(/membres/);
  });

  it('signalement d’une évaluation, masquage par la modération, rétablissement', async () => {
    const s = await shop();
    const p = await product(s);
    const client = await person();
    const o = await handedOver(s, client, p);
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: o.code }).expect(200);
    await h.http().post(`/v1/orders/${o.id}/reviews/items/0`).set(client.auth).send({ rating: 1, comment: 'Arnaque !!! appelez le 0700000000' }).expect(201);
    const id = (await h.pool.query("select id from reviews where order_id = $1 and kind = 'item'", [o.id])).rows[0].id;
    const reporter = await person();
    await h.http().post('/v1/content-reports').set(reporter.auth).send({ targetType: 'review', targetId: id, reason: 'spam' }).expect((r) => expect([200, 201]).toContain(r.status));
    // On ne signale pas sa propre évaluation.
    await h.http().post('/v1/content-reports').set(client.auth).send({ targetType: 'review', targetId: id, reason: 'spam' }).expect(400);
    const moderator = await adminSession(h, ['moderator']);
    const open = (await h.http().get('/admin/v1/content-reports?status=open').set(moderator).expect(200)).body.items.find((x: { targetId: string }) => x.targetId === id);
    expect(open).toMatchObject({ targetType: 'review', content: { kind: 'review', status: 'published' } });
    expect(open.content.text).toContain('1/5');
    await h.http().post(`/admin/v1/content-reports/${open.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'Coordonnées et accusation sans preuve' }).expect((r) => expect([200, 201]).toContain(r.status));
    expect((await h.http().get(`/v1/bimshop/products/${p.id}/reviews`).expect(200)).body.items).toEqual([]);
    await h.http().post(`/admin/v1/content/review/${id}/restore`).set(moderator).expect(200);
    expect((await h.http().get(`/v1/bimshop/products/${p.id}/reviews`).expect(200)).body.items).toHaveLength(1);
  });

  it('aucun remboursement dans BIM : le client signale la boutique (le marchand) ; la modération la voit, sans masquage', async () => {
    const s = await shop();
    const p = await product(s);
    const client = await person();
    const o = await handedOver(s, client, p);
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: o.code }).expect(200);
    const send = (auth: Auth, body: Record<string, unknown>) => h.http().post('/v1/content-reports').set(auth).send({ targetType: 'shop', targetId: s.shopId, reason: 'fraud', ...body });
    await send(client.auth, { message: 'Article différent de la photo, la boutique ne répond plus.' }).expect((r) => expect([200, 201]).toContain(r.status));
    // Doublon tant que le signalement est ouvert : même réponse, une seule ligne.
    await send(client.auth, {}).expect((r) => expect([200, 201]).toContain(r.status));
    expect((await h.pool.query("select count(*)::int n from content_reports where target_type = 'shop' and target_id = $1", [s.shopId])).rows[0].n).toBe(1);
    // L'équipe de la boutique ne signale pas sa propre boutique ; boutique inconnue : 404.
    await send(s.auth, {}).expect(400);
    await h.http().post('/v1/content-reports').set(client.auth).send({ targetType: 'shop', targetId: uuidv7(), reason: 'fraud' }).expect(404);
    const moderator = await adminSession(h, ['moderator']);
    const open = (await h.http().get('/admin/v1/content-reports?status=open').set(moderator).expect(200)).body.items.find((x: { targetId: string }) => x.targetId === s.shopId);
    expect(open).toMatchObject({ targetType: 'shop', reason: 'fraud', content: { kind: 'shop', status: 'active' } });
    expect(open.content.text).toContain('Boutique Élégance');
    // Pas de « masquer » pour une boutique : la mesure est la suspension (écran Boutiques).
    await h.http().post(`/admin/v1/content-reports/${open.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'Essai' }).expect(400);
    await h.http().post(`/admin/v1/content-reports/${open.id}/resolve`).set(moderator).send({ action: 'none', resolution: 'Boutique contactée' }).expect((r) => expect([200, 201]).toContain(r.status));
  });
});
