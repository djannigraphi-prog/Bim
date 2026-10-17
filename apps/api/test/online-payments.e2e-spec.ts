import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { OnlinePaymentsService } from '../src/modules/orders/online/online-payments.service';
import { SIMULATOR_SIGNATURE_HEADER, SimulatorProvider } from '../src/modules/orders/online/simulator.provider';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;
const SECRET = 'test-simulator-secret-0123456789';

/**
 * Lot 8 (socle, désactivé) — paiement en ligne derrière une interface commune, avec le simulateur de test seulement :
 * fermé sans prestataire ni autorisation ; signature vérifiée ; notification jamais crue seule (vérification serveur) ;
 * montant exact ; une notification traitée une fois ; la boutique décide toujours. Aucun prestataire réel.
 */
describe('Paiement en ligne — socle (e2e)', () => {
  let h: Harness;
  let sim: SimulatorProvider;

  async function setting(key: string, value: unknown, status = 'decided') {
    await h.pool.query('update app_settings set value = $1::jsonb, decision_status = $2 where key = $3', [JSON.stringify(value), status, key]);
    h.settings.invalidate();
  }

  beforeAll(async () => {
    h = await startHarness({ PAYMENT_PROVIDER: 'simulator', PAYMENT_SIMULATOR_SECRET: SECRET });
    sim = h.app.get(OnlinePaymentsService).provider as SimulatorProvider;
    await setting('age.min_other_payments', 18);
  });
  afterAll(async () => {
    await setting('age.min_other_payments', null, 'pending');
    await setting('payments.online_enabled', false, 'pending');
    await h.close();
    // L'environnement est partagé entre les suites d'un même processus : le simulateur ne déborde pas sur les autres.
    process.env.PAYMENT_PROVIDER = 'none';
    delete process.env.PAYMENT_SIMULATOR_SECRET;
  });

  async function person() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  /** Commande retirée en boutique, remise par code : le paiement Mobile Money est dû. */
  async function deliveredOrder() {
    const owner = await person();
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Boutique Élégance', $3, 'active', 'Abidjan')", [shopId, owner.userId, `op-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const s = bearer((await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    const p = (await h.http().post('/v1/shop/products').set(s).send({ title: 'Robe', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s).attach('photos', await sharp({ create: { width: 200, height: 200, channels: 3, background: 'red' } }).jpeg().toBuffer(), 'a.jpg').expect(201);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s).send({ quantity: 5 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s).expect(200);
    const client = await person();
    const o = (
      await h
        .http()
        .post('/v1/orders')
        .set(client.auth)
        .send({ shopId, items: [{ productId: p.id, variantId: p.variants[0].id, quantity: 1 }], deliveryMode: 'pickup', paymentMethod: 'mobile_money', expectedTotalFcfa: 20000, idempotencyKey: uuidv7().replace(/-/g, '') })
        .expect(201)
    ).body;
    for (const step of ['confirm', 'prepare', 'ready']) await h.http().post(`/v1/shop/orders/${o.id}/${step}`).set(s).expect(200);
    const code = (await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.handoverCode as string;
    await h.http().post(`/v1/shop/orders/${o.id}/handover`).set(s).send({ code }).expect(200);
    return { id: o.id as string, client, shop: s };
  }

  const notify = (body: Record<string, unknown>, signature?: string) => {
    const raw = JSON.stringify(body);
    return h
      .http()
      .post('/v1/payments/webhooks/simulator')
      .set('content-type', 'application/json')
      .set(SIMULATOR_SIGNATURE_HEADER, signature ?? sim.sign(raw))
      .send(raw);
  };
  const ref = async (intentId: string) => (await h.pool.query('select provider_ref from payment_intents where id = $1', [intentId])).rows[0].provider_ref as string;
  const payment = async (orderId: string) => (await h.pool.query("select provider_status, provider_confirmed_at, decision from order_payments where order_id = $1 and kind = 'article'", [orderId])).rows[0];

  it('fermé tant que le fondateur ne l’a pas autorisé, même avec un prestataire configuré', async () => {
    const o = await deliveredOrder();
    expect((await h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    expect((await h.pool.query('select decision_status, value from app_settings where key = $1', ['payments.online_enabled'])).rows[0]).toEqual({ decision_status: 'pending', value: false });
  });

  it('paiement vérifié : signature, vérification serveur, une seule fois ; la boutique décide toujours', async () => {
    await setting('payments.online_enabled', true);
    const o = await deliveredOrder();
    // Un tiers ne paie pas la commande d'autrui.
    const other = await person();
    await h.http().post(`/v1/orders/${o.id}/payment/online`).set(other.auth).expect(404);
    const started = (await h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(200)).body;
    expect(started).toMatchObject({ status: 'pending', amountFcfa: 20000 });
    const r = await ref(started.intentId);
    expect((await h.pool.query('select payee_shop_id, status, currency from payment_intents where id = $1', [started.intentId])).rows[0]).toMatchObject({ status: 'pending', currency: 'XOF' });

    // Signature fausse : refusée, rien n'est écrit.
    expect((await notify({ id: 'ev-forged', reference: r }, 'a'.repeat(128)).expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await h.pool.query("select count(*)::int n from payment_provider_events where event_key = 'ev-forged'")).rows[0].n).toBe(0);
    // Notification signée mais paiement pas encore validé chez le prestataire : rien ne change.
    await notify({ id: 'ev-early', reference: r }).expect(200);
    expect((await payment(o.id)).provider_status).toBe('unavailable');

    // Validé chez le prestataire, notifié : vérifié par appel serveur, confirmé techniquement.
    sim.settle(r, 'succeeded');
    await notify({ id: 'ev-ok', reference: r }).expect(200);
    const p = await payment(o.id);
    expect(p).toMatchObject({ provider_status: 'confirmed', decision: 'pending' });
    expect(p.provider_confirmed_at).not.toBeNull();
    // Même notification renvoyée : traitée une seule fois.
    await notify({ id: 'ev-ok', reference: r }).expect(200);
    expect((await h.pool.query("select count(*)::int n from payment_provider_events where event_key = 'ev-ok'")).rows[0].n).toBe(1);
    // Le prestataire confirme, la boutique décide : la commande n'est pas « terminée » sans elle.
    const mine = (await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body;
    expect(mine).toMatchObject({ status: 'delivered', payment: { status: 'confirmed_by_provider', provider: 'confirmed' } });
    await h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(409); // déjà confirmé
    expect((await h.http().post(`/v1/shop/orders/${o.id}/payment/confirm`).set(o.shop).expect(200)).body.status).toBe('completed');
    // Historique et journal.
    expect((await h.pool.query("select count(*)::int n from order_events where order_id = $1 and type = 'payment_provider_confirmed'", [o.id])).rows[0].n).toBe(1);
    // Historique des notifications en écriture seule.
    await expect(h.pool.query("delete from payment_provider_events where event_key = 'ev-ok'")).rejects.toThrow();
  });

  it('montant différent ou échec : jamais confirmé ; un nouveau lancement remplace le précédent', async () => {
    await setting('payments.online_enabled', true);
    const o = await deliveredOrder();
    const first = (await h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(200)).body;
    const second = (await h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(200)).body;
    expect((await h.pool.query('select status from payment_intents where id = $1', [first.intentId])).rows[0].status).toBe('expired');
    // Le premier lancement, expiré, ne confirme plus rien même s'il est payé.
    const r1 = await ref(first.intentId);
    sim.settle(r1, 'succeeded');
    await notify({ id: `ev-${uuidv7()}`, reference: r1 }).expect(200);
    expect((await payment(o.id)).provider_status).toBe('unavailable');
    // Montant payé différent : refusé.
    const r2 = await ref(second.intentId);
    sim.settle(r2, 'succeeded', 19000);
    await notify({ id: `ev-${uuidv7()}`, reference: r2 }).expect(200);
    expect((await h.pool.query('select status from payment_intents where id = $1', [second.intentId])).rows[0].status).toBe('failed');
    expect((await payment(o.id)).provider_status).toBe('unavailable');
    // Échec : le client peut relancer ; la déclaration « J'ai payé » reste possible.
    const third = (await h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(200)).body;
    sim.settle(await ref(third.intentId), 'failed');
    await notify({ id: `ev-${uuidv7()}`, reference: await ref(third.intentId) }).expect(200);
    expect((await h.pool.query('select status from payment_intents where id = $1', [third.intentId])).rows[0].status).toBe('failed');
    expect((await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body.actions).toContain('declare_payment');
    // La base refuse une confirmation technique sans date, ou pour des espèces.
    await expect(h.pool.query("update order_payments set provider_status = 'confirmed' where order_id = $1", [o.id])).rejects.toThrow();
  });
});
