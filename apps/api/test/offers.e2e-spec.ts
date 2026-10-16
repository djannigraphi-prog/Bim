import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 5-D — Demandes et offres de projet (écrans 21, 49, 55), recommandations Premium. Aucun paiement. */
describe('Offres de projet (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const jpeg = () => sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 10, g: 140, b: 90 } } }).jpeg().toBuffer();

  async function merchant(category = 'vetements_sport') {
    const u = await registerAndActivate(h);
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Kalia Sport', $3, 'active', 'Abidjan')", [shopId, u.userId, `k-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, u.userId]);
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(u.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken);
    const p = (await h.http().post('/v1/shop/products').set(auth).send({ title: 'Legging respirant', categoryCode: category, priceFcfa: 8500 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(auth).expect(200);
    return { ...u, shopId, auth, user: bearer(u.tokens.accessToken), productId: p.id as string };
  }
  async function person(overrides: Record<string, unknown> = {}, project: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    const auth = bearer(u.tokens.accessToken);
    const pr = (await h.http().post('/v1/projects').set(auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30, receiveMerchantOffers: true, ...project }).expect(201)).body;
    return { ...u, auth, projectId: (pr.project?.id ?? pr.id) as string };
  }
  const requests = async (auth: Record<string, string>) => (await h.http().get('/v1/shop/project-requests').set(auth).expect(200)).body.items as { id: string; title: string; city: string | null; offerStatus: string | null }[];

  it('demandes anonymisées, seulement pour les rubriques liées, jamais les mineurs ni sans accord', async () => {
    const m = await merchant();
    const yes = await person({ city: 'Yopougon' });
    const no = await person({}, { receiveMerchantOffers: false });
    const minorBirth = new Date();
    minorBirth.setFullYear(minorBirth.getFullYear() - 17);
    const minor = await person({ birthDate: minorBirth.toISOString().slice(0, 10) });
    const other = await person({}, { categoryCode: 'visage_peau', goalCode: undefined, description: 'Peau nette' });

    const items = await requests(m.auth);
    const ids = items.map((r) => r.id);
    expect(ids).toContain(yes.projectId);
    for (const hidden of [no.projectId, minor.projectId, other.projectId]) expect(ids).not.toContain(hidden);
    const r = items.find((x) => x.id === yes.projectId)!;
    expect(Object.keys(r).sort()).toEqual(['category', 'city', 'createdAt', 'durationDays', 'goal', 'id', 'mode', 'offerStatus', 'targetQuantity', 'title']);
    expect(r.city).toBeNull(); // ville privée par défaut
    expect(JSON.stringify(r)).not.toContain(yes.body.username);

    // Espace utilisateur : refusé.
    await h.http().get('/v1/shop/project-requests').set(m.user).expect(403);
    // Une boutique sans article en ligne ne voit rien.
    const empty = await merchant();
    await h.http().post(`/v1/shop/products/${empty.productId}/unpublish`).set(empty.auth).expect(200);
    expect((await h.http().get('/v1/shop/project-requests').set(empty.auth).expect(200)).body).toEqual({ items: [], hint: expect.any(String) });
  });

  it('offre : une par projet, articles de la boutique ; la personne la voit, la refuse ; notifications ; ne plus recevoir', async () => {
    const m = await merchant();
    const p = await person();
    const foreign = await merchant();
    const send = (body: Record<string, unknown>, status: number) => h.http().post(`/v1/shop/project-requests/${p.projectId}/offers`).set(m.auth).send(body).expect(status);

    await send({ message: 'Court' }, 400);
    await send({ message: 'Nos leggings sont parfaits pour tes abdos.', productIds: [foreign.productId] }, 400);
    await send({ message: 'Nos leggings sont parfaits pour tes abdos.', productIds: [m.productId] }, 201);
    expect((await send({ message: 'Encore une offre pour ton projet.' }, 409)).body.error.code).toBe('OFFER_EXISTS');
    expect((await requests(m.auth)).find((r) => r.id === p.projectId)!.offerStatus).toBe('sent');

    const got = (await h.http().get(`/v1/projects/${p.projectId}/offers`).set(p.auth).expect(200)).body;
    expect(got.receiveOffers).toBe(true);
    expect(got.items).toHaveLength(1);
    expect(got.items[0]).toMatchObject({ message: 'Nos leggings sont parfaits pour tes abdos.', shop: { name: 'Kalia Sport' }, products: [{ id: m.productId, title: 'Legging respirant' }] });
    const inbox = (await h.http().get('/v1/me/notifications').set(p.auth).expect(200)).body.items;
    expect(inbox.find((n: { type: string }) => n.type === 'project_offer')).toMatchObject({ category: 'projects', link: `/projects/${p.projectId}/offers` });
    // Un autre compte ne voit pas ces offres.
    await h.http().get(`/v1/projects/${p.projectId}/offers`).set(foreign.user).expect(404);

    // Refus : définitif pour cette boutique, la demande disparaît de sa liste.
    await h.http().post(`/v1/projects/${p.projectId}/offers/${got.items[0].id}/decline`).set(p.auth).expect(200);
    expect((await h.http().get(`/v1/projects/${p.projectId}/offers`).set(p.auth).expect(200)).body.items).toEqual([]);
    expect((await requests(m.auth)).map((r) => r.id)).not.toContain(p.projectId);
    expect((await h.http().get('/v1/shop/offers').set(m.auth).expect(200)).body.items[0]).toMatchObject({ status: 'declined' });

    // Ne plus recevoir d'offres : la demande disparaît pour toutes les boutiques.
    expect((await requests(foreign.auth)).map((r) => r.id)).toContain(p.projectId);
    await h.http().put(`/v1/projects/${p.projectId}/merchant-offers`).set(p.auth).send({ receive: false }).expect(200);
    expect((await requests(foreign.auth)).map((r) => r.id)).not.toContain(p.projectId);
    await h.http().post(`/v1/shop/project-requests/${p.projectId}/offers`).set(foreign.auth).send({ message: 'Bonjour, une offre pour toi.' }).expect(404);
  });

  it('retrait d’une offre, blocage, limite quotidienne', async () => {
    const m = await merchant();
    const p = await person();
    const o = (await h.http().post(`/v1/shop/project-requests/${p.projectId}/offers`).set(m.auth).send({ message: 'Une offre pour ton projet sport.' }).expect(201)).body;
    await h.http().delete(`/v1/shop/offers/${o.id}`).set(m.auth).expect(200);
    expect((await h.http().get(`/v1/projects/${p.projectId}/offers`).set(p.auth).expect(200)).body.items).toEqual([]);

    // La personne bloque le propriétaire de la boutique : plus de demande visible.
    const blocked = await person();
    await h.pool.query('insert into user_blocks (blocker_id, blocked_id) values ($1, $2)', [blocked.userId, m.userId]);
    expect((await requests(m.auth)).map((r) => r.id)).not.toContain(blocked.projectId);

    await h.pool.query("update app_settings set value = '1'::jsonb where key = 'offers.max_per_shop_per_day'");
    h.settings.invalidate();
    try {
      const q = await person();
      const r = await h.http().post(`/v1/shop/project-requests/${q.projectId}/offers`).set(m.auth).send({ message: 'Une deuxième offre aujourd’hui.' }).expect(429);
      expect(r.body.error.details).toMatchObject({ limit: 1 });
    } finally {
      await h.pool.query("update app_settings set value = '20'::jsonb where key = 'offers.max_per_shop_per_day'");
      h.settings.invalidate();
    }
  });

  it('« Recommandé pour toi » : seulement les projets Premium, articles des rubriques liées', async () => {
    const m = await merchant('sport_tenues');
    const eco = await person();
    expect((await h.http().get(`/v1/projects/${eco.projectId}/recommendations`).set(eco.auth).expect(200)).body).toEqual({ premiumOnly: true, items: [] });
    const premium = await person({}, { mode: 'premium', budget: 'small' });
    const rec = (await h.http().get(`/v1/projects/${premium.projectId}/recommendations`).set(premium.auth).expect(200)).body;
    expect(rec.premiumOnly).toBe(false);
    expect(rec.items.map((c: { id: string }) => c.id)).toContain(m.productId);
    const beauty = await person({}, { mode: 'premium', budget: 'small', categoryCode: 'visage_peau', goalCode: undefined, description: 'Peau nette' });
    const recB = (await h.http().get(`/v1/projects/${beauty.projectId}/recommendations`).set(beauty.auth).expect(200)).body.items;
    expect(recB.map((c: { id: string }) => c.id)).not.toContain(m.productId);
  });
});
