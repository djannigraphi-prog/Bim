import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Signalements avec image (écrans 21 et 27) : un seul système pour un problème de projet ou un problème général. */
describe('Signalements avec image et « Résoudre un problème » (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const today = () => new Date().toISOString().slice(0, 10);
  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  const screenshot = () =>
    sharp({ create: { width: 1080, height: 2400, channels: 3, background: { r: 240, g: 240, b: 240 } } })
      .withExif({ IFD0: { Artist: 'Personne test' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '5/1 20/1 0/1' } })
      .png()
      .toBuffer();
  async function fetchBytes(url: string): Promise<{ status: number; body: Buffer }> {
    const res = await h
      .http()
      .get(new URL(url).pathname)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    return { status: res.status, body: res.body as Buffer };
  }

  it('problème général avec une capture : enregistré, image privée sans métadonnées, visible par la personne et le support, réponse', async () => {
    const u = await user();
    const other = await user();
    const res = await h
      .http()
      .post('/v1/reports')
      .set(u.auth)
      .field('reason', 'app')
      .field('message', 'Le bouton Continuer ne réagit pas sur l’écran des objectifs.')
      .attach('image', await screenshot(), { filename: 'capture.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'open', healthAdvice: false });

    const mine = (await h.http().get('/v1/reports').set(u.auth).expect(200)).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ context: 'general', projectId: null, reason: 'app', status: 'open', image: { width: 720, height: 1600 } });
    const img = await fetchBytes(mine[0].image.url);
    expect(img.status).toBe(200);
    const meta = await sharp(img.body).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    // Personne d'autre ne voit ce signalement.
    expect((await h.http().get('/v1/reports').set(other.auth).expect(200)).body.items).toHaveLength(0);

    const sup = await adminSession(h, ['support']);
    const open = (await h.http().get('/admin/v1/reports').set(sup).expect(200)).body.items;
    const forSupport = open.find((x: { id: string }) => x.id === res.body.id);
    expect(forSupport).toMatchObject({ context: 'general', projectTitle: null, reason: 'app', username: u.body.username });
    expect(forSupport.attachmentKey).toBeUndefined();
    expect((await fetchBytes(forSupport.image.url)).status).toBe(200);

    await h.http().post(`/admin/v1/reports/${res.body.id}/resolve`).set(sup).send({ resolution: 'Corrigé dans la prochaine version, merci !' }).expect(200);
    const back = (await h.http().get('/v1/reports').set(u.auth).expect(200)).body.items[0];
    expect(back).toMatchObject({ status: 'resolved', resolution: 'Corrigé dans la prochaine version, merci !' });
  });

  it('contrôles : description obligatoire, motifs par contexte, image invalide refusée sans rien créer', async () => {
    const u = await user();
    await h.http().post('/v1/reports').set(u.auth).send({ reason: 'app' }).expect(400);
    await h.http().post('/v1/reports').set(u.auth).send({ reason: 'app', message: 'court' }).expect(400);
    await h.http().post('/v1/reports').set(u.auth).send({ reason: 'too_hard', message: 'Motif réservé aux projets' }).expect(400);
    await h.http().post('/v1/reports').set(u.auth).send({ reason: 'other', message: 'Un jour sans projet', day: today() }).expect(400);
    await h.http().post('/v1/reports').set(u.auth).send({ reason: 'pirate', message: 'Motif inconnu ici' }).expect(400);
    await h.http().get('/v1/reports?projectId=pas-un-id').set(u.auth).expect(400);
    const bad = await h
      .http()
      .post('/v1/reports')
      .set(u.auth)
      .field('reason', 'product')
      .field('message', 'Le produit reçu est abîmé.')
      .attach('image', Buffer.from('pas une image'), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(bad.body.error.details.fields.image).toBeDefined();
    await h
      .http()
      .post('/v1/reports')
      .set(u.auth)
      .field('reason', 'product')
      .field('message', 'Le produit reçu est abîmé.')
      .attach('image', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect((await h.http().get('/v1/reports').set(u.auth).expect(200)).body.items).toHaveLength(0);
    const files = (await h.pool.query('select count(*)::int as n from project_reports where user_id = $1', [u.userId])).rows[0].n;
    expect(files).toBe(0);
  });

  it('depuis un projet, avec une image ; filtre par projet ; projet d’un autre refusé', async () => {
    const u = await user();
    const other = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
    await h.http().post('/v1/reports').set(other.auth).send({ projectId: p.id, day: today(), reason: 'other' }).expect(404);
    await h.http().post('/v1/reports').set(u.auth).send({ projectId: p.id, reason: 'other' }).expect(400);
    await h.http().post('/v1/reports').set(u.auth).send({ projectId: p.id, day: today(), reason: 'app' }).expect(400);
    const r = (
      await h
        .http()
        .post('/v1/reports')
        .set(u.auth)
        .field('projectId', p.id)
        .field('day', today())
        .field('taskId', p.tasks[0].id)
        .field('reason', 'unavailable')
        .attach('image', await sharp({ create: { width: 400, height: 300, channels: 3, background: 'gray' } }).jpeg().toBuffer(), { filename: 'salle.jpg', contentType: 'image/jpeg' })
        .expect(201)
    ).body;
    await h.http().post('/v1/reports').set(u.auth).send({ reason: 'other', message: 'Un problème général aussi.' }).expect(201);
    const all = (await h.http().get('/v1/reports').set(u.auth).expect(200)).body.items;
    expect(all).toHaveLength(2);
    const onProject = (await h.http().get(`/v1/reports?projectId=${p.id}`).set(u.auth).expect(200)).body.items;
    expect(onProject).toHaveLength(1);
    expect(onProject[0]).toMatchObject({ id: r.id, context: 'project', projectTitle: p.title, day: today(), image: { width: 400, height: 300 } });
    // Ancienne route du projet : même système, même réponse.
    expect((await h.http().get(`/v1/projects/${p.id}/reports`).set(u.auth).expect(200)).body.items[0].id).toBe(r.id);
    await h.http().get(`/v1/reports?projectId=${p.id}`).set(other.auth).expect(404);
    const key = (await h.pool.query('select attachment_key from project_reports where id = $1', [r.id])).rows[0].attachment_key as string;
    expect(key.startsWith(`reports/${u.userId}/`)).toBe(true);
    expect(existsSync(join(process.env.MEDIA_LOCAL_DIR!, key))).toBe(true);
  });

  it('au plus 20 signalements par personne et par 24 h', async () => {
    const u = await user();
    await h.pool.query(
      `insert into project_reports (id, context, user_id, reason, message)
       select gen_random_uuid(), 'general', $1, 'other', 'Signalement de remplissage' from generate_series(1, 20)`,
      [u.userId],
    );
    const r = await h.http().post('/v1/reports').set(u.auth).send({ reason: 'other', message: 'Un de trop aujourd’hui.' }).expect(429);
    expect(r.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('Signalements sans stockage de fichiers configuré (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ MEDIA_STORAGE: 'none' });
  });
  afterAll(async () => h.close());

  it('le texte part ; une image est refusée clairement (rien n’est créé), pour que l’app propose d’envoyer sans image', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    const img = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
    const r = await h.http().post('/v1/reports').set(auth).field('reason', 'app').field('message', 'Écran blanc au démarrage.').attach('image', img, { filename: 'a.png', contentType: 'image/png' }).expect(503);
    expect(r.body.error.code).toBe('NOT_CONFIGURED');
    expect((await h.http().get('/v1/reports').set(auth).expect(200)).body.items).toHaveLength(0);
    await h.http().post('/v1/reports').set(auth).send({ reason: 'app', message: 'Écran blanc au démarrage.' }).expect(201);
    expect((await h.http().get('/v1/reports').set(auth).expect(200)).body.items[0]).toMatchObject({ image: null, status: 'open' });
  });
});
