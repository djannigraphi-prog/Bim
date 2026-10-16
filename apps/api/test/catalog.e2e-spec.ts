import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { StorageService } from '../src/modules/media/storage';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 5-B — Espace marchand (écran 55) : boutique, articles, photos, variantes, stock. Aucun paiement. */
describe('Catalogue des boutiques (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  /** Boutique ouverte (lot 5-A validé) et jeton dans l'espace marchand. */
  async function merchant(status = 'active') {
    const u = await registerAndActivate(h);
    const shopId = uuidv7();
    await h.pool.query('insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, $3, $4, $5, $6)', [shopId, u.userId, 'Boutique Élégance', `elegance-${shopId}`, status, 'Abidjan']);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, u.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(bearer(u.tokens.accessToken)).send({ type: 'merchant', id: shopId });
    return { ...u, shopId, userAuth: bearer(u.tokens.accessToken), auth: sw.status === 200 ? bearer(sw.body.accessToken) : null, switchStatus: sw.status };
  }
  const jpeg = (r = 200) =>
    sharp({ create: { width: 800, height: 800, channels: 3, background: { r, g: 80, b: 120 } } })
      .withMetadata({ exif: { IFD0: { Copyright: 'boutique' } } })
      .jpeg()
      .toBuffer();
  const robe = { title: 'Robe soirée à plumes', categoryCode: 'vetements_soiree', priceFcfa: 60000, promoPriceFcfa: 45000, description: 'Taille ajustable' };

  it('rubriques publiques (écran 33) en arbre', async () => {
    const cats = (await h.http().get('/v1/shop-categories').expect(200)).body.items;
    expect(cats.map((c: { code: string }) => c.code)).toContain('vetements');
    const vet = cats.find((c: { code: string }) => c.code === 'vetements');
    expect(vet.children.map((c: { code: string }) => c.code)).toContain('vetements_soiree');
  });

  it('réservé à l’espace marchand actif : espace utilisateur refusé, boutique d’un autre inaccessible', async () => {
    const m = await merchant();
    await h.http().get('/v1/shop').set(m.userAuth).expect(403);
    // L'application sait dans quel espace elle se trouve (ouverture directe de l'espace marchand).
    expect((await h.http().get('/v1/me').set(m.auth!).expect(200)).body.activeSpace).toEqual({ type: 'merchant', id: m.shopId });
    expect((await h.http().get('/v1/me').set(m.userAuth).expect(200)).body.activeSpace).toEqual({ type: 'user', id: m.userId });
    const created = (await h.http().post('/v1/shop/products').set(m.auth!).send(robe).expect(201)).body;
    const other = await merchant();
    await h.http().get(`/v1/shop/products/${created.id}`).set(other.auth!).expect(404);
    await h.http().patch(`/v1/shop/products/${created.id}`).set(other.auth!).send({ priceFcfa: 1 }).expect(404);
    // Une boutique en préparation n'est pas un espace utilisable.
    expect((await merchant('draft')).switchStatus).toBe(403);
  });

  it('parcours écran 55 : article brouillon, photos sans métadonnées, publication, variantes et stock jamais négatif', async () => {
    const m = await merchant();
    // Règles de saisie.
    await h.http().post('/v1/shop/products').set(m.auth!).send({ ...robe, categoryCode: 'inconnue' }).expect(400);
    await h.http().post('/v1/shop/products').set(m.auth!).send({ ...robe, promoPriceFcfa: 70000 }).expect(400);
    await h.http().post('/v1/shop/products').set(m.auth!).send({ ...robe, priceFcfa: 0 }).expect(400);

    const p = (await h.http().post('/v1/shop/products').set(m.auth!).send(robe).expect(201)).body;
    expect(p).toMatchObject({ status: 'draft', priceFcfa: 45000, photos: [], variants: [{ label: 'Unique', stock: 0 }] });

    // Variantes (tailles) réglées avant la première publication (L7-04 : figées ensuite).
    const withSizes = (await h.http().put(`/v1/shop/products/${p.id}/variants`).set(m.auth!).send({ labels: ['S', 'M', 'L'] }).expect(200)).body;
    expect(withSizes.variants.map((v: { label: string }) => v.label)).toEqual(['S', 'M', 'L']);

    // Publication impossible sans photo.
    const noPhoto = (await h.http().post(`/v1/shop/products/${p.id}/publish`).set(m.auth!).expect(400)).body.error.details.fields;
    expect(Object.keys(noPhoto)).toEqual(['photos']);

    let d = (await h.http().post(`/v1/shop/products/${p.id}/photos`).set(m.auth!).attach('photos', await jpeg(), 'a.jpg').attach('photos', await jpeg(40), 'b.jpg').expect(201)).body;
    expect(d.photos).toHaveLength(2);
    const key = (await h.pool.query('select storage_key from product_media where product_id = $1 order by position limit 1', [p.id])).rows[0].storage_key;
    const meta = await sharp(await h.app.get(StorageService).read(key)).metadata();
    expect(meta.exif).toBeUndefined();
    // Pas plus de 6 photos ; un fichier qui n'est pas une image est refusé.
    const many = h.http().post(`/v1/shop/products/${p.id}/photos`).set(m.auth!);
    for (let i = 0; i < 5; i++) many.attach('photos', await jpeg(i * 10), `${i}.jpg`);
    await many.expect(400);
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(m.auth!).attach('photos', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);

    d = (await h.http().post(`/v1/shop/products/${p.id}/publish`).set(m.auth!).expect(200)).body;
    expect(d.status).toBe('published');
    expect(d.publishedAt).toBeTruthy();

    // Un article publié garde au moins une photo.
    await h.http().delete(`/v1/shop/products/${p.id}/photos/${d.photos[0].id}`).set(m.auth!).expect(200);
    const last = await h.http().delete(`/v1/shop/products/${p.id}/photos/${d.photos[1].id}`).set(m.auth!).expect(409);
    expect(last.body.error.code).toBe('LAST_PHOTO');

    // Article publié : ajouter ou retirer une taille est refusé (L7-04, nouvelle fiche), rien n'est enregistré ;
    // le stock par variante reste libre.
    const locked = await h.http().put(`/v1/shop/products/${p.id}/variants`).set(m.auth!).send({ labels: ['S', 'M', 'L', 'XL'] }).expect(409);
    expect(locked.body.error).toMatchObject({ code: 'PRODUCT_CONTENT_LOCKED', details: { fields: ['variants'] } });
    d = (await h.http().get(`/v1/shop/products/${p.id}`).set(m.auth!).expect(200)).body;
    expect(d.variants.map((v: { label: string }) => v.label)).toEqual(['S', 'M', 'L']);
    const vM = d.variants[1].id;
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants/${vM}/stock`).set(m.auth!).send({ quantity: 7 }).expect(200)).body;
    expect(d.variants[1].stock).toBe(7);
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants/${vM}/stock`).set(m.auth!).send({ quantity: 3 }).expect(200)).body;
    expect(d.variants[1].stock).toBe(3);
    const moves = (await h.pool.query('select delta, reason from inventory_movements where variant_id = $1 order by created_at', [vM])).rows;
    expect(moves).toEqual([{ delta: 7, reason: 'adjustment' }, { delta: -4, reason: 'adjustment' }]);
    await h.http().put(`/v1/shop/products/${p.id}/variants/${vM}/stock`).set(m.auth!).send({ quantity: -1 }).expect(400);
    // La base refuse elle-même un stock négatif.
    await expect(h.pool.query("insert into inventory_movements (id, variant_id, delta, reason) values ($1, $2, -10, 'sale')", [uuidv7(), vM])).rejects.toThrow();

    // Tableau de bord et liste.
    const dash = (await h.http().get('/v1/shop').set(m.auth!).expect(200)).body;
    expect(dash).toMatchObject({ name: 'Boutique Élégance', status: 'active' });
    const list = (await h.http().get('/v1/shop/products?status=published').set(m.auth!).expect(200)).body.items;
    expect(list).toEqual([expect.objectContaining({ id: p.id, stock: 3, imageUrl: expect.any(String) })]);

    // Retirer : photos effacées, l'article disparaît de la liste.
    await h.http().delete(`/v1/shop/products/${p.id}`).set(m.auth!).expect(204);
    expect((await h.http().get('/v1/shop/products').set(m.auth!).expect(200)).body.items).toEqual([]);
    expect((await h.pool.query('select count(*)::int as n from product_media where product_id = $1', [p.id])).rows[0].n).toBe(0);
  });

  it('prestation (service) : durée, pas de stock ; présentation de la boutique modifiable', async () => {
    const m = await merchant();
    const s = (await h.http().post('/v1/shop/products').set(m.auth!).send({ kind: 'service', title: 'Tresses africaines', categoryCode: 'services', priceFcfa: 15000, durationMinutes: 180 }).expect(201)).body;
    expect(s).toMatchObject({ kind: 'service', durationMinutes: 180, variants: [{ label: 'Unique', stock: null }] });
    const shop = (await h.http().patch('/v1/shop').set(m.auth!).send({ description: 'Robes et coiffure', commune: 'Cocody' }).expect(200)).body;
    expect(shop).toMatchObject({ description: 'Robes et coiffure', commune: 'Cocody' });
  });
});
