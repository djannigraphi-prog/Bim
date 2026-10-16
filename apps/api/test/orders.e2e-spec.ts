import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { OrdersRunner } from '../src/modules/orders/orders-runner';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;

/**
 * Lot 7-B — Commandes : BimShop et proposition dans la conversation, lignes figées, frais calculés par le serveur,
 * confirmation, expiration, annulation, code de remise, stock sans survente, permissions. Aucun paiement.
 */
describe('Commandes (e2e)', () => {
  let h: Harness;
  let admin: Auth;
  const city = `Cmd${Date.now()}`;
  let shopCommune = '';
  let homeCommune = '';
  const grid = { baseFcfa: 500, perMinuteFcfa: 40, minimumFcfa: 1000, roundingFcfa: 25, freeWaitMinutes: 5, waitPerMinuteFcfa: 50, waitCapMinutes: 15 };

  async function setAge(value: number | null, status = 'decided') {
    await h.pool.query("update app_settings set value = $1::jsonb, decision_status = $2 where key = 'age.min_other_payments'", [JSON.stringify(value), status]);
    h.settings.invalidate();
  }

  async function publishTariff(mode: string, values = grid) {
    const d = (await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode, ...values }).expect(200)).body;
    await h.http().post(`/admin/v1/delivery/tariffs/${d.id}/publish`).set(admin).expect(201);
  }

  beforeAll(async () => {
    h = await startHarness();
    admin = await adminSession(h, ['super_admin']);
    await setAge(18);
    const c = (await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name: 'Cocody' }).expect(201)).body.items;
    shopCommune = c.find((x: { name: string; city: string }) => x.name === 'Cocody' && x.city === city).code;
    homeCommune = (await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name: 'Yopougon' }).expect(201)).body.items.find((x: { name: string; city: string }) => x.name === 'Yopougon' && x.city === city).code;
    await h.http().put('/admin/v1/delivery/durations').set(admin).send({ fromCode: shopCommune, toCode: homeCommune, mode: 'express', minutes: 30 }).expect(200);
    await publishTariff('express');
  });
  afterAll(async () => {
    await setAge(null, 'pending');
    await h.close();
  });

  const jpeg = () => sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 80, b: 120 } } }).jpeg().toBuffer();

  async function person(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  /** Boutique ouverte à Cocody, avec son propriétaire dans l'espace boutique. */
  async function shop() {
    const owner = await person();
    const shopId = uuidv7();
    const slug = `cmd-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Boutique Élégance', $3, 'active', $4, 'Cocody')", [shopId, owner.userId, slug, city]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200);
    return { shopId, slug, owner, auth: bearer(sw.body.accessToken) as Auth };
  }

  /** Article publié avec photo et stock. */
  async function product(s: { auth: Auth }, opts: { price?: number; promo?: number; stock?: number; publish?: boolean } = {}) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Robe soirée à plumes', categoryCode: 'vetements_soiree', priceFcfa: opts.price ?? 20000, ...(opts.promo ? { promoPriceFcfa: opts.promo } : {}) }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    const variant = p.variants[0].id;
    if (opts.stock) await h.http().put(`/v1/shop/products/${p.id}/variants/${variant}/stock`).set(s.auth).send({ quantity: opts.stock }).expect(200);
    if (opts.publish !== false) await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    return { id: p.id as string, variant: variant as string, reference: p.reference as string };
  }

  const stock = async (variant: string) => (await h.pool.query('select coalesce(sum(delta), 0)::int s from inventory_movements where variant_id = $1', [variant])).rows[0].s as number;
  const key = () => uuidv7().replace(/-/g, '');

  function order(c: { auth: Auth }, body: Record<string, unknown>, status = 201) {
    return h.http().post('/v1/orders').set(c.auth).send({ paymentMethod: 'mobile_money', idempotencyKey: key(), ...body }).expect(status);
  }

  it('règle d’âge non décidée : commandes fermées ; moins de 18 ans refusé', async () => {
    const s = await shop();
    const p = await product(s, { stock: 3 });
    const items = [{ productId: p.id, variantId: p.variant, quantity: 1 }];
    const adult = await person();
    await setAge(null, 'pending');
    expect((await order(adult, { shopId: s.shopId, items, deliveryMode: 'pickup', expectedTotalFcfa: 20000 }, 503)).body.error.code).toBe('RULE_NOT_DECIDED');
    await setAge(18);
    const minor = await person({ birthDate: `${new Date().getFullYear() - 17}-01-01` });
    expect((await order(minor, { shopId: s.shopId, items, deliveryMode: 'pickup', expectedTotalFcfa: 20000 }, 403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');
    // On ne commande pas dans sa propre boutique.
    await order({ auth: s.owner.auth }, { shopId: s.shopId, items, deliveryMode: 'pickup', expectedTotalFcfa: 20000 }, 403);
  });

  it('BimShop, retrait en boutique : anti-doublon, montant vérifié, confirmation (stock, code), remise par code à usage unique', async () => {
    const s = await shop();
    const p = await product(s, { price: 25000, promo: 20000, stock: 3 });
    const client = await person();
    const items = [{ productId: p.id, variantId: p.variant, quantity: 2 }];
    const pre = (await h.http().post('/v1/orders/preview').set(client.auth).send({ shopId: s.shopId, items, deliveryMode: 'pickup', paymentMethod: 'cash' }).expect(200)).body;
    expect(pre).toMatchObject({ itemsTotalFcfa: 40000, deliveryFeeFcfa: null, totalFcfa: 40000, canOrder: true, items: [{ reference: p.reference, unitPriceFcfa: 20000, available: true }] });
    // Montant affiché différent du calcul du serveur : refusé, rien n'est créé.
    expect((await order(client, { shopId: s.shopId, items, deliveryMode: 'pickup', paymentMethod: 'cash', expectedTotalFcfa: 39000 }, 409)).body.error).toMatchObject({ code: 'PRICE_CHANGED', details: { totalFcfa: 40000 } });

    // Double appui : deux envois simultanés avec la même clé ne créent qu'une commande.
    const k = key();
    const body = { shopId: s.shopId, items, deliveryMode: 'pickup', paymentMethod: 'cash', expectedTotalFcfa: 40000, idempotencyKey: k };
    const [a, b] = await Promise.all([h.http().post('/v1/orders').set(client.auth).send(body), h.http().post('/v1/orders').set(client.auth).send(body)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect((await h.pool.query('select count(*)::int n from orders where customer_id = $1', [client.userId])).rows[0].n).toBe(1);
    const o = a.body;
    expect(o).toMatchObject({ status: 'pending_shop', number: expect.stringMatching(/^CMD-\d{6,}$/), source: 'bimshop', deliveryMode: 'pickup', paymentMethod: 'cash', handoverCode: null, actions: ['cancel'] });
    expect(o.items[0]).toMatchObject({ reference: p.reference, title: 'Robe soirée à plumes', variantLabel: 'Unique', quantity: 2, catalogPriceFcfa: 20000, unitPriceFcfa: 20000, photoUrl: expect.any(String) });
    expect(await stock(p.variant)).toBe(3); // rien n'est retiré avant la confirmation

    // La boutique confirme : stock retiré, code créé, visible du seul client.
    let so = (await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(s.auth).expect(200)).body;
    expect(so).toMatchObject({ status: 'confirmed', handoverCode: null, handoverCodeStatus: 'active', customer: { fullName: 'Awa Koné' }, actions: ['prepare', 'cancel'] });
    expect(await stock(p.variant)).toBe(1);
    const mine = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth).expect(200)).body;
    expect(mine.handoverCode).toMatch(/^\d{4}$/);
    expect(mine.customer).toBeNull();
    // Le code n'apparaît ni dans l'historique ni dans le journal.
    const code = mine.handoverCode as string;
    const traces = (await h.pool.query("select data::text d from order_events where order_id = $1 union all select metadata::text from audit_logs where target_id = $1", [o.id])).rows.map((r: { d: string }) => r.d).join(' ');
    expect(traces).not.toContain(code);
    // Requête répétée : sans effet.
    expect((await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(s.auth).expect(409)).body.error.code).toBe('ORDER_STATE_CHANGED');

    // Remise impossible avant « prête » ; préparation puis prête.
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(409);
    await h.http().post(`/v1/shop/orders/${o.id}/prepare`).set(s.auth).expect(200);
    so = (await h.http().post(`/v1/shop/orders/${o.id}/ready`).set(s.auth).expect(200)).body;
    expect(so.actions).toEqual(['handover', 'cancel']);
    const wrong = code === '0000' ? '1111' : '0000';
    expect((await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: wrong }).expect(400)).body.error).toMatchObject({ code: 'HANDOVER_CODE_INVALID', details: { remaining: 4 } });
    so = (await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(200)).body;
    // 7-C : remise faite ; reste le paiement en espèces à constater au comptoir.
    expect(so).toMatchObject({ status: 'delivered', handoverCodeStatus: 'used', actions: ['cash_received'] });
    expect(so.events.map((e: { type: string }) => e.type)).toEqual(['created', 'confirmed', 'preparing', 'ready', 'code_failed', 'code_validated', 'handed_over']);
    // Code déjà utilisé : refusé ; le client ne le voit plus.
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(409);
    expect((await h.http().get(`/v1/orders/${o.id}`).set(client.auth).expect(200)).body.handoverCode).toBeNull();
    // Historique et lignes non modifiables, commande non supprimable (base).
    await expect(h.pool.query("update order_events set type = 'x' where order_id = $1", [o.id])).rejects.toThrow(/historique/);
    await expect(h.pool.query('update order_items set applied_price_fcfa = 1 where order_id = $1', [o.id])).rejects.toThrow(/historique/);
    await expect(h.pool.query('delete from orders where id = $1', [o.id])).rejects.toThrow(/historique/);
    await expect(h.pool.query("update orders set number = 'CMD-X' where id = $1", [o.id])).rejects.toThrow(/numéro/);
    // Notifications du client : confirmée, prête, remise.
    const notes = (await h.http().get('/v1/me/notifications').set(client.auth).expect(200)).body.items.filter((n: { type: string }) => n.type === 'order_update');
    expect(notes.map((n: { text: string }) => n.text)).toEqual([`Ta commande ${o.number} t’a été remise. Merci !`, `Ta commande ${o.number} est prête.`, `« Boutique Élégance » a confirmé ta commande ${o.number}.`]);
    expect(notes[0].link).toBe(`/orders/${o.id}`);
  });

  it('code de remise bloqué après 5 essais faux', async () => {
    const s = await shop();
    const p = await product(s, { stock: 1 });
    const client = await person();
    const o = (await order(client, { shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
    const code = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.handoverCode as string;
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i++) await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: wrong }).expect(400);
    expect((await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: wrong }).expect(409)).body.error.code).toBe('HANDOVER_CODE_BLOCKED');
    // Même le bon code ne passe plus.
    expect((await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(409)).body.error.code).toBe('HANDOVER_CODE_BLOCKED');
    expect((await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body).toMatchObject({ status: 'ready', handoverCode: null, handoverCodeStatus: 'blocked' });
  });

  it('survente impossible : deux commandes pour le dernier article, la seconde confirmation est refusée', async () => {
    const s = await shop();
    const p = await product(s, { stock: 1 });
    const items = [{ productId: p.id, variantId: p.variant, quantity: 1 }];
    const [c1, c2] = [await person(), await person()];
    const o1 = (await order(c1, { shopId: s.shopId, items, deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    const o2 = (await order(c2, { shopId: s.shopId, items, deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    const [r1, r2] = await Promise.all([h.http().post(`/v1/shop/orders/${o1.id}/confirm`).set(s.auth), h.http().post(`/v1/shop/orders/${o2.id}/confirm`).set(s.auth)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const refused = r1.status === 409 ? r1 : r2;
    expect(refused.body.error.code).toBe('OUT_OF_STOCK');
    expect(await stock(p.variant)).toBe(0);
    // La commande refusée reste en attente, sans code ni retrait de stock.
    const pending = r1.status === 409 ? o1 : o2;
    expect((await h.http().get(`/v1/shop/orders/${pending.id}`).set(s.auth)).body).toMatchObject({ status: 'pending_shop', handoverCodeStatus: null });
    // Et une nouvelle commande est refusée d'emblée.
    expect((await order(await person(), { shopId: s.shopId, items, deliveryMode: 'pickup', expectedTotalFcfa: 20000 }, 409)).body.error.code).toBe('OUT_OF_STOCK');
  });

  it('livraison : frais calculés et figés à la commande ; nouvelle grille et nouvelle promotion sans effet ; espèces refusées', async () => {
    const s = await shop();
    const p = await product(s, { stock: 5 });
    const client = await person();
    const items = [{ productId: p.id, variantId: p.variant, quantity: 1 }];
    // Mode économique sans durée saisie pour ce trajet (et peut-être sans grille, selon l'ordre des suites) : indisponible.
    expect((await order(client, { shopId: s.shopId, items, deliveryMode: 'economy', communeCode: homeCommune, address: 'Rue des jardins, près de la pharmacie', expectedTotalFcfa: 21000 }, 409)).body.error).toMatchObject({ code: 'DELIVERY_UNAVAILABLE', details: { reason: expect.stringMatching(/^NO_(TARIFF|DURATION)$/) } });
    // Espèces en livraison : refusées (livreurs employés au 7-E / 7-F).
    await order(client, { shopId: s.shopId, items, deliveryMode: 'express', communeCode: homeCommune, address: 'Rue des jardins', paymentMethod: 'cash', expectedTotalFcfa: 21700 }, 400);
    // Adresse obligatoire.
    expect(Object.keys((await order(client, { shopId: s.shopId, items, deliveryMode: 'express', expectedTotalFcfa: 21700 }, 400)).body.error.details.fields).sort()).toEqual(['address', 'communeCode']);
    const pre = (await h.http().post('/v1/orders/preview').set(client.auth).send({ shopId: s.shopId, items, deliveryMode: 'express', communeCode: homeCommune, paymentMethod: 'mobile_money' }).expect(200)).body;
    expect(pre).toMatchObject({ itemsTotalFcfa: 20000, deliveryFeeFcfa: 1700, totalFcfa: 21700, delivery: { estimatedMinutes: 30, waitRule: { freeMinutes: 5, billed: false } } });
    const o = (await order(client, { shopId: s.shopId, items, deliveryMode: 'express', communeCode: homeCommune, address: 'Rue des jardins, près de la pharmacie', expectedTotalFcfa: 21700 })).body;
    expect(o).toMatchObject({ totalFcfa: 21700, deliveryFeeFcfa: 1700, delivery: { commune: `Yopougon (${city})`, address: 'Rue des jardins, près de la pharmacie', estimatedMinutes: 30 } });
    // Nouvelle grille et promotion après la commande : la commande ne change pas.
    await publishTariff('express', { ...grid, baseFcfa: 900 });
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ promoPriceFcfa: 15000 }).expect(200);
    expect((await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body).toMatchObject({ totalFcfa: 21700, deliveryFeeFcfa: 1700, items: [{ unitPriceFcfa: 20000 }] });
    // La boutique confirme puis prépare : pas de remise au comptoir pour une livraison (7-F).
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(s.auth).expect(200);
    await h.http().post(`/v1/shop/orders/${o.id}/prepare`).set(s.auth).expect(200);
    const so = (await h.http().post(`/v1/shop/orders/${o.id}/ready`).set(s.auth).expect(200)).body;
    // 7-F : prête et livrée à domicile : la boutique lance la recherche d'un livreur (ou annule).
    expect(so.actions).toEqual(['cancel', 'start_delivery']);
    expect((await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: '1234' }).expect(409)).body.error.code).toBe('NOT_PICKUP');
  });

  it('proposition dans la conversation : prix négocié à la baisse seulement, carte, acceptation, expiration', async () => {
    const s = await shop();
    const draft = await product(s, { stock: 2, publish: false }); // A14 : fiche non publiée possible
    const client = await person();
    const conv = (await h.http().post('/v1/conversations/shop').set(client.auth).send({ shopSlug: s.slug }).expect(201)).body;
    await h.http().post(`/v1/conversations/${conv.id}/messages`).set(client.auth).field('text', 'Vous l’avez en noir ?').expect(201);
    const items = [{ productId: draft.id, variantId: draft.variant, quantity: 1, appliedPriceFcfa: 18000 }];
    // Au-dessus du prix du catalogue : refusé (A15).
    await h.http().post('/v1/shop/orders/proposals').set(s.auth).send({ conversationId: conv.id, items: [{ ...items[0], appliedPriceFcfa: 21000 }], idempotencyKey: key() }).expect(400);
    const prop = (await h.http().post('/v1/shop/orders/proposals').set(s.auth).send({ conversationId: conv.id, items, idempotencyKey: key() }).expect(201)).body;
    expect(prop).toMatchObject({ status: 'proposed', source: 'conversation', itemsTotalFcfa: 18000, items: [{ catalogPriceFcfa: 20000, unitPriceFcfa: 18000 }], actions: ['withdraw'] });
    // Carte dans la conversation, des deux côtés.
    const msgs = (await h.http().get(`/v1/conversations/${conv.id}/messages`).set(client.auth).expect(200)).body.items;
    expect(msgs[0]).toMatchObject({ kind: 'order', senderIsMe: false, order: { id: prop.id, number: prop.number, status: 'proposed', itemsTotalFcfa: 18000 } });
    expect((await h.http().get('/v1/conversations').set(client.auth).expect(200)).body.items[0].lastMessage.preview).toBe('Proposition de commande');
    // Le client accepte (retrait) ; montant vérifié ; stock retiré ; double acceptation sans effet.
    expect((await h.http().get(`/v1/orders/${prop.id}`).set(client.auth)).body.actions).toEqual(['accept', 'decline']);
    const acc = { deliveryMode: 'pickup', paymentMethod: 'mobile_money', expectedTotalFcfa: 18000 };
    const [x, y] = await Promise.all([h.http().post(`/v1/orders/${prop.id}/accept`).set(client.auth).send(acc), h.http().post(`/v1/orders/${prop.id}/accept`).set(client.auth).send(acc)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await stock(draft.variant)).toBe(1);
    const accepted = x.status === 200 ? x.body : y.body;
    expect(accepted).toMatchObject({ status: 'confirmed', handoverCode: expect.stringMatching(/^\d{4}$/) });
    expect(accepted.events.map((e: { type: string }) => e.type)).toEqual(['proposed', 'accepted']);

    // Proposition expirée : l'acceptation tardive est sans effet ; le worker l'expire.
    const late = (await h.http().post('/v1/shop/orders/proposals').set(s.auth).send({ conversationId: conv.id, items: [{ productId: draft.id, variantId: draft.variant, quantity: 1 }], idempotencyKey: key() }).expect(201)).body;
    await h.pool.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [late.id]);
    expect((await h.http().post(`/v1/orders/${late.id}/accept`).set(client.auth).send({ ...acc, expectedTotalFcfa: 20000 }).expect(409)).body.error).toMatchObject({ code: 'ORDER_STATE_CHANGED', details: { status: 'expired' } });
    expect(await stock(draft.variant)).toBe(1);
    const third = (await h.http().post('/v1/shop/orders/proposals').set(s.auth).send({ conversationId: conv.id, items: [{ productId: draft.id, variantId: draft.variant, quantity: 1 }], idempotencyKey: key() }).expect(201)).body;
    await h.pool.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [third.id]);
    expect(await h.app.get(OrdersRunner).tick()).toBeGreaterThanOrEqual(1);
    expect((await h.http().get(`/v1/shop/orders/${third.id}`).set(s.auth)).body).toMatchObject({ status: 'expired', ended: { byType: 'system', fromStatus: 'proposed' } });
    // Le client refuse une proposition : « refusée ».
    const fourth = (await h.http().post('/v1/shop/orders/proposals').set(s.auth).send({ conversationId: conv.id, items: [{ productId: draft.id, variantId: draft.variant, quantity: 1 }], idempotencyKey: key() }).expect(201)).body;
    expect((await h.http().post(`/v1/orders/${fourth.id}/cancel`).set(client.auth).send({}).expect(200)).body).toMatchObject({ status: 'declined', ended: { byType: 'customer', fromStatus: 'proposed' } });

    // Proposition refusée à une personne de moins de 18 ans, sans en dire le motif à la boutique.
    const minor = await person({ birthDate: `${new Date().getFullYear() - 17}-01-01` });
    const c2 = (await h.http().post('/v1/conversations/shop').set(minor.auth).send({ shopSlug: s.slug }).expect(201)).body;
    expect((await h.http().post('/v1/shop/orders/proposals').set(s.auth).send({ conversationId: c2.id, items: [{ productId: draft.id, variantId: draft.variant, quantity: 1 }], idempotencyKey: key() }).expect(403)).body.error.code).toBe('CUSTOMER_CANNOT_ORDER');
    // Conversation d'une autre boutique : introuvable.
    const other = await shop();
    await h.http().post('/v1/shop/orders/proposals').set(other.auth).send({ conversationId: conv.id, items: [{ productId: draft.id, variantId: draft.variant, quantity: 1 }], idempotencyKey: key() }).expect(404);
  });

  it('annulation : stock remis, code annulé, auteur et statut enregistrés ; action tardive sans effet', async () => {
    const s = await shop();
    const p = await product(s, { stock: 2 });
    const client = await person();
    const o = (await order(client, { shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 2 }], deliveryMode: 'pickup', expectedTotalFcfa: 40000 })).body;
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(s.auth).expect(200);
    expect(await stock(p.variant)).toBe(0);
    const c = (await h.http().post(`/v1/orders/${o.id}/cancel`).set(client.auth).send({ reason: 'Je me suis trompée de taille' }).expect(200)).body;
    expect(c).toMatchObject({ status: 'cancelled', handoverCode: null, handoverCodeStatus: 'cancelled', ended: { byType: 'customer', fromStatus: 'confirmed', reason: 'Je me suis trompée de taille' } });
    expect(await stock(p.variant)).toBe(2);
    const moves = (await h.pool.query('select delta, reason from inventory_movements where variant_id = $1 order by created_at', [p.variant])).rows;
    expect(moves.slice(-2)).toEqual([{ delta: -2, reason: 'sale' }, { delta: 2, reason: 'return' }]);
    // Requête tardive de la boutique : sans effet.
    expect((await h.http().post(`/v1/shop/orders/${o.id}/prepare`).set(s.auth).expect(409)).body.error.code).toBe('ORDER_STATE_CHANGED');
    await h.http().post(`/v1/orders/${o.id}/cancel`).set(client.auth).send({}).expect(409);

    // Annulation par la boutique : motif obligatoire ; en préparation, le client ne peut plus annuler seul.
    const o2 = (await order(client, { shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    await h.http().post(`/v1/shop/orders/${o2.id}/confirm`).set(s.auth).expect(200);
    await h.http().post(`/v1/shop/orders/${o2.id}/prepare`).set(s.auth).expect(200);
    await h.http().post(`/v1/orders/${o2.id}/cancel`).set(client.auth).send({}).expect(409);
    await h.http().post(`/v1/shop/orders/${o2.id}/cancel`).set(s.auth).send({}).expect(400);
    expect((await h.http().post(`/v1/shop/orders/${o2.id}/cancel`).set(s.auth).send({ reason: 'Article abîmé au déballage' }).expect(200)).body).toMatchObject({ status: 'cancelled', ended: { byType: 'shop', fromStatus: 'preparing' } });
    expect(await stock(p.variant)).toBe(2);
    // Refus d'une commande en attente, avec motif ; expiration d'une commande non confirmée.
    const o3 = (await order(client, { shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    expect((await h.http().post(`/v1/shop/orders/${o3.id}/decline`).set(s.auth).send({ reason: 'Rupture chez le fournisseur' }).expect(200)).body).toMatchObject({ status: 'declined', ended: { byType: 'shop', reason: 'Rupture chez le fournisseur' } });
    const o4 = (await order(client, { shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    await h.pool.query("update orders set expires_at = now() - interval '1 minute' where id = $1", [o4.id]);
    expect((await h.http().post(`/v1/shop/orders/${o4.id}/confirm`).set(s.auth).expect(409)).body.error.details.status).toBe('expired');
  });

  it('accès : chaque partie ne voit que ses commandes ; employés selon leurs permissions', async () => {
    const s = await shop();
    const p = await product(s, { stock: 2 });
    const client = await person();
    const o = (await order(client, { shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', expectedTotalFcfa: 20000 })).body;
    // Une autre personne, une autre boutique : introuvable.
    const stranger = await person();
    await h.http().get(`/v1/orders/${o.id}`).set(stranger.auth).expect(404);
    await h.http().post(`/v1/orders/${o.id}/cancel`).set(stranger.auth).send({}).expect(404);
    const other = await shop();
    await h.http().get(`/v1/shop/orders/${o.id}`).set(other.auth).expect(404);
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(other.auth).expect(404);
    // Espace personnel ≠ espace boutique.
    await h.http().get('/v1/shop/orders').set(s.owner.auth).expect(403);

    // Employé : rien par défaut ; « consulter » ne permet pas de confirmer.
    const staff = await person();
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s.shopId, staff.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(staff.auth).send({ type: 'merchant', id: s.shopId }).expect(200);
    const st = bearer(sw.body.accessToken);
    await h.http().get('/v1/shop/orders').set(st).expect(403);
    await h.pool.query("insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, 'orders.read')", [s.shopId, staff.userId]);
    const list = (await h.http().get('/v1/shop/orders?box=todo').set(st).expect(200)).body.items;
    expect(list).toEqual([expect.objectContaining({ id: o.id, number: o.number, status: 'pending_shop', customerName: 'Awa Koné', actions: ['confirm', 'decline'] })]);
    expect((await h.http().get('/v1/shop/orders/counts').set(st).expect(200)).body).toEqual({ toConfirm: 1, toPrepare: 0, ready: 0, paymentsToConfirm: 0 });
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(st).expect(403);
    await h.pool.query("insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, 'orders.prepare')", [s.shopId, staff.userId]);
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(st).expect(200);
    // L'auteur de la confirmation est l'employé.
    const ev = (await h.pool.query("select actor_type, actor_id from order_events where order_id = $1 and type = 'confirmed'", [o.id])).rows[0];
    expect(ev).toEqual({ actor_type: 'shop', actor_id: staff.userId });
    // « Mes commandes » du client.
    const mine = (await h.http().get('/v1/orders').set(client.auth).expect(200)).body.items;
    expect(mine).toEqual([expect.objectContaining({ id: o.id, shopName: 'Boutique Élégance', title: 'Robe soirée à plumes', status: 'confirmed', totalFcfa: 20000 })]);
  });
});
