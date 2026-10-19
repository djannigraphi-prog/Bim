import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 9 (prototype) — Premium, pièces, envois (« Encourager ») et retraits, en circuit simulé uniquement (DEMO_MODE). */
describe('Pièces et Premium : mode démonstration fermé (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ DEMO_MODE: 'false' });
  });
  afterAll(async () => h.close());

  it('sans DEMO_MODE : rien ne peut être acheté, envoyé ni retiré', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    const w = (await h.http().get('/v1/wallet').set(auth).expect(200)).body;
    expect(w).toMatchObject({ available: false, demo: false, balance: { total: 0, withdrawable: 0 } });
    expect((await h.http().get('/v1/premium').set(auth).expect(200)).body).toMatchObject({ available: false, active: false });
    expect((await h.http().post('/v1/premium/subscribe').set(auth).send({ channel: 'demo' }).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    expect((await h.http().post('/v1/wallet/purchases').set(auth).send({ coins: 1000, channel: 'demo', idempotencyKey: 'buy-off-0001' }).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'withdrawal', password: u.body.password }).expect(201);
    const g = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(u.destination) }).expect(200);
    await h.http().post('/v1/wallet/withdrawals').set(auth).set('X-Step-Up-Token', g.body.stepUpToken).send({ coins: 5000, operator: 'wave', idempotencyKey: 'wd-off-00001' }).expect(503);
    // Aucun circuit réel n'existe : seul « demo » est accepté.
    await h.http().post('/v1/wallet/purchases').set(auth).send({ coins: 1000, channel: 'apple', idempotencyKey: 'buy-off-0002' }).expect(400);
  });
});

describe('Pièces et Premium : prototype (e2e)', () => {
  let h: Harness;
  const saved: Record<string, unknown> = {};
  const KEYS = ['coins.withdraw_min', 'coins.withdraw_instant_max', 'coins.withdraw_daily_cap'];
  beforeAll(async () => {
    h = await startHarness({ DEMO_MODE: 'true', OTP_MAX_SENDS_PER_DESTINATION_PER_HOUR: '50' });
    for (const k of KEYS) saved[k] = (await h.pool.query('select value from app_settings where key = $1', [k])).rows[0].value;
  });
  afterAll(async () => {
    for (const k of KEYS) await h.pool.query('update app_settings set value = $2 where key = $1', [k, JSON.stringify(saved[k])]);
    await h.close();
  });
  const set = async (key: string, value: unknown) => {
    await h.pool.query('update app_settings set value = $2 where key = $1', [key, JSON.stringify(value)]);
    h.settings.invalidate();
  };
  async function user(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  /** Confirmation d'identité (mot de passe + code), à usage unique, exigée pour chaque retrait. */
  const stepUp = async (u: { auth: Record<string, string>; body: { password: string }; destination: string }) => {
    const su = await h.http().post('/v1/auth/step-up').set(u.auth).send({ scope: 'withdrawal', password: u.body.password }).expect(201);
    const g = await h.http().post('/v1/auth/step-up/verify').set(u.auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(u.destination) }).expect(200);
    return g.body.stepUpToken as string;
  };
  const wallet = async (auth: Record<string, string>) => (await h.http().get('/v1/wallet').set(auth).expect(200)).body;
  let k = 0;
  const key = () => `k-${Date.now()}-${(k += 1)}`;

  it('page /demo (codes factices) : seulement sur l’ordinateur de démonstration (NODE_ENV=development), jamais ici', async () => {
    await h.http().get('/demo').expect(404);
  });

  it('valeurs provisoires : 6 packs, 8 cadeaux de 1 à 200 000, commission 0, frais opérateur 1 %', async () => {
    const u = await user();
    const w = await wallet(u.auth);
    expect(w).toMatchObject({ available: true, demo: true, coinValueFcfa: 1, premium: { active: false } });
    expect(w.packs.map((p: { coins: number }) => p.coins)).toEqual([100, 500, 1000, 5000, 10000, 50000]);
    expect(w.packs[2]).toEqual({ coins: 1000, priceFcfa: 1000 });
    expect(w.gifts).toHaveLength(8);
    expect(w.gifts[0]).toEqual({ code: 'coin1', name: 'Pièce', coins: 1 });
    // V1-1910-G : le Bateau pirate (100 000) avant la Banque (200 000) ; « Autre montant » de 100 à 1 000 000.
    expect(w.gifts[6]).toMatchObject({ code: 'ship', name: 'Bateau pirate', coins: 100000 });
    expect(w.gifts[7]).toMatchObject({ code: 'bank', name: 'Banque', coins: 200000 });
    expect(w.customAmount).toEqual({ min: 100, max: 1000000 });
    expect(w.withdrawal).toMatchObject({ min: 5000, dailyCap: 5000000, instantMax: 100000, feePercent: 1, commissionFcfa: 0 });
    expect((await h.http().get('/v1/premium').set(u.auth).expect(200)).body).toMatchObject({ available: true, priceFcfa: 2000, periodDays: 30, active: false });
  });

  it('V1 : « Autre montant » — la personne choisit le nombre de pièces, dans les bornes réglées', async () => {
    const u = await user();
    const buy = (coins: number) => h.http().post('/v1/wallet/purchases').set(u.auth).send({ coins, channel: 'demo', idempotencyKey: key() });
    expect((await buy(1234).expect(201)).body).toMatchObject({ purchase: { coins: 1234, priceFcfa: 1234 }, balance: { total: 1234, purchased: 1234, withdrawable: 0 } });
    expect((await buy(1_000_000).expect(201)).body.balance.total).toBe(1_001_234);
    await buy(1_000_001).expect(400);
    await buy(12.5).expect(400);
  });

  it('achat, Premium, envois sur publication et commentaire, donateurs, notification, retraits vérifiés par l’équipe', async () => {
    const a = await user();
    const b = await user({ fullName: 'Koffi Yao' });
    const c = await user();

    // Achat simulé, anti-doublon par clé ; un pack inexistant est refusé.
    const buyKey = key();
    const p1 = (await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 1000, channel: 'demo', idempotencyKey: buyKey }).expect(201)).body;
    const p2 = (await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 1000, channel: 'demo', idempotencyKey: buyKey }).expect(201)).body;
    expect(p2.purchase.id).toBe(p1.purchase.id);
    expect(p2.balance).toEqual({ total: 1000, purchased: 1000, received: 0, withdrawable: 0 });
    // Hors des packs : « Autre montant » seulement entre 100 et 1 000 000 pièces (V1-1910-G).
    expect((await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 99, channel: 'demo', idempotencyKey: key() }).expect(400)).body.error.details.fields.coins[0]).toBe('Choisis un nombre de pièces entre 100 et 1 000 000.');
    await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 1_000_001, channel: 'demo', idempotencyKey: key() }).expect(400);
    expect((await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 500, channel: 'demo', idempotencyKey: buyKey }).expect(409)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Sans Premium, a ne peut pas recevoir de pièces (F9).
    const post = (await h.http().post('/v1/posts').set(a.auth).field('text', 'Semaine 3 terminée').field('visibility', 'public').expect(201)).body;
    let seen = (await h.http().get(`/v1/posts/${post.id}`).set(b.auth).expect(200)).body;
    expect(seen).toMatchObject({ coinCount: 0, canGift: false });
    const gift = (body: Record<string, unknown>, auth = b.auth) => h.http().post('/v1/coins/gifts').set(auth).send({ quantity: 1, idempotencyKey: key(), ...body });
    expect((await gift({ targetType: 'post', targetId: post.id, giftCode: 'chest_s' }).expect(409)).body.error.code).toBe('RECIPIENT_NOT_PREMIUM');

    // Premium simulé.
    const prem = (await h.http().post('/v1/premium/subscribe').set(a.auth).send({ channel: 'demo' }).expect(200)).body;
    expect(prem).toMatchObject({ active: true, autoRenew: true, channel: 'demo' });
    seen = (await h.http().get(`/v1/posts/${post.id}`).set(b.auth).expect(200)).body;
    expect(seen).toMatchObject({ coinCount: 0, canGift: true });
    expect((await h.http().get(`/v1/posts/${post.id}`).set(a.auth).expect(200)).body.canGift).toBe(false);

    // Envoi : 2 petits coffres = 200 pièces, rejouable sans double débit.
    const gk = key();
    const g1 = (await gift({ targetType: 'post', targetId: post.id, giftCode: 'chest_s', quantity: 2, idempotencyKey: gk }).expect(201)).body;
    const g2 = (await gift({ targetType: 'post', targetId: post.id, giftCode: 'chest_s', quantity: 2, idempotencyKey: gk }).expect(201)).body;
    expect(g2.gift.id).toBe(g1.gift.id);
    expect(g2).toMatchObject({ targetCoinCount: 200, balance: { total: 800, purchased: 800 } });
    expect((await h.http().get(`/v1/posts/${post.id}`).set(c.auth).expect(200)).body.coinCount).toBe(200);
    expect((await gift({ targetType: 'post', targetId: post.id, giftCode: 'coin1' }, a.auth).expect(409)).body.error.code).toBe('COINS_SELF_GIFT');
    expect((await gift({ targetType: 'post', targetId: post.id, giftCode: 'bank' }).expect(409)).body.error.code).toBe('INSUFFICIENT_COINS');
    await gift({ targetType: 'post', targetId: post.id, giftCode: 'inconnu' }).expect(400);
    await gift({ targetType: 'post', targetId: post.id, giftCode: 'coin1', quantity: 100 }).expect(400);

    // Commentaire de a : pièces reçues sur le commentaire.
    const com = (await h.http().post(`/v1/posts/${post.id}/comments`).set(a.auth).send({ text: 'Merci à tous !' }).expect(201)).body;
    expect(com).toMatchObject({ coinCount: 0, canGift: false });
    await gift({ targetType: 'comment', targetId: com.id, giftCode: 'coin5' }).expect(201);
    const list = (await h.http().get(`/v1/posts/${post.id}/comments`).set(b.auth).expect(200)).body;
    expect(list.items.find((x: { id: string }) => x.id === com.id)).toMatchObject({ coinCount: 5, canGift: true });

    // Envoi anonyme : regroupé, sans nom, dans la liste des donateurs.
    await h.http().post('/v1/wallet/purchases').set(c.auth).send({ coins: 100, channel: 'demo', idempotencyKey: key() }).expect(201);
    await gift({ targetType: 'post', targetId: post.id, giftCode: 'purse', anonymous: true }, c.auth).expect(201);
    const donors = (await h.http().get(`/v1/posts/${post.id}/donors`).set(a.auth).expect(200)).body;
    expect(donors).toMatchObject({ total: 250, anonymousCoins: 50 });
    expect(donors.donors).toEqual([{ user: expect.objectContaining({ id: b.userId }), coins: 200 }]);

    // Notifications de a.
    const inbox = (await h.http().get('/v1/me/notifications').set(a.auth).expect(200)).body;
    const texts = inbox.items.filter((i: { type: string }) => i.type === 'coins_received').map((i: { text: string }) => i.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Koffi Yao t’a envoyé 200 pièces sur ta publication. Bravo !',
        'Koffi Yao t’a envoyé 5 pièces sur ton commentaire. Bravo !',
        'Quelqu’un t’a envoyé 50 pièces sur ta publication. Bravo !',
      ]),
    );
    expect(inbox.items.find((i: { type: string }) => i.type === 'coins_received')).toMatchObject({ category: 'social', link: `/posts/${post.id}` });

    // Portefeuille de a : 255 pièces reçues, retirables (F8).
    let wa = await wallet(a.auth);
    expect(wa.balance).toEqual({ total: 255, purchased: 0, received: 255, withdrawable: 255 });
    expect(wa.stats).toEqual({ receivedTotal: 255, sentTotal: 0 });

    // Retraits : minimum, pièces achetées jamais retirables, premier retrait vérifié par l'équipe.
    // Sans confirmation d'identité : refusé.
    await h.http().post('/v1/wallet/withdrawals').set(a.auth).send({ operator: 'wave', idempotencyKey: key(), coins: 100 }).expect(403);
    const wd = async (body: Record<string, unknown>, status: number) => {
      const token = await stepUp(a);
      return h.http().post('/v1/wallet/withdrawals').set(a.auth).set('X-Step-Up-Token', token).send({ operator: 'wave', idempotencyKey: key(), ...body }).expect(status);
    };
    expect((await wd({ coins: 100 }, 400)).body.error.details).toMatchObject({ min: 5000 });
    await set('coins.withdraw_min', 50);
    await h.http().post('/v1/wallet/purchases').set(a.auth).send({ coins: 500, channel: 'demo', idempotencyKey: key() }).expect(201);
    expect((await wd({ coins: 400 }, 409)).body.error.code).toBe('INSUFFICIENT_COINS');
    const first = (await wd({ coins: 100 }, 201)).body;
    expect(first.withdrawal).toMatchObject({ coins: 100, feeFcfa: 1, netFcfa: 99, status: 'review', reviewReason: 'first', channel: 'demo', operator: 'wave' });
    expect(first.balance).toMatchObject({ purchased: 500, received: 155 });

    // Administration : seule la finance (ou le rôle principal) voit et décide.
    const support = await adminSession(h, ['support']);
    await h.http().get('/admin/v1/withdrawals').set(support).expect(403);
    const finance = await adminSession(h, ['finance']);
    const queue = (await h.http().get('/admin/v1/withdrawals').set(finance).expect(200)).body;
    expect(queue.items.find((x: { id: string }) => x.id === first.withdrawal.id)).toMatchObject({ status: 'review', user: { id: a.userId } });
    const ok = (await h.http().post(`/admin/v1/withdrawals/${first.withdrawal.id}/decision`).set(finance).send({ decision: 'approve' }).expect(200)).body;
    expect(ok).toMatchObject({ status: 'paid' });
    expect((await h.http().post(`/admin/v1/withdrawals/${first.withdrawal.id}/decision`).set(finance).send({ decision: 'reject', reason: 'x' }).expect(409)).body.error.code).toBe('WITHDRAWAL_ALREADY_DECIDED');

    // Ensuite : immédiat sous le seuil, vérifié au-delà ; un refus rend les pièces.
    expect((await wd({ coins: 100 }, 201)).body.withdrawal).toMatchObject({ status: 'paid', reviewReason: null });
    await set('coins.withdraw_instant_max', 10);
    const big = (await wd({ coins: 50 }, 201)).body.withdrawal;
    expect(big).toMatchObject({ status: 'review', reviewReason: 'amount' });
    await h.http().post(`/admin/v1/withdrawals/${big.id}/decision`).set(finance).send({ decision: 'reject' }).expect(400);
    expect((await h.http().post(`/admin/v1/withdrawals/${big.id}/decision`).set(finance).send({ decision: 'reject', reason: 'Numéro à vérifier' }).expect(200)).body).toMatchObject({ status: 'rejected', rejectReason: 'Numéro à vérifier' });
    wa = await wallet(a.auth);
    expect(wa.balance).toMatchObject({ received: 55, purchased: 500 });
    expect(wa.withdrawals[0]).toMatchObject({ id: big.id, status: 'rejected' });

    // Plafond sur 24 heures (retraits refusés non comptés).
    await set('coins.withdraw_daily_cap', 250);
    expect((await wd({ coins: 55 }, 409)).body.error.code).toBe('WITHDRAWAL_DAILY_CAP');

    // F11 : après la fin de Premium, les pièces reçues restent retirables ; plus aucune n'arrive.
    await h.http().post('/v1/premium/cancel').set(a.auth).expect(200);
    expect((await h.http().get('/v1/premium').set(a.auth).expect(200)).body).toMatchObject({ active: true, autoRenew: false });
    await h.pool.query(`update subscriptions set current_period_end = now() - interval '1 minute' where user_id = $1`, [a.userId]);
    expect((await gift({ targetType: 'post', targetId: post.id, giftCode: 'coin1' }).expect(409)).body.error.code).toBe('RECIPIENT_NOT_PREMIUM');
    await set('coins.withdraw_daily_cap', 5000000);
    await set('coins.withdraw_instant_max', 100000);
    expect((await wd({ coins: 55 }, 201)).body.withdrawal.status).toBe('paid');

    // Le grand livre et les soldes concordent pour tout le monde.
    const diff = await h.pool.query(`
      select w.user_id from wallets w
      left join (select user_id, sum(delta) filter (where bucket = 'purchased') p, sum(delta) filter (where bucket = 'received') r from coin_ledger group by user_id) l on l.user_id = w.user_id
      where w.purchased <> coalesce(l.p, 0) or w.received <> coalesce(l.r, 0)`);
    expect(diff.rows).toEqual([]);
  });

  it('envois simultanés : le solde ne devient jamais négatif', async () => {
    const a = await user();
    const b = await user();
    await h.http().post('/v1/premium/subscribe').set(a.auth).send({ channel: 'demo' }).expect(200);
    await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 500, channel: 'demo', idempotencyKey: key() }).expect(201);
    const post = (await h.http().post('/v1/posts').set(a.auth).field('text', 'Merci').field('visibility', 'public').expect(201)).body;
    const res = await Promise.all(
      Array.from({ length: 4 }, () => h.http().post('/v1/coins/gifts').set(b.auth).send({ targetType: 'post', targetId: post.id, giftCode: 'chest_s', quantity: 2, idempotencyKey: key() })),
    );
    expect(res.map((r) => r.status).sort()).toEqual([201, 201, 409, 409]);
    expect(res.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_COINS')).toBe(true);
    expect((await wallet(b.auth)).balance.total).toBe(100);
    expect((await wallet(a.auth)).balance.received).toBe(400);
  });

  it('âge : moins de 18 ans, ni achat de pièces ni Premium (valeurs provisoires)', async () => {
    const y = new Date().getUTCFullYear() - 16;
    const m = await user({ birthDate: `${y}-01-01` });
    expect((await h.http().post('/v1/wallet/purchases').set(m.auth).send({ coins: 100, channel: 'demo', idempotencyKey: key() }).expect(403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');
    expect((await h.http().post('/v1/premium/subscribe').set(m.auth).send({ channel: 'demo' }).expect(403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');
  });
});
