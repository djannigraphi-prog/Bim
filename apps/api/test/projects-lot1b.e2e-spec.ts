import sharp from 'sharp';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 1, suite : programmes par mode, habitudes du jour, catégories administrables, signalements, mesures, photos. */
describe('Projets — lot 1, suite (e2e)', () => {
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

  describe('programmes types par mode (C6) et habitudes du jour', () => {
    it('un programme économique sert aux projets économiques, un Premium aux projets Premium ; conseils seulement s’ils sont validés', async () => {
      const sa = await adminSession(h, ['super_admin']);
      const base = { categoryCode: 'ongles_mains', goalCode: null, durationDays: 14 };
      const eco = (
        await h
          .http()
          .post('/admin/v1/programs')
          .set(sa)
          .send({ ...base, mode: 'eco', title: 'Test éco', tasks: [{ title: 'Soin maison test', timeOfDay: '20:00', weekdays: 127 }], tips: [{ day: 1, text: 'Conseil test du jour 1' }, { text: 'Conseil test général' }] })
          .expect(201)
      ).body;
      const premium = (
        await h
          .http()
          .post('/admin/v1/programs')
          .set(sa)
          .send({ ...base, mode: 'premium', title: 'Test premium', tasks: [{ title: 'Soin avec accessoire test', timeOfDay: '20:00', weekdays: 127 }] })
          .expect(201)
      ).body;
      try {
        // Brouillons : jamais utilisés.
        const u0 = await user();
        const draftUse = (await h.http().post('/v1/projects').set(u0.auth).send({ mode: 'eco', categoryCode: 'ongles_mains', description: 'Des ongles solides', durationDays: 30 }).expect(201)).body;
        expect(draftUse.programSource).toBe('answers');
        expect(draftUse.program).toBeNull();
        const day0 = (await h.http().get(`/v1/projects/${draftUse.id}/days/${today()}`).set(u0.auth).expect(200)).body;
        expect(day0.tip).toBeNull();

        await h.http().post(`/admin/v1/programs/${eco.id}/publish`).set(sa).send({ validatedBy: 'Personne test, prothésiste ongulaire' }).expect(200);
        await h.http().post(`/admin/v1/programs/${premium.id}/publish`).set(sa).send({ validatedBy: 'Personne test, prothésiste ongulaire' }).expect(200);

        const u = await user();
        const pe = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'ongles_mains', description: 'Des ongles solides' }).expect(201)).body;
        expect(pe.tasks[0].title).toBe('Soin maison test');
        expect(pe.program).toEqual({ title: 'Test éco', validatedBy: 'Personne test, prothésiste ongulaire' });
        const day1 = (await h.http().get(`/v1/projects/${pe.id}/days/${today()}`).set(u.auth).expect(200)).body;
        expect(day1.tip).toEqual({ text: 'Conseil test du jour 1', validatedBy: 'Personne test, prothésiste ongulaire' });

        const pp = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'premium', budget: 'small', categoryCode: 'ongles_mains', description: 'Des ongles solides' }).expect(201)).body;
        expect(pp.tasks[0].title).toBe('Soin avec accessoire test');
        const dayP = (await h.http().get(`/v1/projects/${pp.id}/days/${today()}`).set(u.auth).expect(200)).body;
        expect(dayP.tip).toBeNull(); // le programme Premium n'a pas de conseils
      } finally {
        await h.http().post(`/admin/v1/programs/${eco.id}/archive`).set(sa).expect(200);
        await h.http().post(`/admin/v1/programs/${premium.id}/archive`).set(sa).expect(200);
      }
    });

    it('prochaine tâche du jour (écrans 18 et 26)', async () => {
      const u = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 7, availability: 'morning', durationDays: 30 }).expect(201)).body;
      expect(p.nextTask).toMatchObject({ title: 'Séance · Abdos', timeOfDay: '07:00' });
      await h.http().put(`/v1/projects/${p.id}/days/${today()}/tasks/${p.tasks[0].id}/done`).set(u.auth).expect(200);
      const list = (await h.http().get('/v1/projects').set(u.auth).expect(200)).body;
      expect(list.items[0].nextTask).toBeNull();
    });
  });

  describe('catégories et objectifs administrables', () => {
    it('création, modification, désactivation ; effet immédiat dans l’app ; contrôles', async () => {
      const commercial = await adminSession(h, ['commercial']);
      const support = await adminSession(h, ['support']);
      const code = `test_${Date.now() % 1_000_000}`;
      await h.http().post('/admin/v1/categories').set(support).send({ code, label: 'Test', icon: 'leaf', tint: '#EAF7EF' }).expect(403);
      await h.http().post('/admin/v1/categories').set(commercial).send({ code, label: 'Test', icon: 'inconnue', tint: 'rouge' }).expect(400);
      await h.http().post('/admin/v1/categories').set(commercial).send({ code, label: 'Catégorie test', icon: 'leaf', tint: '#EAF7EF', sortOrder: 999 }).expect(201);
      await h.http().post('/admin/v1/goals').set(commercial).send({ code: `${code}_g`, categoryCode: code, label: 'Objectif test', quantityUnit: 'cm', quantityMin: 1, quantityMax: 10, titlePattern: 'Gagner' }).expect(400);
      await h.http().post('/admin/v1/goals').set(commercial).send({ code: `${code}_g`, categoryCode: code, label: 'Objectif test', quantityUnit: 'cm', quantityMin: 1, quantityMax: 10, titlePattern: 'Gagner {q} cm' }).expect(201);
      const u = await user();
      let cat = (await h.http().get('/v1/projects/catalog').set(u.auth).expect(200)).body.categories.find((c: { code: string }) => c.code === code);
      expect(cat.goals[0]).toMatchObject({ label: 'Objectif test', quantityUnit: 'cm' });
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: code, goalCode: `${code}_g`, targetQuantity: 4, durationDays: 30 }).expect(201)).body;
      expect(p.title).toBe('Gagner 4 cm');
      await h.http().patch(`/admin/v1/categories/${code}`).set(commercial).send({ label: 'Catégorie renommée', active: false }).expect(200);
      cat = (await h.http().get('/v1/projects/catalog').set(u.auth).expect(200)).body.categories.find((c: { code: string }) => c.code === code);
      expect(cat).toBeUndefined();
      // Le projet déjà créé reste accessible.
      await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200);
      await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: code, description: 'x y z', durationDays: 30 }).expect(400);
    });
  });

  describe('signalements (écran 27)', () => {
    it('la personne signale, le support répond, la réponse est visible ; santé = orientation vers un professionnel', async () => {
      const u = await user();
      const other = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
      await h.http().post(`/v1/projects/${p.id}/reports`).set(other.auth).send({ day: today(), reason: 'other' }).expect(404);
      await h.http().post(`/v1/projects/${p.id}/reports`).set(u.auth).send({ day: '2020-01-01', reason: 'other' }).expect(400);
      const r = (await h.http().post(`/v1/projects/${p.id}/reports`).set(u.auth).send({ day: today(), taskId: p.tasks[0].id, reason: 'health', message: 'Douleur au genou' }).expect(201)).body;
      expect(r).toMatchObject({ status: 'open', healthAdvice: true });
      const sup = await adminSession(h, ['support']);
      const open = (await h.http().get('/admin/v1/reports').set(sup).expect(200)).body.items;
      const mine = open.find((x: { id: string }) => x.id === r.id);
      expect(mine).toMatchObject({ reason: 'health', message: 'Douleur au genou', taskTitle: 'Séance · Abdos', username: u.body.username });
      await h.http().post(`/admin/v1/reports/${r.id}/resolve`).set(sup).send({ resolution: 'Mets le projet en pause et consulte un médecin.' }).expect(200);
      await h.http().post(`/admin/v1/reports/${r.id}/resolve`).set(sup).send({ resolution: 'Encore' }).expect(409);
      const back = (await h.http().get(`/v1/projects/${p.id}/reports`).set(u.auth).expect(200)).body.items[0];
      expect(back).toMatchObject({ status: 'resolved', resolution: 'Mets le projet en pause et consulte un médecin.' });
      const commercial = await adminSession(h, ['commercial']);
      await h.http().get('/admin/v1/reports').set(commercial).expect(403);
    });
  });

  describe('mesures (objectif chiffré)', () => {
    it('point de départ à la création, nouvelle mesure, variation ; refus pour un objectif non chiffré', async () => {
      const u = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_perte_poids', targetQuantity: 10, weightKg: 84, durationDays: 60 }).expect(201)).body;
      expect(p.measurement).toMatchObject({ unit: 'kg', start: 84, latest: 84, change: null });
      await h.pool.query('update project_measurements set day = $2 where project_id = $1', [p.id, '2020-01-01']);
      await h.http().post(`/v1/projects/${p.id}/measurements`).set(u.auth).send({ value: 82.55 }).expect(400);
      const m = (await h.http().post(`/v1/projects/${p.id}/measurements`).set(u.auth).send({ value: 73.6 }).expect(201)).body;
      expect(m).toMatchObject({ start: 84, latest: 73.6, change: -10.4 });
      // Une seule mesure par jour : la dernière remplace.
      const m2 = (await h.http().post(`/v1/projects/${p.id}/measurements`).set(u.auth).send({ value: 73.4 }).expect(201)).body;
      expect(m2.items).toHaveLength(2);
      const abs = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
      expect(abs.measurement).toBeNull();
      await h.http().post(`/v1/projects/${abs.id}/measurements`).set(u.auth).send({ value: 70 }).expect(409);
    });
  });

  describe('photos avant / après (écrans 22 et 31)', () => {
    async function jpegWithGps(): Promise<Buffer> {
      return sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 200, g: 30, b: 60 } } })
        .withExif({ IFD0: { Copyright: 'Test BIM', Artist: 'Personne test' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '5/1 20/1 0/1' } })
        .jpeg()
        .toBuffer();
    }

    it('photo privée, métadonnées et GPS supprimés, lien temporaire, remplacement, suppression, purge avec le projet', async () => {
      const u = await user();
      const other = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
      const original = await jpegWithGps();
      expect((await sharp(original).metadata()).exif).toBeDefined();

      await h.http().post(`/v1/projects/${p.id}/photos?kind=before`).set(other.auth).attach('photo', original, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(404);
      await h.http().post(`/v1/projects/${p.id}/photos?kind=before`).set(u.auth).attach('photo', Buffer.from('pas une image'), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(400);
      await h.http().post(`/v1/projects/${p.id}/photos?kind=before`).set(u.auth).attach('photo', Buffer.from('%PDF'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
      await h.http().post(`/v1/projects/${p.id}/photos?kind=side`).set(u.auth).attach('photo', original, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(400);

      const up = (await h.http().post(`/v1/projects/${p.id}/photos?kind=before`).set(u.auth).attach('photo', original, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201)).body;
      expect(up.items).toHaveLength(1);
      expect(up.items[0]).toMatchObject({ kind: 'before', width: 1600, height: 800 });
      const path = new URL(up.items[0].url).pathname;
      const got = await h.http().get(path).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      const meta = await sharp(got.body as Buffer).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      await h.http().get(path.slice(0, -3) + 'abc').expect(404);
      await h.http().get(`/v1/projects/${p.id}/photos`).set(other.auth).expect(404);

      // Remplacement : l'ancienne photo est effacée du stockage.
      const rows1 = await h.pool.query('select storage_key from project_photos where project_id = $1', [p.id]);
      const firstKey = rows1.rows[0].storage_key as string;
      await h.http().post(`/v1/projects/${p.id}/photos?kind=before`).set(u.auth).attach('photo', original, { filename: 'b.jpg', contentType: 'image/jpeg' }).expect(201);
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      expect(existsSync(join(process.env.MEDIA_LOCAL_DIR!, firstKey))).toBe(false);
      const after = (await h.http().post(`/v1/projects/${p.id}/photos?kind=after`).set(u.auth).attach('photo', original, { filename: 'c.jpg', contentType: 'image/jpeg' }).expect(201)).body;
      expect(after.items.map((x: { kind: string }) => x.kind).sort()).toEqual(['after', 'before']);

      await h.http().delete(`/v1/projects/${p.id}/photos/${after.items.find((x: { kind: string }) => x.kind === 'after').id}`).set(u.auth).expect(204);
      const keys = (await h.pool.query('select storage_key from project_photos where project_id = $1 and deleted_at is null', [p.id])).rows.map((r: { storage_key: string }) => r.storage_key);
      expect(keys).toHaveLength(1);
      await h.http().delete(`/v1/projects/${p.id}`).set(u.auth).expect(204);
      expect(existsSync(join(process.env.MEDIA_LOCAL_DIR!, keys[0]))).toBe(false);
    });
  });

  describe('journal des événements (source prévue des rappels du lot 2 et de Peni au lot 3)', () => {
    it('chaque changement d’horaire ou de suivi laisse un événement, dans l’ordre', async () => {
      const u = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_perte_poids', targetQuantity: 5, weightKg: 80, durationDays: 30 }).expect(201)).body;
      const added = (await h.http().post(`/v1/projects/${p.id}/tasks`).set(u.auth).send({ title: 'Marche', timeOfDay: '07:00', weekdays: 127 }).expect(201)).body;
      const newTask = added.tasks.find((t: { title: string }) => t.title === 'Marche');
      await h.http().delete(`/v1/projects/${p.id}/tasks/${newTask.id}`).set(u.auth).expect(200);
      await h.http().patch(`/v1/projects/${p.id}`).set(u.auth).send({ mode: 'premium', budget: 'small' }).expect(200);
      await h.http().patch(`/v1/projects/${p.id}`).set(u.auth).send({ title: 'Renommé' }).expect(200);
      await h.http().post(`/v1/projects/${p.id}/measurements`).set(u.auth).send({ value: 79.5 }).expect(201);
      await h.http().post(`/v1/projects/${p.id}/pause`).set(u.auth).send({ days: 2 }).expect(200);
      await h.http().post(`/v1/projects/${p.id}/resume`).set(u.auth).expect(200);
      const rows = (await h.pool.query('select type, payload from project_events where project_id = $1 order by id', [p.id])).rows;
      expect(rows.map((r: { type: string }) => r.type)).toEqual(['created', 'task_added', 'task_removed', 'mode_changed', 'measurement_added', 'paused', 'resumed']);
      expect(rows[1].payload).toBe(newTask.id);
      expect(rows[3].payload).toBe('premium');
    });
  });

  describe('coffres du chemin (écran 26, C8)', () => {
    it('semaine à 70 % des tâches prévues : coffre ouvert par rattrapage, événement, refermé si l’on décoche ; tâche ajoutée sans effet sur le passé', async () => {
      const u = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 7, durationDays: 30 }).expect(201)).body;
      // Projet commencé il y a 8 jours (la semaine 1 est terminée, rien n'a été coché).
      await h.pool.query("update projects set start_date = start_date - 8, planned_end_date = planned_end_date - 8 where id = $1", [p.id]);
      const d0 = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
      expect(d0.chests[0]).toMatchObject({ kind: 'week', week: 1, fromIndex: 1, toIndex: 7, due: 7, done: 0, state: 'missed' });
      expect(d0.chests.filter((c: { kind: string }) => c.kind === 'week')).toHaveLength(4);
      expect(d0.chests.at(-1)).toMatchObject({ kind: 'final', fromIndex: 1, toIndex: 30, state: 'upcoming' });
      expect(JSON.stringify(d0.chests)).not.toMatch(/coin|amount|price|montant/i); // aucune valeur financière

      const task = d0.tasks[0].id;
      const week1 = d0.days.slice(0, 7).map((d: { day: string }) => d.day);
      for (const day of week1.slice(0, 4)) await h.http().put(`/v1/projects/${p.id}/days/${day}/tasks/${task}/done`).set(u.auth).expect(200);
      expect((await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body.chests[0]).toMatchObject({ done: 4, state: 'missed' }); // 57 %
      await h.http().put(`/v1/projects/${p.id}/days/${week1[4]}/tasks/${task}/done`).set(u.auth).expect(200);
      expect((await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body.chests[0]).toMatchObject({ done: 5, state: 'open' }); // 71 %
      const events = async () => (await h.pool.query("select payload from project_events where project_id = $1 and type = 'chest_opened'", [p.id])).rows.map((r: { payload: string }) => r.payload);
      expect(await events()).toEqual(['week:1']);
      // Décocher repasse sous le seuil : le coffre se referme (aucun nouvel événement).
      await h.http().delete(`/v1/projects/${p.id}/days/${week1[4]}/tasks/${task}/done`).set(u.auth).expect(200);
      expect((await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body.chests[0].state).toBe('missed');
      expect(await events()).toEqual(['week:1']);

      // Une tâche ajoutée aujourd'hui ne compte pas pour les jours passés (ni pour le coffre de la semaine 1).
      const before = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
      await h.http().post(`/v1/projects/${p.id}/tasks`).set(u.auth).send({ title: 'Gainage', timeOfDay: '18:00', weekdays: 127 }).expect(201);
      const after = (await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body;
      expect(after.days[0]).toEqual(before.days[0]);
      expect(after.chests[0]).toEqual(before.chests[0]);
      expect(after.days[8].due).toBe(before.days[8].due + 1); // aujourd'hui (jour 9) : la nouvelle tâche compte
      // Une tâche retirée garde son historique : le jour 1 coché reste « fait ».
      const gainage = after.tasks.find((t: { title: string }) => t.title === 'Gainage').id;
      await h.http().delete(`/v1/projects/${p.id}/tasks/${gainage}`).set(u.auth).expect(200);
      await h.http().delete(`/v1/projects/${p.id}/tasks/${task}`).set(u.auth).expect(409); // jamais la dernière tâche
      expect((await h.http().get(`/v1/projects/${p.id}`).set(u.auth).expect(200)).body.days[0]).toMatchObject({ state: 'done' });
    });
  });
});
