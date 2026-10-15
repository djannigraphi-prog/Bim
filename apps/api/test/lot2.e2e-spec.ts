import { localDay } from '../src/common/timezone';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 2 — fondations sans dépense : fuseau horaire, appareils, préférences, rappels (worker désactivé par défaut). */
describe('Lot 2 (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }

  describe('fuseau horaire par personne', () => {
    it('Abidjan par défaut ; fuseau modifiable et contrôlé ; le « jour » du projet suit l’heure locale', async () => {
      const u = await user();
      const me = (await h.http().get('/v1/me').set(u.auth).expect(200)).body;
      expect(me.preferences.timezone).toBe('Africa/Abidjan');
      await h.http().patch('/v1/me/preferences').set(u.auth).send({ timezone: 'Afrique/Abidjan' }).expect(400);
      // UTC+14 : la date locale diffère de la date UTC une grande partie de la journée.
      const tz = 'Pacific/Kiritimati';
      const prefs = (await h.http().patch('/v1/me/preferences').set(u.auth).send({ timezone: tz }).expect(200)).body;
      expect(prefs).toMatchObject({ timezone: tz, theme: 'system' });
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
      const local = localDay(new Date(), tz);
      expect((await h.http().get('/v1/projects').set(u.auth).expect(200)).body.today).toBe(local);
      expect((await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body.today).toBe(local);
      // Le thème reste modifiable seul, sans toucher au fuseau.
      expect((await h.http().patch('/v1/me/preferences').set(u.auth).send({ theme: 'dark' }).expect(200)).body).toMatchObject({ theme: 'dark', timezone: tz });
    });
  });
});
