import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Tests de non-régression de l'audit technique du 16/10/2026 (constats corrigés). */
describe('Audit technique : non-régression (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const jpeg = () => sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 90, g: 30, b: 160 } } }).jpeg().toBuffer();

  async function merchant(category = 'vetements_sport') {
    const u = await registerAndActivate(h);
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Audit Sport', $3, 'active', 'Abidjan')", [shopId, u.userId, `audit-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, u.userId]);
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(u.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken);
    const p = (await h.http().post('/v1/shop/products').set(auth).send({ title: 'Brassière audit', categoryCode: category, priceFcfa: 7000 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(auth).expect(200);
    return { ...u, shopId, auth, productId: p.id as string };
  }

  it('E-1 : la description privée d’un projet n’atteint jamais les marchands (titre neutre)', async () => {
    const m = await merchant();
    const u = await registerAndActivate(h);
    const secret = 'Genou fragile, opération en mai, avant mon mariage';
    const pr = (
      await h.http().post('/v1/projects').set(bearer(u.tokens.accessToken)).send({ mode: 'eco', categoryCode: 'sport', durationDays: 30, description: secret, receiveMerchantOffers: true }).expect(201)
    ).body;
    const projectId = (pr.project?.id ?? pr.id) as string;
    const reqs = (await h.http().get('/v1/shop/project-requests').set(m.auth).expect(200)).body.items;
    const r = reqs.find((x: { id: string }) => x.id === projectId);
    expect(r).toBeDefined();
    expect(JSON.stringify(r)).not.toContain('Genou');
    expect(r.title).toBe('Mon projet Sport');
    await h.http().post(`/v1/shop/project-requests/${projectId}/offers`).set(m.auth).send({ message: 'Une offre adaptée à ton projet.' }).expect(201);
    const sent = (await h.http().get('/v1/shop/offers').set(m.auth).expect(200)).body.items;
    expect(JSON.stringify(sent)).not.toContain('Genou');
  });

  it('A-4 : un commentaire publié au-delà des 30 premiers est bien renvoyé', async () => {
    const a = await registerAndActivate(h);
    const auth = bearer(a.tokens.accessToken);
    const post = (await h.http().post('/v1/posts').set(auth).field('text', 'Publication très commentée').field('visibility', 'public').expect(201)).body;
    const postId = (post.post?.id ?? post.id) as string;
    for (let i = 0; i < 31; i++) {
      await h.pool.query('insert into post_comments (id, post_id, user_id, text) values ($1, $2, $3, $4)', [uuidv7(Date.now() - 100_000 + i), postId, a.userId, `ancien ${i}`]);
    }
    const c = (await h.http().post(`/v1/posts/${postId}/comments`).set(auth).send({ text: 'Le trente-deuxième' }).expect(201)).body;
    expect(c).toMatchObject({ text: 'Le trente-deuxième', isMine: true, likeCount: 0 });
    expect(c.id).toEqual(expect.any(String));
  });

  it('A-5 : une confirmation d’identité reste valable après le renouvellement du jeton (même appareil)', async () => {
    const a = await registerAndActivate(h);
    const auth = bearer(a.tokens.accessToken);
    const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password }).expect(201);
    const grant = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(a.destination) }).expect(200);
    const refreshed = await h.http().post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken }).expect(200);
    const res = await h.http().delete(`/v1/me/contacts/${a.me.contacts[0].id}`).set(bearer(refreshed.body.tokens.accessToken)).set('X-Step-Up-Token', grant.body.stepUpToken).expect(409);
    expect(res.body.error.code).toBe('LAST_RECOVERY_CONTACT'); // la confirmation a été acceptée
    // Un autre appareil (autre session) ne peut pas s'en servir.
    const other = await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: a.body.password }).expect(200);
    const su2 = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password });
    if (su2.status === 201) {
      const g2 = await h.http().post('/v1/auth/step-up/verify').set(bearer(refreshed.body.tokens.accessToken)).send({ challengeId: su2.body.challengeId, code: h.lastCodeFor(a.destination) });
      if (g2.status === 200) {
        const denied = await h.http().delete(`/v1/me/contacts/${a.me.contacts[0].id}`).set(bearer(other.body.tokens.accessToken)).set('X-Step-Up-Token', g2.body.stepUpToken).expect(403);
        expect(denied.body.error.code).toBe('STEP_UP_REQUIRED');
      }
    }
  });

  it('A-8 : mot de passe oublié, plafond d’envois atteint : même réponse qu’un compte inconnu', async () => {
    const a = await registerAndActivate(h);
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username })).status);
    expect(new Set(statuses)).toEqual(new Set([202]));
  });

  it('A-11 : paramètres forgés : 400 au lieu d’une erreur serveur', async () => {
    const forged = Buffer.from(JSON.stringify({ v: 'abc', id: uuidv7() })).toString('base64url');
    await h.http().get('/v1/bimshop/products').query({ sort: 'price_asc', cursor: forged }).expect(400);
    const admin = await adminSession(h, ['super_admin']);
    await h.http().get('/admin/v1/audit-logs?limit=abc').set(admin).expect(400);
    await h.http().get('/admin/v1/audit-logs?before=pas-une-date').set(admin).expect(400);
    await h.http().get('/admin/v1/audit-logs?actorId=123').set(admin).expect(400);
    await h.http().get('/admin/v1/audit-logs?limit=5').set(admin).expect(200);
  });

  it('A-2 / D-1 / D-2 : demande de boutique : consultation journalisée, un seul envoi simultané, validation impossible après retrait', async () => {
    await h.pool.query("update app_settings set value = '18'::jsonb, decision_status = 'decided' where key = 'age.min_merchant'");
    h.settings.invalidate();
    try {
      const u = await registerAndActivate(h);
      const auth = bearer(u.tokens.accessToken);
      const both = await Promise.all([0, 1].map(() => h.http().post('/v1/merchant/applications').set(auth).send({ name: 'Boutique double', city: 'Abidjan' })));
      expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
      const app = both.find((r) => r.status === 201)!.body.application;
      expect((await h.pool.query('select count(*)::int as n from shops where owner_user_id = $1', [u.userId])).rows[0].n).toBe(1);

      // Demande envoyée (pièces et numéro posés directement : ces étapes sont testées ailleurs).
      await h.pool.query("update merchant_applications set status = 'submitted', submitted_at = now() where id = $1", [app.id]);
      const admin = await adminSession(h, ['super_admin']);
      await h.http().get(`/admin/v1/merchant-applications/${app.id}`).set(admin).expect(200);
      const viewed = await h.pool.query("select count(*)::int as n from audit_logs where action = 'admin.merchant_application_viewed' and target_id = $1", [app.id]);
      expect(viewed.rows[0].n).toBe(1);

      // La personne retire sa demande : la validation qui arrive ensuite échoue, la boutique reste fermée.
      await h.http().delete(`/v1/merchant/applications/${app.id}`).set(auth).expect(204);
      // Point 8 de la relecture : un second retrait (déjà fait) répond « introuvable », pas « boutique ouverte ».
      expect((await h.http().delete(`/v1/merchant/applications/${app.id}`).set(auth).expect(404)).body.error.code).toBe('NOT_FOUND');
      await h.http().post(`/admin/v1/merchant-applications/${app.id}/approve`).set(admin).expect(409);
      expect((await h.pool.query('select status from shops where id = $1', [app.shop.id])).rows[0].status).toBe('closed');
    } finally {
      await h.pool.query("update app_settings set value = 'null'::jsonb, decision_status = 'pending' where key = 'age.min_merchant'");
      h.settings.invalidate();
    }
  });

  it('D-3 : photos d’article envoyées en parallèle : jamais plus de 6, positions distinctes', async () => {
    const m = await merchant();
    const send = async () => {
      const r = h.http().post(`/v1/shop/products/${m.productId}/photos`).set(m.auth);
      for (let i = 0; i < 3; i++) r.attach('photos', await jpeg(), `${i}.jpg`);
      return r;
    };
    const res = await Promise.all([send(), send()]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 400]); // 1 + 3 = 4 ; 4 + 3 = 7 refusé
    const rows = (await h.pool.query('select position from product_media where product_id = $1', [m.productId])).rows.map((r) => r.position);
    expect(rows).toHaveLength(4);
    expect(new Set(rows).size).toBe(4);
  });

  it('D-6 : index unique des coffres ouverts (un coffre, un seul événement)', async () => {
    const res = await h.pool.query("select indexdef from pg_indexes where indexname = 'project_events_chest_uq'");
    expect(res.rows[0].indexdef).toContain('UNIQUE');
  });

  it('D-19 : refus et retrait d’une offre ne s’écrasent pas', async () => {
    const m = await merchant();
    const u = await registerAndActivate(h);
    const pr = (await h.http().post('/v1/projects').set(bearer(u.tokens.accessToken)).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30, receiveMerchantOffers: true }).expect(201)).body;
    const projectId = (pr.project?.id ?? pr.id) as string;
    const o = (await h.http().post(`/v1/shop/project-requests/${projectId}/offers`).set(m.auth).send({ message: 'Une offre pour ton projet abdos.' }).expect(201)).body;
    await h.http().delete(`/v1/shop/offers/${o.id}`).set(m.auth).expect(200);
    const d = (await h.http().post(`/v1/projects/${projectId}/offers/${o.id}/decline`).set(bearer(u.tokens.accessToken)).expect(200)).body;
    expect(d.status).toBe('withdrawn');
    expect((await h.pool.query('select status from project_offers where id = $1', [o.id])).rows[0].status).toBe('withdrawn');
    await h.http().delete(`/v1/shop/offers/${o.id}`).set(m.auth).expect(409);
  });

  it('A-14 : un fichier qui n’est pas une vraie image JPEG/PNG/WebP est refusé, même annoncé comme JPEG', async () => {
    const m = await merchant();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await h.http().post(`/v1/shop/products/${m.productId}/photos`).set(m.auth).attach('photos', svg, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
  });
});
