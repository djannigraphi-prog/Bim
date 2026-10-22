import sharp from 'sharp';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';
import { testMp4 } from './mp4-fixture';

/**
 * V1 — Lecture des fichiers et envoi des vidéos : lecture par morceaux (« Range »), liens stables pendant une tranche
 * de temps, erreurs de réception claires, vidéos d'iPhone (pistes minutées « mebx ») et MP4 fragmentés.
 */
describe('Fichiers et vidéos (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    // Limite de vidéo très basse pour vérifier le refus dès la réception, avec la limite dans le message.
    h = await startHarness({ DEMO_MODE: 'true', MEDIA_MAX_VIDEO_MB: '1' });
  });
  afterAll(async () => h.close());

  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken), username: u.me.username as string };
  }
  const reel = (auth: Record<string, string>, video: Buffer, status = 201, field = 'video') =>
    h.http().post('/v1/reels').set(auth).attach(field, video, { filename: 'reel.mp4', contentType: 'video/mp4' }).expect(status);

  it('lecture par morceaux (206, Content-Range, Accept-Ranges), plage impossible (416), type des fichiers', async () => {
    const a = await user();
    const file = testMp4({ seconds: 5 });
    const r = (await reel(a.auth, file)).body;
    const path = new URL(r.video.url).pathname;

    const whole = await h.http().get(path).expect(200);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-type']).toMatch(/^video\/mp4/);
    expect(Number(whole.headers['content-length'])).toBe(file.length);
    expect(whole.headers['cache-control']).toBe('private, no-store');
    expect(whole.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const part = await h.http().get(path).set('Range', 'bytes=0-1').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(206);
    expect(part.headers['content-range']).toBe(`bytes 0-1/${file.length}`);
    expect(part.headers['content-length']).toBe('2');
    expect((part.body as Buffer).length).toBe(2);
    expect((part.body as Buffer).equals((whole.body as Buffer).subarray(0, 2))).toBe(true);

    const tail = await h.http().get(path).set('Range', 'bytes=-4').expect(206);
    expect(tail.headers['content-range']).toBe(`bytes ${file.length - 4}-${file.length - 1}/${file.length}`);

    const beyond = await h.http().get(path).set('Range', `bytes=${file.length + 10}-`).expect(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${file.length}`);
    // En-tête mal formé : le fichier entier.
    await h.http().get(path).set('Range', 'octets=abc').expect(200);
    // Jeton faux ou modifié : introuvable.
    const forged = Buffer.from(Buffer.from(path.split('/').pop()!, 'base64url').toString('utf8').replace(/\|(\d+)\|/, (_m, e) => `|${Number(e) + 3600}|`)).toString('base64url');
    await h.http().get(`/v1/media/${forged}`).expect(404);
  });

  it('lien stable pendant une tranche de temps (cache de l’app), valable au moins MEDIA_URL_TTL_SECONDS', async () => {
    const a = await user();
    const r = (await reel(a.auth, testMp4({ seconds: 5 }))).body;
    const again = (await h.http().get(`/v1/reels/${r.id}`).set(a.auth).expect(200)).body;
    expect(new URL(again.video.url).pathname).toBe(new URL(r.video.url).pathname);
    const token = new URL(r.video.url).pathname.split('/').pop()!;
    const exp = Number(Buffer.from(token, 'base64url').toString('utf8').split('|')[1]);
    expect(exp - Date.now() / 1000).toBeGreaterThanOrEqual(3600 - 5);
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(7200);
  });

  it('vidéo trop lourde : 413 FILE_TOO_LARGE avec la limite ; champ inattendu : message clair', async () => {
    const a = await user();
    const big = Buffer.concat([testMp4({ seconds: 5 }), Buffer.alloc(1024 * 1024 + 10, 1)]);
    const res = await reel(a.auth, big, 413);
    expect(res.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'Fichier trop lourd : 1 Mo au plus.', details: { limitMb: 1 } });
    const wrong = await reel(a.auth, testMp4({ seconds: 5 }), 400, 'film');
    expect(wrong.body.error).toMatchObject({ code: 'UNEXPECTED_FILE', message: expect.stringMatching(/^Fichier inattendu/) });
    // Photo au-delà de la limite de réception (25 Mo) : même code, message générique.
    const photo = await h.http().put('/v1/me/avatar').set(a.auth).attach('photo', Buffer.alloc(25 * 1024 * 1024 + 1, 1), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(413);
    expect(photo.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'Fichier trop lourd.' });
  });

  it('iPhone : piste minutée « mebx » acceptée ; piste GPS refusée avec un message neutre ; MP4 fragmenté', async () => {
    const a = await user();
    await reel(a.auth, testMp4({ seconds: 5, metaTrack: { entry: 'mebx' } }));
    const gps = (await reel(a.auth, testMp4({ seconds: 5, metaTrack: { entry: 'gpmd' } }), 400)).body.error;
    expect(gps).toMatchObject({ code: 'REEL_LOCATION_TRACK', message: 'Cette vidéo contient des données de capteurs qui ne peuvent pas être effacées.' });
    expect((await reel(a.auth, testMp4({ seconds: 8, fragmented: 'trun' }))).body.video).toMatchObject({ durationMs: 8000 });
    const unknown = (await reel(a.auth, testMp4({ seconds: 8, fragmented: 'none' }), 400)).body.error;
    expect(unknown.code).toBe('VALIDATION_FAILED');
    expect(unknown.details.fields.video[0]).toMatch(/^Durée de la vidéo illisible/);
  });

  it('image PNG transparente : fond blanc dans le JPEG servi', async () => {
    const a = await user();
    const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const av = (await h.http().put('/v1/me/avatar').set(a.auth).attach('photo', png, { filename: 'a.png', contentType: 'image/png' }).expect(200)).body;
    const img = (await h.http().get(new URL(av.avatarUrl).pathname).expect(200)).body as Buffer;
    const [r, g, b] = await sharp(img).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(Math.min(r, g, b)).toBeGreaterThan(245);
  });
});
