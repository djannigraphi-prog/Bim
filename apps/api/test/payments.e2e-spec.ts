import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { OrdersRunner } from '../src/modules/orders/orders-runner';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;

/**
 * Lot 7-C — Registre des paiements : cinq informations distinctes, déclaration du client, espèces constatées au
 * comptoir, décision de la boutique, file « à vérifier » ; aucun prestataire, jamais de confirmation implicite.
 */
describe('Paiements (e2e)', () => {
  let h: Harness;
  const city = `Pay${Date.now()}`;

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

  /** Boutique ouverte, avec un numéro Mobile Money confirmé (demande validée, lot 5). */
  async function shop() {
    const owner = await person();
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Boutique Élégance', $3, 'active', $4, 'Cocody')", [shopId, owner.userId, `pay-${shopId}`, city]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    await h.pool.query(
      "insert into merchant_applications (id, user_id, shop_id, status, id_doc_type, payout_phone, payout_operator, payout_verified_at, submitted_at) values ($1, $2, $3, 'approved', 'cni', '+2250102030405', 'wave', now(), now())",
      [uuidv7(), owner.userId, shopId],
    );
    const sw = await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200);
    return { shopId, owner, auth: bearer(sw.body.accessToken) as Auth };
  }

  async function product(s: { auth: Auth }) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Robe soirée à plumes', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: 'teal' } }).jpeg().toBuffer();
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', img, 'a.jpg').expect(201);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s.auth).send({ quantity: 10 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    return { id: p.id as string, variant: p.variants[0].id as string };
  }

  /** Commande au retrait, confirmée, préparée, prête puis remise avec le code du client. */
  async function delivered(s: { shopId: string; auth: Auth }, client: { auth: Auth }, paymentMethod: 'cash' | 'mobile_money') {
    const p = await product(s);
    const o = (
      await h
        .http()
        .post('/v1/orders')
        .set(client.auth)
        .send({ shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', paymentMethod, expectedTotalFcfa: 20000, idempotencyKey: uuidv7().replace(/-/g, '') })
        .expect(201)
    ).body;
    for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
    const code = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.handoverCode;
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code }).expect(200);
    return o.id as string;
  }

  it('Mobile Money : déclaration du client (jamais une confirmation), puis décision de la boutique : commande terminée', async () => {
    const s = await shop();
    const client = await person();
    const p = await product(s);
    // Avant la remise : rien à déclarer, numéro de la boutique non montré.
    const o = (
      await h
        .http()
        .post('/v1/orders')
        .set(client.auth)
        .send({ shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', paymentMethod: 'mobile_money', expectedTotalFcfa: 20000, idempotencyKey: uuidv7().replace(/-/g, '') })
        .expect(201)
    ).body;
    expect(o.payment).toBeNull(); // ouvert à la confirmation
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(s.auth).expect(200);
    let mine = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body;
    expect(mine.payment).toMatchObject({ kind: 'article', method: 'mobile_money', amountFcfa: 20000, status: 'not_paid', provider: 'unavailable', decision: 'pending', shopPayout: null });
    expect((await h.http().post(`/v1/orders/${o.id}/payment/declare`).set(client.auth).send({}).expect(409)).body.error.code).toBe('PAYMENT_ACTION_NOT_ALLOWED');

    for (const step of ['prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s.auth).expect(200);
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s.auth).send({ code: mine.handoverCode }).expect(200);
    mine = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body;
    // Après la remise : numéro Mobile Money confirmé de la boutique, et « J'ai payé ».
    expect(mine).toMatchObject({ status: 'delivered', actions: ['declare_payment'], payment: { shopPayout: { phone: '+2250102030405', operator: 'wave' } } });
    // Côté boutique : pas de « J'ai payé », pas de numéro ; elle confirme ce qu'elle a reçu ou conteste.
    let so = (await h.http().get(`/v1/shop/orders/${o.id}`).set(s.auth)).body;
    expect(so.actions).toEqual(['confirm_payment', 'contest_payment']);
    expect(so.payment.shopPayout).toBeNull();

    // Déclaration répétée : une seule opération.
    mine = (await h.http().post(`/v1/orders/${o.id}/payment/declare`).set(client.auth).send({ reference: 'WV-123456' }).expect(200)).body;
    await h.http().post(`/v1/orders/${o.id}/payment/declare`).set(client.auth).send({ reference: 'AUTRE' }).expect(200);
    mine = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body;
    expect(mine.payment).toMatchObject({ status: 'declared_by_customer', declaredReference: 'WV-123456', decision: 'pending', provider: 'unavailable' });
    expect(mine.status).toBe('delivered'); // la déclaration ne termine pas la commande
    expect((await h.pool.query("select count(*)::int n from order_events where order_id = $1 and type = 'payment_declared'", [o.id])).rows[0].n).toBe(1);
    // La base refuse « confirmé par le prestataire » (aucun prestataire intégré).
    await expect(h.pool.query("update order_payments set provider_status = 'confirmed' where order_id = $1", [o.id])).rejects.toThrow();

    // Compteur de la boutique, puis confirmation : commande terminée, actions closes, répétition sans effet.
    expect((await h.http().get('/v1/shop/orders/counts').set(s.auth)).body.paymentsToConfirm).toBe(1);
    so = (await h.http().post(`/v1/shop/orders/${o.id}/payment/confirm`).set(s.auth).expect(200)).body;
    expect(so).toMatchObject({ status: 'completed', actions: [], payment: { status: 'confirmed_by_shop', decision: 'confirmed' } });
    expect(so.events.map((e: { type: string }) => e.type).slice(-3)).toEqual(['payment_declared', 'payment_confirmed', 'completed']);
    await h.http().post(`/v1/shop/orders/${o.id}/payment/confirm`).set(s.auth).expect(409);
    await h.http().post(`/v1/shop/orders/${o.id}/payment/contest`).set(s.auth).send({ reason: 'Erreur' }).expect(409);
  });

  it('espèces au retrait : constat du montant attendu avant la confirmation ; écart refusé', async () => {
    const s = await shop();
    const client = await person();
    const id = await delivered(s, client, 'cash');
    let so = (await h.http().get(`/v1/shop/orders/${id}`).set(s.auth)).body;
    expect(so.actions).toEqual(['cash_received']);
    // Le client ne déclare pas de paiement en espèces.
    expect((await h.http().get(`/v1/orders/${id}`).set(client.auth)).body.actions).toEqual([]);
    await h.http().post(`/v1/orders/${id}/payment/declare`).set(client.auth).send({}).expect(409);
    // Confirmer sans constat : refusé ; montant différent : refusé.
    await h.http().post(`/v1/shop/orders/${id}/payment/confirm`).set(s.auth).expect(409);
    expect((await h.http().post(`/v1/shop/orders/${id}/payment/cash`).set(s.auth).send({ amountFcfa: 15000 }).expect(400)).body.error).toMatchObject({ code: 'CASH_AMOUNT_MISMATCH', details: { expectedFcfa: 20000 } });
    so = (await h.http().post(`/v1/shop/orders/${id}/payment/cash`).set(s.auth).send({ amountFcfa: 20000 }).expect(200)).body;
    expect(so.payment).toMatchObject({ status: 'cash_received_to_confirm', cashObserved: { amountFcfa: 20000, byRole: 'shop' }, decision: 'pending' });
    await h.http().post(`/v1/shop/orders/${id}/payment/cash`).set(s.auth).send({ amountFcfa: 20000 }).expect(409);
    so = (await h.http().post(`/v1/shop/orders/${id}/payment/confirm`).set(s.auth).expect(200)).body;
    expect(so).toMatchObject({ status: 'completed', payment: { status: 'confirmed_by_shop' } });
  });

  it('contestation : motif obligatoire, file « à vérifier » ; silence de la boutique : rappel puis file, jamais confirmé', async () => {
    const s = await shop();
    const client = await person();
    const contested = await delivered(s, client, 'mobile_money');
    await h.http().post(`/v1/orders/${contested}/payment/declare`).set(client.auth).send({}).expect(200);
    await h.http().post(`/v1/shop/orders/${contested}/payment/contest`).set(s.auth).send({}).expect(400);
    const so = (await h.http().post(`/v1/shop/orders/${contested}/payment/contest`).set(s.auth).send({ reason: 'Aucun transfert reçu sur le numéro Wave' }).expect(200)).body;
    expect(so).toMatchObject({ status: 'delivered', payment: { status: 'contested_by_shop', contestReason: 'Aucun transfert reçu sur le numéro Wave' } });

    // Silence : paiement sans décision depuis plus de 3 jours après la remise.
    const silent = await delivered(s, client, 'mobile_money');
    await h.pool.query("update orders set delivered_at = now() - interval '4 days' where id = $1", [silent]);
    await h.app.get(OrdersRunner).tick();
    await h.app.get(OrdersRunner).tick(); // une seule mise en file
    const silentView = (await h.http().get(`/v1/shop/orders/${silent}`).set(s.auth)).body;
    expect(silentView).toMatchObject({ status: 'delivered', payment: { decision: 'pending', status: 'not_paid' } });
    expect((await h.pool.query("select count(*)::int n from order_events where order_id = $1 and type = 'payment_review_queued'", [silent])).rows[0].n).toBe(1);

    // Support : file « à vérifier » (consultation journalisée), note de vérification ; droits par rôle.
    const moderator = await adminSession(h, ['moderator']);
    await h.http().get('/admin/v1/payments/review').set(moderator).expect(403);
    const support = await adminSession(h, ['support']);
    const queue = (await h.http().get('/admin/v1/payments/review').set(support).expect(200)).body.items;
    const numbers = (await h.pool.query('select number from orders where id in ($1, $2)', [contested, silent])).rows.map((r: { number: string }) => r.number);
    const mineInQueue = queue.filter((q: { orderNumber: string }) => numbers.includes(q.orderNumber));
    expect(mineInQueue.map((q: { status: string }) => q.status).sort()).toEqual(['contested_by_shop', 'not_paid']);
    expect((await h.pool.query("select count(*)::int n from audit_logs where action = 'admin.payments_review_viewed'")).rows[0].n).toBeGreaterThanOrEqual(1);
    const item = mineInQueue.find((q: { status: string }) => q.status === 'not_paid');
    await h.http().post(`/admin/v1/payments/${item.id}/reviewed`).set(support).send({ note: 'Boutique relancée par téléphone' }).expect(200);
    await h.http().post(`/admin/v1/payments/${item.id}/reviewed`).set(support).send({ note: 'Encore' }).expect(404);
    // La vérification du support ne change ni la décision ni le statut.
    expect((await h.http().get(`/v1/shop/orders/${silent}`).set(s.auth)).body).toMatchObject({ status: 'delivered', payment: { decision: 'pending' } });
  });

  it('permissions : décider d’un paiement exige « payments.decide » ; annulation avant remise : paiement annulé', async () => {
    const s = await shop();
    const client = await person();
    const id = await delivered(s, client, 'mobile_money');
    const staff = await person();
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s.shopId, staff.userId]);
    await h.pool.query("insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, 'orders.read'), ($1, $2, 'orders.prepare')", [s.shopId, staff.userId]);
    const st = bearer((await h.http().post('/v1/auth/switch-space').set(staff.auth).send({ type: 'merchant', id: s.shopId }).expect(200)).body.accessToken);
    await h.http().post(`/v1/shop/orders/${id}/payment/confirm`).set(st).expect(403);
    await h.pool.query("insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, 'payments.decide')", [s.shopId, staff.userId]);
    await h.http().post(`/v1/shop/orders/${id}/payment/confirm`).set(st).expect(200);
    expect((await h.pool.query('select decided_by from order_payments where order_id = $1', [id])).rows[0].decided_by).toBe(staff.userId);
    // Un autre client ne déclare rien sur cette commande.
    const stranger = await person();
    await h.http().post(`/v1/orders/${id}/payment/declare`).set(stranger.auth).send({}).expect(404);

    // Annulation avant la remise : paiement annulé (rien n'était dû), aucune action de paiement.
    const p = await product(s);
    const o = (
      await h
        .http()
        .post('/v1/orders')
        .set(client.auth)
        .send({ shopId: s.shopId, items: [{ productId: p.id, variantId: p.variant, quantity: 1 }], deliveryMode: 'pickup', paymentMethod: 'mobile_money', expectedTotalFcfa: 20000, idempotencyKey: uuidv7().replace(/-/g, '') })
        .expect(201)
    ).body;
    await h.http().post(`/v1/shop/orders/${o.id}/confirm`).set(s.auth).expect(200);
    const c = (await h.http().post(`/v1/orders/${o.id}/cancel`).set(client.auth).send({}).expect(200)).body;
    expect(c).toMatchObject({ status: 'cancelled', actions: [], payment: { status: 'cancelled', failure: 'cancelled' } });
    // Le registre ne se supprime pas.
    await expect(h.pool.query('delete from order_payments where order_id = $1', [o.id])).rejects.toThrow(/historique/);
  });
});
