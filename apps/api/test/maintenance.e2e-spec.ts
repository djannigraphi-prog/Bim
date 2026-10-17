import {
  AccountPurgeService,
  PURGE_BLOCKING_TABLES,
  PURGE_CASCADED_TABLES,
  PURGE_MAX_PER_RUN,
} from '../src/modules/maintenance/account-purge.service';
import { MaintenanceRunner } from '../src/modules/maintenance/maintenance-runner';
import { adminSession } from './admin-helpers';
import { Harness, newUser, registerAndActivate, startHarness } from './harness';

/**
 * Purge des comptes jamais vérifiés (lot 2, décision du 15/10/2026) : désactivée et en simulation par défaut,
 * 30 jours, jamais un compte actif ou utilisé, un seul passage à la fois, plafond de 500, audit sans donnée personnelle.
 */
describe('Purge des comptes jamais vérifiés (e2e)', () => {
  let h: Harness;
  let purge: AccountPurgeService;

  async function setSetting(key: string, value: unknown, decisionStatus?: 'decided' | 'pending') {
    await h.pool.query('update app_settings set value = $2::jsonb, decision_status = coalesce($3, decision_status) where key = $1', [key, JSON.stringify(value), decisionStatus ?? null]);
    h.settings.invalidate();
  }
  async function defaults() {
    await setSetting('maintenance.account_purge_enabled', false, 'pending');
    await setSetting('maintenance.account_purge_mode', 'simulation', 'pending');
    await setSetting('maintenance.account_purge_after_days', 30, 'decided');
  }
  async function realModeValidated() {
    await setSetting('maintenance.account_purge_enabled', true, 'decided');
    await setSetting('maintenance.account_purge_mode', 'real', 'decided');
  }
  const exists = async (id: string) => (await h.pool.query('select status from users where id = $1', [id])).rows[0]?.status ?? null;
  const age = (id: string, days: number) => h.pool.query(`update users set created_at = now() - make_interval(days => $2::int) where id = $1`, [id, days]);
  const oldCodes = (id: string) => h.pool.query(`update verification_codes set last_sent_at = now() - interval '3 days', created_at = now() - interval '3 days' where user_id = $1`, [id]);

  /** Compte inscrit par l'API, jamais vérifié, vieilli de `days` jours, dernier code envoyé il y a 3 jours. */
  async function pending(days: number) {
    const reg = await h.http().post('/v1/auth/register').send(newUser()).expect(201);
    const id = reg.body.userId as string;
    await age(id, days);
    await oldCodes(id);
    return id;
  }

  beforeAll(async () => {
    h = await startHarness();
    purge = h.app.get(AccountPurgeService);
  });
  beforeEach(async () => {
    await defaults();
    await h.pool.query(`delete from maintenance_runs`);
  });
  afterAll(async () => {
    await defaults();
    await h.close();
  });

  it('par défaut : désactivée, en simulation, suppression réelle non permise ; le passage quotidien ne fait rien', async () => {
    expect(await purge.config()).toEqual({ enabled: false, mode: 'simulation', realDeletionAllowed: false, afterDays: 30, maxPerRun: 500 });
    const id = await pending(45);
    expect(await purge.runScheduled()).toMatchObject({ status: 'disabled', deleted: 0, runId: null });
    expect(await exists(id)).toBe('pending_verification');
    expect((await h.pool.query('select count(*)::int as n from maintenance_runs')).rows[0].n).toBe(0);
    await h.pool.query('delete from users where id = $1', [id]);
  });

  it('simulation : compte les comptes concernés, ne supprime rien, garde une trace', async () => {
    const ids = [await pending(31), await pending(60)];
    await setSetting('maintenance.account_purge_enabled', true, 'decided');
    const r = await purge.runScheduled();
    expect(r).toMatchObject({ status: 'ok', mode: 'simulation', candidates: 2, deleted: 0 });
    for (const id of ids) expect(await exists(id)).toBe('pending_verification');
    const run = (await h.pool.query('select mode, status, trigger, candidates, deleted from maintenance_runs where id = $1', [r.runId])).rows[0];
    expect(run).toEqual({ mode: 'simulation', status: 'ok', trigger: 'schedule', candidates: 2, deleted: 0 });
    const audit = (await h.pool.query(`select actor_type, metadata from audit_logs where action = 'maintenance.account_purge' and target_id = $1`, [r.runId])).rows;
    expect(audit).toEqual([{ actor_type: 'system', metadata: { mode: 'simulation', status: 'ok', trigger: 'schedule', candidates: 2, deleted: 0 } }]);
    // Mode « real » demandé mais pas validé (réglages « pending ») : toujours une simulation.
    await h.pool.query(`delete from maintenance_runs`);
    await setSetting('maintenance.account_purge_mode', 'real', 'pending');
    expect(await purge.config()).toMatchObject({ mode: 'real', realDeletionAllowed: false });
    expect(await purge.runScheduled()).toMatchObject({ status: 'ok', mode: 'simulation', deleted: 0 });
    for (const id of ids) expect(await exists(id)).toBe('pending_verification');
    await h.pool.query('delete from users where id = any($1::uuid[])', [ids]);
  });

  it('mode réel validé : seuls les comptes jamais vérifiés de plus de 30 jours sont supprimés ; les autres ne sont jamais touchés', async () => {
    const eligible = [await pending(31), await pending(400)];

    const protectedIds: Record<string, string> = {};
    // Comptes actifs (vérifiés), même très anciens.
    const active = await registerAndActivate(h);
    await age(active.userId, 400);
    protectedIds.active = active.userId;
    // Suspendu et supprimé (statuts).
    const suspended = await registerAndActivate(h);
    await age(suspended.userId, 400);
    await h.pool.query(`update users set status = 'suspended' where id = $1`, [suspended.userId]);
    protectedIds.suspended = suspended.userId;
    const deleted = await registerAndActivate(h);
    await age(deleted.userId, 400);
    await h.pool.query(`update users set status = 'deleted', deleted_at = now() where id = $1`, [deleted.userId]);
    protectedIds.deleted = deleted.userId;
    // Jamais vérifiés mais récents (29 jours).
    protectedIds.recent = await pending(29);
    // Jamais vérifié, ancien, mais un code a été envoyé il y a moins de 24 h (vérification en cours).
    protectedIds.recentCode = await pending(45);
    await h.pool.query(`update verification_codes set last_sent_at = now() - interval '23 hours' where user_id = $1`, [protectedIds.recentCode]);
    // Statut « pending_verification » incohérent mais compte utilisé : coordonnée vérifiée, sessions, connexion.
    const used = await registerAndActivate(h);
    await age(used.userId, 400);
    await oldCodes(used.userId);
    await h.pool.query(`update users set status = 'pending_verification' where id = $1`, [used.userId]);
    protectedIds.usedWithSessionAndContact = used.userId;
    protectedIds.verifiedContact = await pending(45);
    await h.pool.query(`update user_contacts set verified_at = now() - interval '40 days' where user_id = $1`, [protectedIds.verifiedContact]);
    protectedIds.loggedIn = await pending(45);
    await h.pool.query(`update users set last_login_at = now() - interval '40 days' where id = $1`, [protectedIds.loggedIn]);

    await realModeValidated();
    expect(await purge.config()).toMatchObject({ enabled: true, mode: 'real', realDeletionAllowed: true });
    const contactsBefore = (await h.pool.query('select count(*)::int as n from user_contacts where user_id = any($1::uuid[])', [eligible])).rows[0].n;
    expect(contactsBefore).toBeGreaterThan(0);

    const r = await purge.runScheduled();
    expect(r).toMatchObject({ status: 'ok', mode: 'real', candidates: 2, deleted: 2 });
    for (const id of eligible) expect(await exists(id)).toBeNull();
    // Cascade : coordonnées non vérifiées et codes supprimés avec le compte.
    expect((await h.pool.query('select count(*)::int as n from user_contacts where user_id = any($1::uuid[])', [eligible])).rows[0].n).toBe(0);
    expect((await h.pool.query('select count(*)::int as n from verification_codes where user_id = any($1::uuid[])', [eligible])).rows[0].n).toBe(0);
    // Aucun autre compte touché.
    expect(await exists(protectedIds.active)).toBe('active');
    expect(await exists(protectedIds.suspended)).toBe('suspended');
    expect(await exists(protectedIds.deleted)).toBe('deleted');
    for (const k of ['recent', 'recentCode', 'usedWithSessionAndContact', 'verifiedContact', 'loggedIn']) expect([k, await exists(protectedIds[k])]).toEqual([k, 'pending_verification']);

    // Audit : une ligne par compte supprimé, sans nom, téléphone ni e-mail.
    const audit = (await h.pool.query(`select actor_type, target_type, target_id, metadata from audit_logs where action = 'user.purged' and target_id = any($1::uuid[])`, [eligible])).rows;
    expect(audit).toHaveLength(2);
    for (const a of audit) {
      expect(a).toMatchObject({ actor_type: 'system', target_type: 'user' });
      expect(a.metadata).toEqual({ reason: 'never_verified', afterDays: 30, runId: r.runId });
    }
    // Un seul passage par jour : le suivant ne fait rien.
    expect(await purge.runScheduled()).toMatchObject({ status: 'already_done', deleted: 0 });
  });

  it('délai : un réglage inférieur à 30 jours est ignoré (minimum imposé)', async () => {
    await setSetting('maintenance.account_purge_after_days', 7);
    expect((await purge.config()).afterDays).toBe(30);
    const id = await pending(10);
    await realModeValidated();
    expect(await purge.runScheduled()).toMatchObject({ status: 'ok', candidates: 0, deleted: 0 });
    expect(await exists(id)).toBe('pending_verification');
    await h.pool.query('delete from users where id = $1', [id]);
  });

  it('plafond : au-delà de 500 comptes, rien n’est supprimé et le passage est arrêté ; à 500, tout est traité', async () => {
    const insert = (n: number, prefix: string) =>
      h.pool.query(
        `insert into users (id, full_name, username, birth_date, city, created_at)
         select gen_random_uuid(), 'Plafond', $2 || i, '1998-01-01', 'Cocody', now() - interval '40 days' from generate_series(1, $1::int) i`,
        [n, prefix],
      );
    await insert(PURGE_MAX_PER_RUN + 1, `cap${Date.now() % 100000}.`);
    await realModeValidated();
    const count = async () => (await h.pool.query(`select count(*)::int as n from users where full_name = 'Plafond'`)).rows[0].n;
    const aborted = await purge.runScheduled();
    expect(aborted).toMatchObject({ status: 'aborted', mode: 'real', candidates: PURGE_MAX_PER_RUN + 1, deleted: 0 });
    expect(await count()).toBe(PURGE_MAX_PER_RUN + 1);
    expect((await h.pool.query('select status, details from maintenance_runs where id = $1', [aborted.runId])).rows[0]).toMatchObject({ status: 'aborted', details: { reason: 'cap_exceeded' } });

    await h.pool.query(`delete from users where id = (select id from users where full_name = 'Plafond' limit 1)`);
    await h.pool.query(`delete from maintenance_runs`);
    expect(await purge.runScheduled()).toMatchObject({ status: 'ok', candidates: PURGE_MAX_PER_RUN, deleted: PURGE_MAX_PER_RUN });
    expect(await count()).toBe(0);
  });

  it('exécution unique : deux passages simultanés ne suppriment qu’une fois', async () => {
    const ids = [await pending(40), await pending(41)];
    await realModeValidated();
    const results = await Promise.all([purge.runScheduled(), purge.runScheduled(), purge.runScheduled()]);
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.status !== 'ok').every((r) => ['locked', 'already_done'].includes(r.status) && r.deleted === 0)).toBe(true);
    expect(results.reduce((n, r) => n + r.deleted, 0)).toBe(2);
    expect((await h.pool.query(`select count(*)::int as n from maintenance_runs`)).rows[0].n).toBe(1);
    for (const id of ids) expect(await exists(id)).toBeNull();
  });

  it('administration : état et simulation à la demande, qui ne supprime jamais rien, même en mode réel validé', async () => {
    const id = await pending(50);
    await realModeValidated();
    const auth = await adminSession(h, ['tech']);
    const sim = (await h.http().post('/admin/v1/maintenance/account-purge/simulate').set(auth).expect(200)).body;
    expect(sim).toMatchObject({ status: 'ok', mode: 'simulation', candidates: 1, deleted: 0 });
    expect(await exists(id)).toBe('pending_verification');
    const audit = (await h.pool.query(`select actor_type, actor_id from audit_logs where action = 'maintenance.account_purge' and target_id = $1`, [sim.runId])).rows[0];
    expect(audit.actor_type).toBe('admin');
    expect(audit.actor_id).toBeTruthy();
    const view = (await h.http().get('/admin/v1/maintenance/account-purge').set(auth).expect(200)).body;
    expect(view).toMatchObject({ enabled: true, mode: 'real', effectiveMode: 'real', afterDays: 30, maxPerRun: 500 });
    expect(view.runs[0]).toMatchObject({ id: sim.runId, mode: 'simulation', trigger: 'admin', candidates: 1, deleted: 0 });
    // Sans la permission de surveillance : refusé.
    const commercial = await adminSession(h, ['commercial']);
    await h.http().post('/admin/v1/maintenance/account-purge/simulate').set(commercial).expect(403);
    await h.http().get('/admin/v1/maintenance/account-purge').set(commercial).expect(403);
    // La simulation de l'administration ne compte pas comme le passage du jour.
    expect(await purge.runScheduled()).toMatchObject({ status: 'ok', mode: 'real', deleted: 1 });
  });

  it('passage quotidien : seulement à 3 h (heure d’Abidjan), et sans effet tant que la purge est désactivée', async () => {
    const runner = h.app.get(MaintenanceRunner);
    expect(await runner.runIfDue(new Date('2026-10-16T02:59:00Z'))).toBeNull();
    // La conservation des discussions avec Peni est décidée (1 an, D-2010) : elle s'exécute ; la purge reste désactivée.
    const r = await runner.runIfDue(new Date('2026-10-16T03:10:00Z'));
    expect(r).toMatchObject({ purge: { status: 'disabled' } });
    expect(['ok', 'already_done']).toContain(r!.peniRetention!.status);
  });

  it('toute table liée aux comptes est classée : bloquante (activité) ou supprimée avec le compte', async () => {
    const fks = (await h.pool.query(`select distinct conrelid::regclass::text as t from pg_constraint where confrelid = 'users'::regclass and contype = 'f'`)).rows.map((r: { t: string }) => r.t);
    const known = new Set<string>([...PURGE_BLOCKING_TABLES, ...PURGE_CASCADED_TABLES]);
    expect(fks.filter((t: string) => !known.has(t))).toEqual([]);
    // Les tables d'activité sont bien bloquantes (et non supprimées en silence).
    for (const t of ['projects', 'project_photos', 'project_reports', 'shops', 'courier_accounts', 'sessions']) expect(PURGE_BLOCKING_TABLES).toContain(t);
  });
});
