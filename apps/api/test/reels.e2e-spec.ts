import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';
import { testMp4 } from './mp4-fixture';

/** Lot 11 (prototype) — Reels : vidéos courtes rangées dans le stockage privé, sans service vidéo payant. */
describe('Reels (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ DEMO_MODE: 'true' });
  });
  afterAll(async () => h.close());

  async function user(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, auth: bearer(u.tokens.accessToken), username: u.me.username as string };
  }
  const upload = (auth: Record<string, string>, video: Buffer | null, fields: Record<string, string> = {}, status = 201) => {
    let r = h.http().post('/v1/reels').set(auth);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    if (video) r = r.attach('video', video, { filename: 'reel.mp4', contentType: 'video/mp4' });
    return r.expect(status);
  };

  it('publication : MP4 vérifié, position effacée, lecture par lien temporaire ; vues, j’aime, suppression', async () => {
    const a = await user({ fullName: 'Awa Koné' });
    const b = await user();
    const r = (await upload(a.auth, testMp4({ seconds: 15, width: 720, height: 1280, gps: '+05.3600-004.0083/' }), { caption: 'Ma routine en 15 s' })).body;
    expect(r).toMatchObject({ caption: 'Ma routine en 15 s', visibility: 'public', likeCount: 0, viewCount: 0, coinCount: 0, isMine: true, video: { durationMs: 15000, width: 720, height: 1280 } });

    // Le fichier servi n'a plus de métadonnées (ni la position).
    const file = await h.http().get(new URL(r.video.url).pathname).expect(200);
    expect(file.headers['content-type']).toMatch(/^video\/mp4/);
    const body = file.body as Buffer;
    expect(body.includes(Buffer.from('+05.3600-004.0083/'))).toBe(false);
    expect(body.includes(Buffer.from('udta'))).toBe(false);

    // Contrôles : pas de vidéo, mauvais format, trop long.
    await upload(a.auth, null, {}, 400);
    await upload(a.auth, Buffer.from('%PDF-1.4 pas une vidéo'), {}, 400);
    expect((await upload(a.auth, testMp4({ seconds: 75 }), {}, 400)).body.error).toMatchObject({ code: 'REEL_TOO_LONG', details: { maxSeconds: 60 } });
    expect((await upload(a.auth, testMp4({ gpsTrack: true }), {}, 400)).body.error.code).toBe('REEL_LOCATION_TRACK');

    const feed = (await h.http().get('/v1/reels').set(b.auth).expect(200)).body;
    expect(feed.items.map((x: { id: string }) => x.id)).toContain(r.id);
    expect(feed.items.find((x: { id: string }) => x.id === r.id)).toMatchObject({ isMine: false, likedByMe: false, canGift: false });

    expect((await h.http().post(`/v1/reels/${r.id}/view`).set(b.auth).expect(200)).body).toEqual({ viewCount: 1 });
    expect((await h.http().post(`/v1/reels/${r.id}/view`).set(b.auth).expect(200)).body).toEqual({ viewCount: 1 }); // une vue par personne
    expect((await h.http().post(`/v1/reels/${r.id}/view`).set(a.auth).expect(200)).body).toEqual({ viewCount: 1 }); // pas la sienne
    expect((await h.http().put(`/v1/reels/${r.id}/like`).set(b.auth).expect(200)).body).toEqual({ likeCount: 1, likedByMe: true });
    expect((await h.http().put(`/v1/reels/${r.id}/like`).set(b.auth).expect(200)).body.likeCount).toBe(1);
    expect((await h.http().delete(`/v1/reels/${r.id}/like`).set(b.auth).expect(200)).body).toEqual({ likeCount: 0, likedByMe: false });

    // Pièces : l'auteur doit être Premium.
    await h.http().post('/v1/wallet/purchases').set(b.auth).send({ coins: 100, channel: 'demo', idempotencyKey: `reel-buy-${Date.now()}` }).expect(201);
    const gift = () => h.http().post('/v1/coins/gifts').set(b.auth).send({ targetType: 'reel', targetId: r.id, giftCode: 'coin5', quantity: 2, idempotencyKey: `rg-${Date.now()}-${Math.floor(Math.random() * 1e9)}` });
    expect((await gift().expect(409)).body.error.code).toBe('RECIPIENT_NOT_PREMIUM');
    await h.http().post('/v1/premium/subscribe').set(a.auth).send({ channel: 'demo' }).expect(200);
    expect((await h.http().get(`/v1/reels/${r.id}`).set(b.auth).expect(200)).body.canGift).toBe(true);
    expect((await gift().expect(201)).body.targetCoinCount).toBe(10);
    const inbox = (await h.http().get('/v1/me/notifications').set(a.auth).expect(200)).body.items.map((i: { text: string }) => i.text);
    expect(inbox.some((t: string) => /t’a envoyé 10 pièces sur ton Reel/.test(t))).toBe(true);

    await h.http().delete(`/v1/reels/${r.id}`).set(b.auth).expect(404); // pas son Reel : introuvable
    await h.http().delete(`/v1/reels/${r.id}`).set(a.auth).expect(204);
    await h.http().get(`/v1/reels/${r.id}`).set(b.auth).expect(404);
    await h.http().get(new URL(r.video.url).pathname).expect(404);
  });

  it('visibilité « abonnés », blocage ; signalement et masquage par la modération', async () => {
    const a = await user();
    const fan = await user();
    const other = await user();
    const r = (await upload(a.auth, testMp4({ seconds: 8 }), { visibility: 'followers' })).body;
    await h.http().get(`/v1/reels/${r.id}`).set(other.auth).expect(404);
    await h.http().put(`/v1/people/${a.username}/follow`).set(fan.auth).expect(200);
    await h.http().get(`/v1/reels/${r.id}`).set(fan.auth).expect(200);
    await h.http().put(`/v1/people/${fan.username}/block`).set(a.auth).expect(200);
    await h.http().get(`/v1/reels/${r.id}`).set(fan.auth).expect(404);

    const pub = (await upload(a.auth, testMp4({ seconds: 5 }), { caption: 'À signaler' })).body;
    await h.http().post('/v1/content-reports').set(other.auth).send({ targetType: 'reel', targetId: pub.id, reason: 'spam' }).expect(201);
    const mod = await adminSession(h, ['moderator']);
    const open = (await h.http().get('/admin/v1/content-reports').set(mod).expect(200)).body.items;
    const rep = open.find((x: { targetId: string }) => x.targetId === pub.id);
    expect(rep.content).toMatchObject({ kind: 'reel', text: 'À signaler', status: 'published' });
    expect(rep.content.videoUrl).toEqual(expect.any(String));
    await h.http().post(`/admin/v1/content-reports/${rep.id}/resolve`).set(mod).send({ action: 'hidden', resolution: 'Contenu indésirable' }).expect(200);
    await h.http().get(`/v1/reels/${pub.id}`).set(other.auth).expect(404);
    await h.http().post(`/admin/v1/content/reel/${pub.id}/restore`).set(mod).expect(200);
    await h.http().get(`/v1/reels/${pub.id}`).set(other.auth).expect(200);
  });

  it('limite quotidienne (réglage) : refus au-delà', async () => {
    const a = await user();
    await h.pool.query(`update app_settings set value = '1' where key = 'reels.daily_limit'`);
    h.settings.invalidate();
    try {
      await upload(a.auth, testMp4({ seconds: 3 }));
      expect((await upload(a.auth, testMp4({ seconds: 3 }), {}, 429)).body.error.details).toMatchObject({ reason: 'REELS_DAILY_LIMIT', limit: 1 });
    } finally {
      await h.pool.query(`update app_settings set value = '10' where key = 'reels.daily_limit'`);
      h.settings.invalidate();
    }
  });
});
