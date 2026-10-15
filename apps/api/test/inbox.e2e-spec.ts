import { randomUUID } from 'node:crypto';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Centre de notifications (lot 2, écran 17) : lu dans les sources réelles (journal des projets, signalements,
 * rappels envoyés), textes produits à la lecture, état « vu », filtres, pages, et cloisonnement entre personnes.
 */
describe('Centre de notifications (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  it('coffre ouvert, réponse du support et rappel envoyé apparaissent, du plus récent au plus ancien, avec leur lien', async () => {
    const u = await user();
    const other = await user();
    expect((await h.http().get('/v1/me/notifications').set(u.auth).expect(200)).body).toEqual({ templatesVersion: 'v1', items: [], nextBefore: null });
    expect((await h.http().get('/v1/me/notifications/unread-count').set(u.auth).expect(200)).body).toEqual({ count: 0 });

    const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
    const task = p.tasks[0];
    // Coffre de la semaine 1 (événement écrit par le module Projets à l'ouverture d'un coffre), il y a 3 heures.
    await h.pool.query("insert into project_events (id, project_id, type, payload, created_at) values ($1, $2, 'chest_opened', 'week:1', $3)", [randomUUID(), p.id, minutesAgo(180)]);
    // Rappel réellement envoyé par le serveur il y a 2 heures (tentative +1 h).
    await h.pool.query(
      "insert into notification_deliveries (id, key, user_id, project_id, task_id, day, attempt, fire_at, status, sent_at) values ($1, $2, $3, $4, $5, current_date, 1, $6, 'sent', $6)",
      [randomUUID(), `${p.id}|${task.id}|x|1`, u.userId, p.id, task.id, minutesAgo(120)],
    );
    // Rappel jamais envoyé (ignoré, péremption) : n'apparaît pas.
    await h.pool.query(
      "insert into notification_deliveries (id, key, user_id, project_id, task_id, day, attempt, fire_at, status) values ($1, $2, $3, $4, $5, current_date, 0, $6, 'stale')",
      [randomUUID(), `${p.id}|${task.id}|x|0`, u.userId, p.id, task.id, minutesAgo(150)],
    );
    // Signalement auquel le support répond (maintenant).
    const report = (
      await h.http().post('/v1/reports').set(u.auth).field('reason', 'app').field('message', 'Le bouton Continuer ne réagit pas sur l’écran des objectifs.').expect(201)
    ).body;
    const sup = await adminSession(h, ['support']);
    await h.http().post(`/admin/v1/reports/${report.id}/resolve`).set(sup).send({ resolution: 'Corrigé, merci !' }).expect(200);

    const list = (await h.http().get('/v1/me/notifications').set(u.auth).expect(200)).body;
    expect(list.items.map((i: { type: string }) => i.type)).toEqual(['report_answered', 'task_reminder', 'chest_opened']);
    expect(list.items[0]).toMatchObject({ category: 'support', sender: 'bim', text: 'L’équipe BIM a répondu à ton signalement.', unread: true, link: '/reports' });
    expect(list.items[1]).toMatchObject({
      category: 'projects',
      sender: 'peni',
      text: `Petit rappel : ${task.title} t’attend encore aujourd’hui.`,
      link: expect.stringMatching(new RegExp(`^/projects/${p.id}/day/\\d{4}-\\d{2}-\\d{2}$`)),
    });
    expect(list.items[2]).toMatchObject({ sender: 'peni', text: `Coffre de la semaine 1 ouvert pour « ${p.title} ». Continue comme ça !`, link: `/projects/${p.id}` });
    expect(list.nextBefore).toBeNull();
    expect((await h.http().get('/v1/me/notifications/unread-count').set(u.auth).expect(200)).body).toEqual({ count: 3 });

    // Filtres de l'écran : Projets ; « support » pour la réponse de l'équipe.
    const projects = (await h.http().get('/v1/me/notifications?category=projects').set(u.auth).expect(200)).body;
    expect(projects.items.map((i: { type: string }) => i.type)).toEqual(['task_reminder', 'chest_opened']);
    await h.http().get('/v1/me/notifications?category=pieces').set(u.auth).expect(400);

    // Pages : 2 puis 1.
    const first = (await h.http().get('/v1/me/notifications?limit=2').set(u.auth).expect(200)).body;
    expect(first.items).toHaveLength(2);
    expect(first.nextBefore).toBe(first.items[1].at);
    const second = (await h.http().get(`/v1/me/notifications?limit=2&before=${encodeURIComponent(first.nextBefore)}`).set(u.auth).expect(200)).body;
    expect(second.items.map((i: { type: string }) => i.type)).toEqual(['chest_opened']);

    // Ouvert : tout devient « vu » ; une nouvelle notification compte de nouveau.
    await h.http().post('/v1/me/notifications/seen').set(u.auth).expect(200);
    expect((await h.http().get('/v1/me/notifications/unread-count').set(u.auth).expect(200)).body).toEqual({ count: 0 });
    expect((await h.http().get('/v1/me/notifications').set(u.auth).expect(200)).body.items.every((i: { unread: boolean }) => !i.unread)).toBe(true);
    await h.pool.query("insert into project_events (id, project_id, type, payload, created_at) values ($1, $2, 'chest_opened', 'final', now() + interval '1 second')", [randomUUID(), p.id]);
    expect((await h.http().get('/v1/me/notifications/unread-count').set(u.auth).expect(200)).body).toEqual({ count: 1 });
    const final = (await h.http().get('/v1/me/notifications?limit=1').set(u.auth).expect(200)).body.items[0];
    expect(final).toMatchObject({ unread: true, text: `Tu as ouvert le grand coffre de « ${p.title} ». Bravo, je suis fière de toi !` });

    // Cloisonnement : rien de tout cela chez une autre personne.
    expect((await h.http().get('/v1/me/notifications').set(other.auth).expect(200)).body.items).toEqual([]);
    await h.http().get('/v1/me/notifications').expect(401);
  });

  it('au-delà de 30 jours, une notification n’est plus affichée', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
    await h.pool.query("insert into project_events (id, project_id, type, payload, created_at) values ($1, $2, 'chest_opened', 'week:2', now() - interval '31 days')", [randomUUID(), p.id]);
    expect((await h.http().get('/v1/me/notifications').set(u.auth).expect(200)).body.items).toEqual([]);
    expect((await h.http().get('/v1/me/notifications/unread-count').set(u.auth).expect(200)).body).toEqual({ count: 0 });
  });
});
