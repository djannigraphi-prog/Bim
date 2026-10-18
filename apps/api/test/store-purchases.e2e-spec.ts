import { SimulatorStore } from '../src/modules/wallet/store';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** V1 — Achats dans l'app (magasin) : vérifiés côté serveur, catalogue du serveur, anti-rejeu ; simulateur seulement. */
describe('Achats dans l’app (e2e)', () => {
  let h: Harness;
  let store: SimulatorStore;
  beforeAll(async () => {
    h = await startHarness({ STORE_PROVIDER: 'simulator' });
    await h.pool.query("update app_settings set value = '18', decision_status = 'decided' where key = 'age.min_paid_subscription'");
    h.settings.invalidate();
    store = h.app.get(WalletService).store as SimulatorStore;
  });
  afterAll(async () => h.close());

  const user = async () => {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  };
  const buy = (auth: Record<string, string>, body: Record<string, unknown>, status = 200) => h.http().post('/v1/store/purchases').set(auth).send(body).expect(status);

  it('pièces : jeton vérifié, catalogue du serveur, une seule fois ; produit différent, jeton forgé ou annulé : refusés', async () => {
    const a = await user();
    const b = await user();
    const w = (await h.http().get('/v1/wallet').set(a.auth).expect(200)).body;
    expect(w).toMatchObject({ available: true, storePacks: expect.arrayContaining([{ productId: 'bim.coins.500', coins: 500 }]) });
    const token = store.token('bim.coins.500', 'GPA.1111-2222');
    const r = (await buy(a.auth, { platform: 'google', productId: 'bim.coins.500', purchaseToken: token })).body;
    expect(r).toMatchObject({ purchase: { kind: 'coins', coins: 500, test: true }, balance: { purchased: 500 } });
    // Rejeu : même résultat, aucun second crédit ; jamais pour un autre compte.
    expect((await buy(a.auth, { platform: 'google', productId: 'bim.coins.500', purchaseToken: token })).body.balance.purchased).toBe(500);
    expect((await buy(b.auth, { platform: 'google', productId: 'bim.coins.500', purchaseToken: token }, 409)).body.error.code).toBe('STORE_PURCHASE_INVALID');
    expect((await h.http().get('/v1/wallet').set(b.auth).expect(200)).body.balance.purchased).toBe(0);
    // Produit annoncé différent de celui acheté, jeton forgé, achat annulé, produit inconnu.
    await buy(a.auth, { platform: 'google', productId: 'bim.coins.5000', purchaseToken: store.token('bim.coins.100', 'GPA.3333') }, 422);
    await buy(a.auth, { platform: 'google', productId: 'bim.coins.100', purchaseToken: 'eyJmYWtlIjp0cnVlfQ.signature-fausse' }, 422);
    const refunded = store.token('bim.coins.100', 'GPA.4444');
    store.revoked.add(refunded);
    await buy(a.auth, { platform: 'google', productId: 'bim.coins.100', purchaseToken: refunded }, 422);
    await buy(a.auth, { platform: 'google', productId: 'bim.inconnu', purchaseToken: store.token('bim.inconnu', 'GPA.5555') }, 400);
    // Magasin injoignable : rien n'est crédité, l'app réessaiera.
    store.unavailable = true;
    try {
      expect((await buy(a.auth, { platform: 'apple', productId: 'bim.coins.100', purchaseToken: store.token('bim.coins.100', 'APL-1') }, 503)).body.error.code).toBe('STORE_UNAVAILABLE');
    } finally {
      store.unavailable = false;
    }
    expect((await h.http().get('/v1/wallet').set(a.auth).expect(200)).body.balance.purchased).toBe(500);
  });

  it('Premium acheté dans l’app : ouvert jusqu’à la date du magasin, canal enregistré', async () => {
    const a = await user();
    expect((await h.http().get('/v1/premium').set(a.auth).expect(200)).body).toMatchObject({ available: true, active: false, store: ['bim.premium.month'] });
    const r = (await buy(a.auth, { platform: 'apple', productId: 'bim.premium.month', purchaseToken: store.token('bim.premium.month', 'APL-2000', { days: 30 }) })).body;
    expect(r.premium).toMatchObject({ active: true, channel: 'apple' });
    expect((await h.pool.query('select channel from subscriptions where user_id = $1', [a.userId])).rows).toEqual([{ channel: 'apple' }]);
  });

  it('fermé sans magasin configuré', async () => {
    const off = await startHarness({ STORE_PROVIDER: 'none' });
    try {
      const u = await registerAndActivate(off);
      expect((await off.http().post('/v1/store/purchases').set(bearer(u.tokens.accessToken)).send({ platform: 'google', productId: 'bim.coins.100', purchaseToken: 'abcdefgh.ijk' }).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    } finally {
      await off.close();
    }
  });
});
