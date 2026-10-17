import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 8 — Sans prestataire configuré (situation réelle) : paiement en ligne fermé, notifications ignorées. */
describe('Paiement en ligne — aucun prestataire (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ PAYMENT_PROVIDER: 'none' });
  });
  afterAll(async () => h.close());

  it('fermé : 503 pour le client, 404 pour une notification ; rien n’est écrit', async () => {
    const u = await registerAndActivate(h);
    const r = await h.http().post('/v1/orders/0192f7a0-0000-7000-8000-000000000000/payment/online').set(bearer(u.tokens.accessToken)).expect(503);
    expect(r.body.error.code).toBe('NOT_CONFIGURED');
    await h.http().post('/v1/payments/webhooks/simulator').send({ id: 'x', reference: 'y' }).expect(404);
    await h.http().post('/v1/payments/webhooks/paystack').send({}).expect(404);
    expect((await h.pool.query("select count(*)::int n from payment_provider_events where event_key = 'x'")).rows[0].n).toBe(0);
  });
});
