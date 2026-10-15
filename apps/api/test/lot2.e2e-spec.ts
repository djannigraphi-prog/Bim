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

  describe('appareils qui reçoivent les notifications', () => {
    const token = (n: string) => `fcm-test-${n}-${'x'.repeat(40)}`;
    const devices = async (userId: string) => (await h.pool.query('select session_family_id, token, platform from push_devices where user_id = $1 order by created_at', [userId])).rows;

    it('un jeton par appareil connecté, remplacé au renouvellement, retiré à la déconnexion ou à la révocation de l’appareil', async () => {
      const u = await user();
      await h.http().put('/v1/me/push-device').set(u.auth).send({ token: 'court', platform: 'android' }).expect(400);
      await h.http().put('/v1/me/push-device').set(u.auth).send({ token: token('a1'), platform: 'windows' }).expect(400);
      await h.http().put('/v1/me/push-device').set(u.auth).send({ token: token('a1'), platform: 'android', appVersion: '1.0.0' }).expect(200);
      await h.http().put('/v1/me/push-device').set(u.auth).send({ token: token('a2'), platform: 'android' }).expect(200);
      expect((await devices(u.userId)).map((d: { token: string }) => d.token)).toEqual([token('a2')]);

      // Le jeton reste attaché à l'appareil malgré le renouvellement de la session.
      const refreshed = (await h.http().post('/v1/auth/refresh').send({ refreshToken: u.tokens.refreshToken }).expect(200)).body.tokens;
      await h.http().put('/v1/me/push-device').set(bearer(refreshed.accessToken)).send({ token: token('a3'), platform: 'android' }).expect(200);
      expect(await devices(u.userId)).toHaveLength(1);

      // Deuxième appareil, puis révocation de cet appareil depuis le premier.
      const tablet = (await h.http().post('/v1/auth/login').send({ identifier: u.body.username, password: u.body.password, deviceName: 'Tablette' }).expect(200)).body.tokens;
      await h.http().put('/v1/me/push-device').set(bearer(tablet.accessToken)).send({ token: token('t1'), platform: 'ios' }).expect(200);
      expect(await devices(u.userId)).toHaveLength(2);
      const list = (await h.http().get('/v1/me/sessions').set(bearer(refreshed.accessToken)).expect(200)).body.items;
      const other = list.find((x: { deviceName: string }) => x.deviceName === 'Tablette');
      await h.http().delete(`/v1/me/sessions/${other.id}`).set(bearer(refreshed.accessToken)).expect(204);
      expect((await devices(u.userId)).map((d: { token: string }) => d.token)).toEqual([token('a3')]);

      // Ne plus recevoir de notifications sur cet appareil, puis déconnexion.
      await h.http().delete('/v1/me/push-device').set(bearer(refreshed.accessToken)).expect(204);
      expect(await devices(u.userId)).toHaveLength(0);
      await h.http().put('/v1/me/push-device').set(bearer(refreshed.accessToken)).send({ token: token('a4'), platform: 'android' }).expect(200);
      await h.http().post('/v1/auth/logout').set(bearer(refreshed.accessToken)).expect(204);
      expect(await devices(u.userId)).toHaveLength(0);
    });

    it('un téléphone reconnecté sous un autre compte ne reçoit plus les notifications du premier', async () => {
      const a = await user();
      const b = await user();
      await h.http().put('/v1/me/push-device').set(a.auth).send({ token: token('partage'), platform: 'android' }).expect(200);
      await h.http().put('/v1/me/push-device').set(b.auth).send({ token: token('partage'), platform: 'android' }).expect(200);
      expect(await devices(a.userId)).toHaveLength(0);
      expect(await devices(b.userId)).toHaveLength(1);
    });
  });

  describe('préférences de notification', () => {
    it('valeurs de la plateforme par défaut, heures calmes personnelles, retour au défaut, contrôles ; rappels pas encore en service', async () => {
      const u = await user();
      const d = (await h.http().get('/v1/me/notification-preferences').set(u.auth).expect(200)).body;
      // Rappels désactivés par défaut (décision du 15/10/2026) : c'est la personne qui les active.
      expect(d).toEqual({ remindersEnabled: false, quietHours: { start: '22:00', end: '06:00' }, quietHoursSource: 'default', remindersAvailable: false });
      // Choisir ses heures calmes n'active pas les rappels.
      const quietOnly = (await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '22:30', quietEnd: '06:30' }).expect(200)).body;
      expect(quietOnly).toMatchObject({ remindersEnabled: false, quietHoursSource: 'personal' });
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '21:00' }).expect(400);
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '21:00', quietEnd: null }).expect(400);
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '25:00', quietEnd: '06:00' }).expect(400);
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '21:00', quietEnd: '21:00' }).expect(400);
      const p = (await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '21:30', quietEnd: '05:30', remindersEnabled: false }).expect(200)).body;
      expect(p).toMatchObject({ remindersEnabled: false, quietHours: { start: '21:30', end: '05:30' }, quietHoursSource: 'personal' });
      const back = (await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: null, quietEnd: null }).expect(200)).body;
      expect(back).toMatchObject({ remindersEnabled: false, quietHours: { start: '22:00', end: '06:00' }, quietHoursSource: 'default' });

      // Écran « Rappels » de l'app : un seul choix envoyé à la fois ; rien d'autre ne change, et jamais le service lui-même.
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: '23:00', quietEnd: '07:00' }).expect(200);
      const on = (await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ remindersEnabled: true }).expect(200)).body;
      expect(on).toEqual({ remindersEnabled: true, quietHours: { start: '23:00', end: '07:00' }, quietHoursSource: 'personal', remindersAvailable: false });
      const platform = (await h.pool.query("select value from app_settings where key = 'notifications.reminders_enabled'")).rows[0];
      expect(platform.value).toBe(false);
    });

    it('les réglages des rappels sont enregistrés comme non validés et contrôlés dans l’administration', async () => {
      const rows = (await h.pool.query("select key, value, decision_status from app_settings where key like 'notifications.%' order by key")).rows;
      expect(Object.fromEntries(rows.map((r: { key: string; decision_status: string }) => [r.key, r.decision_status]))).toEqual({
        'notifications.quiet_hours': 'pending',
        'notifications.reminder_grace_minutes': 'provisional',
        'notifications.reminder_offsets_minutes': 'pending',
        'notifications.reminders_enabled': 'pending',
      });
      expect(rows.find((r: { key: string }) => r.key === 'notifications.reminders_enabled').value).toBe(false);
    });
  });
});
