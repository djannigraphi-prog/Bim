import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { OrdersRunner } from '../src/modules/orders/orders-runner';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;

/**
 * Lot 7-F / 7-G / évaluation des livraisons — le marchand sollicite un livreur éligible (priorité employés, partenaires,
 * indépendants, calculée par le serveur) ; le livreur accepte ; course, code, paiement, clôture ; refus du client et
 * incidents ; historique personnel ; évaluation distincte. Aucun paiement réel.
 */
describe('Livraisons (e2e)', () => {
  let h: Harness;
  let admin: Auth;
  const city = `Lv${Date.now()}`;
  let shopCommune = '';
  let home = '';
  let elsewhere = '';
  const grid = { baseFcfa: 500, perMinuteFcfa: 40, minimumFcfa: 1000, roundingFcfa: 25, freeWaitMinutes: 5, waitPerMinuteFcfa: 50, waitCapMinutes: 15 };

  async function setting(key: string, value: unknown, status = 'decided') {
    await h.pool.query('update app_settings set value = $1::jsonb, decision_status = $2 where key = $3', [JSON.stringify(value), status, key]);
    h.settings.invalidate();
  }

  beforeAll(async () => {
    h = await startHarness();
    admin = await adminSession(h, ['super_admin']);
    await setting('age.min_other_payments', 18);
    const add = async (name: string) =>
      (await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name }).expect(201)).body.items.find((x: { name: string; city: string }) => x.name === name && x.city === city).code as string;
    shopCommune = await add('Cocody');
    home = await add('Yopougon');
    elsewhere = await add('Abobo');
    for (const mode of ['express', 'economy']) {
      await h.http().put('/admin/v1/delivery/durations').set(admin).send({ fromCode: shopCommune, toCode: home, mode, minutes: 30 }).expect(200);
      const d = (await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode, ...grid }).expect(200)).body;
      await h.http().post(`/admin/v1/delivery/tariffs/${d.id}/publish`).set(admin).expect(201);
    }
  });
  afterAll(async () => {
    await setting('age.min_other_payments', null, 'pending');
    await h.close();
  });

  async function person() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  async function shop() {
    const owner = await person();
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Boutique Élégance', $3, 'active', $4, 'Cocody')", [shopId, owner.userId, `lv-${shopId}`, city]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200);
    const p = (await h.http().post('/v1/shop/products').set(bearer(sw.body.accessToken)).send({ title: 'Robe soirée à plumes', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    const auth = bearer(sw.body.accessToken) as Auth;
    const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: 'navy' } }).jpeg().toBuffer();
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(auth).attach('photos', img, 'a.jpg').expect(201);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(auth).send({ quantity: 50 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(auth).expect(200);
    return { shopId, owner, auth, product: { id: p.id as string, variant: p.variants[0].id as string } };
  }

  /** Livreur vérifié (compte actif), disponible, desservant les communes données, éventuellement lié à la boutique. */
  async function courier(communes: string[], relation?: { shopId: string; kind: 'employee' | 'partner' }, capacity = 2) {
    const u = await person();
    const id = uuidv7();
    await h.pool.query("insert into courier_accounts (id, user_id, type, status, available, capacity, vehicle) values ($1, $2, 'independent', 'active', true, $3, 'moto')", [id, u.userId, capacity]);
    for (const c of communes) await h.pool.query('insert into courier_communes (courier_id, commune_code) values ($1, $2)', [id, c]);
    if (relation) await h.pool.query("insert into courier_shop_partnerships (id, courier_id, shop_id, relation, status, accepted_at) values ($1, $2, $3, $4, 'active', now())", [uuidv7(), id, relation.shopId, relation.kind]);
    const sw = await h.http().post('/v1/auth/switch-space').set(u.auth).send({ type: 'courier', id }).expect(200);
    return { ...u, courierId: id, space: bearer(sw.body.accessToken) as Auth };
  }

  /** Commande livrée à domicile, confirmée, préparée, prête. */
  async function readyOrder(s: Awaited<ReturnType<typeof shop>>, client: { auth: Auth }, mode: 'express' | 'economy' = 'express') {
    const o = (
      await h
        .http()
        .post('/v1/orders')
        .set(client.auth)
        .send({ shopId: s.shopId, items: [{ productId: s.product.id, variantId: s.product.variant, quantity: 1 }], deliveryMode: mode, communeCode: home, address: 'Rue des jardins, près de la pharmacie', paymentMethod: 'mobile_money', expectedTotalFcfa: 21700, idempotencyKey: uuidv7().replace(/-/g, '') })
        .expect(201)
    ).body;
    for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
    return o.id as string;
  }

  it('priorité côté serveur : employés, puis partenaires, puis indépendants ; rapide : prioritaire obligatoire ; économique : motif', async () => {
    const s = await shop();
    const client = await person();
    const employee = await courier([home], { shopId: s.shopId, kind: 'employee' });
    const partner = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const independent = await courier([home]);
    const farAway = await courier([elsewhere]);
    const id = await readyOrder(s, client, 'express');
    // Recherche à lancer d'abord ; une commande au retrait n'a pas de livraison.
    expect((await h.http().get(`/v1/shop/orders/${id}/delivery/candidates`).set(s.auth).expect(409)).body.error.code).toBe('DELIVERY_NOT_STARTED');
    let so = (await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200)).body;
    expect(so).toMatchObject({ tracking: { status: 'searching' }, actions: expect.arrayContaining(['select_courier']) });
    await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200); // répété : sans effet
    const list = (await h.http().get(`/v1/shop/orders/${id}/delivery/candidates`).set(s.auth).expect(200)).body.items;
    const mine = list.filter((c: { courierId: string }) => [employee.courierId, partner.courierId, independent.courierId, farAway.courierId].includes(c.courierId));
    expect(mine.map((c: { courierId: string; category: string; selectable: boolean }) => [c.courierId, c.category, c.selectable])).toEqual([
      [employee.courierId, 'employee', true],
      [partner.courierId, 'partner', false],
      [independent.courierId, 'independent', false],
    ]);
    // Rapide : un partenaire ne peut pas être sollicité tant qu'un employé est disponible ; hors commune : non éligible.
    expect((await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: partner.courierId }).expect(409)).body.error.code).toBe('COURIER_NOT_PRIORITY');
    expect((await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: farAway.courierId }).expect(409)).body.error.code).toBe('COURIER_NOT_ELIGIBLE');

    // Économique : partenaire ou indépendant possibles, avec un motif puisqu'un employé est disponible.
    const eco = await readyOrder(s, client, 'economy');
    await h.http().post(`/v1/shop/orders/${eco}/delivery/start`).set(s.auth).expect(200);
    const ecoList = (await h.http().get(`/v1/shop/orders/${eco}/delivery/candidates`).set(s.auth).expect(200)).body.items.filter((c: { courierId: string }) => c.courierId === partner.courierId);
    expect(ecoList[0]).toMatchObject({ selectable: true, reasonRequired: true });
    await h.http().post(`/v1/shop/orders/${eco}/delivery/offer`).set(s.auth).send({ courierId: partner.courierId }).expect(400);
    so = (await h.http().post(`/v1/shop/orders/${eco}/delivery/offer`).set(s.auth).send({ courierId: partner.courierId, reason: 'Employé déjà sur une autre course longue' }).expect(200)).body;
    expect(so.tracking).toMatchObject({ status: 'offered', requestExpiresAt: expect.any(String) });
    expect((await h.pool.query('select skip_reason, category from delivery_offers where courier_id = $1', [partner.courierId])).rows[0]).toEqual({ skip_reason: 'Employé déjà sur une autre course longue', category: 'partner' });
    // Une seule sollicitation à la fois.
    await h.http().post(`/v1/shop/orders/${eco}/delivery/offer`).set(s.auth).send({ courierId: independent.courierId, reason: 'test' }).expect(409);
  });

  it('L7-07 espèces à la livraison : seulement si la boutique a un livreur employé ; course réservée aux employés ; espèces reçues par l’employé', async () => {
    const client = await person();
    const body = (shopId: string, productId: string, variantId: string) => ({
      shopId,
      items: [{ productId, variantId, quantity: 1 }],
      deliveryMode: 'express',
      communeCode: home,
      address: 'Rue des jardins, près de la pharmacie',
      paymentMethod: 'cash',
      expectedTotalFcfa: 21700,
      idempotencyKey: uuidv7().replace(/-/g, ''),
    });
    // Sans employé : espèces refusées en livraison ; le devis l'indique.
    const plain = await shop();
    await courier([home], { shopId: plain.shopId, kind: 'partner' });
    expect((await h.http().get(`/v1/shops/${plain.shopId}/delivery-quote?commune=${home}`).set(client.auth).expect(200)).body.cashOnDelivery).toBe(false);
    const refused = (await h.http().post('/v1/orders').set(client.auth).send(body(plain.shopId, plain.product.id, plain.product.variant)).expect(400)).body;
    expect(Object.keys(refused.error.details.fields)).toEqual(['paymentMethod']);

    // Avec un employé actif : possible ; seuls les employés sont proposés pour la course.
    const s = await shop();
    const employee = await courier([home], { shopId: s.shopId, kind: 'employee' });
    const partner = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const independent = await courier([home]);
    const quote = (await h.http().get(`/v1/shops/${s.shopId}/delivery-quote?commune=${home}`).set(client.auth).expect(200)).body;
    expect(quote.cashOnDelivery).toBe(true);
    const o = (await h.http().post('/v1/orders').set(client.auth).send(body(s.shopId, s.product.id, s.product.variant)).expect(201)).body;
    expect(o).toMatchObject({ paymentMethod: 'cash', deliveryMode: 'express' });
    for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
    await h.http().post(`/v1/shop/orders/${o.id}/delivery/start`).set(s.auth).expect(200);
    const ids = (await h.http().get(`/v1/shop/orders/${o.id}/delivery/candidates`).set(s.auth).expect(200)).body.items.map((c: { courierId: string }) => c.courierId);
    expect(ids).toContain(employee.courierId);
    expect(ids).not.toContain(partner.courierId);
    expect(ids).not.toContain(independent.courierId);
    await h.http().post(`/v1/shop/orders/${o.id}/delivery/offer`).set(s.auth).send({ courierId: partner.courierId, reason: 'test' }).expect(409);
    await h.http().post(`/v1/shop/orders/${o.id}/delivery/offer`).set(s.auth).send({ courierId: employee.courierId }).expect(200);
    const offerId = (await h.http().get('/v1/courier/missions').set(employee.space).expect(200)).body.items[0].offerId;
    const dId = (await h.http().post(`/v1/courier/missions/${offerId}/accept`).set(employee.space).expect(200)).body.items[0].deliveryId;
    let course = (await h.http().get(`/v1/courier/courses/${dId}`).set(employee.space).expect(200)).body;
    expect(course.payment).toMatchObject({ method: 'cash', amountToCollectFcfa: 20000 });
    const code = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.handoverCode as string;
    await h.http().post(`/v1/courier/courses/${dId}/picked-up`).set(employee.space).expect(200);
    await h.http().post(`/v1/courier/courses/${dId}/arrived`).set(employee.space).expect(200);
    course = (await h.http().post(`/v1/courier/courses/${dId}/code`).set(employee.space).send({ code }).expect(200)).body;
    expect(course.actions).toEqual(['cash_received', 'close', 'report_incident']);
    // Pas de clôture avant les espèces ; montant exact exigé.
    expect((await h.http().post(`/v1/courier/courses/${dId}/close`).set(employee.space).expect(409)).body.error.code).toBe('PAYMENT_CONDITION_MISSING');
    expect((await h.http().post(`/v1/courier/courses/${dId}/cash`).set(employee.space).send({ amountFcfa: 19000 }).expect(400)).body.error.code).toBe('CASH_AMOUNT_MISMATCH');
    await h.http().post(`/v1/courier/courses/${dId}/cash`).set(employee.space).send({ amountFcfa: 20000 }).expect(200);
    await h.http().post(`/v1/courier/courses/${dId}/close`).set(employee.space).expect(200);
    const so = (await h.http().get(`/v1/shop/orders/${o.id}`).set(s.auth).expect(200)).body;
    expect(so.status).toBe('delivered');
    expect(so.actions).toContain('confirm_payment');
    expect((await h.http().post(`/v1/shop/orders/${o.id}/payment/confirm`).set(s.auth).expect(200)).body.status).toBe('completed');
    // L'emploi prend fin avant une nouvelle commande en espèces : refusée de nouveau.
    await h.pool.query("update courier_shop_partnerships set status = 'ended', ended_at = now() where courier_id = $1", [employee.courierId]);
    await h.http().post('/v1/orders').set(client.auth).send(body(s.shopId, s.product.id, s.product.variant)).expect(400);
  });

  it('L7-07 délais confirmés : réglages de livraison « décidés »', async () => {
    const r = (await h.pool.query("select key, value, decision_status from app_settings where key in ('deliveries.mission_accept_minutes', 'deliveries.client_absent_after_minutes') order by key")).rows;
    expect(r).toEqual([
      { key: 'deliveries.client_absent_after_minutes', value: 15, decision_status: 'decided' },
      { key: 'deliveries.mission_accept_minutes', value: 5, decision_status: 'decided' },
    ]);
  });

  it('désistement avant la prise en charge : nouvelle recherche, même mode et même prix ; le livreur n’est plus proposé ; après la prise en charge : impossible', async () => {
    const s = await shop();
    const client = await person();
    const first = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const second = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const id = await readyOrder(s, client);
    const fee = (await h.http().get(`/v1/orders/${id}`).set(client.auth)).body.deliveryFeeFcfa;
    await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200);
    await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: first.courierId }).expect(200);
    const offer1 = (await h.http().get('/v1/courier/missions').set(first.space)).body.items[0].offerId;
    const dId = (await h.http().post(`/v1/courier/missions/${offer1}/accept`).set(first.space).expect(200)).body.items[0].deliveryId;
    expect((await h.http().get(`/v1/courier/courses/${dId}`).set(first.space)).body.actions).toEqual(['picked_up', 'release']);
    // Motif obligatoire ; un autre livreur ne peut pas se désister à sa place.
    await h.http().post(`/v1/courier/courses/${dId}/release`).set(first.space).send({}).expect(400);
    await h.http().post(`/v1/courier/courses/${dId}/release`).set(second.space).send({ reason: 'Pas moi' }).expect(404);
    await h.http().post(`/v1/courier/courses/${dId}/release`).set(first.space).send({ reason: 'Moto en panne' }).expect(200);
    // La course n'est plus à lui ; la boutique relance la sélection ; frais inchangés.
    await h.http().get(`/v1/courier/courses/${dId}`).set(first.space).expect(404);
    const so = (await h.http().get(`/v1/shop/orders/${id}`).set(s.auth)).body;
    expect(so).toMatchObject({ status: 'ready', tracking: { status: 'searching', courier: null }, deliveryFeeFcfa: fee });
    expect(so.actions).toContain('select_courier');
    const ids = (await h.http().get(`/v1/shop/orders/${id}/delivery/candidates`).set(s.auth)).body.items.map((c: { courierId: string }) => c.courierId);
    expect(ids).toContain(second.courierId);
    expect(ids).not.toContain(first.courierId);
    await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: second.courierId }).expect(200);
    const offer2 = (await h.http().get('/v1/courier/missions').set(second.space)).body.items[0].offerId;
    await h.http().post(`/v1/courier/missions/${offer2}/accept`).set(second.space).expect(200);
    await h.http().post(`/v1/courier/courses/${dId}/picked-up`).set(second.space).expect(200);
    // Après la prise en charge : plus de désistement (signaler un incident).
    expect((await h.http().post(`/v1/courier/courses/${dId}/release`).set(second.space).send({ reason: 'Trop loin' }).expect(409)).body.error.code).toBe('DELIVERY_STATE_CHANGED');
    expect((await h.http().get(`/v1/orders/${id}`).set(client.auth)).body.deliveryFeeFcfa).toBe(fee);
  });

  it('parcours complet : sollicitation, acceptation, prise en charge, arrivée, code, « J’ai payé », clôture, terminée, évaluation', async () => {
    const s = await shop();
    const client = await person();
    const c = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const other = await courier([home]);
    const id = await readyOrder(s, client);
    await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200);
    await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: c.courierId }).expect(200);

    // Le livreur sollicité voit la mission, sans adresse ni client ni prix des articles ; un autre ne la voit pas.
    const missions = (await h.http().get('/v1/courier/missions').set(c.space).expect(200)).body.items;
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({ mode: 'express', to: { commune: 'Yopougon' }, feeFcfa: 1700, itemsCount: 1, category: 'partner' });
    expect(JSON.stringify(missions[0])).not.toMatch(/jardins|Awa|\\+225|20000/);
    expect((await h.http().get('/v1/courier/missions').set(other.space).expect(200)).body.items).toEqual([]);
    await h.http().post(`/v1/courier/missions/${missions[0].offerId}/accept`).set(other.space).expect(404);
    // Ni les commandes de la boutique.
    await h.http().get('/v1/shop/orders').set(c.space).expect(403);
    await h.http().get(`/v1/orders/${id}`).set(c.space).expect(403);

    const courses = (await h.http().post(`/v1/courier/missions/${missions[0].offerId}/accept`).set(c.space).expect(200)).body.items;
    const dId = courses[0].deliveryId;
    await h.http().post(`/v1/courier/missions/${missions[0].offerId}/accept`).set(c.space).expect(409);
    let course = (await h.http().get(`/v1/courier/courses/${dId}`).set(c.space).expect(200)).body;
    expect(course).toMatchObject({ status: 'accepted', client: { firstName: 'Awa', address: 'Rue des jardins, près de la pharmacie', phone: client.destination }, actions: ['picked_up', 'release'], payment: { method: 'mobile_money', amountToCollectFcfa: null } });
    expect(JSON.stringify(course)).not.toMatch(/handoverCode|"code"/);
    await h.http().get(`/v1/courier/courses/${dId}`).set(other.space).expect(404);
    // Côté client : livreur (prénom), notification.
    let mine = (await h.http().get(`/v1/orders/${id}`).set(client.auth).expect(200)).body;
    expect(mine.tracking).toMatchObject({ status: 'accepted', courier: { firstName: 'Awa', vehicle: 'moto', category: null } });
    const code = mine.handoverCode as string;

    await h.http().post(`/v1/courier/courses/${dId}/arrived`).set(c.space).expect(409); // pas encore pris en charge
    await h.http().post(`/v1/courier/courses/${dId}/picked-up`).set(c.space).expect(200);
    expect((await h.http().get(`/v1/orders/${id}`).set(client.auth)).body.status).toBe('in_delivery');
    // La boutique ne peut plus annuler une commande en route.
    await h.http().post(`/v1/shop/orders/${id}/cancel`).set(s.auth).send({ reason: 'Erreur de stock' }).expect(409);
    course = (await h.http().post(`/v1/courier/courses/${dId}/arrived`).set(c.space).expect(200)).body;
    expect(course.actions).toEqual(['validate_code', 'client_absent', 'report_incident']);
    mine = (await h.http().get(`/v1/orders/${id}`).set(client.auth)).body;
    expect(mine.actions).toEqual(expect.arrayContaining(['refuse_delivery', 'report_incident']));
    // Code faux : compté ; partenaire : jamais d'espèces.
    const wrong = code === '0000' ? '1111' : '0000';
    expect((await h.http().post(`/v1/courier/courses/${dId}/code`).set(c.space).send({ code: wrong }).expect(400)).body.error).toMatchObject({ code: 'HANDOVER_CODE_INVALID', details: { remaining: 4 } });
    course = (await h.http().post(`/v1/courier/courses/${dId}/code`).set(c.space).send({ code }).expect(200)).body;
    expect(course).toMatchObject({ status: 'code_validated', actions: ['close', 'report_incident'] });
    expect((await h.http().post(`/v1/courier/courses/${dId}/cash`).set(c.space).send({ amountFcfa: 20000 }).expect(403)).body.error.code).toBe('CASH_NOT_ALLOWED');
    // Clôture impossible tant que le client n'a pas déclaré son paiement.
    expect((await h.http().post(`/v1/courier/courses/${dId}/close`).set(c.space).expect(409)).body.error.code).toBe('PAYMENT_CONDITION_MISSING');
    mine = (await h.http().get(`/v1/orders/${id}`).set(client.auth)).body;
    expect(mine.actions).toContain('declare_payment');
    expect(mine.payment.shopPayout).toBeNull(); // boutique sans numéro confirmé dans ce test
    await h.http().post(`/v1/orders/${id}/payment/declare`).set(client.auth).send({ reference: 'WV-9' }).expect(200);
    expect((await h.http().get(`/v1/courier/courses/${dId}`).set(c.space)).body.payment.declaredByCustomer).toBe(true);
    course = (await h.http().post(`/v1/courier/courses/${dId}/close`).set(c.space).expect(200)).body;
    expect(course).toMatchObject({ status: 'closed', client: null, actions: [] });
    await h.http().post(`/v1/courier/courses/${dId}/close`).set(c.space).expect(409);
    expect((await h.http().get(`/v1/orders/${id}`).set(client.auth)).body.status).toBe('delivered');
    // La boutique confirme le paiement : terminée.
    expect((await h.http().post(`/v1/shop/orders/${id}/payment/confirm`).set(s.auth).expect(200)).body.status).toBe('completed');

    // Historique personnel : seulement ses courses.
    expect((await h.http().get('/v1/courier/courses?box=history').set(c.space).expect(200)).body.items.map((x: { deliveryId: string }) => x.deliveryId)).toEqual([dId]);
    expect((await h.http().get('/v1/courier/courses?box=history').set(other.space).expect(200)).body.items).toEqual([]);
    // Notifications du client.
    const notes = (await h.http().get('/v1/me/notifications').set(client.auth).expect(200)).body.items.filter((n: { type: string }) => n.type === 'order_update').map((n: { text: string }) => n.text);
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('Un livreur a accepté'), expect.stringContaining('est en route'), expect.stringContaining('Le livreur est arrivé'), expect.stringContaining('est livrée')]));

    // Évaluation de la livraison : une fois, distincte, non publique ; le livreur peut la signaler.
    expect((await h.http().get(`/v1/orders/${id}`).set(client.auth)).body.actions).toContain('review_delivery');
    await h.http().post(`/v1/orders/${id}/delivery/review`).set(client.auth).send({ rating: 5, comment: 'Rapide et aimable' }).expect(201);
    await h.http().post(`/v1/orders/${id}/delivery/review`).set(client.auth).send({ rating: 1 }).expect(409);
    mine = (await h.http().get(`/v1/orders/${id}`).set(client.auth)).body;
    expect(mine.tracking.review).toMatchObject({ rating: 5 });
    expect(mine.actions).not.toContain('review_delivery');
    expect((await h.http().get(`/v1/bimshop/products/${s.product.id}/reviews`).expect(200)).body.items).toEqual([]);
    const review = (await h.http().get(`/v1/courier/courses/${dId}`).set(c.space)).body.review;
    expect(review).toMatchObject({ rating: 5, comment: 'Rapide et aimable' });
    await h.http().post(`/v1/courier/reviews/${review.id}/report`).set(c.space).send({ reason: 'other' }).expect(200);
    await h.http().post(`/v1/courier/reviews/${review.id}/report`).set(other.space).send({ reason: 'other' }).expect(404);
    // Aucune note de livreur calculée ni exposée.
    expect(JSON.stringify((await h.http().get('/v1/courier/me').set(c.space)).body)).not.toMatch(/rating|average|moyenne/);
  });

  it('refus, expiration, éligibilité revérifiée, sollicitations simultanées, permissions', async () => {
    const s = await shop();
    const client = await person();
    const a = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const b = await courier([home], { shopId: s.shopId, kind: 'partner' });
    const id = await readyOrder(s, client);
    await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200);
    // Deux sollicitations simultanées : une seule passe.
    const [r1, r2] = await Promise.all([
      h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: a.courierId }),
      h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: b.courierId }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const asked = r1.status === 200 ? a : b;
    const second = asked === a ? b : a;
    // Refus : la recherche reprend, le livreur qui a refusé n'est plus proposé.
    const m = (await h.http().get('/v1/courier/missions').set(asked.space)).body.items[0];
    await h.http().post(`/v1/courier/missions/${m.offerId}/decline`).set(asked.space).expect(200);
    let cands = (await h.http().get(`/v1/shop/orders/${id}/delivery/candidates`).set(s.auth).expect(200)).body.items.map((x: { courierId: string }) => x.courierId);
    expect(cands).toContain(second.courierId);
    expect(cands).not.toContain(asked.courierId);
    // Sans réponse dans le délai : expirée (worker), la recherche reprend.
    await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: second.courierId }).expect(200);
    const late = (await h.http().get('/v1/courier/missions').set(second.space)).body.items[0];
    await h.pool.query("update delivery_offers set expires_at = now() - interval '1 minute' where id = $1", [late.offerId]);
    await h.app.get(OrdersRunner).tick();
    expect((await h.http().get(`/v1/shop/orders/${id}`).set(s.auth)).body.tracking.status).toBe('searching');
    expect((await h.http().post(`/v1/courier/missions/${late.offerId}/accept`).set(second.space).expect(409)).body.error.code).toBe('MISSION_UNAVAILABLE');

    // Éligibilité revérifiée à l'acceptation : devenu indisponible, il ne peut pas accepter.
    const c = await courier([home]);
    await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: c.courierId }).expect(200);
    const mc = (await h.http().get('/v1/courier/missions').set(c.space)).body.items[0];
    await h.http().patch('/v1/courier/me').set(c.space).send({ available: false }).expect(200);
    expect((await h.http().post(`/v1/courier/missions/${mc.offerId}/accept`).set(c.space).expect(409)).body.error.code).toBe('COURIER_NOT_ELIGIBLE');
    expect((await h.http().get(`/v1/shop/orders/${id}`).set(s.auth)).body.tracking.status).toBe('searching');

    // Employé sans la permission « sélectionner un livreur » : refusé.
    const staff = await person();
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s.shopId, staff.userId]);
    await h.pool.query("insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, 'orders.read')", [s.shopId, staff.userId]);
    const st = bearer((await h.http().post('/v1/auth/switch-space').set(staff.auth).send({ type: 'merchant', id: s.shopId }).expect(200)).body.accessToken);
    await h.http().get(`/v1/shop/orders/${id}/delivery/candidates`).set(st).expect(403);
    // Annulation par la boutique avant la prise en charge : livraison annulée, état figé.
    await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: second.courierId === a.courierId ? b.courierId : a.courierId }).expect((r) => expect([200, 409]).toContain(r.status));
    const so = (await h.http().post(`/v1/shop/orders/${id}/cancel`).set(s.auth).send({ reason: 'Client injoignable' }).expect(200)).body;
    expect(so).toMatchObject({ status: 'cancelled', tracking: { status: 'cancelled' } });
    expect((await h.pool.query("select count(*)::int n from delivery_offers o join deliveries d on d.id = o.delivery_id where d.order_id = $1 and o.status = 'offered'", [id])).rows[0].n).toBe(0);
  });

  it('retour en boutique après refus ou absence : la boutique confirme, la commande est annulée, le stock remis ; une seule fois', async () => {
    const s = await shop();
    const client = await person();
    const c = await courier([home], { shopId: s.shopId, kind: 'employee' });
    const stock = async () => (await h.pool.query('select coalesce(sum(delta), 0)::int n from inventory_movements where variant_id = $1', [s.product.variant])).rows[0].n as number;
    const arrived = async () => {
      const id = await readyOrder(s, client);
      await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200);
      await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: c.courierId }).expect(200);
      const m = (await h.http().get('/v1/courier/missions').set(c.space)).body.items[0];
      const dId = (await h.http().post(`/v1/courier/missions/${m.offerId}/accept`).set(c.space).expect(200)).body.items.find((x: { number: string }) => x).deliveryId;
      await h.http().post(`/v1/courier/courses/${dId}/picked-up`).set(c.space).expect(200);
      await h.http().post(`/v1/courier/courses/${dId}/arrived`).set(c.space).expect(200);
      return { id, dId };
    };
    const before = await stock();
    const a = await arrived();
    const reserved = await stock();
    expect(reserved).toBeLessThan(before);
    // Pas de retour tant que la livraison est en cours.
    expect((await h.http().get(`/v1/shop/orders/${a.id}`).set(s.auth)).body.actions).not.toContain('confirm_return');
    await h.http().post(`/v1/shop/orders/${a.id}/delivery/returned`).set(s.auth).expect(409);
    await h.http().post(`/v1/orders/${a.id}/delivery/refuse`).set(client.auth).send({ reason: 'incorrect' }).expect(200);
    expect((await h.http().get(`/v1/shop/orders/${a.id}`).set(s.auth)).body.actions).toContain('confirm_return');
    // Autre boutique : introuvable ; client : pas de route boutique.
    const other = await shop();
    await h.http().post(`/v1/shop/orders/${a.id}/delivery/returned`).set(other.auth).expect(404);
    const done = (await h.http().post(`/v1/shop/orders/${a.id}/delivery/returned`).set(s.auth).expect(200)).body;
    expect(done).toMatchObject({ status: 'cancelled', tracking: { status: 'refused_by_client', returnedAt: expect.any(String) } });
    expect(done.actions).not.toContain('confirm_return');
    expect(await stock()).toBe(before);
    await h.http().post(`/v1/shop/orders/${a.id}/delivery/returned`).set(s.auth).expect(409);
    const mine = (await h.http().get(`/v1/orders/${a.id}`).set(client.auth)).body;
    expect(mine).toMatchObject({ status: 'cancelled', payment: { failure: 'cancelled' } });
    // L'incident reste ouvert pour le support ; historique et audit.
    expect((await h.http().get(`/v1/orders/${a.id}/incidents`).set(client.auth)).body.items[0]).toMatchObject({ status: 'open' });
    expect((await h.pool.query("select count(*)::int n from delivery_events where delivery_id = $1 and type = 'returned_to_shop'", [a.dId])).rows[0].n).toBe(1);
    expect((await h.pool.query("select count(*)::int n from audit_logs where action = 'deliveries.returned_to_shop' and target_id = $1", [a.id])).rows[0].n).toBe(1);

    // Client absent : même retour.
    const b = await arrived();
    await h.pool.query("update deliveries set arrived_at = now() - interval '20 minutes' where id = $1", [b.dId]);
    await h.http().post(`/v1/courier/courses/${b.dId}/client-absent`).set(c.space).send({}).expect(200);
    expect((await h.http().post(`/v1/shop/orders/${b.id}/delivery/returned`).set(s.auth).expect(200)).body).toMatchObject({ status: 'cancelled', ended: { reason: 'Client absent : colis revenu en boutique' } });
    expect(await stock()).toBe(before);
  });

  it('refus du client après examen : motif, incident, jamais « livrée » ; support ; client absent après le délai', async () => {
    const s = await shop();
    const client = await person();
    const c = await courier([home], { shopId: s.shopId, kind: 'employee' });
    const start = async () => {
      const id = await readyOrder(s, client);
      await h.http().post(`/v1/shop/orders/${id}/delivery/start`).set(s.auth).expect(200);
      await h.http().post(`/v1/shop/orders/${id}/delivery/offer`).set(s.auth).send({ courierId: c.courierId }).expect(200);
      const m = (await h.http().get('/v1/courier/missions').set(c.space)).body.items[0];
      const dId = (await h.http().post(`/v1/courier/missions/${m.offerId}/accept`).set(c.space).expect(200)).body.items.find((x: { number: string }) => x).deliveryId;
      await h.http().post(`/v1/courier/courses/${dId}/picked-up`).set(c.space).expect(200);
      await h.http().post(`/v1/courier/courses/${dId}/arrived`).set(c.space).expect(200);
      return { id, dId };
    };
    const { id, dId } = await start();
    // Espèces : employé, mais commande en Mobile Money : rien à encaisser.
    await h.http().post(`/v1/orders/${id}/delivery/refuse`).set(client.auth).send({ reason: 'other' }).expect(400);
    let mine = (await h.http().post(`/v1/orders/${id}/delivery/refuse`).set(client.auth).send({ reason: 'damaged', details: 'Plumes arrachées' }).expect(200)).body;
    expect(mine).toMatchObject({ status: 'in_delivery', tracking: { status: 'refused_by_client', refusalReason: 'damaged' }, incidents: [{ status: 'open', reason: 'item_damaged' }] });
    // Le livreur ne peut plus saisir le code ni clôturer.
    await h.http().post(`/v1/courier/courses/${dId}/code`).set(c.space).send({ code: mine.handoverCode ?? '1234' }).expect(409);
    await h.http().post(`/v1/courier/courses/${dId}/close`).set(c.space).expect(409);
    // Incident : vu par les parties seulement ; précisions ; transmission au support ; décision sans effet financier.
    const inc = (await h.http().get(`/v1/orders/${id}/incidents`).set(client.auth).expect(200)).body.items[0];
    expect(inc).toMatchObject({ reason: 'item_damaged', description: 'Plumes arrachées', openedBy: 'customer', actions: ['add_note', 'send_to_support'] });
    const stranger = await person();
    await h.http().get(`/v1/orders/${id}/incidents`).set(stranger.auth).expect(404);
    await h.http().post(`/v1/incidents/${inc.id}/notes`).set(stranger.auth).send({ note: 'Intrus' }).expect(404);
    expect((await h.http().get(`/v1/shop/orders/${id}/incidents`).set(s.auth).expect(200)).body.items).toHaveLength(1);
    await h.http().post(`/v1/shop/incidents/${inc.id}/notes`).set(s.auth).send({ note: 'Nous reprenons l’article' }).expect(200);
    await h.http().post(`/v1/courier/incidents/${inc.id}/notes`).set(c.space).send({ note: 'Colis intact au départ' }).expect(200);
    const sent = (await h.http().post(`/v1/incidents/${inc.id}/support`).set(client.auth).expect(200)).body;
    expect(sent).toMatchObject({ status: 'with_support', actions: ['add_note'] });
    await h.http().post(`/v1/incidents/${inc.id}/support`).set(client.auth).expect(409);
    const moderator = await adminSession(h, ['moderator']);
    await h.http().get('/admin/v1/incidents').set(moderator).expect(403);
    const support = await adminSession(h, ['support']);
    const queue = (await h.http().get('/admin/v1/incidents').set(support).expect(200)).body.items.find((x: { id: string }) => x.id === inc.id);
    expect(queue.events.map((e: { type: string }) => e.type)).toEqual(['opened', 'note', 'note', 'sent_to_support']);
    expect((await h.pool.query("select count(*)::int n from audit_logs where action = 'admin.incidents_viewed'")).rows[0].n).toBeGreaterThanOrEqual(1);
    const resolved = (await h.http().post(`/admin/v1/incidents/${inc.id}/resolve`).set(support).send({ note: 'Article repris par la boutique, à son initiative' }).expect(200)).body;
    expect(resolved).toMatchObject({ status: 'resolved', resolution: 'Article repris par la boutique, à son initiative' });
    // Aucune conséquence automatique : la commande reste telle quelle, aucun mouvement de paiement.
    mine = (await h.http().get(`/v1/orders/${id}`).set(client.auth)).body;
    expect(mine).toMatchObject({ status: 'in_delivery', payment: { decision: 'pending', failure: 'none' } });
    await expect(h.pool.query('update incident_events set note = $1 where incident_id = $2', ['x', inc.id])).rejects.toThrow(/historique/);

    // Client absent : pas avant le délai ; ensuite incident ouvert par le livreur.
    const second = await start();
    expect((await h.http().post(`/v1/courier/courses/${second.dId}/client-absent`).set(c.space).send({}).expect(409)).body.error.code).toBe('TOO_EARLY');
    await h.pool.query("update deliveries set arrived_at = now() - interval '20 minutes' where id = $1", [second.dId]);
    const course = (await h.http().post(`/v1/courier/courses/${second.dId}/client-absent`).set(c.space).send({ note: 'Appelé trois fois' }).expect(200)).body;
    expect(course).toMatchObject({ status: 'client_absent', waitedSeconds: expect.any(Number) });
    expect(course.waitedSeconds).toBeGreaterThanOrEqual(20 * 60);
    expect((await h.http().get(`/v1/orders/${second.id}/incidents`).set(client.auth)).body.items[0]).toMatchObject({ reason: 'client_absent', openedBy: 'courier' });
  });
});
