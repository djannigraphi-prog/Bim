import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { Harness, registerAndActivate, startHarness } from './harness';

/** Lot 7-D — Tarification des livraisons : communes, durées, grilles versionnées immuables, calcul côté serveur. */
describe('Tarifs de livraison (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const grid = { baseFcfa: 500, perMinuteFcfa: 40, minimumFcfa: 1000, roundingFcfa: 25, freeWaitMinutes: 5, waitPerMinuteFcfa: 50, waitCapMinutes: 15 };

  async function shopIn(city: string, commune: string) {
    const u = await registerAndActivate(h);
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, 'Boutique', $3, 'active', $4, $5)", [shopId, u.userId, `t-${shopId}`, city, commune]);
    return shopId;
  }

  it('permissions : lecture pour le support, modification réservée au rôle principal ; refus sans session', async () => {
    const support = await adminSession(h, ['support']);
    await h.http().get('/admin/v1/delivery/tariffs').set(support).expect(200);
    await h.http().put('/admin/v1/delivery/tariffs/draft').set(support).send({ mode: 'express', ...grid }).expect(403);
    await h.http().post('/admin/v1/delivery/communes').set(support).send({ city: 'Abidjan', name: 'Treichville' }).expect(403);
    await h.http().get('/admin/v1/delivery/tariffs').expect(401);
  });

  it('grille : brouillon, publication, immuable (API et base), nouvelle version ; tout est journalisé', async () => {
    const admin = await adminSession(h, ['super_admin']);
    // Valeurs contrôlées : pas d'arrondi nul, pas de négatif.
    const bad = await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode: 'express', ...grid, roundingFcfa: 0, baseFcfa: -1 }).expect(400);
    expect(Object.keys(bad.body.error.details.fields).sort()).toEqual(['baseFcfa', 'roundingFcfa']);

    const d1 = (await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode: 'express', ...grid }).expect(200)).body;
    expect(d1).toMatchObject({ status: 'draft', mode: 'express' });
    // Un seul brouillon par mode : le second enregistrement modifie le même.
    const d1b = (await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode: 'express', ...grid, perMinuteFcfa: 45 }).expect(200)).body;
    expect(d1b).toMatchObject({ id: d1.id, version: d1.version, perMinuteFcfa: 45 });
    expect((await h.http().post(`/admin/v1/delivery/tariffs/${d1.id}/simulate`).set(admin).send({ minutes: 30 }).expect(201)).body.feeFcfa).toBe(1850);

    const list = (await h.http().post(`/admin/v1/delivery/tariffs/${d1.id}/publish`).set(admin).expect(201)).body.items;
    expect(list.find((t: { id: string }) => t.id === d1.id)).toMatchObject({ status: 'published', current: true });
    await h.http().post(`/admin/v1/delivery/tariffs/${d1.id}/publish`).set(admin).expect(409);
    await h.http().delete(`/admin/v1/delivery/tariffs/${d1.id}`).set(admin).expect(404);
    // La base refuse toute modification ou suppression d'une grille publiée.
    await expect(h.pool.query('update delivery_tariffs set base_fcfa = 0 where id = $1', [d1.id])).rejects.toThrow(/ne se modifie pas/);
    await expect(h.pool.query('delete from delivery_tariffs where id = $1', [d1.id])).rejects.toThrow(/ne se supprime pas/);

    // Nouvelle version : brouillon distinct, la version publiée reste en vigueur jusqu'à la publication.
    const d2 = (await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode: 'express', ...grid, baseFcfa: 600 }).expect(200)).body;
    expect(d2.version).toBe(d1.version + 1);
    let items = (await h.http().get('/admin/v1/delivery/tariffs').set(admin).expect(200)).body.items;
    expect(items.find((t: { id: string }) => t.id === d1.id).current).toBe(true);
    items = (await h.http().post(`/admin/v1/delivery/tariffs/${d2.id}/publish`).set(admin).expect(201)).body.items;
    expect(items.find((t: { id: string }) => t.id === d2.id).current).toBe(true);
    expect(items.find((t: { id: string }) => t.id === d1.id)).toMatchObject({ current: false, status: 'published', baseFcfa: 500 });

    const actions = (await h.pool.query("select action, metadata from audit_logs where target_id in ($1, $2) order by created_at", [d1.id, d2.id])).rows;
    expect(actions.map((r: { action: string }) => r.action)).toEqual([
      'admin.delivery_tariff_draft_created',
      'admin.delivery_tariff_draft_updated',
      'admin.delivery_tariff_published',
      'admin.delivery_tariff_draft_created',
      'admin.delivery_tariff_published',
    ]);
    expect(actions[1].metadata).toMatchObject({ before: { perMinuteFcfa: 40 }, after: { perMinuteFcfa: 45 } });
    expect(actions[4].metadata).toMatchObject({ replaces: { id: d1.id, values: { baseFcfa: 500 } } });
  });

  it('devis : calculé par le serveur ; indisponible si commune, durée ou grille absente (rien d’inventé)', async () => {
    const admin = await adminSession(h, ['super_admin']);
    const city = `Ville${Date.now()}`;
    const communes = (await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name: 'Port-Bouët' }).expect(201)).body.items;
    const from = communes.find((c: { name: string }) => c.name === 'Port-Bouët').code;
    expect(from).toBe(`${city.toLowerCase()}-port-bouet`);
    await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name: 'Port-Bouët' }).expect(409);
    const to = (await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name: 'Cocody' }).expect(201)).body.items.find((c: { name: string }) => c.name === 'Cocody').code;
    // Liste publique : les communes actives.
    expect((await h.http().get('/v1/communes').expect(200)).body.items.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining([from, to]));

    const shopId = await shopIn(city, 'Port-Bouët');
    // Grilles en vigueur pour les deux modes.
    for (const mode of ['express', 'economy']) {
      const d = (await h.http().put('/admin/v1/delivery/tariffs/draft').set(admin).send({ mode, ...grid, perMinuteFcfa: mode === 'express' ? 40 : 20 }).expect(200)).body;
      await h.http().post(`/admin/v1/delivery/tariffs/${d.id}/publish`).set(admin).expect(201);
    }
    // Sans durée saisie : indisponible.
    let q = (await h.http().get(`/v1/shops/${shopId}/delivery-quote?commune=${to}`).expect(200)).body;
    expect(q.quotes).toEqual([
      { mode: 'express', available: false, reason: 'NO_DURATION' },
      { mode: 'economy', available: false, reason: 'NO_DURATION' },
    ]);
    await h.http().put('/admin/v1/delivery/durations').set(admin).send({ fromCode: from, toCode: to, mode: 'express', minutes: 30 }).expect(200);
    await h.http().put('/admin/v1/delivery/durations').set(admin).send({ fromCode: from, toCode: 'inconnue-x', mode: 'express', minutes: 30 }).expect(400);
    q = (await h.http().get(`/v1/shops/${shopId}/delivery-quote?commune=${to}`).expect(200)).body;
    expect(q.shopCommune).toBe(from);
    expect(q.quotes[0]).toMatchObject({ mode: 'express', available: true, minutes: 30, feeFcfa: 1700, waitFeesBilled: false, breakdown: { freeWaitMinutes: 5 } });
    expect(q.quotes[1]).toEqual({ mode: 'economy', available: false, reason: 'NO_DURATION' });
    // Commune de destination inconnue ou désactivée.
    expect((await h.http().get(`/v1/shops/${shopId}/delivery-quote?commune=nulle-part`).expect(200)).body.quotes[0].reason).toBe('COMMUNE_UNKNOWN');
    await h.http().patch(`/admin/v1/delivery/communes/${to}`).set(admin).send({ active: false }).expect(200);
    expect((await h.http().get(`/v1/shops/${shopId}/delivery-quote?commune=${to}`).expect(200)).body.quotes[0].reason).toBe('COMMUNE_UNKNOWN');
    expect((await h.http().get('/v1/communes').expect(200)).body.items.map((c: { code: string }) => c.code)).not.toContain(to);
    await h.http().patch(`/admin/v1/delivery/communes/${to}`).set(admin).send({ active: true }).expect(200);
    // Boutique dans une commune non référencée : indisponible.
    const elsewhere = await shopIn(city, 'Bingerville');
    expect((await h.http().get(`/v1/shops/${elsewhere}/delivery-quote?commune=${to}`).expect(200)).body.quotes[0].reason).toBe('COMMUNE_UNKNOWN');
    // Retirer la durée : de nouveau indisponible ; changement journalisé avec avant / après.
    await h.http().put('/admin/v1/delivery/durations').set(admin).send({ fromCode: from, toCode: to, mode: 'express', minutes: null }).expect(200);
    expect((await h.http().get(`/v1/shops/${shopId}/delivery-quote?commune=${to}`).expect(200)).body.quotes[0].reason).toBe('NO_DURATION');
    const logs = (await h.pool.query("select metadata from audit_logs where action = 'admin.delivery_duration_set' and metadata->>'fromCode' = $1 order by created_at", [from])).rows;
    expect(logs.map((r: { metadata: { before: number | null; after: number | null } }) => [r.metadata.before, r.metadata.after])).toEqual([
      [null, 30],
      [30, null],
    ]);
    // Boutique fermée : pas de devis.
    await h.pool.query("update shops set status = 'suspended' where id = $1", [shopId]);
    await h.http().get(`/v1/shops/${shopId}/delivery-quote?commune=${to}`).expect(404);
  });
});
