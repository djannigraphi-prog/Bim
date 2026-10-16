import { StepUpService } from '../src/modules/auth/step-up.service';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Défaut 2 (audit du 16/10/2026) : la confirmation d'identité (« step-up ») était consommée par la garde AVANT la
 * validation et l'opération. Une saisie refusée (mot de passe trop faible, coordonnée invalide) faisait perdre la
 * confirmation : il fallait refaire mot de passe + code (nouveau SMS). Elle n'est plus consommée que si
 * l'opération aboutit ; elle reste à usage unique.
 */
describe('Confirmation d’identité consommée seulement si l’opération aboutit (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function grant(scope: 'password_change' | 'contact_change') {
    const a = await registerAndActivate(h);
    const auth = bearer(a.tokens.accessToken);
    const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope, password: a.body.password }).expect(201);
    const g = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(a.destination) }).expect(200);
    return { a, auth, token: g.body.stepUpToken as string };
  }

  it('mot de passe trop faible refusé (400) : la même confirmation sert ensuite au bon mot de passe, puis plus jamais', async () => {
    const { auth, token } = await grant('password_change');
    const weak = await h.http().post('/v1/me/password').set(auth).set('X-Step-Up-Token', token).send({ newPassword: '123' }).expect(400);
    expect(weak.body.error.code).not.toBe('STEP_UP_REQUIRED');
    await h.http().post('/v1/me/password').set(auth).set('X-Step-Up-Token', token).send({ newPassword: 'Un-nouveau-mot-de-passe-2026' }).expect(204);
    // Usage unique : l'opération ayant abouti, la confirmation est consommée.
    const again = await h.http().post('/v1/me/password').set(auth).set('X-Step-Up-Token', token).send({ newPassword: 'Encore-un-autre-mdp-2026' });
    expect([401, 403]).toContain(again.status);
  });

  it('coordonnée invalide (400) puis valide : une seule confirmation suffit ; elle ne sert pas deux fois', async () => {
    const { auth, token } = await grant('contact_change');
    await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', token).send({ type: 'email', value: 'pas-un-email' }).expect(400);
    await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', token).send({ type: 'email', value: `audit.${Date.now()}@bim.test` }).expect(201);
    const reuse = await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', token).send({ type: 'email', value: `autre.${Date.now()}@bim.test` }).expect(403);
    expect(reuse.body.error.code).toBe('STEP_UP_REQUIRED');
  });

  it('refus métier (dernière coordonnée, 409) : la confirmation reste valable pour une autre opération autorisée', async () => {
    const { a, auth, token } = await grant('contact_change');
    await h.http().delete(`/v1/me/contacts/${a.me.contacts[0].id}`).set(auth).set('X-Step-Up-Token', token).expect(409);
    await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', token).send({ type: 'email', value: `audit2.${Date.now()}@bim.test` }).expect(201);
  });

  it('deux opérations simultanées avec la même confirmation : une seule passe', async () => {
    const { auth, token } = await grant('contact_change');
    const rs = await Promise.all(
      [1, 2, 3].map((i) => h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', token).send({ type: 'email', value: `par.${i}.${Date.now()}@bim.test` })),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 403 && r.body.error.code === 'STEP_UP_REQUIRED')).toHaveLength(2);
  });

  it('jamais rendue après un changement de mot de passe, ni pour une session fermée', async () => {
    const { a, auth, token } = await grant('contact_change');
    const [row] = (await h.pool.query('select id from step_up_grants where user_id = $1 order by created_at desc limit 1', [a.userId])).rows;
    // Prise par une opération qui échouera…
    await h.pool.query('update step_up_grants set consumed_at = now() where id = $1', [row.id]);
    // …pendant qu'un changement de mot de passe a lieu.
    await h.pool.query("update users set password_changed_at = now() + interval '1 second' where id = $1", [a.userId]);
    await h.app.get(StepUpService).release(row.id);
    expect((await h.pool.query('select consumed_at from step_up_grants where id = $1', [row.id])).rows[0].consumed_at).not.toBeNull();
    await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', token).send({ type: 'email', value: `x.${Date.now()}@bim.test` }).expect(403);

    const other = await grant('contact_change');
    const [g2] = (await h.pool.query('select id, session_id from step_up_grants where user_id = $1', [other.a.userId])).rows;
    await h.pool.query('update step_up_grants set consumed_at = now() where id = $1', [g2.id]);
    await h.pool.query("update sessions set revoked_at = now(), revoked_reason = 'test' where id = $1", [g2.session_id]);
    await h.app.get(StepUpService).release(g2.id);
    expect((await h.pool.query('select consumed_at from step_up_grants where id = $1', [g2.id])).rows[0].consumed_at).not.toBeNull();
  });
});
