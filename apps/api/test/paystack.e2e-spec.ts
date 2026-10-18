import { createHmac } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { PAYSTACK_SIGNATURE_HEADER } from '../src/modules/orders/online/paystack.provider';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;
const KEY = `sk_test_${'b1m'.repeat(12)}`;

/**
 * Lot 8 — Intégration Paystack contre un **faux serveur Paystack** local (tests automatisés, simulation) : forme
 * exacte des appels documentés (initialisation, vérification, remboursement), signature `x-paystack-signature`
 * (HMAC SHA512 du corps brut, clé secrète), montants XOF × 100, sous-compte de la boutique (F4). Aucun appel n'est fait
 * à Paystack : aucune clé réelle n'existe et ce n'est pas un test dans l'environnement de test de Paystack.
 */
describe('Paystack — faux serveur (e2e)', () => {
  let h: Harness;
  let fake: Server;
  const calls: Array<{ method: string; path: string; auth: string | undefined; body: Record<string, unknown> | null }> = [];
  const tx = new Map<string, { status: string; amount: number; currency: string; subaccount: string }>();

  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => resolve(d));
    });

  beforeAll(async () => {
    fake = createServer(async (req, res) => {
      const raw = await read(req);
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      calls.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body });
      const send = (code: number, json: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { status: false, message: 'Invalid key' });
      if (req.method === 'POST' && req.url === '/transaction/initialize') {
        const ref = body!.reference as string;
        tx.set(ref, { status: 'ongoing', amount: Number(body!.amount), currency: body!.currency as string, subaccount: body!.subaccount as string });
        return send(200, { status: true, message: 'Authorization URL created', data: { authorization_url: `https://checkout.paystack.com/${ref}`, access_code: 'ac', reference: ref } });
      }
      const verify = req.url!.match(/^\/transaction\/verify\/(.+)$/);
      if (req.method === 'GET' && verify) {
        const t = tx.get(decodeURIComponent(verify[1]));
        if (!t) return send(404, { status: false, message: 'Transaction reference not found' });
        return send(200, { status: true, data: { status: t.status, amount: t.amount, currency: t.currency, reference: decodeURIComponent(verify[1]), subaccount: { subaccount_code: t.subaccount } } });
      }
      const sub = req.url!.match(/^\/subaccount\/(.+)$/);
      if (req.method === 'GET' && sub) {
        const code = decodeURIComponent(sub[1]);
        if (code === 'ACCT_boutique01') return send(200, { status: true, data: { subaccount_code: code, active: true, percentage_charge: 0, currency: 'XOF' } });
        if (code === 'ACCT_part') return send(200, { status: true, data: { subaccount_code: code, active: true, percentage_charge: 10, currency: 'XOF' } });
        return send(404, { status: false, message: 'Subaccount not found' });
      }
      if (req.method === 'POST' && req.url === '/refund') return send(200, { status: true, data: { id: 9001, status: 'pending' } });
      if (req.method === 'GET' && req.url === '/refund/9001') return send(200, { status: true, data: { status: 'processed' } });
      if (req.url === '/panne') return send(500, { status: false });
      send(404, { status: false });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    h = await startHarness({ PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: KEY, PAYSTACK_API_BASE_URL: `http://127.0.0.1:${port}`, PAYMENT_CUSTOMER_EMAIL_DOMAIN: 'clients.bim.test' });
    for (const [k, v] of [['age.min_other_payments', 18], ['payments.online_enabled', true], ['payments.fee_bearer', 'shop'], ['payments.shop_fee_terms', 'Frais Paystack à la charge de la boutique (test).']] as const) {
      await h.pool.query("update app_settings set value = $1::jsonb, decision_status = 'decided' where key = $2", [JSON.stringify(v), k]);
    }
    h.settings.invalidate();
  });
  afterAll(async () => {
    await h.pool.query("update app_settings set value = 'null'::jsonb, decision_status = 'pending' where key in ('age.min_other_payments', 'payments.shop_fee_terms')");
    await h.pool.query("update app_settings set value = 'false'::jsonb, decision_status = 'pending' where key = 'payments.online_enabled'");
    await h.close();
    await new Promise<void>((r) => fake.close(() => r()));
    process.env.PAYMENT_PROVIDER = 'none';
    for (const k of ['PAYSTACK_SECRET_KEY', 'PAYSTACK_API_BASE_URL', 'PAYMENT_CUSTOMER_EMAIL_DOMAIN']) delete process.env[k];
  });

  async function person() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  it('initialisation, notification signée, vérification, sous-compte de la boutique, aucun remboursement : appels conformes à la documentation', async () => {
    const finance = await adminSession(h, ['finance']);
    const owner = await person();
    const shopId = uuidv7();
    const slug = `ps-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Boutique Paystack', $3, 'active', 'Abidjan')", [shopId, owner.userId, slug]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const s = bearer((await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    const p = (await h.http().post('/v1/shop/products').set(s).send({ title: 'Robe', categoryCode: 'vetements_soiree', priceFcfa: 20000 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s).attach('photos', await sharp({ create: { width: 200, height: 200, channels: 3, background: 'red' } }).jpeg().toBuffer(), 'a.jpg').expect(201);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s).send({ quantity: 5 }).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s).expect(200);
    // Compte vérifié chez Paystack : part du compte principal non nulle ou compte inconnu refusés.
    expect((await h.http().post('/admin/v1/online-payments/accounts').set(finance).send({ shopSlug: slug, accountRef: 'ACCT_part' }).expect(422)).body.error.code).toBe('PAYEE_ACCOUNT_INVALID');
    expect((await h.http().post('/admin/v1/online-payments/accounts').set(finance).send({ shopSlug: slug, accountRef: 'ACCT_inconnu' }).expect(422)).body.error.message).toMatch(/introuvable/);
    await h.http().post('/admin/v1/online-payments/accounts').set(finance).send({ shopSlug: slug, accountRef: 'ACCT_boutique01' }).expect(201);
    expect(calls.some((c) => c.method === 'GET' && c.path === '/subaccount/ACCT_boutique01' && c.auth === `Bearer ${KEY}`)).toBe(true);
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

    // Opérateurs annoncés : ceux que Paystack prend en charge en Côte d'Ivoire (Moov exclu).
    expect((await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.onlinePayment).toMatchObject({ available: true, operators: ['orange', 'mtn', 'wave'] });
    const started = (await h.http().post(`/v1/orders/${o.id}/payment/online`).set(client.auth).expect(200)).body;
    expect(started.redirectUrl).toBe(`https://checkout.paystack.com/${started.intentId}`);
    const init = calls.find((c) => c.path === '/transaction/initialize')!;
    expect(init.body).toMatchObject({ amount: '2000000', currency: 'XOF', reference: started.intentId, channels: ['mobile_money'], subaccount: 'ACCT_boutique01', bearer: 'subaccount', transaction_charge: 0 });
    expect(init.body!.email).toMatch(/^c-[0-9a-f]{20}@clients\.bim\.test$/);
    expect(JSON.stringify(init.body)).not.toContain(client.destination); // aucun numéro de téléphone transmis

    // Notification signée avec la clé : acceptée ; signée autrement : refusée.
    const payload = JSON.stringify({ event: 'charge.success', data: { id: 777, reference: started.intentId, amount: 2000000, currency: 'XOF', status: 'success' } });
    await h.http().post('/v1/payments/webhooks/paystack').set('content-type', 'application/json').set(PAYSTACK_SIGNATURE_HEADER, createHmac('sha512', 'autre-cle').update(payload).digest('hex')).send(payload).expect(401);
    // Paiement encore « en cours » chez Paystack : rien n'est confirmé malgré la notification.
    const sig = createHmac('sha512', KEY).update(payload).digest('hex');
    await h.http().post('/v1/payments/webhooks/paystack').set('content-type', 'application/json').set(PAYSTACK_SIGNATURE_HEADER, sig).send(payload).expect(200);
    expect((await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body.payment.provider).toBe('unavailable');
    // Réussi chez Paystack, notification (nouvelle) : vérifiée par GET /transaction/verify, confirmée.
    tx.get(started.intentId)!.status = 'success';
    const payload2 = JSON.stringify({ event: 'charge.success', data: { id: 778, reference: started.intentId } });
    await h.http().post('/v1/payments/webhooks/paystack').set('content-type', 'application/json').set(PAYSTACK_SIGNATURE_HEADER, createHmac('sha512', KEY).update(payload2).digest('hex')).send(payload2).expect(200);
    expect(calls.some((c) => c.method === 'GET' && c.path === `/transaction/verify/${started.intentId}`)).toBe(true);
    expect((await h.http().get(`/v1/orders/${o.id}`).set(client.auth)).body).toMatchObject({ status: 'delivered', payment: { status: 'confirmed_by_provider' } });
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);

    // Aucun remboursement dans BIM (règle du fondateur, 18/10/2026) : pas de route, l'API /refund de Paystack n'est
    // jamais appelée ; une notification `refund.*` signée est enregistrée sans aucun effet.
    await h.http().post(`/admin/v1/online-payments/${started.intentId}/refund`).set(finance).send({ amountFcfa: 5000, reason: 'Article retourné en partie' }).expect(404);
    const rp = JSON.stringify({ event: 'refund.processed', data: { id: 9001, transaction_reference: started.intentId, status: 'processed' } });
    await h.http().post('/v1/payments/webhooks/paystack').set('content-type', 'application/json').set(PAYSTACK_SIGNATURE_HEADER, createHmac('sha512', KEY).update(rp).digest('hex')).send(rp).expect(200);
    expect(calls.some((c) => c.path.startsWith('/refund'))).toBe(false);
    expect((await h.pool.query('select count(*)::int n from payment_refunds r join payment_intents i on i.id = r.intent_id where i.provider_ref = $1', [started.intentId])).rows[0].n).toBe(0);
    // Journal technique sans donnée personnelle.
    const logs = (await h.pool.query("select metadata from audit_logs where action in ('payments.provider_confirmed', 'payments.online_started') order by created_at desc limit 5")).rows;
    expect(JSON.stringify(logs)).not.toMatch(/@|\+225/);
  });
});
