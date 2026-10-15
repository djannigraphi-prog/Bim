import { DB } from '../src/database/database.module';
import { LlmProvider, LlmRequest } from '../src/modules/peni/llm-provider';
import { PeniService } from '../src/modules/peni/peni.service';
import { CLOCK, ProjectsService } from '../src/modules/projects/projects.service';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Peni (lot 3, écran 25) : discussion guidée sans IA, brouillon de projet accepté par POST /v1/projects. */
describe('Peni (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function setSetting(key: string, value: unknown, decisionStatus?: string) {
    await h.pool.query('update app_settings set value = $2::jsonb, decision_status = coalesce($3, decision_status) where key = $1', [key, JSON.stringify(value), decisionStatus ?? null]);
    h.settings.invalidate();
  }
  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  const say = (auth: Record<string, string>, id: string, body: object, status = 200) => h.http().post(`/v1/peni/conversations/${id}/messages`).set(auth).send(body).expect(status);

  it('accueil : prénom de la personne, domaines en réponses rapides, discussion relue à l’identique', async () => {
    const u = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body;
    expect(c).toMatchObject({ purpose: 'new_project', status: 'open', engine: 'guided-v1', draft: null });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ role: 'peni', text: 'Coucou Awa ! 🥰 Raconte-moi : qu’est-ce que tu aimerais changer ?', pose: 'wave', safety: null });
    expect(c.messages[0].quickReplies.map((q: { label: string }) => q.label)).toEqual(['Sport', 'Style & look', 'Visage & peau', 'Cheveux & coiffure', 'Ongles & mains', 'Maquillage', 'Bien-être & spa']);
    expect((await h.http().get(`/v1/peni/conversations/${c.id}`).set(u.auth).expect(200)).body).toEqual(c);
    await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'autre' }).expect(400);
  });

  it('conversation de la maquette 25 → brouillon accepté tel quel par POST /v1/projects (mêmes contrôles, R5)', async () => {
    const u = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body;
    let r = (await say(u.auth, c.id, { text: 'Je veux perdre du ventre avant mon mariage en décembre. Mais j’ai pas trop le temps la semaine 😅' })).body;
    expect(r.status).toBe('open');
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'peni']);
    expect(r.messages[1].text).toContain('Félicitations pour le mariage');
    r = (await say(u.auth, c.id, { text: 'En salle, le samedi et le dimanche matin' })).body;
    r = (await say(u.auth, c.id, { choice: 'mode:premium' })).body;
    expect(r.messages[0]).toMatchObject({ role: 'user', text: 'Premium' }); // le libellé du bouton, pas son identifiant
    r = (await say(u.auth, c.id, { choice: 'budget:medium' })).body;
    expect(r.status).toBe('completed');
    expect(r.draft).toMatchObject({ mode: 'premium', budget: 'medium', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 2, availability: 'morning' });
    expect(r.messages[1].summary).toContainEqual({ label: 'Catégorie', value: 'Sport · Abdos' });

    // Relue : tous les messages dans l'ordre, brouillon conservé.
    const full = (await h.http().get(`/v1/peni/conversations/${c.id}`).set(u.auth).expect(200)).body;
    expect(full.messages.map((m: { role: string }) => m.role)).toEqual(['peni', 'user', 'peni', 'user', 'peni', 'user', 'peni', 'user', 'peni']);
    expect(full).toMatchObject({ status: 'completed', draft: r.draft });

    // La personne confirme : le projet est créé par la route normale.
    const p = (await h.http().post('/v1/projects').set(u.auth).send(r.draft).expect(201)).body;
    const row = (await h.pool.query('select mode, budget, category_code, goal_code, sessions_per_week, availability, duration_days from projects where id = $1', [p.id])).rows[0];
    expect(row).toEqual({ mode: 'premium', budget: 'medium', category_code: 'sport', goal_code: 'sport_abdos', sessions_per_week: 2, availability: 'morning', duration_days: 30 });
  });

  it('domaine sans liste d’objectifs, uniquement avec les boutons, mode connu de l’écran 19 : brouillon valide', async () => {
    const u = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project', mode: 'eco' }).expect(201)).body;
    await say(u.auth, c.id, { choice: 'cat:maquillage' });
    await say(u.auth, c.id, { text: 'Apprendre à me maquiller pour le travail' });
    await say(u.auth, c.id, { choice: 'sessions:3' });
    const r = (await say(u.auth, c.id, { choice: 'avail:afternoon' })).body; // pas de question sur le mode
    expect(r.messages[1].quickReplies.map((q: { id: string }) => q.id)).toEqual(['dur:30', 'dur:60', 'dur:90']);
    const done = (await say(u.auth, c.id, { choice: 'dur:60' })).body;
    expect(done.draft).toEqual({ mode: 'eco', categoryCode: 'maquillage', description: 'Apprendre à me maquiller pour le travail', sessionsPerWeek: 3, availability: 'afternoon', durationDays: 60 });
    await h.http().post('/v1/projects').set(u.auth).send(done.draft).expect(201);
  });

  it('santé et urgence : messages de prudence enregistrés, sans avis médical', async () => {
    const u = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body;
    const health = (await say(u.auth, c.id, { text: 'Je veux maigrir mais je suis enceinte' })).body;
    expect(health.messages.map((m: { safety: string | null }) => m.safety)).toEqual([null, 'health', null]);
    const urgent = (await say(u.auth, c.id, { text: 'je veux en finir' })).body;
    expect(urgent.messages[1]).toMatchObject({ safety: 'urgent' });
    expect(urgent.messages[1].text).toContain('185');
    expect(urgent.messages[1].quickReplies).toEqual([{ id: 'continue', label: 'Reprendre mon projet' }]);
  });

  it('contrôles : réponse rapide non proposée, message vide ou double, trop long ; discussion d’une autre personne invisible', async () => {
    const u = await user();
    const other = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body;
    const bad = (await say(u.auth, c.id, { choice: 'mode:eco' }, 400)).body;
    expect(bad.error.details.fields.choice[0]).toContain('n’est plus proposée');
    await say(u.auth, c.id, {}, 400);
    await say(u.auth, c.id, { text: '   ' }, 400);
    await say(u.auth, c.id, { text: 'abdos', choice: 'cat:sport' }, 400);
    await say(u.auth, c.id, { text: 'x'.repeat(501) }, 400);
    await h.http().get(`/v1/peni/conversations/${c.id}`).set(other.auth).expect(404);
    await say(other.auth, c.id, { text: 'abdos' }, 404);
    await h.http().get(`/v1/peni/conversations/${c.id}`).expect(401);
    // Rien n'a été enregistré par les essais refusés.
    expect((await h.http().get(`/v1/peni/conversations/${c.id}`).set(u.auth).expect(200)).body.messages).toHaveLength(1);
  });

  it('limites : messages par 24 heures et par discussion (réglages administrables)', async () => {
    const u = await user();
    await setSetting('peni.daily_message_limit', 2);
    try {
      const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body;
      await say(u.auth, c.id, { text: 'salut' });
      await say(u.auth, c.id, { text: 'bonjour' });
      const limited = (await say(u.auth, c.id, { text: 'abdos' }, 429)).body;
      expect(limited.error.details).toMatchObject({ reason: 'PENI_DAILY_LIMIT', limit: 2 });
      await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(429);
    } finally {
      await setSetting('peni.daily_message_limit', 100);
    }
    await setSetting('peni.conversation_max_messages', 2);
    try {
      const v = await user();
      const c = (await h.http().post('/v1/peni/conversations').set(v.auth).send({ purpose: 'new_project' }).expect(201)).body;
      await say(v.auth, c.id, { text: 'salut' });
      await say(v.auth, c.id, { text: 'bonjour' });
      expect((await say(v.auth, c.id, { text: 'abdos' }, 409)).body.error.code).toBe('PENI_CONVERSATION_TOO_LONG');
    } finally {
      await setSetting('peni.conversation_max_messages', 60);
    }
  });

  it('deux messages envoyés en même temps : traités l’un après l’autre, ordre des messages sans trou', async () => {
    const u = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body;
    await Promise.all([say(u.auth, c.id, { text: 'des abdos' }), say(u.auth, c.id, { text: '3 fois le matin' })]);
    const seqs = (await h.pool.query('select seq from peni_messages where conversation_id = $1 order by seq', [c.id])).rows.map((r: { seq: number }) => r.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('IA : aucun fournisseur branché ; même branché, rien n’est envoyé sans réglage validé par le fondateur', async () => {
    const calls: LlmRequest[] = [];
    const spy: LlmProvider = { name: 'espion', available: true, complete: async (r) => (calls.push(r), { text: 'x', inputTokens: 0, outputTokens: 0 }) };
    const service = new PeniService(h.app.get(DB), h.settings, h.app.get(ProjectsService), h.app.get(CLOCK), spy);
    expect(await h.app.get(PeniService).llmAllowed()).toBe(false); // fournisseur « none »
    expect(await service.llmAllowed()).toBe(false); // réglage à false, « pending »
    await setSetting('peni.llm_enabled', true);
    expect(await service.llmAllowed()).toBe(false); // true mais pas « decided »
    await setSetting('peni.llm_enabled', false, 'pending');

    const u = await user();
    const c = await service.start(u.userId, { purpose: 'new_project' });
    await service.send(u.userId, c.id, { text: 'Je veux perdre 5 kg, 3 fois par semaine le matin' });
    await service.send(u.userId, c.id, { choice: 'mode:eco' });
    expect(calls).toHaveLength(0);
  });

  it('« Pas sûr ? » (écran 21) : objectif choisi avec Peni, brouillon partiel, discussion terminée sans questions de séances', async () => {
    const u = await user();
    const c = (await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'choose_goal', categoryCode: 'sport', mode: 'eco' }).expect(201)).body;
    expect(c.purpose).toBe('choose_goal');
    expect(c.messages[0].text).toContain('Pas de souci, on va trouver ensemble');
    const r = (await say(u.auth, c.id, { text: 'Je voudrais perdre 6 kg' })).body;
    expect(r).toMatchObject({ status: 'completed', draft: { categoryCode: 'sport', goalCode: 'sport_perte_poids', targetQuantity: 6 } });
    expect(r.messages[1].summary).toContainEqual({ label: 'Objectif', value: 'Perte de poids · 6 kg' });
    await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'choose_goal', categoryCode: 'x'.repeat(41) }).expect(400);
  });

  describe('encouragements (écrans 26 et 27)', () => {
    const hhmm = (offsetMinutes: number) => {
      const d = new Date(Date.now() + offsetMinutes * 60_000); // Abidjan = UTC
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    };
    async function project() {
      const u = await user();
      const p = (await h.http().post('/v1/projects').set(u.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 7, durationDays: 30 }).expect(201)).body;
      // Heures calmes personnelles loin de l'heure actuelle : le test ne dépend pas de l'heure à laquelle il tourne.
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: hhmm(180), quietEnd: hhmm(240) }).expect(200);
      return { u, p };
    }
    const get = (auth: Record<string, string>, id: string, query: string, status = 200) => h.http().get(`/v1/peni/projects/${id}/encouragement?${query}`).set(auth).expect(status);

    it('journée et carte : message selon l’état du jour ; « tout est fait » après les coches', async () => {
      const { u, p } = await project();
      const first = (await get(u.auth, p.id, 'context=day')).body;
      expect(first).toMatchObject({ key: 'first_day', text: 'C’est le premier jour ! 🎉 On commence ensemble ?', pose: 'wave', version: 'v1' });
      expect((await get(u.auth, p.id, 'context=map')).body.key).toBe('first_day');
      const day = (await h.http().get(`/v1/projects/${p.id}/days/${p.today}`).set(u.auth).expect(200)).body;
      for (const t of day.tasks) await h.http().put(`/v1/projects/${p.id}/days/${p.today}/tasks/${t.id}/done`).set(u.auth).expect(200);
      expect((await get(u.auth, p.id, `context=day&day=${p.today}`)).body).toMatchObject({ key: 'today_done', pose: 'cheer' });
    });

    it('heures calmes de la personne : aucun appel à faire une tâche', async () => {
      const { u, p } = await project();
      await h.http().patch('/v1/me/notification-preferences').set(u.auth).send({ quietStart: hhmm(-60), quietEnd: hhmm(60) }).expect(200);
      const r = (await get(u.auth, p.id, 'context=map')).body;
      expect(['quiet_night', 'quiet_early', 'quiet_calm']).toContain(r.key);
      expect(r.text).not.toMatch(/on commence|on y va/i);
    });

    it('contrôles : contexte et jour validés, projet d’une autre personne invisible', async () => {
      const { u, p } = await project();
      const other = await user();
      await get(u.auth, p.id, 'context=autre', 400);
      await get(u.auth, p.id, 'context=day&day=15-10-2026', 400);
      await get(u.auth, p.id, 'context=day&day=2020-01-01', 400);
      await get(other.auth, p.id, 'context=day', 404);
      await h.http().get(`/v1/peni/projects/${p.id}/encouragement?context=day`).expect(401);
    });
  });
});
