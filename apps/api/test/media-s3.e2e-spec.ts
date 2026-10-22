import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Stockage S3 réel (serveur compatible S3 qui applique les signatures) : lancé par la CI quand S3_TEST_ENDPOINT est défini.
 * Vérifie l'envoi, le lien présigné temporaire et l'effacement, avec le même code qu'en production sur AWS.
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
(endpoint ? describe : describe.skip)('Photos sur stockage S3', () => {
  let h: Harness;
  const bucket = `bim-test-${Date.now()}`;
  const s3 = new S3Client({ region: 'eu-west-3', endpoint, forcePathStyle: true });

  beforeAll(async () => {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    h = await startHarness({ MEDIA_STORAGE: 's3', S3_BUCKET: bucket, S3_ENDPOINT: endpoint!, S3_REGION: 'eu-west-3' });
  });
  afterAll(async () => h?.close());

  it('envoi, lien présigné qui expire, effacement réel', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    const p = (await h.http().post('/v1/projects').set(auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
    const img = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'blue' } }).jpeg().toBuffer();
    const up = (await h.http().post(`/v1/projects/${p.id}/photos?kind=before`).set(auth).attach('photo', img, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201)).body;
    const url = up.items[0].url as string;
    expect(url).toContain('X-Amz-Signature');
    // V1 : même lien présigné pendant toute une tranche de temps (cache de l'app).
    const again = (await h.http().get(`/v1/projects/${p.id}/photos`).set(auth).expect(200)).body;
    expect(again.items[0].url).toBe(url);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(800);
    // Sans signature, le fichier n'est pas lisible : le compartiment est privé.
    expect((await fetch(url.split('?')[0])).status).toBe(403);
    const key = (await h.pool.query('select storage_key from project_photos where id = $1', [up.items[0].id])).rows[0].storage_key;
    await h.http().delete(`/v1/projects/${p.id}`).set(auth).expect(204);
    await expect(s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).rejects.toThrow();
  });
});
