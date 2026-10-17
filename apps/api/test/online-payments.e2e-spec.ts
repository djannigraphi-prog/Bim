import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { OnlinePaymentsService } from '../src/modules/orders/online/online-payments.service';
import { SIMULATOR_SIGNATURE_HEADER, SimulatorProvider } from '../src/modules/orders/online/simulator.provider';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;
const SECRET = 'test-simulator-secret-0123456789';

/**
 * Lot 8 — paiement en ligne derrière l'interface commune, avec le **simulateur** (tests automatisés, aucun prestataire
 * réel) : fermé sans autorisation, sans décision sur les frais ni compte de la boutique (F4) ; signature vérifiée ;
 * notification jamais crue seule ; montant, devise et bénéficiaire exacts ; une notification traitée une fois ;
 * expiration ; remboursement par l'équipe BIM seulement ; la boutique décide toujours.
 */
describe('Paiement en ligne — simulateur (e2e)', () => {
  let h: Harness;
  let sim: SimulatorProvider;
  let online: OnlinePaymentsService;
  let finance: Auth;

  async function setting(key: string, value: unknown, status = 'decided') {
    await h.pool.query('update app_settings set value = $1::jsonb, decision_status = $2 where key = $3', [JSON.stringify(value), status, key]);
    h.settings.invalidate();
  }
  async function open() {
    await setting('payments.online_enabled', true);
    await setting('payments.fee_bearer', 'shop');
  }

  beforeAll(async () => {
    h = await startHarness({ PAYMENT_PROVIDER: 'simulator', PAYMENT_SIMULATOR_SECRET: SECRET });
    online = h.app.get(OnlinePaymentsService);
    sim = online.provider as SimulatorProvider;
    finance = await adminSession(h, ['finance']);
    await setting('age.min_other_payments', 18);
  });
  afterAll(async () => {
    await setting('age.min_other_payments', null, 'pending');
    await setting('payments.online_enabled', false, 'pending');
    await setting('payments.fee_bearer', null, 'pending');
    await h.close();
    // L'environnement est partagé entre les suites d'un même processus : le simulateur ne déborde pas sur les autres.
    process.env.PAYMENT_PROVIDER = 'none';
    delete process.env.PAYMENT_SIMULATOR_SECRET;
  });

  async function person() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  /** Commande retirée en boutique, remise par code : le paiement Mobile Money est dû. `account` : compte de la boutique. */
  async function deliveredOrder(account: string | null = `ACCT_${uuidv7().slice(0, 8)}`) {
    const owner = await person();
    const shopId = uuidv7();
    const slug = `op-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Boutique Élégance', $3, 'active', 'Abidjan')", [shopId, owner.userId, slug]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const s = bearer((await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    const p = (await h.http().post('/v1/shop/products').set(s).send({ title: 'Robe', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s).attach('photos', await sharp({ create: { width: 200, height: 200, channels: 3, background: 'red' } }).jpeg().toBuffer(), 'a.jpg').expect(201);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s).send({ quantity: 5 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s).expect(200);
    if (account) await h.http().post('/admin/v1/online-payments/accounts').set(finance).send({ shopSlug: slug, accountRef: account }).expect(201);
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
    return { id: o.id as string, client, shop: s, slug, account };
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
  const intent = async (id: string) => (await h.pool.query('select provider_ref, status, failure_reason, payee_account_ref from payment_intents where id = $1', [id])).rows[0];
  const payment = async (orderId: string) => (await h.pool.query("select provider_status, provider_confirmed_at, decision from order_payments where order_id = $1 and kind = 'article'", [orderId])).rows[0];
  const start = (o: { id: string; client: { auth: Auth } }, status = 200) => h.http().post(`/v1/orders/${o.id}/payment/online`).set(o.client.auth).expect(status);

  it('fermé tant que le fondateur n’a pas autorisé, que les frais ne sont pas décidés ou que la boutique n’a pas de compte (F4)', async () => {
    const o = await deliveredOrder();
    // Aucun moyen inactif affiché au client.
    let mine = (await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body;
    expect(mine.onlinePayment).toBeNull();
    expect(mine.actions).not.toContain('pay_online');
    expect((await start(o, 503)).body.error.code).toBe('NOT_CONFIGURED');
    await setting('payments.online_enabled', true);
    // Frais non décidés (décision commerciale) : toujours fermé.
    expect((await start(o, 503)).body.error.code).toBe('NOT_CONFIGURED');
    await setting('payments.fee_bearer', 'shop', 'provisional');
    expect((await start(o, 503)).body.error.code).toBe('NOT_CONFIGURED');
    await setting('payments.fee_bearer', 'shop');
    // Boutique sans compte chez le prestataire : jamais de paiement vers un compte de BIM.
    const noAccount = await deliveredOrder(null);
    mine = (await h.http().get(`/v1/orders/${noAccount.id}`).set(noAccount.client.auth)).body;
    expect(mine.actions).not.toContain('pay_online');
    expect((await start(noAccount, 409)).body.error.code).toBe('SHOP_PAYMENT_ACCOUNT_MISSING');
    // Ouvert : action et opérateurs réellement pris en charge.
    mine = (await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body;
    expect(mine.actions).toContain('pay_online');
    expect(mine.onlinePayment).toMatchObject({ available: true, operators: ['orange', 'mtn', 'wave'], last: null });
    await setting('payments.online_enabled', false, 'pending');
    await setting('payments.fee_bearer', null, 'pending');
  });

  it('paiement vérifié : signature, vérification serveur, bénéficiaire, une seule fois ; la boutique décide toujours', async () => {
    await open();
    const o = await deliveredOrder();
    const other = await person();
    await h.http().post(`/v1/orders/${o.id}/payment/online`).set(other.auth).expect(404);
    const started = (await start(o)).body;
    expect(started).toMatchObject({ status: 'pending', amountFcfa: 20000, redirectUrl: expect.stringContaining('https://'), operators: ['orange', 'mtn', 'wave'] });
    const r = (await intent(started.intentId)).provider_ref as string;
    expect((await intent(started.intentId)).payee_account_ref).toBe(o.account);

    // Signature fausse : refusée, rien n'est écrit.
    expect((await notify({ id: 'ev-forged', reference: r }, 'a'.repeat(128)).expect(401)).body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((await h.pool.query("select count(*)::int n from payment_provider_events where event_key = 'ev-forged'")).rows[0].n).toBe(0);
    // Notification valide mais paiement pas encore validé : rien ne change ; la vérification du client dit « en attente ».
    await notify({ id: 'ev-early', reference: r }).expect(200);
    expect((await payment(o.id)).provider_status).toBe('unavailable');
    expect((await h.http().post(`/v1/orders/${o.id}/payment/online/check`).set(o.client.auth).expect(200)).body).toMatchObject({ status: 'pending' });

    sim.settle(r, 'succeeded');
    await notify({ id: 'ev-ok', reference: r }).expect(200);
    const p = await payment(o.id);
    expect(p).toMatchObject({ provider_status: 'confirmed', decision: 'pending' });
    expect(p.provider_confirmed_at).not.toBeNull();
    // Rejeu de la même notification : traitée une seule fois.
    await notify({ id: 'ev-ok', reference: r }).expect(200);
    expect((await h.pool.query("select count(*)::int n from payment_provider_events where event_key = 'ev-ok'")).rows[0].n).toBe(1);
    // La boutique décide : pas « terminée » sans elle ; plus de paiement en ligne proposé.
    const mine = (await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body;
    expect(mine).toMatchObject({ status: 'delivered', payment: { status: 'confirmed_by_provider', provider: 'confirmed' }, onlinePayment: { available: false, last: { status: 'succeeded' } } });
    expect(mine.actions).not.toContain('pay_online');
    expect((await start(o, 409)).body.error.code).toBe('PAYMENT_ACTION_NOT_ALLOWED');
    expect((await h.http().post(`/v1/shop/orders/${o.id}/payment/confirm`).set(o.shop).expect(200)).body.status).toBe('completed');
    expect((await h.pool.query("select count(*)::int n from order_events where order_id = $1 and type = 'payment_provider_confirmed'", [o.id])).rows[0].n).toBe(1);
    await expect(h.pool.query("delete from payment_provider_events where event_key = 'ev-ok'")).rejects.toThrow();
  });

  it('montant, bénéficiaire, échec, remplacement : jamais confirmé ; vérification par le client', async () => {
    await open();
    const o = await deliveredOrder();
    const first = (await start(o)).body;
    const second = (await start(o)).body;
    expect(await intent(first.intentId)).toMatchObject({ status: 'expired', failure_reason: 'replaced' });
    // Le premier, remplacé, ne confirme plus rien même payé.
    const r1 = (await intent(first.intentId)).provider_ref;
    sim.settle(r1, 'succeeded');
    await notify({ id: `ev-${uuidv7()}`, reference: r1 }).expect(200);
    expect((await payment(o.id)).provider_status).toBe('unavailable');
    // Montant différent : refusé.
    const r2 = (await intent(second.intentId)).provider_ref;
    sim.settle(r2, 'succeeded', { amountFcfa: 19000 });
    await notify({ id: `ev-${uuidv7()}`, reference: r2 }).expect(200);
    expect(await intent(second.intentId)).toMatchObject({ status: 'failed', failure_reason: 'amount_mismatch' });
    // Payé sur un autre compte que celui de la boutique : refusé (F4).
    const third = (await start(o)).body;
    sim.settle((await intent(third.intentId)).provider_ref, 'succeeded', { payee: 'ACCT_autre' });
    expect((await h.http().post(`/v1/orders/${o.id}/payment/online/check`).set(o.client.auth).expect(200)).body).toMatchObject({ status: 'failed', failureReason: 'payee_mismatch' });
    // Échec chez le prestataire, constaté par la vérification du client (pas de notification pour un échec).
    const fourth = (await start(o)).body;
    sim.settle((await intent(fourth.intentId)).provider_ref, 'failed');
    expect((await h.http().post(`/v1/orders/${o.id}/payment/online/check`).set(o.client.auth).expect(200)).body).toMatchObject({ status: 'failed', failureReason: 'provider_failed' });
    expect((await payment(o.id)).provider_status).toBe('unavailable');
    expect((await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body.actions).toEqual(expect.arrayContaining(['declare_payment', 'pay_online']));
    await expect(h.pool.query("update order_payments set provider_status = 'confirmed' where order_id = $1", [o.id])).rejects.toThrow();
  });

  it('expiration : revérifié puis expiré après le délai ; payé entre-temps : confirmé', async () => {
    await open();
    const a = await deliveredOrder();
    const b = await deliveredOrder();
    const ia = (await start(a)).body.intentId;
    const ib = (await start(b)).body.intentId;
    sim.settle((await intent(ib)).provider_ref, 'succeeded');
    await h.pool.query("update payment_intents set created_at = now() - interval '2 hours' where id in ($1, $2)", [ia, ib]);
    await online.expirePending(new Date());
    expect(await intent(ia)).toMatchObject({ status: 'expired', failure_reason: 'expired' });
    expect((await intent(ib)).status).toBe('succeeded');
    expect((await payment(b.id)).provider_status).toBe('confirmed');
  });

  it('remboursement : équipe BIM avec la permission, motif, montant borné, suivi par notification signée ; administration journalisée', async () => {
    await open();
    const o = await deliveredOrder();
    const id = (await start(o)).body.intentId;
    const ref = (await intent(id)).provider_ref;
    // Pas de remboursement d'un paiement non vérifié.
    expect((await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(finance).send({ reason: 'Article retourné' }).expect(409)).body.error.code).toBe('REFUND_NOT_ALLOWED');
    sim.settle(ref, 'succeeded');
    await h.http().post(`/v1/orders/${o.id}/payment/online/check`).set(o.client.auth).expect(200);
    // Permissions : le support ne rembourse pas ; motif obligatoire ; montant borné.
    const support = await adminSession(h, ['support']);
    await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(support).send({ reason: 'Article retourné' }).expect(403);
    await h.http().get('/admin/v1/online-payments').set(support).expect(403);
    await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(finance).send({ reason: 'x' }).expect(400);
    expect((await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(finance).send({ amountFcfa: 25000, reason: 'Article retourné' }).expect(400)).body.error.code).toBe('REFUND_AMOUNT_INVALID');
    const rf = (await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(finance).send({ amountFcfa: 5000, reason: 'Article retourné en partie' }).expect(201)).body;
    expect(rf).toMatchObject({ status: 'pending', amountFcfa: 5000 });
    // Un seul remboursement en cours à la fois.
    await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(finance).send({ reason: 'Second remboursement' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    // Notification signée du prestataire : statut relu auprès de lui.
    const refundRef = (await h.pool.query('select provider_refund_ref from payment_refunds where id = $1', [rf.id])).rows[0].provider_refund_ref;
    sim.settleRefund(refundRef, 'processed');
    await notify({ id: `ev-${uuidv7()}`, reference: ref, refund: refundRef }).expect(200);
    expect((await h.pool.query('select status from payment_refunds where id = $1', [rf.id])).rows[0].status).toBe('processed');
    // Reste à rembourser : 15 000 F au plus.
    expect((await h.http().post(`/admin/v1/online-payments/${id}/refund`).set(finance).send({ amountFcfa: 15001, reason: 'Le reste' }).expect(400)).body.error.details).toEqual({ maxFcfa: 15000 });
    // Liste journalisée ; comptes des boutiques.
    const list = (await h.http().get('/admin/v1/online-payments?status=succeeded').set(finance).expect(200)).body;
    expect(list).toMatchObject({ provider: 'simulator', operators: ['orange', 'mtn', 'wave'] });
    expect(list.items.find((x: { id: string }) => x.id === id).refunds).toEqual([expect.objectContaining({ amountFcfa: 5000, status: 'processed' })]);
    expect((await h.pool.query("select count(*)::int n from audit_logs where action = 'admin.online_payments_viewed'")).rows[0].n).toBeGreaterThan(0);
    const accounts = (await h.http().get('/admin/v1/online-payments/accounts').set(finance).expect(200)).body.items;
    const acc = accounts.find((x: { slug: string }) => x.slug === o.slug);
    expect(acc).toMatchObject({ accountRef: o.account, status: 'active', provider: 'simulator' });
    await h.http().post(`/admin/v1/online-payments/accounts/${acc.id}/disable`).set(finance).expect(200);
    expect((await h.http().get(`/v1/orders/${o.id}`).set(o.client.auth)).body.actions).not.toContain('pay_online');
  });
});
