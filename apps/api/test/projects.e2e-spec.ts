import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 1 — projets BIM, contre la vraie base. Les dates passées sont simulées en déplaçant le début du projet en base. */
describe('Projets (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const today = () => new Date().toISOString().slice(0, 10);
  const shift = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const sport = {
    mode: 'premium',
    budget: 'medium',
    categoryCode: 'sport',
    goalCode: 'sport_perte_poids',
    targetQuantity: 10,
    availability: 'afternoon',
    sessionsPerWeek: 7,
    level: 'intermediate',
    heightCm: 172,
    weightKg: 84,
    durationDays: 60,
  };

  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }

  it('catalogue : 7 catégories des maquettes, objectifs du sport, aucun modèle validé', async () => {
    const u = await user();
    const r = await h.http().get('/v1/projects/catalog').set(u.auth).expect(200);
    expect(r.body.categories.map((c: { code: string }) => c.code)).toHaveLength(7);
    const s = r.body.categories.find((c: { code: string }) => c.code === 'sport');
    expect(s.goals.find((g: { code: string }) => g.code === 'sport_perte_poids').quantityUnit).toBe('kg');
    expect(r.body.categories.every((c: { hasValidatedPrograms: boolean }) => !c.hasValidatedPrograms)).toBe(true);
    expect(r.body.maxActive).toBe(5);
  });

  it('visiteur refusé', async () => {
    await h.http().get('/v1/projects').expect(401);
  });

  it('crée un projet : titre généré, programme issu des réponses, aucune somme à payer', async () => {
    const u = await user();
    const r = await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201);
    expect(r.body.title).toBe('Perdre 10 kg');
    expect(r.body.programSource).toBe('answers');
    expect(r.body.tasks).toHaveLength(1);
    expect(r.body.tasks[0]).toMatchObject({ timeOfDay: '15:00', weekdays: 127, origin: 'answers' });
    expect(r.body.totalSteps).toBe(60);
    expect(r.body.currentDay).toBe(1);
    expect(r.body.progress).toBe(0);
    expect(JSON.stringify(r.body)).not.toMatch(/price|amount|payment/i);
    const list = await h.http().get('/v1/projects').set(u.auth).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.activeCount).toBe(1);
  });

  it('valide les réponses : quantité, budget, durée, objectif de la bonne catégorie', async () => {
    const u = await user();
    const r = await h
      .http()
      .post('/v1/projects')
      .set(u.auth)
      .send({ ...sport, targetQuantity: undefined, budget: undefined, durationDays: 45 })
      .expect(400);
    expect(Object.keys(r.body.error.details.fields).sort()).toEqual(['budget', 'durationDays', 'targetQuantity']);
    const r2 = await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'maquillage', goalCode: 'sport_abdos', durationDays: 30 }).expect(400);
    expect(r2.body.error.details.fields.goalCode).toBeDefined();
    const r3 = await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'maquillage', durationDays: 30 }).expect(400);
    expect(r3.body.error.details.fields.description).toBeDefined();
    const ok = await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'maquillage', description: 'Apprendre un maquillage naturel', durationDays: 30 }).expect(201);
    expect(ok.body.title).toBe('Apprendre un maquillage naturel');
  });

  it('limite de 5 projets en cours, y compris en créations simultanées', async () => {
    const u = await user();
    const results = await Promise.all(Array.from({ length: 7 }, () => h.http().post('/v1/projects').set(u.auth).send(sport)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const refused = results.filter((r) => r.status === 409);
    expect(refused).toHaveLength(2);
    expect(refused[0].body.error.code).toBe('PROJECT_LIMIT_REACHED');
  });

  it('journée : cocher, décocher ; pas de case dans le futur', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    const t = today();
    const day = await h.http().get(`/v1/projects/${p.id}/days/${t}`).set(u.auth).expect(200);
    expect(day.body.tasks).toHaveLength(1);
    expect(day.body.editable).toBe(true);
    const taskId = day.body.tasks[0].id;
    const checked = await h.http().put(`/v1/projects/${p.id}/days/${t}/tasks/${taskId}/done`).set(u.auth).expect(200);
    expect(checked.body.tasks[0].done).toBe(true);
    await h.http().put(`/v1/projects/${p.id}/days/${t}/tasks/${taskId}/done`).set(u.auth).expect(200); // idempotent
    const d = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
    expect(d.completedSteps).toBe(1);
    expect(d.streak).toBe(1);
    const unchecked = await h.http().delete(`/v1/projects/${p.id}/days/${t}/tasks/${taskId}/done`).set(u.auth).expect(200);
    expect(unchecked.body.tasks[0].done).toBe(false);
    const future = await h.http().put(`/v1/projects/${p.id}/days/${shift(t, 1)}/tasks/${taskId}/done`).set(u.auth).expect(409);
    expect(future.body.error.code).toBe('DAY_NOT_EDITABLE');
  });

  it('un jour passé peut être rattrapé ; jour de programme et jours manqués', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    const start = shift(today(), -4);
    await h.pool.query('update projects set start_date = $2, planned_end_date = $3 where id = $1', [p.id, start, shift(start, 59)]);
    const taskId = p.tasks[0].id;
    await h.http().put(`/v1/projects/${p.id}/days/${start}/tasks/${taskId}/done`).set(u.auth).expect(200);
    const d = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
    expect(d.currentDay).toBe(5);
    expect(d.days.slice(0, 5).map((x: { state: string }) => x.state)).toEqual(['done', 'missed', 'missed', 'missed', 'today']);
  });

  it('pause : fin prévue décalée, cases bloquées, reprise anticipée qui rend les jours', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    const end = p.plannedEndDate;
    const paused = (await h.http().post(`/v1/projects/${p.id}/pause`).set(u.auth).send({ days: 3 }).expect(200)).body;
    expect(paused.status).toBe('paused');
    expect(paused.plannedEndDate).toBe(shift(end, 3));
    const t = today();
    const blocked = await h.http().put(`/v1/projects/${p.id}/days/${t}/tasks/${p.tasks[0].id}/done`).set(u.auth).expect(409);
    expect(blocked.body.error.code).toBe('DAY_NOT_EDITABLE');
    await h.http().post(`/v1/projects/${p.id}/pause`).set(u.auth).send({ days: 1 }).expect(409);
    const resumed = (await h.http().post(`/v1/projects/${p.id}/resume`).set(u.auth).expect(200)).body;
    expect(resumed.status).toBe('active');
    expect(resumed.plannedEndDate).toBe(end);
    expect(resumed.days.some((x: { state: string }) => x.state === 'paused')).toBe(false);
  });

  it('pause terminée : le projet reprend tout seul', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    await h.http().post(`/v1/projects/${p.id}/pause`).set(u.auth).send({ days: 2 }).expect(200);
    const y = shift(today(), -1);
    await h.pool.query('update projects set paused_until = $2 where id = $1', [p.id, y]);
    await h.pool.query('update project_pauses set start_day = $2, end_day = $2 where project_id = $1', [p.id, y]);
    const d = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
    expect(d.status).toBe('active');
  });

  it('tâches : ajout, retrait logique, jamais la dernière', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    await h.http().delete(`/v1/projects/${p.id}/tasks/${p.tasks[0].id}`).set(u.auth).expect(409);
    const added = (await h.http().post(`/v1/projects/${p.id}/tasks`).set(u.auth).send({ title: 'Étirements', detail: '15 min', timeOfDay: '21:00', weekdays: 127 }).expect(201)).body;
    expect(added.tasks).toHaveLength(2);
    expect(added.totalSteps).toBe(120);
    await h.http().post(`/v1/projects/${p.id}/tasks`).set(u.auth).send({ title: 'X', timeOfDay: '25:00', weekdays: 0 }).expect(400);
    const removed = (await h.http().delete(`/v1/projects/${p.id}/tasks/${p.tasks[0].id}`).set(u.auth).expect(200)).body;
    expect(removed.tasks.map((t: { title: string }) => t.title)).toEqual(['Étirements']);
    const row = await h.pool.query('select removed_at from project_tasks where id = $1', [p.tasks[0].id]);
    expect(row.rows[0].removed_at).not.toBeNull();
  });

  it('renommer, rendre public, supprimer (logique) ; un autre compte ne voit rien', async () => {
    const u = await user();
    const other = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    await h.http().get(`/v1/projects/${p.id}`).set(other.auth).expect(404);
    await h.http().put(`/v1/projects/${p.id}/days/${today()}/tasks/${p.tasks[0].id}/done`).set(other.auth).expect(404);
    const upd = (await h.http().patch(`/v1/projects/${p.id}`).set(u.auth).send({ title: 'Mariage en forme', isPublic: true }).expect(200)).body;
    expect(upd).toMatchObject({ title: 'Mariage en forme', isPublic: true });
    await h.http().delete(`/v1/projects/${p.id}`).set(other.auth).expect(404);
    await h.http().delete(`/v1/projects/${p.id}`).set(u.auth).expect(204);
    await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(404);
    const row = await h.pool.query('select status from projects where id = $1', [p.id]);
    expect(row.rows[0].status).toBe('abandoned');
    expect((await h.http().get('/v1/projects').set(u.auth).expect(200)).body.items).toHaveLength(0);
  });

  it('fin du programme : le projet passe « terminé » et libère une place', async () => {
    const u = await user();
    const p = (await h.http().post('/v1/projects').set(u.auth).send(sport).expect(201)).body;
    const start = shift(today(), -30);
    await h.pool.query('update projects set start_date = $2, planned_end_date = $3, duration_days = 30 where id = $1', [p.id, start, shift(start, 29)]);
    const d = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
    expect(d.status).toBe('completed');
    const list = (await h.http().get('/v1/projects').set(u.auth).expect(200)).body;
    expect(list.activeCount).toBe(0);
    await h.http().put(`/v1/projects/${p.id}/days/${start}/tasks/${p.tasks[0].id}/done`).set(u.auth).expect(409);
  });

  it('modèle validé et publié : utilisé à la place des réponses', async () => {
    const tid = '01900000-0000-7000-8000-00000000a001';
    await h.pool.query(
      "insert into program_templates (id, category_code, goal_code, title, duration_days, status, validated_by) values ($1, 'ongles_mains', null, 'Test', 14, 'published', 'test e2e')",
      [tid],
    );
    await h.pool.query(
      "insert into program_template_tasks (id, template_id, title, time_of_day, weekdays, sort_order) values ('01900000-0000-7000-8000-00000000b001', $1, 'Tâche du modèle', '08:00', 127, 0)",
      [tid],
    );
    try {
      const u = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'ongles_mains', description: 'Des ongles solides' }).expect(201)).body;
      expect(p.programSource).toBe('template');
      expect(p.durationDays).toBe(14);
      expect(p.tasks).toEqual([expect.objectContaining({ title: 'Tâche du modèle', origin: 'template' })]);
      // Un modèle publié sans validation est refusé par la base.
      await expect(
        h.pool.query("insert into program_templates (id, category_code, title, duration_days, status) values ('01900000-0000-7000-8000-00000000a002', 'sport', 'X', 14, 'published')"),
      ).rejects.toThrow(/program_templates_published_validated_ck/);
    } finally {
      await h.pool.query('delete from projects where template_id = $1', [tid]);
      await h.pool.query('delete from program_templates where id = $1', [tid]);
    }
  });
});
