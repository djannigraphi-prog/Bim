import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 7-A — Version minimale de l'app : sans minimum décidé, aucun effet ; sinon 426 pour une app trop ancienne. */
describe('Version minimale de l’app (e2e)', () => {
  let h: Harness;
  async function setting(key: string, value: unknown, status = 'decided') {
    await h.pool.query('update app_settings set value = $1::jsonb, decision_status = $2 where key = $3', [JSON.stringify(value), status, key]);
    h.settings.invalidate();
  }
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await setting('app.min_version_android', null, 'pending');
    await setting('app.min_version_ios', null, 'pending');
    await setting('app.recommended_version_android', null, 'pending');
    await h.close();
  });

  it('aucun minimum (défaut) : toute version passe ; configuration publique', async () => {
    const u = await registerAndActivate(h);
    await h.http().get('/v1/me').set(bearer(u.tokens.accessToken)).set('x-bim-platform', 'android').set('x-bim-app-version', '0.0.1').expect(200);
    expect((await h.http().get('/v1/app/config').expect(200)).body).toEqual({ minVersion: { android: null, ios: null }, recommendedVersion: { android: null, ios: null } });
  });

  it('L7-09 version recommandée : rappel non bloquant (en-tête), toutes les fonctionnalités restent accessibles', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    await setting('app.recommended_version_android', '0.3.0');
    const old = await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').set('x-bim-app-version', '0.1.0').expect(200);
    expect(old.headers['x-bim-update-available']).toBe('0.3.0');
    const fresh = await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').set('x-bim-app-version', '0.3.0').expect(200);
    expect(fresh.headers['x-bim-update-available']).toBeUndefined();
    expect((await h.http().get('/v1/app/config')).body.recommendedVersion).toEqual({ android: '0.3.0', ios: null });
    await setting('app.recommended_version_android', null, 'pending');
  });

  it('minimum décidé : version plus ancienne ou illisible refusée (426) ; égale ou plus récente acceptée ; autres plateformes et administration non concernées', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    await setting('app.min_version_android', '0.2.0', 'provisional');
    await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').set('x-bim-app-version', '0.1.0').expect(200); // pas encore décidé
    await setting('app.min_version_android', '0.2.0');
    const old = await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').set('x-bim-app-version', '0.1.9+4').expect(426);
    expect(old.body.error).toMatchObject({ code: 'APP_UPDATE_REQUIRED', details: { minVersion: '0.2.0', platform: 'android' } });
    await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').expect(426); // version absente
    await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').set('x-bim-app-version', 'abc').expect(426);
    await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'Android').set('x-bim-app-version', '0.2.0').expect(200);
    await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'android').set('x-bim-app-version', '0.10.0').expect(200);
    // Même sans session : l'app sait qu'elle doit se mettre à jour.
    expect((await h.http().post('/v1/auth/login').set('x-bim-platform', 'android').set('x-bim-app-version', '0.1.0').send({}).expect(426)).body.error.code).toBe('APP_UPDATE_REQUIRED');
    await h.http().get('/v1/me').set(auth).set('x-bim-platform', 'ios').set('x-bim-app-version', '0.1.0').expect(200);
    await h.http().get('/v1/me').set(auth).expect(200); // navigateur, outils : pas de plateforme mobile
    await h.http().get('/v1/app/config').set('x-bim-platform', 'android').set('x-bim-app-version', '0.1.0').expect(200);
    await h.http().get('/health').set('x-bim-platform', 'android').set('x-bim-app-version', '0.1.0').expect(200);
    expect((await h.http().get('/v1/app/config')).body.minVersion).toEqual({ android: '0.2.0', ios: null });
    await setting('app.min_version_android', null, 'pending');
  });
});
