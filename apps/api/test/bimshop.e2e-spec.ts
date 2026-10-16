import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 5-C — BimShop (écrans 32, 33, 34, 54) : parcourir, chercher, fiche, profil de boutique, cœur, suivre. Aucun paiement. */
describe('BimShop (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const jpeg = () => sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 200, g: 40, b: 90 } } }).jpeg().toBuffer();

  async function merchant(name = 'Boutique Élégance') {
    const u = await registerAndActivate(h);
    const shopId = uuidv7();
    const slug = `b-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, $3, $4, 'active', 'Abidjan', 'Cocody')", [shopId, u.userId, name, slug]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, u.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(bearer(u.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200);
    return { ...u, shopId, slug, user: bearer(u.tokens.accessToken), auth: bearer(sw.body.accessToken) };
  }
  type M = Awaited<ReturnType<typeof merchant>>;
  async function product(m: M, body: Record<string, unknown>, opts: { publish?: boolean; stock?: number } = {}) {
    const p = (await h.http().post('/v1/shop/products').set(m.auth).send({ categoryCode: 'vetements_soiree', priceFcfa: 10000, ...body }).expect(201)).body;
    if (opts.publish !== false) {
      await h.http().post(`/v1/shop/products/${p.id}/photos`).set(m.auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
      await h.http().post(`/v1/shop/products/${p.id}/publish`).set(m.auth).expect(200);
    }
    if (opts.stock) await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(m.auth).send({ quantity: opts.stock }).expect(200);
    return p.id as string;
  }

  it('visiteur : seuls les articles en ligne des boutiques ouvertes ; disponibilité sans stock exact ; fiche et profil', async () => {
    const m = await merchant('Maison Plumes');
    const robe = await product(m, { title: 'Robe Plumes Zéphyr', priceFcfa: 60000, promoPriceFcfa: 45000 }, { stock: 2 });
    const draft = await product(m, { title: 'Robe Zéphyr brouillon' }, { publish: false });
    const sac = await product(m, { title: 'Sac Zéphyr', categoryCode: 'accessoires_sacs', priceFcfa: 15000 });

    const all = (await h.http().get('/v1/bimshop/products?q=Zéphyr').expect(200)).body.items;
    expect(all.map((p: { id: string }) => p.id).sort()).toEqual([robe, sac].sort());
    const card = all.find((p: { id: string }) => p.id === robe);
    expect(card).toMatchObject({ available: true, priceFcfa: 45000, shop: { name: 'Maison Plumes', slug: m.slug, verified: false } });
    expect(card.stock).toBeUndefined();
    expect(all.find((p: { id: string }) => p.id === sac).available).toBe(false); // stock 0 : épuisé

    // Rubrique : sous-rubrique ou rubrique parente.
    const byParent = (await h.http().get('/v1/bimshop/products?category=accessoires&q=Zéphyr').expect(200)).body.items;
    expect(byParent.map((p: { id: string }) => p.id)).toEqual([sac]);
    expect((await h.http().get('/v1/bimshop/products?category=inconnue').expect(200)).body.items).toEqual([]);
    // Caractères spéciaux de recherche sans effet de joker.
    expect((await h.http().get('/v1/bimshop/products?q=%25').expect(200)).body.items).toEqual([]);

    const d = (await h.http().get(`/v1/bimshop/products/${robe}`).expect(200)).body;
    expect(d).toMatchObject({ title: 'Robe Plumes Zéphyr', available: true, category: { code: 'vetements_soiree', label: 'Soirée' }, variants: [{ label: 'Unique', available: true }] });
    expect(d.photos).toHaveLength(1);
    expect(d.moreFromShop.map((p: { id: string }) => p.id)).toEqual([sac]);
    await h.http().get(`/v1/bimshop/products/${draft}`).expect(404);

    const profile = (await h.http().get(`/v1/bimshop/shops/${m.slug}`).expect(200)).body;
    expect(profile).toMatchObject({ name: 'Maison Plumes', counts: { followers: 0, products: 2 } });
    expect(profile.items).toHaveLength(2);

    const cats = (await h.http().get('/v1/bimshop/categories').expect(200)).body.items;
    expect(cats.find((c: { code: string }) => c.code === 'accessoires').products).toBeGreaterThanOrEqual(1);

    // Boutique fermée ou propriétaire suspendu : tout disparaît.
    await h.pool.query("update shops set status = 'suspended' where id = $1", [m.shopId]);
    await h.http().get(`/v1/bimshop/products/${robe}`).expect(404);
    await h.http().get(`/v1/bimshop/shops/${m.slug}`).expect(404);
    expect((await h.http().get('/v1/bimshop/products?q=Zéphyr').expect(200)).body.items).toEqual([]);
    await h.pool.query("update shops set status = 'active' where id = $1", [m.shopId]);
    await h.pool.query("update users set status = 'suspended' where id = $1", [m.userId]);
    await h.http().get(`/v1/bimshop/products/${robe}`).expect(404);
    await h.pool.query("update users set status = 'active' where id = $1", [m.userId]);
  });

  it('tri par prix et pagination sans doublon ni oubli', async () => {
    // Mot unique : d'autres suites créent aussi des boutiques et des articles dans la même base.
    const tag = `Pagi${Date.now().toString(36)}`;
    const m = await merchant(`Grande Boutique ${tag}`);
    const base = Date.now();
    for (let i = 0; i < 25; i++) {
      await h.pool.query(
        "insert into products (id, shop_id, category_code, title, price_fcfa, status, published_at) values ($1, $2, 'vetements_sport', $3, $4, 'published', $5)",
        [uuidv7(), m.shopId, `${tag} tenue ${i}`, 1000 + (i % 5) * 100, new Date(base - i * 1000)],
      );
    }
    for (const sort of ['recent', 'price_asc', 'price_desc']) {
      const seen: string[] = [];
      const prices: number[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: { id: string; priceFcfa: number }[]; nextCursor: string | null } = (
          await h.http().get('/v1/bimshop/products').query({ q: tag, sort, ...(cursor ? { cursor } : {}) }).expect(200)
        ).body;
        seen.push(...page.items.map((p) => p.id));
        prices.push(...page.items.map((p) => p.priceFcfa));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
      if (sort === 'price_asc') expect(prices).toEqual([...prices].sort((a, b) => a - b));
      if (sort === 'price_desc') expect(prices).toEqual([...prices].sort((a, b) => b - a));
    }
    await h.http().get('/v1/bimshop/products?cursor=nimportequoi').expect(400);
  });

  it('cœur et suivre : compte requis, état personnel, pas sa propre boutique, articles retirés masqués', async () => {
    const m = await merchant('Atelier Nala');
    const robe = await product(m, { title: 'Robe Nala' }, { stock: 1 });
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);

    await h.http().put(`/v1/bimshop/products/${robe}/favorite`).expect(401);
    await h.http().put(`/v1/bimshop/products/${robe}/favorite`).set(auth).expect(200);
    await h.http().put(`/v1/bimshop/products/${robe}/favorite`).set(auth).expect(200); // idempotent
    await h.http().put(`/v1/bimshop/shops/${m.slug}/follow`).set(auth).expect(200);
    expect((await h.http().get(`/v1/bimshop/products/${robe}/me`).set(auth).expect(200)).body).toEqual({ favorite: true, followingShop: true });
    expect((await h.http().get(`/v1/bimshop/shops/${m.slug}/me`).set(auth).expect(200)).body).toEqual({ following: true, own: false });
    expect((await h.http().get(`/v1/bimshop/shops/${m.slug}`).expect(200)).body.counts.followers).toBe(1);
    expect((await h.http().get('/v1/shop').set(m.auth).expect(200)).body.counts.followers).toBe(1);
    expect((await h.http().put(`/v1/bimshop/shops/${m.slug}/follow`).set(m.user).expect(409)).body.error.code).toBe('OWN_SHOP');

    expect((await h.http().get('/v1/bimshop/favorites').set(auth).expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([robe]);
    // Repassé en brouillon : il n'apparaît plus, mais n'est pas perdu.
    await h.http().post(`/v1/shop/products/${robe}/unpublish`).set(m.auth).expect(200);
    expect((await h.http().get('/v1/bimshop/favorites').set(auth).expect(200)).body.items).toEqual([]);
    await h.http().put(`/v1/bimshop/products/${robe}/favorite`).set(auth).expect(404);
    await h.http().post(`/v1/shop/products/${robe}/publish`).set(m.auth).expect(200);
    expect((await h.http().get('/v1/bimshop/favorites').set(auth).expect(200)).body.items).toHaveLength(1);

    await h.http().delete(`/v1/bimshop/products/${robe}/favorite`).set(auth).expect(200);
    await h.http().delete(`/v1/bimshop/shops/${m.slug}/follow`).set(auth).expect(200);
    expect((await h.http().get(`/v1/bimshop/products/${robe}/me`).set(auth).expect(200)).body).toEqual({ favorite: false, followingShop: false });
  });
});
