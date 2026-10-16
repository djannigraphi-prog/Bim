import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { CouriersService } from '../src/modules/couriers/couriers.service';
import { StorageService } from '../src/modules/media/storage';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

type Auth = Record<string, string>;

/**
 * Lot 7-E — Livreurs : demande vérifiée (pièces chiffrées, âge minimum), profil de travail, relations proposées par la
 * boutique et acceptées par le livreur, au plus un emploi actif, catégorie déduite de la relation active seulement.
 */
describe('Livreurs (e2e)', () => {
  let h: Harness;
  const city = `Liv${Date.now()}`;

  async function setAge(value: number | null, status = 'decided') {
    await h.pool.query("update app_settings set value = $1::jsonb, decision_status = $2 where key = 'age.min_courier'", [JSON.stringify(value), status]);
    h.settings.invalidate();
  }

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await setAge(null, 'pending');
    await h.close();
  });

  const jpeg = () =>
    sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 30, g: 90, b: 160 } } })
      .withMetadata({ exif: { IFD0: { Copyright: 'pièce' } } })
      .jpeg()
      .toBuffer();

  async function person(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, auth: bearer(u.tokens.accessToken) as Auth };
  }

  /** Livreur vérifié : demande complète, validée par l'équipe, jeton dans l'espace livreur. */
  async function courier(admin: Auth) {
    const u = await person();
    await h.http().post('/v1/courier-application').set(u.auth).expect(201);
    await h.http().patch('/v1/courier-application').set(u.auth).send({ idDocType: 'cni', vehicle: 'moto' }).expect(200);
    for (const kind of ['id_front', 'id_back', 'selfie']) await h.http().put(`/v1/courier-application/documents/${kind}`).set(u.auth).attach('photo', await jpeg(), 'p.jpg').expect(200);
    const app = (await h.http().post('/v1/courier-application/submit').set(u.auth).expect(200)).body.application;
    await h.http().post(`/admin/v1/courier-applications/${app.id}/approve`).set(admin).expect(200);
    const sw = await h.http().post('/v1/auth/switch-space').set(u.auth).send({ type: 'courier', id: app.id }).expect(200);
    return { ...u, courierId: app.id as string, space: bearer(sw.body.accessToken) as Auth };
  }

  async function shop(name = 'Boutique Élégance') {
    const owner = await person();
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city, commune) values ($1, $2, $3, $4, 'active', $5, 'Cocody')", [shopId, owner.userId, name, `liv-${shopId}`, city]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const sw = await h.http().post('/v1/auth/switch-space').set(owner.auth).send({ type: 'merchant', id: shopId }).expect(200);
    return { shopId, owner, auth: bearer(sw.body.accessToken) as Auth };
  }

  it('demande : âge minimum non décidé = fermé ; pièces chiffrées ; envoi complet ; refus motivé puis validation ; lecture journalisée', async () => {
    const u = await person();
    await setAge(null, 'pending');
    expect((await h.http().post('/v1/courier-application').set(u.auth).expect(503)).body.error.code).toBe('RULE_NOT_DECIDED');
    await setAge(18);
    const minor = await person({ birthDate: `${new Date().getFullYear() - 17}-01-01` });
    expect((await h.http().post('/v1/courier-application').set(minor.auth).expect(403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');

    let app = (await h.http().post('/v1/courier-application').set(u.auth).expect(201)).body.application;
    expect(app).toMatchObject({ stage: 'draft', checklist: { identity: false, selfie: false, details: false } });
    await h.http().post('/v1/courier-application').set(u.auth).expect(409);
    // Envoi incomplet refusé.
    expect((await h.http().post('/v1/courier-application/submit').set(u.auth).expect(400)).body.error.details.fields.checklist.sort()).toEqual(['details', 'identity', 'selfie']);
    await h.http().patch('/v1/courier-application').set(u.auth).send({ idDocType: 'cni', vehicle: 'fusée' }).expect(400);
    await h.http().patch('/v1/courier-application').set(u.auth).send({ idDocType: 'cni', vehicle: 'moto' }).expect(200);
    for (const kind of ['id_front', 'id_back', 'selfie']) app = (await h.http().put(`/v1/courier-application/documents/${kind}`).set(u.auth).attach('photo', await jpeg(), 'p.jpg').expect(200)).body.application;
    expect(app.checklist).toEqual({ identity: true, selfie: true, details: true });
    // Pièces chiffrées dans le stockage (aucun JPEG en clair).
    const keys = (await h.pool.query('select storage_key from courier_documents where courier_id = $1', [app.id])).rows;
    expect(keys).toHaveLength(3);
    for (const { storage_key } of keys) {
      const raw = await h.app.get(StorageService).read(storage_key);
      expect(raw[0]).toBe(1);
      expect(raw.subarray(0, 40).includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    }
    app = (await h.http().post('/v1/courier-application/submit').set(u.auth).expect(200)).body.application;
    expect(app.stage).toBe('submitted');
    await h.http().patch('/v1/courier-application').set(u.auth).send({ vehicle: 'velo' }).expect(409);
    // Compte non vérifié : pas d'espace livreur.
    await h.http().post('/v1/auth/switch-space').set(u.auth).send({ type: 'courier', id: app.id }).expect(403);

    // Administration : droits, lecture journalisée des pièces, refus motivé, correction, validation.
    const moderator = await adminSession(h, ['moderator']);
    await h.http().get('/admin/v1/courier-applications').set(moderator).expect(403);
    const support = await adminSession(h, ['support']);
    expect((await h.http().get('/admin/v1/courier-applications').set(support).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(app.id);
    const img = await h.http().get(`/admin/v1/courier-applications/${app.id}/documents/selfie`).set(support).expect(200);
    expect(img.headers['content-type']).toMatch(/image\/jpeg/);
    expect((await sharp(img.body).metadata()).exif).toBeUndefined();
    expect((await h.pool.query("select count(*)::int n from audit_logs where action = 'admin.courier_document_viewed' and target_id = $1", [app.id])).rows[0].n).toBe(1);
    await h.http().post(`/admin/v1/courier-applications/${app.id}/reject`).set(support).send({ reason: 'Selfie flou, merci de le refaire' }).expect(200);
    app = (await h.http().get('/v1/courier-application').set(u.auth).expect(200)).body.application;
    expect(app).toMatchObject({ stage: 'to_correct', rejectReason: 'Selfie flou, merci de le refaire' });
    await h.http().put('/v1/courier-application/documents/selfie').set(u.auth).attach('photo', await jpeg(), 'p.jpg').expect(200);
    await h.http().post('/v1/courier-application/submit').set(u.auth).expect(200);
    await h.http().post(`/admin/v1/courier-applications/${app.id}/approve`).set(support).expect(200);
    await h.http().post(`/admin/v1/courier-applications/${app.id}/approve`).set(support).expect(409);
    const sw = await h.http().post('/v1/auth/switch-space').set(u.auth).send({ type: 'courier', id: app.id }).expect(200);
    const me = (await h.http().get('/v1/courier/me').set(bearer(sw.body.accessToken)).expect(200)).body;
    expect(me).toMatchObject({ id: app.id, available: false, capacity: 1, vehicle: 'moto', communes: [], relations: [] });
  });

  it('profil de travail : disponibilité, capacité bornée, communes connues seulement', async () => {
    await setAge(18);
    const admin = await adminSession(h, ['super_admin']);
    const c = await courier(admin);
    const code = (await h.http().post('/admin/v1/delivery/communes').set(admin).send({ city, name: 'Cocody' }).expect(201)).body.items.find((x: { name: string; city: string }) => x.name === 'Cocody' && x.city === city).code;
    await h.http().patch('/v1/courier/me').set(c.space).send({ capacity: 50 }).expect(400);
    await h.http().patch('/v1/courier/me').set(c.space).send({ communes: ['nulle-part'] }).expect(400);
    const me = (await h.http().patch('/v1/courier/me').set(c.space).send({ available: true, capacity: 3, communes: [code, code] }).expect(200)).body;
    expect(me).toMatchObject({ available: true, capacity: 3, communes: [{ code, name: 'Cocody', city }] });
    // Depuis l'espace personnel : pas d'accès à l'espace livreur.
    await h.http().get('/v1/courier/me').set(c.auth).expect(403);
  });

  it('relations : proposées par la boutique, acceptées par le livreur ; un seul emploi ; fin immédiate ; catégorie déduite de la relation', async () => {
    await setAge(18);
    const admin = await adminSession(h, ['super_admin']);
    const c = await courier(admin);
    const s1 = await shop('Boutique Une');
    const s2 = await shop('Boutique Deux');
    const svc = h.app.get(CouriersService);

    // Permission « paramètres de livraison » pour un employé de la boutique.
    const staff = await person();
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s1.shopId, staff.userId]);
    const st = bearer((await h.http().post('/v1/auth/switch-space').set(staff.auth).send({ type: 'merchant', id: s1.shopId }).expect(200)).body.accessToken);
    await h.http().get('/v1/shop/couriers').set(st).expect(403);
    await h.http().post('/v1/shop/couriers').set(st).send({ username: c.body.username, relation: 'employee' }).expect(403);

    // Livreur inconnu ou non vérifié : refusé.
    const notCourier = await person();
    expect((await h.http().post('/v1/shop/couriers').set(s1.auth).send({ username: notCourier.body.username, relation: 'partner' }).expect(404)).body.error.code).toBe('COURIER_NOT_FOUND');
    let list = (await h.http().post('/v1/shop/couriers').set(s1.auth).send({ username: `@${c.body.username}`, relation: 'employee' }).expect(201)).body.items;
    expect(list).toEqual([expect.objectContaining({ username: c.body.username, relation: 'employee', status: 'pending', available: null })]);
    await h.http().post('/v1/shop/couriers').set(s1.auth).send({ username: c.body.username, relation: 'partner' }).expect(409);
    // Proposée mais pas acceptée : indépendant pour cette boutique.
    expect(await svc.category(c.courierId, s1.shopId)).toBe('independent');

    let me = (await h.http().get('/v1/courier/me').set(c.space).expect(200)).body;
    const r1 = me.relations[0];
    expect(r1).toMatchObject({ shop: { name: 'Boutique Une' }, relation: 'employee', status: 'pending' });
    me = (await h.http().post(`/v1/courier/relations/${r1.id}/accept`).set(c.space).expect(200)).body;
    expect(me.relations[0].status).toBe('active');
    expect(await svc.category(c.courierId, s1.shopId)).toBe('employee');
    expect(await svc.canCollectCash(c.courierId, s1.shopId)).toBe(true);

    // Second emploi : la boutique peut proposer, le livreur ne peut pas accepter tant que le premier dure.
    await h.http().post('/v1/shop/couriers').set(s2.auth).send({ username: c.body.username, relation: 'employee' }).expect(201);
    me = (await h.http().get('/v1/courier/me').set(c.space)).body;
    const r2 = me.relations.find((r: { shop: { name: string } }) => r.shop.name === 'Boutique Deux');
    expect((await h.http().post(`/v1/courier/relations/${r2.id}/accept`).set(c.space).expect(409)).body.error.code).toBe('ALREADY_EMPLOYED');
    // La base refuse aussi deux emplois actifs.
    await expect(h.pool.query("update courier_shop_partnerships set status = 'active' where id = $1", [r2.id])).rejects.toThrow();
    await h.http().post(`/v1/courier/relations/${r2.id}/decline`).set(c.space).expect(200);
    // Partenaire d'une autre boutique : catégorie « partenaire » là-bas seulement ; jamais d'espèces pour elle.
    await h.http().post('/v1/shop/couriers').set(s2.auth).send({ username: c.body.username, relation: 'partner' }).expect(201);
    me = (await h.http().get('/v1/courier/me').set(c.space)).body;
    const p2 = me.relations.find((r: { shop: { name: string }; status: string }) => r.shop.name === 'Boutique Deux' && r.status === 'pending');
    await h.http().post(`/v1/courier/relations/${p2.id}/accept`).set(c.space).expect(200);
    expect(await svc.category(c.courierId, s2.shopId)).toBe('partner');
    expect(await svc.canCollectCash(c.courierId, s2.shopId)).toBe(false);
    // L'ancien champ « peut encaisser » n'autorise jamais les espèces.
    await h.pool.query('update courier_shop_partnerships set can_collect_article_payment = true where id = $1', [p2.id]);
    expect(await svc.canCollectCash(c.courierId, s2.shopId)).toBe(false);

    // Fin de l'emploi par la boutique : effet immédiat.
    list = (await h.http().get('/v1/shop/couriers').set(s1.auth).expect(200)).body.items;
    expect(list).toEqual([expect.objectContaining({ relation: 'employee', status: 'active', available: false })]);
    await h.http().post(`/v1/shop/couriers/${list[0].id}/end`).set(s1.auth).expect(200);
    expect(await svc.category(c.courierId, s1.shopId)).toBe('independent');
    expect(await svc.canCollectCash(c.courierId, s1.shopId)).toBe(false);
    // Une autre boutique ne met pas fin aux relations d'autrui.
    await h.http().post(`/v1/shop/couriers/${p2.id}/end`).set(s1.auth).expect(404);
    // Compte livreur suspendu : plus aucune catégorie.
    await h.pool.query("update courier_accounts set status = 'suspended' where id = $1", [c.courierId]);
    expect(await svc.category(c.courierId, s2.shopId)).toBe('independent');
    // Toutes les étapes sont journalisées.
    const actions = (await h.pool.query("select action from audit_logs where action like 'courier.relation_%' or action = 'shop.courier_invited'")).rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['shop.courier_invited', 'courier.relation_accepted', 'courier.relation_declined', 'courier.relation_ended']));
  });
});
