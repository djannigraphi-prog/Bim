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

  it('photo seule : réputation conservée ; contenu modifié : avertissement, annulation possible, puis remise à zéro', async () => {
    const s = await shop();
    const p = await published(s);
    const a = await client();
    const b = await client();
    await heart(a, p.id);
    await heart(b, p.id);
    expect((await detail(s, p.id)).activeFavorites).toBe(2);

    // 1. Photo seule (ajout puis retrait) : rien ne change.
    const withPhoto = (await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(30), 'b.jpg').expect(201)).body;
    await h.http().delete(`/v1/shop/products/${p.id}/photos/${withPhoto.photos[0].id}`).set(s.auth).expect(200);
    let d = await detail(s, p.id);
    expect(d).toMatchObject({ contentVersion: 1, activeFavorites: 2, reputationResetAt: null, reference: p.reference });
    expect(await hearted(a, p.id)).toBe(true);

    // 5. Modification non confirmée (annulation) : 409, rien n'est enregistré, réputation intacte.
    const warn = await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Chaussures cuir', priceFcfa: 30000 }).expect(409);
    expect(warn.body.error).toMatchObject({ code: 'REPUTATION_RESET_REQUIRED', details: { fields: ['title', 'priceFcfa'], activeFavorites: 2 } });
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Chaussures cuir', confirmReputationReset: false }).expect(409);
    d = await detail(s, p.id);
    expect(d).toMatchObject({ title: 'Robe soirée à plumes', priceFcfa: 45000, contentVersion: 1, activeFavorites: 2 });

    // Renvoyer les mêmes valeurs n'est pas une modification.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Robe soirée à plumes', priceFcfa: 45000 }).expect(200);
    expect((await detail(s, p.id)).contentVersion).toBe(1);

    // 2. Nom (et prix) confirmés : remise à zéro, trace conservée, référence stable (7).
    d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Chaussures cuir', priceFcfa: 30000, confirmReputationReset: true }).expect(200)).body;
    expect(d).toMatchObject({ title: 'Chaussures cuir', priceFcfa: 30000, contentVersion: 2, activeFavorites: 0, reference: p.reference });
    expect(d.reputationResetAt).toBeTruthy();
    expect(await hearted(a, p.id)).toBe(false);
    expect(await favoritesList(a)).not.toContain(p.id);
    // 8. Historique non corrompu : les anciens cœurs restent en base (inactifs), la version précédente est conservée.
    expect((await h.pool.query('select count(*)::int n from product_favorites where product_id = $1 and product_version = 1', [p.id])).rows[0].n).toBe(2);
    const rev = (await h.pool.query('select version, changed_fields, previous, changed_by from product_revisions where product_id = $1', [p.id])).rows;
    expect(rev).toEqual([{ version: 2, changed_fields: 'title,priceFcfa', previous: expect.objectContaining({ title: 'Robe soirée à plumes', priceFcfa: 45000 }), changed_by: s.ownerId }]);
    const audit = await h.pool.query("select metadata from audit_logs where action = 'shop.product_content_changed' and target_id = $1", [p.id]);
    expect(audit.rows[0].metadata).toMatchObject({ reference: p.reference, fields: ['title', 'priceFcfa'], version: 2, reputationReset: true });

    // Un nouveau cœur compte pour la nouvelle version.
    await heart(a, p.id);
    expect(await hearted(a, p.id)).toBe(true);
    expect((await detail(s, p.id)).activeFavorites).toBe(1);

    // 3. Prix seul : remise à zéro aussi.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ priceFcfa: 28000 }).expect(409);
    d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ priceFcfa: 28000, confirmReputationReset: true }).expect(200)).body;
    expect(d).toMatchObject({ contentVersion: 3, activeFavorites: 0 });

    // 4. Photo et contenu dans la même opération (l'app envoie la photo puis le contenu) : la remise à zéro s'applique.
    await heart(b, p.id);
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(200), 'c.jpg').expect(201);
    expect((await detail(s, p.id)).activeFavorites).toBe(1);
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ description: 'Cuir véritable' }).expect(409);
    d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ description: 'Cuir véritable', confirmReputationReset: true }).expect(200)).body;
    expect(d).toMatchObject({ contentVersion: 4, activeFavorites: 0, reference: p.reference });

    // Variantes : changer seulement l'ordre ne change rien ; ajouter une taille remet à zéro.
    await h.http().put(`/v1/shop/products/${p.id}/variants`).set(s.auth).send({ labels: ['S', 'M'] }).expect(409);
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants`).set(s.auth).send({ labels: ['S', 'M'], confirmReputationReset: true }).expect(200)).body;
    expect(d.contentVersion).toBe(5);
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants`).set(s.auth).send({ labels: ['M', 'S'] }).expect(200)).body;
    expect(d.contentVersion).toBe(5);
    // Le stock n'est pas le contenu : aucune remise à zéro.
    d = (await h.http().put(`/v1/shop/products/${p.id}/variants/${d.variants[0].id}/stock`).set(s.auth).send({ quantity: 4 }).expect(200)).body;
    expect(d.contentVersion).toBe(5);
    expect((await h.pool.query('select count(*)::int n from product_revisions where product_id = $1', [p.id])).rows[0].n).toBe(4);
  });

  it('brouillon jamais publié : modifications libres, sans avertissement ni remise à zéro', async () => {
    const s = await shop();
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Brouillon', categoryCode: 'vetements_soiree', priceFcfa: 1000 }).expect(201)).body;
    const d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Brouillon renommé', priceFcfa: 2000 }).expect(200)).body;
    expect(d).toMatchObject({ title: 'Brouillon renommé', contentVersion: 1, reference: p.reference });
    expect((await h.pool.query('select count(*)::int n from product_revisions where product_id = $1', [p.id])).rows[0].n).toBe(0);
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
    // Un article masqué modifié : avertissement aussi (il a déjà été publié).
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.auth).send({ title: 'Autre chose' }).expect(409);
    expect((await h.pool.query('select count(*)::int n from audit_logs where target_id = $1 and action in ($2, $3)', [p.id, 'shop.product_hidden', 'shop.product_published'])).rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it('permissions séparées : rien par défaut, chaque action contrôlée par le serveur, mêmes règles de réputation', async () => {
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
    await h.http().patch(`/v1/shop/products/${p.id}`).set(editor.auth).send({ title: 'Robe modifiée' }).expect(409);
    const d = (await h.http().patch(`/v1/shop/products/${p.id}`).set(editor.auth).send({ title: 'Robe modifiée', confirmReputationReset: true }).expect(200)).body;
    expect(d.contentVersion).toBe(2);
    expect((await h.pool.query('select changed_by from product_revisions where product_id = $1', [p.id])).rows[0].changed_by).toBe(editor.userId);
    await h.http().post(`/v1/shop/products/${p.id}/hide`).set(editor.auth).expect(403);
    await h.http().delete(`/v1/shop/products/${p.id}`).set(editor.auth).expect(403);
    // Masquer / republier : sa permission propre, sans pouvoir modifier.
    await h.http().post(`/v1/shop/products/${p.id}/hide`).set(visibility.auth).expect(200);
    await h.http().post(`/v1/shop/products/${p.id}/show`).set(visibility.auth).expect(200);
    await h.http().patch(`/v1/shop/products/${p.id}`).set(visibility.auth).send({ title: 'Non' }).expect(403);
    // Publier n'autorise pas à modifier.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(publisher.auth).send({ title: 'Non' }).expect(403);
    // Une autre boutique : introuvable.
    const other = await shop('Autre');
    await h.http().patch(`/v1/shop/products/${p.id}`).set(other.auth).send({ title: 'Vol', confirmReputationReset: true }).expect(404);
    // Espace utilisateur : refusé.
    await h.http().patch(`/v1/shop/products/${p.id}`).set(s.user).send({ title: 'Non' }).expect(403);
    // Permission retirée : effet immédiat (revérifiée à chaque requête).
    await h.pool.query('delete from shop_member_permissions where user_id = $1', [editor.userId]);
    await h.http().patch(`/v1/shop/products/${p.id}`).set(editor.auth).send({ title: 'Plus le droit', confirmReputationReset: true }).expect(403);
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

    // Invitation refusée par la personne.
    const koffi = await client();
    await h.http().post('/v1/shop/team').set(s.auth).send({ username: koffi.username }).expect(201);
    await h.http().post(`/v1/shop-invitations/${s.shopId}/decline`).set(koffi.auth).expect(200);
    expect((await h.http().get('/v1/shop-invitations').set(koffi.auth).expect(200)).body.items).toEqual([]);
    await h.http().post('/v1/auth/switch-space').set(koffi.auth).send({ type: 'merchant', id: s.shopId }).expect(403);
  });
});
