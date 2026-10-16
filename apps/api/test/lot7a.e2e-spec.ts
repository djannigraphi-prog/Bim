import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Lot 7-A — Références des articles (A13), réputation liée au contenu réellement évalué (nouvelle règle du
 * 16/10/2026), masquer / republier, équipe de la boutique et permissions séparées (A16).
 */
describe('Lot 7-A : références, réputation, équipe (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.pool.query("update app_settings set value = 'null'::jsonb, decision_status = 'pending' where key = 'age.min_merchant'");
    h.settings.invalidate();
    await h.close();
  });

  type Auth = Record<string, string>;
  const jpeg = (r = 120) => sharp({ create: { width: 400, height: 400, channels: 3, background: { r, g: 60, b: 90 } } }).jpeg().toBuffer();

  async function shop(name = 'Boutique Élégance') {
    const owner = await registerAndActivate(h);
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, $3, $4, 'active', 'Abidjan')", [shopId, owner.userId, name, `r-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const user = bearer(owner.tokens.accessToken) as Auth;
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(user).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    return { shopId, ownerId: owner.userId, user, auth };
  }
  type S = Awaited<ReturnType<typeof shop>>;
  async function client() {
    const u = await registerAndActivate(h);
    return { ...u, username: u.body.username as string, auth: bearer(u.tokens.accessToken) as Auth };
  }
  async function staff(s: S, permissions: string[]) {
    const u = await registerAndActivate(h);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s.shopId, u.userId]);
    for (const p of permissions) await h.pool.query('insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, $3)', [s.shopId, u.userId, p]);
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(u.tokens.accessToken)).send({ type: 'merchant', id: s.shopId }).expect(200)).body.accessToken) as Auth;
    return { userId: u.userId, auth };
  }
  async function published(s: S, title = 'Robe soirée à plumes', price = 45000) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title, categoryCode: 'vetements_soiree', priceFcfa: price }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    return p as { id: string; reference: string };
  }
  const detail = async (s: S, id: string) => (await h.http().get(`/v1/shop/products/${id}`).set(s.auth).expect(200)).body;
  const heart = (c: { auth: Auth }, id: string) => h.http().put(`/v1/bimshop/products/${id}/favorite`).set(c.auth).expect(200);
  const hearted = async (c: { auth: Auth }, id: string) => (await h.http().get(`/v1/bimshop/products/${id}/me`).set(c.auth).expect(200)).body.favorite as boolean;
  const favoritesList = async (c: { auth: Auth }) => ((await h.http().get('/v1/bimshop/favorites').set(c.auth).expect(200)).body.items as { id: string }[]).map((p) => p.id);

  it('références : attribuées par le serveur dès le brouillon, uniques sous créations simultanées, immuables, jamais réattribuées', async () => {
    const s = await shop();
    // L'app ne peut pas fournir de référence (champ refusé) : seule la base l'attribue.
    await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Sac perlé', categoryCode: 'vetements_soiree', priceFcfa: 9000, reference: 'BIM-000001' }).expect(400);
    const draft = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Sac perlé', categoryCode: 'vetements_soiree', priceFcfa: 9000 }).expect(201)).body;
    expect(draft.reference).toMatch(/^BIM-\d{6,}$/);
    expect(draft.status).toBe('draft');

    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) => h.http().post('/v1/shop/products').set(s.auth).send({ title: `Article ${i}`, categoryCode: 'vetements_soiree', priceFcfa: 1000 + i })),
    );
    const refs = created.map((r) => r.body.reference as string);
    expect(new Set([...refs, draft.reference]).size).toBe(9);

    // Immuable, même par une requête directe en base.
    await expect(h.pool.query("update products set reference = 'BIM-999999' where id = $1", [draft.id])).rejects.toThrow(/ne peut pas être modifiée/);
    // Un article retiré garde sa référence ; la suivante est nouvelle.
    await h.http().delete(`/v1/shop/products/${draft.id}`).set(s.auth).expect(204);
    const after = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Après retrait', categoryCode: 'vetements_soiree', priceFcfa: 5000 }).expect(201)).body;
    const num = (r: string) => Number(r.slice(4));
    expect(num(after.reference)).toBeGreaterThan(Math.max(...[...refs, draft.reference].map(num)));
    expect((await h.pool.query('select reference from products where id = $1', [draft.id])).rows[0].reference).toBe(draft.reference);
    // Format au-delà de 999 999 : jamais tronqué.
    expect((await h.pool.query('select bim_product_reference(1234567) as r, bim_product_reference(42) as s')).rows[0]).toEqual({ r: 'BIM-1234567', s: 'BIM-000042' });

    // Visible sur le BimShop (fiche et liste) et dans l'espace boutique.
    const p = await published(s, 'Robe référencée');
    expect((await h.http().get(`/v1/bimshop/products/${p.id}`).expect(200)).body.reference).toBe(p.reference);
    const cards = (await h.http().get('/v1/bimshop/products?q=Robe%20référencée').expect(200)).body.items;
    expect(cards[0].reference).toBe(p.reference);
    expect((await h.http().get('/v1/shop/products').set(s.auth).expect(200)).body.items.find((x: { id: string }) => x.id === p.id).reference).toBe(p.reference);
  });

  it('L7-04 — photo et promotion : réputation conservée ; nom, description, prix normal : refusés (nouvelle fiche)', async () => {
    const s = await shop();
    const p = await published(s, 'Robe soirée à plumes', 60000);
    const a = await client();
    const b = await client();
    await heart(a, p.id);
    await heart(b, p.id);
    expect((await detail(s, p.id)).activeFavorites).toBe(2);

    // Photo seule (ajout puis retrait) : réputation conservée.
    const withPhoto = (await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(30), 'b.jpg').expect(201)).body;
    await h.http().delete(`/v1/shop/products/${p.id}/photos/${withPhoto.photos[0].id}`).set(s.auth).expect(200);
    let d = await detail(s, p.id);
    expect(d).toMatchObject({ contentVersion: 1, activeFavorites: 2, reference: p.reference });
    expect(await hearted(a, p.id)).toBe(true);

    // Promotion activée, modifiée puis supprimée : réputation conservée, prix normal intact, journal avant / après.
    d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ promoPriceFcfa: 45000 }).expect(200)).body;
    expect(d).toMatchObject({ normalPriceFcfa: 60000, promoPriceFcfa: 45000, priceFcfa: 45000, compareAtFcfa: 60000, activeFavorites: 2, contentVersion: 1 });
    expect((await h.http().get(`/v1/bimshop/products/${p.id}`).expect(200)).body).toMatchObject({ priceFcfa: 45000, compareAtFcfa: 60000 });
    d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ promoPriceFcfa: 40000 }).expect(200)).body;
    expect(d).toMatchObject({ promoPriceFcfa: 40000, activeFavorites: 2 });
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ promoPriceFcfa: 60000 }).expect(400); // pas au-dessus du prix normal
    d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ promoPriceFcfa: null }).expect(200)).body;
    expect(d).toMatchObject({ normalPriceFcfa: 60000, promoPriceFcfa: null, priceFcfa: 60000, compareAtFcfa: null, activeFavorites: 2, contentVersion: 1 });
    expect(await hearted(b, p.id)).toBe(true);
    const promos = (await h.pool.query("select metadata from audit_logs where action = 'shop.product_promotion_changed' and target_id = $1 order by created_at", [p.id])).rows.map((r: { metadata: unknown }) => r.metadata);
    expect(promos).toEqual([
      expect.objectContaining({ reference: p.reference, before: null, after: 45000 }),
      expect.objectContaining({ before: 45000, after: 40000 }),
      expect.objectContaining({ before: 40000, after: null }),
    ]);

    // Nom, description, prix normal : refusés, rien n'est enregistré (même combinés avec une promotion).
    for (const body of [{ title: 'Chaussures cuir' }, { description: 'Autre produit' }, { priceFcfa: 30000 }, { title: 'Chaussures cuir', promoPriceFcfa: 20000 }]) {
      const r = await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send(body).expect(409);
      expect(r.body.error.code).toBe('PRODUCT_CONTENT_LOCKED');
    }
    // L'ancienne demande de « remise à zéro » n'existe plus : champ refusé.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Chaussures cuir', confirmReputationReset: true }).expect(400);
    d = await detail(s, p.id);
    expect(d).toMatchObject({ title: 'Robe soirée à plumes', normalPriceFcfa: 60000, promoPriceFcfa: null, activeFavorites: 2, contentVersion: 1, reference: p.reference });
    // Renvoyer les mêmes valeurs n'est pas une modification.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Robe soirée à plumes', priceFcfa: 60000 }).expect(200);
    // Même en contournant l'API, la base refuse.
    await expect(h.pool.query("update products set title = 'Autre' where id = $1", [p.id])).rejects.toThrow(/ne se modifient pas/);
    await expect(h.pool.query('update products set price_fcfa = 1 where id = $1', [p.id])).rejects.toThrow(/ne se modifient pas/);

    // Article publié : rubrique et variantes figées aussi ; l'ordre des variantes et le stock restent libres.
    expect((await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ categoryCode: 'accessoires_sacs' }).expect(409)).body.error.details.fields).toEqual(['categoryCode']);
    expect((await h.http().put(`/v1/shop/products/${p.id}/variants`).set(s.auth).send({ labels: ['S', 'M'] }).expect(409)).body.error.details.fields).toEqual(['variants']);
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants`).set(s.auth).send({ labels: ['Unique'] }).expect(200)).body;
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants/${d.variants[0].id}/stock`).set(s.auth).send({ quantity: 4 }).expect(200)).body;
    expect(d).toMatchObject({ contentVersion: 1, activeFavorites: 2 });

    // Nouvelle fiche pour un autre produit : nouvelle référence, réputation vierge ; l'ancienne fiche est intacte.
    const other = await published(s, 'Chaussures cuir', 30000);
    expect(other.reference).not.toBe(p.reference);
    expect(await detail(s, other.id)).toMatchObject({ reference: other.reference, contentVersion: 1, activeFavorites: 0 });
    expect(await hearted(a, other.id)).toBe(false);
    expect(await detail(s, p.id)).toMatchObject({ title: 'Robe soirée à plumes', activeFavorites: 2 });
  });

  it('fiche jamais publiée : nom, description, prix normal figés dès la création ; rubrique, durée et variantes encore réglables', async () => {
    const s = await shop();
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Brouillon', categoryCode: 'vetements_soiree', priceFcfa: 1000 }).expect(201)).body;
    expect((await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Brouillon renommé' }).expect(409)).body.error).toMatchObject({ code: 'PRODUCT_CONTENT_LOCKED', details: { fields: ['title'] } });
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ priceFcfa: 2000 }).expect(409);
    let d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ categoryCode: 'accessoires_sacs', promoPriceFcfa: 800 }).expect(200)).body;
    expect(d).toMatchObject({ title: 'Brouillon', categoryCode: 'accessoires_sacs', normalPriceFcfa: 1000, promoPriceFcfa: 800, reference: p.reference });
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants`).set(s.auth).send({ labels: ['S', 'M'] }).expect(200)).body;
    expect(d.variants.map((v: { label: string }) => v.label)).toEqual(['S', 'M']);
    const svc = (await h.http().post('/v1/shop/products').set(s.auth).send({ kind: 'service', title: 'Tresses', categoryCode: 'services', priceFcfa: 15000, durationMinutes: 120 }).expect(201)).body;
    expect((await h.http().patch(`/v1/shop/products/${svc.id}`).set(s.auth).send({ durationMinutes: 180 }).expect(200)).body.durationMinutes).toBe(180);
  });

  it('masquer et republier : invisible publiquement, réputation et référence conservées', async () => {
    const s = await shop();
    const p = await published(s);
    const a = await client();
    await heart(a, p.id);
    // Un brouillon ne se masque ni ne se « republie » (il se publie) ; republier un article visible est sans effet.
    const draft = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Jamais publié', categoryCode: 'vetements_soiree', priceFcfa: 1000 }).expect(201)).body;
    expect((await h.http().post(`/v1/shop/products/${draft.id}/hide`).set(s.auth).expect(409)).body.error.code).toBe('INVALID_PRODUCT_STATUS');
    expect((await h.http().post(`/v1/shop/products/${draft.id}/show`).set(s.auth).expect(409)).body.error.code).toBe('INVALID_PRODUCT_STATUS');
    expect((await h.http().post(`/v1/shop/products/${p.id}/show`).set(s.auth).expect(200)).body).toMatchObject({ status: 'published', contentVersion: 1 });

    let d = (await h.http().post(`/v1/shop/products/${p.id}/hide`).set(s.auth).expect(200)).body;
    expect(d).toMatchObject({ status: 'hidden', reference: p.reference, contentVersion: 1, activeFavorites: 1 });
    await h.http().get(`/v1/bimshop/products/${p.id}`).expect(404);
    expect(await favoritesList(a)).not.toContain(p.id);
    expect((await h.http().get('/v1/shop/products?status=hidden').set(s.auth).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await h.http().get('/v1/shop').set(s.auth).expect(200)).body.counts).toMatchObject({ published: 0, hidden: 1, drafts: 1 });
    // Masquer de nouveau : sans effet.
    await h.http().post(`/v1/shop/products/${p.id}/hide`).set(s.auth).expect(200);

    d = (await h.http().post(`/v1/shop/products/${p.id}/show`).set(s.auth).expect(200)).body;
    expect(d).toMatchObject({ status: 'published', reference: p.reference, contentVersion: 1, activeFavorites: 1 });
    expect(await hearted(a, p.id)).toBe(true);
    expect(await favoritesList(a)).toContain(p.id);
    // L'ancien « unpublish » masque désormais (réputation conservée).
    d = (await h.http().post(`/v1/shop/products/${p.id}/unpublish`).set(s.auth).expect(200)).body;
    expect(d).toMatchObject({ status: 'hidden', activeFavorites: 1 });
    // Masqué : le nom reste figé ; la promotion se règle, sans toucher à la réputation.
    expect((await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Autre chose' }).expect(409)).body.error.code).toBe('PRODUCT_CONTENT_LOCKED');
    expect((await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ promoPriceFcfa: 30000 }).expect(200)).body).toMatchObject({ status: 'hidden', activeFavorites: 1 });
    expect((await h.pool.query('select count(*)::int n from audit_logs where target_id = $1 and action in ($2, $3)', [p.id, 'shop.product_hidden', 'shop.product_published'])).rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it('permissions séparées : rien par défaut, chaque action contrôlée par le serveur, mêmes règles de fiche', async () => {
    const s = await shop();
    const p = await published(s);
    const nobody = await staff(s, []);
    const editor = await staff(s, ['products.edit']);
    const publisher = await staff(s, ['products.publish']);
    const visibility = await staff(s, ['products.visibility']);

    // 9. Sans permission : lecture seule de la boutique, aucune modification.
    const dash = (await h.http().get('/v1/shop').set(nobody.auth).expect(200)).body;
    expect(dash.viewer).toEqual({ role: 'staff', permissions: [] });
    expect((await h.http().get('/v1/shop').set(s.auth).expect(200)).body.viewer).toEqual({ role: 'owner', permissions: [] });
    for (const [method, url] of [
      ['post', '/v1/shop/products'],
      ['patch', `/v1/shop/products/${p.id}`],
      ['put', `/v1/shop/products/${p.id}/variants`],
      ['post', `/v1/shop/products/${p.id}/hide`],
      ['post', `/v1/shop/products/${p.id}/publish`],
      ['delete', `/v1/shop/products/${p.id}`],
      ['patch', '/v1/shop'],
      ['get', '/v1/shop/inbox'],
      ['get', '/v1/shop/project-requests'],
      ['get', '/v1/shop/team'],
    ] as const) {
      const r = await h.http()[method](url).set(nobody.auth).send({ title: 'x', labels: ['A'] });
      expect([url, r.status, r.body.error?.code]).toEqual([url, 403, 'SHOP_PERMISSION_REQUIRED']);
    }
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(nobody.auth).attach('photos', await jpeg(), 'a.jpg').expect(403);

    // Éditeur : modifie, soumis au même avertissement ; ne publie, ne masque ni ne retire.
    // Éditeur : mêmes règles que le propriétaire (nom figé) ; il règle la promotion, journalisée à son nom.
    expect((await h.http().patch(`/v1/shop/products/${p.id}`).set(editor.auth).send({ title: 'Robe modifiée' }).expect(409)).body.error.code).toBe('PRODUCT_CONTENT_LOCKED');
    const d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(editor.auth).send({ promoPriceFcfa: 40000 }).expect(200)).body;
    expect(d).toMatchObject({ promoPriceFcfa: 40000, contentVersion: 1 });
    expect((await h.pool.query("select actor_id from audit_logs where action = 'shop.product_promotion_changed' and target_id = $1", [p.id])).rows[0].actor_id).toBe(editor.userId);
    await h.http().post(`/v1/shop/products/${p.id}/hide`).set(editor.auth).expect(403);
    await h.http().delete(`/v1/shop/products/${p.id}`).set(editor.auth).expect(403);
    // Masquer / republier : sa permission propre, sans pouvoir modifier.
    await h.http().post(`/v1/shop/products/${p.id}/hide`).set(visibility.auth).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/show`).set(visibility.auth).expect(200);
    await h.http().patch(`/v1/shop/products/${p.id}`).set(visibility.auth).send({ promoPriceFcfa: 1000 }).expect(403);
    // Publier n'autorise pas à modifier, ni à republier un article masqué (« masquer ou republier »), même par /publish.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(publisher.auth).send({ promoPriceFcfa: 1000 }).expect(403);
    await h.http().post(`/v1/shop/products/${p.id}/hide`).set(visibility.auth).expect(200);
    expect((await h.http().post(`/v1/shop/products/${p.id}/publish`).set(publisher.auth).expect(403)).body.error).toMatchObject({ code: 'SHOP_PERMISSION_REQUIRED', details: { permission: 'products.visibility' } });
    expect((await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200)).body.status).toBe('published');
    // Une autre boutique : introuvable.
    const other = await shop('Autre');
    await h.http().patch(`/v1/shop/products/${p.id}`).set(other.auth).send({ promoPriceFcfa: 1000 }).expect(404);
    // Espace utilisateur : refusé.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.user).send({ promoPriceFcfa: 1000 }).expect(403);
    // Permission retirée : effet immédiat (revérifiée à chaque requête).
    await h.pool.query('delete from shop_member_permissions where user_id = $1', [editor.userId]);
    await h.http().patch(`/v1/shop/products/${p.id}`).set(editor.auth).send({ promoPriceFcfa: 1000 }).expect(403);
  });

  it('équipe : invitation acceptée par la personne, permissions accordées et retirées par le propriétaire seul, journalisées', async () => {
    await h.pool.query("update app_settings set value = '18'::jsonb, decision_status = 'provisional' where key = 'age.min_merchant'");
    h.settings.invalidate();
    const s = await shop();
    const awa = await client();
    const minorBirth = new Date();
    minorBirth.setFullYear(minorBirth.getFullYear() - 17);
    const minor = await registerAndActivate(h, { birthDate: minorBirth.toISOString().slice(0, 10) });

    // Invitation : aucun accès avant l'accord.
    let team = (await h.http().post('/v1/shop/team').set(s.auth).send({ username: awa.username }).expect(201)).body;
    expect(team.items.find((m: { userId: string }) => m.userId === awa.userId)).toMatchObject({ role: 'staff', status: 'invited', permissions: [] });
    expect((await h.http().post('/v1/shop/team').set(s.auth).send({ username: awa.username }).expect(409)).body.error.code).toBe('ALREADY_MEMBER');
    expect((await h.http().post('/v1/shop/team').set(s.auth).send({ username: minor.body.username }).expect(403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');
    await h.http().post('/v1/auth/switch-space').set(awa.auth).send({ type: 'merchant', id: s.shopId }).expect(403);
    const spacesBefore = (await h.http().get('/v1/me/spaces').set(awa.auth).expect(200)).body;
    expect(JSON.stringify(spacesBefore)).not.toContain(s.shopId);

    // Acceptation par la personne.
    expect((await h.http().get('/v1/shop-invitations').set(awa.auth).expect(200)).body.items).toEqual([expect.objectContaining({ shop: expect.objectContaining({ id: s.shopId }) })]);
    await h.http().post(`/v1/shop-invitations/${s.shopId}/accept`).set(awa.auth).expect(200);
    await h.http().post(`/v1/shop-invitations/${s.shopId}/accept`).set(awa.auth).expect(404);
    const awaShop = bearer((await h.http().post('/v1/auth/switch-space').set(awa.auth).send({ type: 'merchant', id: s.shopId }).expect(200)).body.accessToken) as Auth;
    // Aucune permission par défaut.
    await h.http().post('/v1/shop/products').set(awaShop).send({ title: 'Essai', categoryCode: 'vetements_soiree', priceFcfa: 1000 }).expect(403);

    // Permissions : accordées par le propriétaire, journalisées avant / après.
    team = (await h.http().put(`/v1/shop/team/${awa.userId}/permissions`).set(s.auth).send({ permissions: ['products.edit', 'messages.reply'] }).expect(200)).body;
    expect(team.items.find((m: { userId: string }) => m.userId === awa.userId)).toMatchObject({ status: 'active', permissions: ['messages.reply', 'products.edit'] });
    await h.http().post('/v1/shop/products').set(awaShop).send({ title: 'Essai', categoryCode: 'vetements_soiree', priceFcfa: 1000 }).expect(201);
    await h.http().put(`/v1/shop/team/${awa.userId}/permissions`).set(s.auth).send({ permissions: ['encaisser.especes'] }).expect(400);
    // Un employé ne gère ni l'équipe ni ses propres permissions.
    await h.http().put(`/v1/shop/team/${awa.userId}/permissions`).set(awaShop).send({ permissions: ['payments.decide'] }).expect(403);
    await h.http().get('/v1/shop/team').set(awaShop).expect(403);
    // Le propriétaire ne se modifie pas lui-même.
    expect((await h.http().put(`/v1/shop/team/${s.ownerId}/permissions`).set(s.auth).send({ permissions: [] }).expect(409)).body.error.code).toBe('OWNER_IMMUTABLE');
    const log = await h.pool.query("select metadata from audit_logs where action = 'shop.member_permissions_changed' and target_id = $1", [awa.userId]);
    expect(log.rows[0].metadata).toMatchObject({ shopId: s.shopId, before: [], after: ['messages.reply', 'products.edit'] });

    // Retrait : accès et permissions supprimés immédiatement.
    await h.http().delete(`/v1/shop/team/${awa.userId}`).set(s.auth).expect(200);
    await h.http().get('/v1/shop').set(awaShop).expect(403);
    expect((await h.pool.query('select count(*)::int n from shop_member_permissions where user_id = $1', [awa.userId])).rows[0].n).toBe(0);

    // Réinvitée après son retrait : elle repart sans aucune permission.
    await h.http().post('/v1/shop/team').set(s.auth).send({ username: awa.username }).expect(201);
    await h.http().post(`/v1/shop-invitations/${s.shopId}/accept`).set(awa.auth).expect(200);
    expect((await h.http().get('/v1/shop/team').set(s.auth).expect(200)).body.items.find((m: { userId: string }) => m.userId === awa.userId)).toMatchObject({ status: 'active', permissions: [] });

    // Invitation refusée par la personne : permissions préparées effacées, aucun accès ; réinvitée, rien ne revient.
    const koffi = await client();
    await h.http().post('/v1/shop/team').set(s.auth).send({ username: koffi.username }).expect(201);
    await h.http().put(`/v1/shop/team/${koffi.userId}/permissions`).set(s.auth).send({ permissions: ['payments.decide'] }).expect(200);
    await h.http().post(`/v1/shop-invitations/${s.shopId}/decline`).set(koffi.auth).expect(200);
    expect((await h.pool.query('select count(*)::int n from shop_member_permissions where user_id = $1', [koffi.userId])).rows[0].n).toBe(0);
    expect((await h.http().get('/v1/shop-invitations').set(koffi.auth).expect(200)).body.items).toEqual([]);
    await h.http().post('/v1/auth/switch-space').set(koffi.auth).send({ type: 'merchant', id: s.shopId }).expect(403);
    await h.http().post('/v1/shop/team').set(s.auth).send({ username: koffi.username }).expect(201);
    expect((await h.http().get('/v1/shop/team').set(s.auth).expect(200)).body.items.find((m: { userId: string }) => m.userId === koffi.userId)).toMatchObject({ status: 'invited', permissions: [] });

    // Une invitation en attente ne permet pas de signaler les messages des clients de la boutique ; un employé non plus
    // sans « répondre aux messages ».
    const buyer = await client();
    const conv = (await h.http().post('/v1/conversations/shop').set(buyer.auth).send({ shopSlug: `r-${s.shopId}` }).expect(201)).body;
    const msg = (await h.http().post(`/v1/conversations/${conv.id}/messages`).set(buyer.auth).send({ text: 'Bonjour' }).expect(201)).body;
    await h.http().post('/v1/content-reports').set(koffi.auth).send({ targetType: 'message', targetId: msg.id, reason: 'spam' }).expect(404);
    await h.http().post('/v1/content-reports').set(awaShop).send({ targetType: 'message', targetId: msg.id, reason: 'spam' }).expect(404);
    await h.http().put(`/v1/shop/team/${awa.userId}/permissions`).set(s.auth).send({ permissions: ['messages.reply'] }).expect(200);
    await h.http().post('/v1/content-reports').set(awaShop).send({ targetType: 'message', targetId: msg.id, reason: 'spam' }).expect(201);
  });
});
