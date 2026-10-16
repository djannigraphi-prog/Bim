import sharp from 'sharp';
import { StorageService } from '../src/modules/media/storage';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 5-A — Ouvrir une boutique (écrans 07 à 09) : demande, pièces chiffrées, numéro Mobile Money, vérification. */
describe('Marchands : ouverture de boutique (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function setAge(value: number | null, status = 'decided') {
    await h.pool.query("update app_settings set value = $1::jsonb, decision_status = $2 where key = 'age.min_merchant'", [JSON.stringify(value), status]);
    h.settings.invalidate();
  }
  async function user(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  const jpeg = () =>
    sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 20, g: 120, b: 200 } } })
      .withMetadata({ exif: { IFD0: { Copyright: 'pièce' } } })
      .jpeg()
      .toBuffer();
  const upload = async (auth: Record<string, string>, id: string, kind: string, status = 200) =>
    (await h.http().put(`/v1/merchant/applications/${id}/documents/${kind}`).set(auth).attach('photo', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' }).expect(status)).body;

  afterEach(() => setAge(null, 'pending'));

  it('fermé tant que l’âge minimum des marchands n’est pas décidé (F15) ; puis réservé aux personnes assez âgées', async () => {
    const u = await user();
    const r = await h.http().post('/v1/merchant/applications').set(u.auth).send({ name: 'Ma boutique', city: 'Abidjan' }).expect(503);
    expect(r.body.error).toMatchObject({ code: 'RULE_NOT_DECIDED', details: { rule: 'age.min_merchant' } });
    await setAge(25);
    const young = await user({ birthDate: '2004-01-01' });
    expect((await h.http().post('/v1/merchant/applications').set(young.auth).send({ name: 'Ma boutique', city: 'Abidjan' }).expect(403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');
    expect((await h.http().get('/v1/merchant/applications/mine').set(u.auth).expect(200)).body).toEqual({ application: null, available: true });
  });

  it('parcours complet : boutique, pièces chiffrées, Mobile Money confirmé par SMS, envoi ; refus motivé, correction, validation', async () => {
    await setAge(18);
    const u = await user();
    let app = (await h.http().post('/v1/merchant/applications').set(u.auth).send({ name: 'Boutique Élégance', city: 'Abidjan', commune: 'Cocody', description: 'Robes de soirée' }).expect(201)).body.application;
    expect(app).toMatchObject({ status: 'draft', shop: { name: 'Boutique Élégance', status: 'draft', commune: 'Cocody' }, ready: false });
    // Une seule demande en cours.
    expect((await h.http().post('/v1/merchant/applications').set(u.auth).send({ name: 'Autre', city: 'Abidjan' }).expect(409)).body.error.code).toBe('APPLICATION_IN_PROGRESS');
    // Une boutique en préparation n'est pas utilisable comme espace.
    const spaces = (await h.http().get('/v1/me/spaces').set(u.auth).expect(200)).body.items;
    expect(spaces.find((s: { type: string }) => s.type === 'merchant')).toMatchObject({ status: 'draft', usable: false });

    // Envoi incomplet refusé, avec ce qui manque.
    const missing = (await h.http().post(`/v1/merchant/applications/${app.id}/submit`).set(u.auth).expect(400)).body.error.details.fields;
    expect(Object.keys(missing).sort()).toEqual(['identity', 'payout', 'selfie']);

    // Pièce d'identité (CNI : recto et verso) et selfie : chiffrés dans le stockage, jamais en clair.
    await h.http().patch(`/v1/merchant/applications/${app.id}`).set(u.auth).send({ idDocType: 'cni', address: 'Cocody, Riviera 3' }).expect(200);
    await upload(u.auth, app.id, 'id_front');
    app = (await upload(u.auth, app.id, 'selfie')).application;
    expect(app.checklist).toMatchObject({ identity: false, selfie: true, address: true });
    app = (await upload(u.auth, app.id, 'id_back')).application;
    expect(app.checklist.identity).toBe(true);
    await upload(u.auth, app.id, 'passeport', 400);
    await h.http().put(`/v1/merchant/applications/${app.id}/documents/selfie`).set(u.auth).attach('photo', Buffer.from('%PDF'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
    const stored = (await h.pool.query('select storage_key from merchant_documents d join merchant_applications a on a.id = d.application_id where a.id = $1', [app.id])).rows;
    expect(stored).toHaveLength(3);
    for (const { storage_key } of stored) {
      const raw = await h.app.get(StorageService).read(storage_key);
      expect(raw[0]).toBe(1); // version du format chiffré
      expect(raw.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false); // pas d'en-tête JPEG en clair
    }

    // Numéro Mobile Money : code SMS ; un mauvais code est refusé ; le numéro n'est rappelé que masqué.
    const start = (await h.http().post(`/v1/merchant/applications/${app.id}/payout-number`).set(u.auth).send({ phone: '0701020304', operator: 'wave' }).expect(201)).body;
    await h.http().post(`/v1/merchant/applications/${app.id}/payout-number/verify`).set(u.auth).send({ challengeId: start.challenge.challengeId, code: '000000' }).expect(400);
    const code = h.lastCodeFor('+2250701020304');
    app = (await h.http().post(`/v1/merchant/applications/${app.id}/payout-number/verify`).set(u.auth).send({ challengeId: start.challenge.challengeId, code }).expect(200)).body.application;
    expect(app.payout).toEqual({ operator: 'wave', phoneEnd: '04', verified: true });
    expect(app.ready).toBe(true);

    // Une autre personne ne voit ni ne modifie la demande.
    const other = await user();
    await h.http().patch(`/v1/merchant/applications/${app.id}`).set(other.auth).send({ name: 'Piratage' }).expect(404);
    await upload(other.auth, app.id, 'selfie', 404);

    app = (await h.http().post(`/v1/merchant/applications/${app.id}/submit`).set(u.auth).expect(200)).body.application;
    expect(app).toMatchObject({ status: 'submitted', shop: { status: 'pending_verification' } });
    expect((await h.http().patch(`/v1/merchant/applications/${app.id}`).set(u.auth).send({ name: 'Nouveau nom' }).expect(409)).body.error.code).toBe('APPLICATION_LOCKED');

    // Administration : support autorisé, commercial refusé ; pièces déchiffrées pour l'équipe, lecture journalisée.
    const support = await adminSession(h, ['support']);
    const commercial = await adminSession(h, ['commercial']);
    await h.http().get('/admin/v1/merchant-applications').set(commercial).expect(403);
    const list = (await h.http().get('/admin/v1/merchant-applications').set(support).expect(200)).body.items;
    expect(list.find((x: { id: string }) => x.id === app.id)).toMatchObject({ shopName: 'Boutique Élégance', idDocType: 'cni', payoutOperator: 'wave', payoutVerified: true });
    const detail = (await h.http().get(`/admin/v1/merchant-applications/${app.id}`).set(support).expect(200)).body;
    expect(detail.payout).toEqual({ operator: 'wave', phone: '+2250701020304', verified: true });
    expect(detail.person).toMatchObject({ username: u.me.username, birthDate: '1998-03-12' });
    const img = await h.http().get(`/admin/v1/merchant-applications/${app.id}/documents/selfie`).set(support).expect(200);
    expect(img.headers['content-type']).toContain('image/jpeg');
    expect(img.headers['cache-control']).toBe('no-store');
    expect((await sharp(img.body).metadata()).exif).toBeUndefined(); // métadonnées supprimées avant chiffrement
    await h.http().get(`/admin/v1/merchant-applications/${app.id}/documents/selfie`).expect(401);
    const views = (await h.pool.query("select count(*)::int as n from audit_logs where action = 'admin.kyc_document_viewed' and target_id = $1", [app.id])).rows[0].n;
    expect(views).toBe(1);

    // Refus motivé : la personne voit le motif, corrige et renvoie.
    await h.http().post(`/admin/v1/merchant-applications/${app.id}/reject`).set(support).send({ reason: 'Le selfie est flou, merci de le refaire.' }).expect(200);
    app = (await h.http().get('/v1/merchant/applications/mine').set(u.auth).expect(200)).body.application;
    expect(app).toMatchObject({ status: 'rejected', rejectionReason: 'Le selfie est flou, merci de le refaire.', shop: { status: 'draft' } });
    await upload(u.auth, app.id, 'selfie');
    await h.http().post(`/v1/merchant/applications/${app.id}/submit`).set(u.auth).expect(200);
    await h.http().post(`/admin/v1/merchant-applications/${app.id}/approve`).set(support).expect(200);
    await h.http().post(`/admin/v1/merchant-applications/${app.id}/approve`).set(support).expect(409);

    // Boutique ouverte : espace marchand utilisable ; notification de la décision.
    app = (await h.http().get('/v1/merchant/applications/mine').set(u.auth).expect(200)).body.application;
    expect(app).toMatchObject({ status: 'approved', shop: { status: 'active' } });
    const s2 = (await h.http().get('/v1/me/spaces').set(u.auth).expect(200)).body.items;
    expect(s2.find((s: { type: string }) => s.type === 'merchant')).toMatchObject({ label: 'Boutique Élégance', status: 'active', usable: true });
    const inbox = (await h.http().get('/v1/me/notifications?category=support').set(u.auth).expect(200)).body.items;
    // Notifications lues dans l'état actuel de la demande : après validation, seule la validation apparaît.
    expect(inbox.map((i: { type: string }) => i.type)).toEqual(['merchant_approved']);
    expect(inbox[0]).toMatchObject({ text: 'Ta boutique « Boutique Élégance » est validée par l’équipe BIM. Bienvenue parmi les marchands !', link: '/merchant/apply' });
    const audit = (await h.pool.query("select action from audit_logs where action like 'admin.merchant_%' and target_id = (select shop_id from merchant_applications where id = $1) order by created_at", [app.id])).rows.map((r: { action: string }) => r.action);
    expect(audit).toEqual(['admin.merchant_rejected', 'admin.merchant_approved']);
  });

  it('abandonner une demande : boutique fermée, pièces effacées du stockage ; nouvelle demande possible', async () => {
    await setAge(18);
    const u = await user();
    const app = (await h.http().post('/v1/merchant/applications').set(u.auth).send({ name: 'Essai', city: 'Bouaké' }).expect(201)).body.application;
    await upload(u.auth, app.id, 'selfie');
    const [{ storage_key }] = (await h.pool.query('select storage_key from merchant_documents where application_id = $1', [app.id])).rows;
    await h.http().delete(`/v1/merchant/applications/${app.id}`).set(u.auth).expect(204);
    await expect(h.app.get(StorageService).read(storage_key)).rejects.toBeTruthy();
    expect((await h.pool.query('select status from shops where id = $1', [app.shop.id])).rows[0].status).toBe('closed');
    await h.http().post('/v1/merchant/applications').set(u.auth).send({ name: 'Deuxième essai', city: 'Bouaké' }).expect(201);
  });
});
