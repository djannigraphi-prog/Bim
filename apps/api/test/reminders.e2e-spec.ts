import { localDay, zonedTime } from '../src/common/timezone';
import { PUSH_SENDER, RecordingPushSender } from '../src/modules/notifications/push-sender';
import { ReminderWorkerService } from '../src/modules/notifications/reminder-worker.service';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Worker des rappels (lot 2) : envoi de test en mémoire, heure maîtrisée par le test (`now`).
 * Vérifie la reprise après panne, l'absence de doublons, la péremption, les jetons refusés, les erreurs passagères,
 * la revérification avant envoi, les heures calmes, l'interrupteur général et la surveillance.
 */
describe('Rappels : worker, reprise, doublons, surveillance (e2e)', () => {
  let h: Harness;
  let worker: ReminderWorkerService;
  let push: RecordingPushSender;
  const day = localDay(new Date());
  const at = (hhmm: string, plusSeconds = 30) => new Date(zonedTime(day, hhmm).getTime() + plusSeconds * 1000);

  async function setSetting(key: string, value: unknown) {
    await h.pool.query('update app_settings set value = $2::jsonb where key = $1', [key, JSON.stringify(value)]);
    h.settings.invalidate();
  }

  beforeAll(async () => {
    h = await startHarness({ PUSH_PROVIDER: 'test' });
    worker = h.app.get(ReminderWorkerService);
    push = h.app.get(PUSH_SENDER);
    await setSetting('notifications.reminders_enabled', true);
    await setSetting('notifications.quiet_hours', null);
  });
  afterAll(async () => {
    // Remet les valeurs de la migration (non validées) pour les autres fichiers de test.
    await setSetting('notifications.reminders_enabled', false);
    await setSetting('notifications.quiet_hours', { start: '22:00', end: '06:00' });
    await h.close();
  });
  beforeEach(() => push.reset());

  /** Personne avec un appareil et un projet dont les tâches quotidiennes sont à `times`. */
  async function setup(times: string[] = ['15:00'], token = `tok-${Math.random().toString(36).slice(2)}-${'x'.repeat(30)}`) {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    await h.http().put('/v1/me/push-device').set(auth).send({ token, platform: 'android' }).expect(200);
    // Rappels désactivés par défaut : la personne les active (décision du 15/10/2026).
    await h.http().patch('/v1/me/notification-preferences').set(auth).send({ remindersEnabled: true }).expect(200);
    const p = (await h.http().post('/v1/projects').set(auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 7, durationDays: 30 }).expect(201)).body;
    const first = p.tasks[0].id;
    await h.pool.query("update project_tasks set time_of_day = $2 where id = $1", [first, times[0]]);
    for (const t of times.slice(1)) {
      await h.http().post(`/v1/projects/${p.id}/tasks`).set(auth).send({ title: `Tâche ${t}`, timeOfDay: t, weekdays: 127 }).expect(201);
    }
    // Les tâches ajoutées comptent à partir d'aujourd'hui (active_from) : elles sont bien dues ce jour.
    return { u, auth, p, token, task: first };
  }
  const rows = async (projectId: string) =>
    (await h.pool.query('select key, attempt, status, reason, send_tries from notification_deliveries where project_id = $1 order by fire_at, key', [projectId])).rows;

  it('planification idempotente et envoi unique, même avec deux planificateurs et trois workers en parallèle', async () => {
    const { p, token } = await setup(['15:00', '15:00', '15:00', '15:00', '15:00']);
    const now = at('15:00');
    const planned = await Promise.all([worker.plan(now), worker.plan(now)]);
    const mine = await rows(p.id);
    expect(mine).toHaveLength(5); // 5 tâches × tentative 0, aucune ligne en double
    expect(planned.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);
    await Promise.all([worker.dispatch(now), worker.dispatch(now), worker.dispatch(now)]);
    const sentToMe = push.sent.filter((s) => s.target.token === token);
    expect(sentToMe).toHaveLength(5);
    expect(new Set(sentToMe.map((s) => s.message.collapseKey)).size).toBe(5);
    expect((await rows(p.id)).every((r: { status: string }) => r.status === 'sent')).toBe(true);
    // Rejouer le même tour n'envoie rien de plus.
    await worker.tick(now);
    expect(push.sent.filter((s) => s.target.token === token)).toHaveLength(5);
    expect(sentToMe[0].message).toMatchObject({ title: 'Peni', data: { type: 'task_reminder', projectId: p.id, day } });
  });

  it('reprise après panne : un rappel resté « en cours d’envoi » (worker arrêté) repart une seule fois', async () => {
    const { p, token } = await setup(['15:00']);
    const now = at('15:00');
    await worker.plan(now);
    // Panne simulée : un worker a pris le rappel il y a 5 minutes puis s'est arrêté.
    await h.pool.query("update notification_deliveries set status = 'sending', claimed_at = $2, claimed_by = 'worker-arrete' where project_id = $1", [p.id, new Date(now.getTime() - 5 * 60_000)]);
    await worker.dispatch(now);
    expect(push.sent.filter((s) => s.target.token === token)).toHaveLength(0); // encore sous bail : personne ne le reprend
    const later = new Date(now.getTime() + 60_000);
    const r = await worker.tick(later);
    expect(r.recovered).toBeGreaterThanOrEqual(1);
    expect(push.sent.filter((s) => s.target.token === token)).toHaveLength(1);
    expect((await rows(p.id))[0]).toMatchObject({ status: 'sent', send_tries: 1 });
  });

  it('rappel trop en retard (au-delà de 30 minutes) : pas envoyé, compté comme manqué', async () => {
    const { p, token } = await setup(['15:00']);
    await worker.plan(at('15:00'));
    await worker.dispatch(at('15:31', 30));
    expect(push.sent.filter((s) => s.target.token === token)).toHaveLength(0);
    expect((await rows(p.id))[0]).toMatchObject({ status: 'stale', reason: 'too_late' });
  });

  it('jeton refusé définitivement : appareil retiré ; erreur passagère : nouvel essai puis envoi', async () => {
    const a = await setup(['15:00']);
    push.invalidTokens.add(a.token);
    await worker.tick(at('15:00'));
    expect((await rows(a.p.id))[0]).toMatchObject({ status: 'skipped', reason: 'invalid_token' });
    expect((await h.pool.query('select count(*)::int as n from push_devices where user_id = $1', [a.u.userId])).rows[0].n).toBe(0);

    const b = await setup(['16:00']);
    push.transientFailures.set(b.token, 1);
    await worker.plan(at('16:00'));
    await worker.dispatch(at('16:00'));
    expect((await rows(b.p.id))[0]).toMatchObject({ status: 'pending', reason: 'retry', send_tries: 1 });
    await worker.dispatch(at('16:00', 45)); // trop tôt : attente d'une minute
    expect(push.sent.filter((s) => s.target.token === b.token)).toHaveLength(0);
    await worker.dispatch(at('16:01', 40));
    expect(push.sent.filter((s) => s.target.token === b.token)).toHaveLength(1);
    expect((await rows(b.p.id))[0]).toMatchObject({ status: 'sent', send_tries: 2 });
  });

  it('revérifié juste avant l’envoi : tâche cochée entre-temps, projet en pause, rappels désactivés, heures calmes', async () => {
    const done = await setup(['15:00']);
    await worker.plan(at('15:00'));
    await h.http().put(`/v1/projects/${done.p.id}/days/${day}/tasks/${done.task}/done`).set(done.auth).expect(200);
    await worker.dispatch(at('15:00'));
    expect((await rows(done.p.id))[0]).toMatchObject({ status: 'skipped', reason: 'done' });
    // Une fois cochée, les rappels suivants (+1 h, +2 h) ne sont même pas planifiés.
    await worker.tick(at('16:00'));
    expect(await rows(done.p.id)).toHaveLength(1);

    const paused = await setup(['15:00']);
    await worker.plan(at('15:00'));
    await h.http().post(`/v1/projects/${paused.p.id}/pause`).set(paused.auth).send({ days: 2 }).expect(200);
    await worker.dispatch(at('15:00'));
    expect((await rows(paused.p.id))[0]).toMatchObject({ status: 'skipped', reason: 'project_inactive' });

    const off = await setup(['15:00']);
    await worker.plan(at('15:00'));
    await h.http().patch('/v1/me/notification-preferences').set(off.auth).send({ remindersEnabled: false }).expect(200);
    await worker.dispatch(at('15:00'));
    expect((await rows(off.p.id))[0]).toMatchObject({ status: 'skipped', reason: 'disabled' });

    const quiet = await setup(['15:00']);
    await h.http().patch('/v1/me/notification-preferences').set(quiet.auth).send({ quietStart: '14:00', quietEnd: '16:00' }).expect(200);
    await worker.tick(at('15:00'));
    expect(await rows(quiet.p.id)).toHaveLength(0); // pas planifié pendant les heures calmes
    expect(push.sent.filter((s) => s.target.token === quiet.token)).toHaveLength(0);
  });

  it('rappels jamais activés par la personne (valeur par défaut) : rien n’est planifié ni envoyé', async () => {
    const u = await registerAndActivate(h);
    const auth = bearer(u.tokens.accessToken);
    const token = `tok-defaut-${'y'.repeat(30)}`;
    await h.http().put('/v1/me/push-device').set(auth).send({ token, platform: 'android' }).expect(200);
    const p = (await h.http().post('/v1/projects').set(auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 7, durationDays: 30 }).expect(201)).body;
    await h.pool.query('update project_tasks set time_of_day = $2 where id = $1', [p.tasks[0].id, '19:00']);
    // Choisir ses heures calmes ne vaut pas activation.
    await h.http().patch('/v1/me/notification-preferences').set(auth).send({ quietStart: '23:00', quietEnd: '05:00' }).expect(200);
    await worker.tick(at('19:00'));
    expect(await rows(p.id)).toHaveLength(0);
    expect(push.sent.filter((s) => s.target.token === token)).toHaveLength(0);
    // Activés ensuite par la personne : le rappel suivant (+1 h) est planifié et envoyé.
    await h.http().patch('/v1/me/notification-preferences').set(auth).send({ remindersEnabled: true }).expect(200);
    await worker.tick(at('20:00'));
    expect(push.sent.filter((s) => s.target.token === token)).toHaveLength(1);
  });

  it('appareil déconnecté : aucun rappel ; interrupteur général coupé : rien n’est planifié', async () => {
    const gone = await setup(['15:00']);
    await worker.plan(at('15:00'));
    await h.http().post('/v1/auth/logout').set(gone.auth).expect(204);
    await worker.dispatch(at('15:00'));
    expect((await rows(gone.p.id))[0]).toMatchObject({ status: 'skipped', reason: 'no_device' });

    const s = await setup(['17:00']);
    await setSetting('notifications.reminders_enabled', false);
    try {
      expect(await worker.tick(at('17:00'))).toEqual({ planned: 0, recovered: 0, dispatched: 0 });
      expect(await rows(s.p.id)).toHaveLength(0);
      expect((await worker.health(at('17:00'))).status).toBe('disabled');
    } finally {
      await setSetting('notifications.reminders_enabled', true);
    }
  });

  it('surveillance : worker actif = ok ; rappels en retard = dégradé ; worker silencieux = arrêté ; visible dans l’administration', async () => {
    const now = at('18:00');
    await worker.tick(now);
    await h.pool.query("update notification_deliveries set status = 'sent' where status in ('pending', 'sending', 'failed', 'stale')"); // isole ce scénario
    expect((await worker.health(now)).status).toBe('ok');
    const s = await setup(['18:00']);
    await worker.plan(now);
    const late = new Date(now.getTime() + 5 * 60_000);
    await worker.beat(late);
    const degraded = await worker.health(late);
    expect(degraded).toMatchObject({ status: 'degraded', enabled: true });
    expect(degraded.overdue).toBeGreaterThanOrEqual(1);
    expect((await worker.health(new Date(late.getTime() + 10 * 60_000))).status).toBe('down');
    await worker.dispatch(late);
    expect(push.sent.filter((x) => x.target.token === s.token)).toHaveLength(1);

    const admin = await adminSession(h, ['super_admin']);
    const res = (await h.http().get('/admin/v1/reminders/health').set(admin).expect(200)).body;
    expect(res).toHaveProperty('status');
    expect(res).toHaveProperty('lastHour.sent');
    const tech = await adminSession(h, ['tech']);
    await h.http().get('/admin/v1/reminders/health').set(tech).expect(200);
    const commercial = await adminSession(h, ['commercial']);
    await h.http().get('/admin/v1/reminders/health').set(commercial).expect(403);
  });
});
