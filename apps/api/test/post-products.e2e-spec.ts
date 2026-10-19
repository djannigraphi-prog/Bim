import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Lot 5-E — « Produits et services utilisés » d'un « J'ai fait mon BIM » (écran 11, règle E2) : l'auteur associe des
 * articles visibles du BimShop ; le lecteur voit un lien vers la fiche, jamais d'achat ; fils sans produits ; fiches
 * masquées, retirées ou bloquées omises sans rien dévoiler ; réputation des articles inchangée.
 */
describe('Produits et services utilisés (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  type Auth = Record<string, string>;
  const jpeg = () => sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 220, g: 30, b: 60 } } }).jpeg().toBuffer();
  async function user() {
    const u = await registerAndActivate(h);
    return { userId: u.userId as string, username: u.me.username as string, auth: bearer(u.tokens.accessToken) as Auth };
  }
  type U = Awaited<ReturnType<typeof user>>;
  async function shop(name: string) {
    const owner = await user();
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, $3, $4, 'active', 'Abidjan')", [shopId, owner.userId, name, `pp-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    return { shopId, owner, auth };
  }
  async function product(s: { auth: Auth }, title: string, publish = true) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title, categoryCode: 'vetements_soiree', priceFcfa: 45000 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    if (publish) await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    return p.id as string;
  }
  async function bim(a: U, body: Record<string, unknown> = {}, status = 201) {
    const pr = (await h.http().post('/v1/projects').set(a.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
    for (const kind of ['before', 'after']) {
      await h.http().post(`/v1/projects/${pr.id}/photos?kind=${kind}`).set(a.auth).attach('photo', await jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
    }
    return (await h.http().post('/v1/posts/bim').set(a.auth).send({ projectId: pr.id, text: 'Mon parcours', ...body }).expect(status)).body;
  }
  const detail = async (auth: Auth, id: string, status = 200) => (await h.http().get(`/v1/posts/${id}`).set(auth).expect(status)).body;
  const set = (auth: Auth, id: string, productIds: string[], status = 200) => h.http().put(`/v1/posts/${id}/products`).set(auth).send({ productIds }).expect(status);

  it('l’auteur associe des fiches visibles (5 au plus) ; le lecteur voit un lien vers la fiche, sans prix ni achat ; fils sans produits', async () => {
    const s = await shop('Boutique Élégance');
    const robe = await product(s, 'Robe de sport');
    const tapis = await product(s, 'Tapis de yoga');
    const brouillon = await product(s, 'Brouillon', false);
    const a = await user();
    const b = await user();

    // À la publication : fiches publiées seulement ; brouillon ou identifiant inconnu refusés (rien n'est créé).
    const before = (await h.pool.query('select count(*)::int as n from posts where user_id = $1', [a.userId])).rows[0].n;
    expect((await bim(a, { productIds: [robe, brouillon] }, 400)).error.code).toBe('VALIDATION_FAILED');
    expect((await h.pool.query('select count(*)::int as n from posts where user_id = $1', [a.userId])).rows[0].n).toBe(before);
    const post = await bim(a, { productIds: [robe, robe, tapis] });
    expect(post.usedProducts.map((p: { id: string }) => p.id)).toEqual([robe, tapis]); // doublon retiré, ordre gardé
    const seen = (await detail(b.auth, post.id)).usedProducts;
    expect(seen[0]).toEqual({ id: robe, kind: 'product', title: 'Robe de sport', imageUrl: expect.any(String), available: false, shop: { name: 'Boutique Élégance', slug: expect.any(String), verified: false, certified: false } });
    // Aucun prix, aucune action d'achat dans la publication (E2).
    expect(JSON.stringify(seen)).not.toMatch(/price|Fcfa|order|buy/i);
    // Fil (Accueil) : aucune fiche, aucun lien d'achat.
    const feed = (await h.http().get('/v1/feed?tab=for_you').set(b.auth).expect(200)).body.items.find((x: { id: string }) => x.id === post.id);
    expect(feed).toBeDefined();
    expect(feed.usedProducts).toBeUndefined();
    const visitor = (await h.http().get('/v1/public/feed').expect(200)).body.items.find((x: { id: string }) => x.id === post.id);
    expect(visitor.usedProducts).toBeUndefined();

    // Modifier la liste : remplacement, 5 au plus, liste vide pour tout retirer.
    const more = [await product(s, 'Gourde'), await product(s, 'Serviette'), await product(s, 'Bandeau'), await product(s, 'Short')];
    expect((await set(a.auth, post.id, [...more, robe])).body.usedProducts).toHaveLength(5);
    await set(a.auth, post.id, [...more, robe, tapis], 400);
    expect((await set(a.auth, post.id, [])).body.usedProducts).toEqual([]);
    expect((await set(a.auth, post.id, [tapis])).body.usedProducts.map((p: { id: string }) => p.id)).toEqual([tapis]);
    // Seul l'auteur ; une publication simple n'a pas de produits utilisés.
    await set(b.auth, post.id, [robe], 404);
    const simple = (await h.http().post('/v1/posts').set(a.auth).field('text', 'Bonjour').expect(201)).body;
    expect((await set(a.auth, simple.id, [robe], 409)).body.error.code).toBe('NOT_A_BIM');
    expect((await detail(b.auth, simple.id)).usedProducts).toEqual([]);
    // Modifications simultanées : jamais plus de 5 lignes ni de doublon de position.
    await Promise.all([set(a.auth, post.id, more), set(a.auth, post.id, [robe, tapis]), set(a.auth, post.id, [...more.slice(0, 2), robe])]);
    const rows = (await h.pool.query('select position from post_products where post_id = $1 order by position', [post.id])).rows.map((r: { position: number }) => r.position);
    expect(rows).toEqual([...Array(rows.length).keys()]);
    // Réputation de l'article inchangée : aucun cœur ni avis créé.
    expect((await h.pool.query('select count(*)::int as n from product_favorites where product_id = $1', [robe])).rows[0].n).toBe(0);
    expect((await h.pool.query('select count(*)::int as n from reviews where product_id = $1', [robe])).rows[0].n).toBe(0);
  });

  it('fiche masquée, retirée, boutique fermée ou blocage : omise sans rien dévoiler ; publication masquée ou privée : rien', async () => {
    const s = await shop('Maison Awa');
    const p1 = await product(s, 'Crème');
    const p2 = await product(s, 'Huile');
    const p3 = await product(s, 'Savon');
    const other = await shop('Autre boutique');
    const p4 = await product(other, 'Brosse');
    const a = await user();
    const b = await user();
    const post = await bim(a, { productIds: [p1, p2, p3, p4] });

    await h.http().post(`/v1/shop/products/${p1}/hide`).set(s.auth).expect(200); // « Visible par moi uniquement »
    await h.http().post(`/v1/shop/products/${p2}/unpublish`).set(s.auth).expect(200);
    const ids = async (auth: Auth) => (await detail(auth, post.id)).usedProducts.map((p: { id: string }) => p.id);
    expect(await ids(b.auth)).toEqual([p3, p4]);
    // L'article réapparaît s'il est de nouveau en ligne (le lien est conservé).
    await h.http().post(`/v1/shop/products/${p1}/show`).set(s.auth).expect(200);
    expect(await ids(b.auth)).toEqual([p1, p3, p4]);
    // Boutique fermée : ses articles disparaissent.
    await h.pool.query("update shops set status = 'suspended' where id = $1", [other.shopId]);
    expect(await ids(b.auth)).toEqual([p1, p3]);
    // Blocage entre le lecteur et le propriétaire de la boutique : ses articles sont omis pour ce lecteur seulement.
    await h.http().put(`/v1/people/${s.owner.username}/block`).set(b.auth).expect(200);
    expect(await ids(b.auth)).toEqual([]);
    expect(await ids(a.auth)).toEqual([p1, p3]);
    // L'auteur ne peut pas associer un article d'une boutique dont le propriétaire l'a bloqué.
    await h.http().put(`/v1/people/${a.username}/block`).set(s.owner.auth).expect(200);
    await set(a.auth, post.id, [p3], 400);
    expect(await ids(a.auth)).toEqual([]);

    // Publication privée : invisible pour les autres, ses produits aussi.
    // (la boutique d'Autre étant fermée, son article n'est plus associable : une troisième boutique sert ici)
    const third = await shop('Troisième');
    const p5 = await product(third, 'Bouteille');
    await bim(a, { visibility: 'private', productIds: [p4] }, 400);
    const priv = await bim(a, { visibility: 'private', productIds: [p5] });
    expect((await detail(a.auth, priv.id)).usedProducts.map((p: { id: string }) => p.id)).toEqual([p5]);
    await detail(b.auth, priv.id, 404);
    // Publication masquée par la modération : introuvable, l'auteur ne la modifie plus.
    await h.pool.query("update posts set status = 'hidden' where id = $1", [priv.id]);
    await set(a.auth, priv.id, [], 404);
    // Publication supprimée : ses liens disparaissent avec elle.
    await h.http().delete(`/v1/posts/${post.id}`).set(a.auth).expect(204);
    expect((await h.pool.query('select count(*)::int as n from post_products where post_id = $1', [post.id])).rows[0].n).toBe(0);
  });
});
