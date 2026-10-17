import { PENI_RETENTION_BATCH, PeniRetentionService } from '../src/modules/maintenance/peni-retention.service';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Conservation des discussions avec Peni (lot 3) : mécanisme configurable, inactif tant que la durée n'est pas
 * validée par le fondateur ; suppression vérifiable (discussions et messages), sans toucher aux discussions récentes.
 */
describe('Conservation des discussions avec Peni (e2e)', () => {
  let h: Harness;
  let retention: PeniRetentionService;

  async function setRetention(value: number | null, decisionStatus: 'decided' | 'pending') {
    await h.pool.query(`update app_settings set value = $1::jsonb, decision_status = $2 where key = 'peni.conversation_retention_days'`, [JSON.stringify(value), decisionStatus]);
    h.settings.invalidate();
  }
  async function conversation(auth: Record<string, string>, ageDays: number) {
    const c = (await h.http().post('/v1/peni/conversations').set(auth).send({ purpose: 'new_project' }).expect(201)).body;
    await h.http().post(`/v1/peni/conversations/${c.id}/messages`).set(auth).send({ text: 'Je veux des abdos' }).expect(200);
    await h.pool.query(`update peni_conversations set updated_at = now() - make_interval(days => $2::int) where id = $1`, [c.id, ageDays]);
    return c.id as string;
  }
  const exists = async (id: string) => (await h.pool.query('select 1 from peni_conversations where id = $1', [id])).rows.length === 1;
  const messages = async (id: string) => (await h.pool.query('select count(*)::int as n from peni_messages where conversation_id = $1', [id])).rows[0].n;

  beforeAll(async () => {
    h = await startHarness();
    retention = h.app.get(PeniRetentionService);
  });
  beforeEach(async () => {
    await setRetention(null, 'pending');
    await h.pool.query(`delete from maintenance_runs where job = 'peni_retention'`);
  });
  afterAll(async () => {
    // Décision du 17/10/2026 (20 h 10) : 1 an sans activité (état livré par la migration 0048).
    await setRetention(365, 'decided');
    await h.close();
  });

  it('sans durée fixée : rien n’est supprimé', async () => {
    expect(await retention.config()).toEqual({ retentionDays: null, decided: false, active: false });
    const u = await registerAndActivate(h);
    const old = await conversation(bearer(u.tokens.accessToken), 800);
    expect(await retention.runScheduled()).toEqual({ status: 'not_configured', deleted: 0, runId: null });
    expect(await exists(old)).toBe(true);
  });

  it('durée saisie mais pas validée : rien n’est supprimé, le nombre de discussions expirées est visible', async () => {
    const u = await registerAndActivate(h);
    const old = await conversation(bearer(u.tokens.accessToken), 100);
    await setRetention(60, 'pending');
    expect(await retention.config()).toEqual({ retentionDays: 60, decided: false, active: false });
    expect(await retention.expiredCount()).toBeGreaterThanOrEqual(1);
    expect((await retention.runScheduled()).status).toBe('not_configured');
    expect(await exists(old)).toBe(true);
    // Une durée trop courte, même validée, est refusée (garde-fou).
    await setRetention(3, 'decided');
    expect((await retention.config()).active).toBe(false);
    expect((await retention.runScheduled()).status).toBe('not_configured');
    expect(await exists(old)).toBe(true);
  });

  it('durée validée : seules les discussions sans activité depuis la durée sont supprimées, avec leurs messages', async () => {
    const a = await registerAndActivate(h);
    const b = await registerAndActivate(h);
    const authA = bearer(a.tokens.accessToken);
    const expiredA = await conversation(authA, 61);
    const expiredB = await conversation(bearer(b.tokens.accessToken), 400);
    const recentA = await conversation(authA, 59);
    const todayB = await conversation(bearer(b.tokens.accessToken), 0);
    expect(await messages(expiredA)).toBeGreaterThan(0);

    await setRetention(60, 'decided');
    const r = await retention.runScheduled();
    expect(r.status).toBe('ok');
    expect(r.deleted).toBeGreaterThanOrEqual(2);
    expect(await exists(expiredA)).toBe(false);
    expect(await exists(expiredB)).toBe(false);
    expect(await messages(expiredA)).toBe(0);
    expect(await exists(recentA)).toBe(true);
    expect(await exists(todayB)).toBe(true);
    expect(await messages(recentA)).toBeGreaterThan(0);
    // Plus rien d'expiré ; la discussion supprimée n'est plus lisible par l'app.
    expect(await retention.expiredCount()).toBe(0);
    await h.http().get(`/v1/peni/conversations/${expiredA}`).set(authA).expect(404);
    await h.http().get(`/v1/peni/conversations/${recentA}`).set(authA).expect(200);

    // Trace : passage enregistré et audit sans contenu ni identifiant de personne.
    const run = (await h.pool.query('select job, status, deleted, details from maintenance_runs where id = $1', [r.runId])).rows[0];
    expect(run).toEqual({ job: 'peni_retention', status: 'ok', deleted: r.deleted, details: { retentionDays: 60 } });
    const audit = (await h.pool.query(`select actor_type, metadata from audit_logs where action = 'maintenance.peni_retention' and target_id = $1`, [r.runId])).rows;
    expect(audit).toEqual([{ actor_type: 'system', metadata: { retentionDays: 60, deleted: r.deleted } }]);
    // Un seul passage par jour.
    expect((await retention.runScheduled()).status).toBe('already_done');
  });

  it('suppression par lots : plus d’un lot de discussions expirées, toutes supprimées en un passage', async () => {
    const u = await registerAndActivate(h);
    const n = PENI_RETENTION_BATCH + 5;
    await h.pool.query(
      `insert into peni_conversations (id, user_id, purpose, status, engine, state, created_at, updated_at)
       select gen_random_uuid(), $1, 'new_project', 'open', 'guided-v1', '{}'::jsonb, now() - interval '200 days', now() - interval '200 days' from generate_series(1, $2::int)`,
      [u.userId, n],
    );
    await setRetention(90, 'decided');
    const r = await retention.runScheduled();
    expect(r.deleted).toBeGreaterThanOrEqual(n);
    expect((await h.pool.query('select count(*)::int as n from peni_conversations where user_id = $1', [u.userId])).rows[0].n).toBe(0);
  });

  it('passages simultanés : un seul supprime', async () => {
    const u = await registerAndActivate(h);
    const ids = [await conversation(bearer(u.tokens.accessToken), 50), await conversation(bearer(u.tokens.accessToken), 51)];
    await setRetention(30, 'decided');
    const results = await Promise.all([retention.runScheduled(), retention.runScheduled(), retention.runScheduled()]);
    expect(results.filter((x) => x.status === 'ok')).toHaveLength(1);
    expect(results.filter((x) => x.status !== 'ok').every((x) => ['locked', 'already_done'].includes(x.status) && x.deleted === 0)).toBe(true);
    expect((await h.pool.query(`select count(*)::int as n from maintenance_runs where job = 'peni_retention'`)).rows[0].n).toBe(1);
    for (const id of ids) expect(await exists(id)).toBe(false);
  });

  it('administration : état visible avec la permission de surveillance, refusé sans', async () => {
    await setRetention(120, 'pending');
    const tech = await adminSession(h, ['tech']);
    const commercial = await adminSession(h, ['commercial']);
    const view = (await h.http().get('/admin/v1/maintenance/peni-retention').set(tech).expect(200)).body;
    expect(view).toMatchObject({ retentionDays: 120, decided: false, active: false, minDays: 7, runs: [] });
    expect(typeof view.expired).toBe('number');
    await h.http().get('/admin/v1/maintenance/peni-retention').set(commercial).expect(403);
  });
});
