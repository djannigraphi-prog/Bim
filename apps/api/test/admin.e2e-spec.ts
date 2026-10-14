import { hash, Algorithm } from '@node-rs/argon2';
import { totpAt, timeStep } from '../src/common/totp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Administration (lot 0, partie 2) : connexion avec double authentification, rôles, réglages, audit, comptes, programmes. */
describe('Administration (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const PASSWORD = 'Admin-Test-2026!long';
  let seq = 0;

  async function createAdmin(roles: string[]) {
    seq += 1;
    const id = uuidv7();
    const email = `admin${seq}.${Date.now()}@bim.test`;
    const passwordHash = await hash(PASSWORD, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await h.pool.query('insert into admin_users (id, email, full_name, password_hash) values ($1, $2, $3, $4)', [id, email, `Admin ${seq}`, passwordHash]);
    for (const r of roles) await h.pool.query('insert into admin_user_roles (admin_id, role_code) values ($1, $2)', [id, r]);
    return { id, email, secret: '' };
  }

  const tick = () => {
    h.adminClock.t += 30_000; // pas TOTP suivant
  };
  const code = (secret: string) => totpAt(secret, timeStep(h.adminClock.now()));

  /** Connexion complète ; au premier passage, enrôle la double authentification. */
  async function signIn(admin: { email: string; secret: string }) {
    tick();
    const l = await h.http().post('/admin/v1/auth/login').send({ email: admin.email, password: PASSWORD }).expect(200);
    if (l.body.next === 'totp_enrollment') {
      const e = await h.http().post('/admin/v1/auth/totp/enrollment').send({ loginToken: l.body.loginToken }).expect(200);
      expect(e.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      admin.secret = e.body.secret;
    }
    const v = await h.http().post('/admin/v1/auth/totp/verify').send({ loginToken: l.body.loginToken, code: code(admin.secret) }).expect(200);
    return bearer(v.body.accessToken);
  }

  describe('connexion', () => {
    it('mot de passe puis TOTP obligatoire ; enrôlement au premier passage ; session admin', async () => {
      const a = await createAdmin(['super_admin']);
      const l = await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);
      expect(l.body.next).toBe('totp_enrollment');
      expect(l.body.accessToken).toBeUndefined();
      const auth = await signIn(a);
      const me = await h.http().get('/admin/v1/auth/me').set(auth).expect(200);
      expect(me.body).toMatchObject({ email: a.email, roles: ['super_admin'] });
      expect(me.body.permissions).toContain('settings.write');
      // Le secret est chiffré en base, jamais en clair.
      const row = await h.pool.query('select totp_secret_encrypted from admin_users where id = $1', [a.id]);
      expect(row.rows[0].totp_secret_encrypted).not.toContain(a.secret);
      // Connexions suivantes : directement le code.
      tick();
      const l2 = await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);
      expect(l2.body.next).toBe('totp');
    });

    it('refuse un mauvais code, un code réutilisé et un jeton d’étape après 5 essais', async () => {
      const a = await createAdmin(['support']);
      await signIn(a);
      tick();
      const l = await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);
      const good = code(a.secret);
      await h.http().post('/admin/v1/auth/totp/verify').send({ loginToken: l.body.loginToken, code: good }).expect(200);
      const l2 = await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);
      const reuse = await h.http().post('/admin/v1/auth/totp/verify').send({ loginToken: l2.body.loginToken, code: good }).expect(401);
      expect(reuse.body.error.code).toBe('INVALID_CODE');
      for (let i = 0; i < 4; i++) await h.http().post('/admin/v1/auth/totp/verify').send({ loginToken: l2.body.loginToken, code: '000000' }).expect(401);
      tick();
      const late = await h.http().post('/admin/v1/auth/totp/verify').send({ loginToken: l2.body.loginToken, code: code(a.secret) }).expect(401);
      expect(late.body.error.code).toBe('LOGIN_EXPIRED');
    });

    it('verrouille le compte après 5 mots de passe faux, sans révéler si l’e-mail existe', async () => {
      const a = await createAdmin(['support']);
      const unknown = await h.http().post('/admin/v1/auth/login').send({ email: 'personne@bim.test', password: 'x' }).expect(401);
      for (let i = 0; i < 4; i++) {
        const r = await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: 'mauvais' }).expect(401);
        expect(r.body.error).toEqual(unknown.body.error);
      }
      await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: 'mauvais' }).expect(401);
      await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(429);
      h.adminClock.t += 16 * 60_000;
      await h.http().post('/admin/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(200);
      const audit = await h.pool.query("select action from audit_logs where actor_id = $1 and action = 'admin.locked'", [a.id]);
      expect(audit.rowCount).toBe(1);
    });

    it('un jeton de l’app ne donne jamais accès à l’administration, et inversement', async () => {
      const u = await registerAndActivate(h);
      await h.http().get('/admin/v1/settings').set(bearer(u.tokens.accessToken)).expect(401);
      const a = await createAdmin(['super_admin']);
      const auth = await signIn(a);
      await h.http().get('/v1/me').set(auth).expect(401);
    });

    it('déconnexion : la session est révoquée', async () => {
      const a = await createAdmin(['tech']);
      const auth = await signIn(a);
      await h.http().post('/admin/v1/auth/logout').set(auth).expect(204);
      await h.http().get('/admin/v1/auth/me').set(auth).expect(401);
    });
  });

  describe('rôles et fonctions', () => {
    it('chaque rôle n’accède qu’à ses fonctions', async () => {
      const support = await signIn(await createAdmin(['support']));
      await h.http().get('/admin/v1/settings').set(support).expect(200);
      await h.http().put('/admin/v1/settings/age.min_merchant').set(support).send({ value: 18 }).expect(403);
      await h.http().get('/admin/v1/admins').set(support).expect(403);
      await h.http().post('/admin/v1/programs').set(support).send({}).expect(403);
      const commercial = await signIn(await createAdmin(['commercial']));
      await h.http().get('/admin/v1/audit-logs').set(commercial).expect(403);
      await h.http().get('/admin/v1/users?q=abc').set(commercial).expect(403);
    });

    it('réglages : valeur contrôlée, appliquée immédiatement, journalisée avec avant/après', async () => {
      const auth = await signIn(await createAdmin(['super_admin']));
      const bad = await h.http().put('/admin/v1/settings/age.min_registration').set(auth).send({ value: 3 }).expect(400);
      expect(bad.body.error.details.fields.value).toBeDefined();
      await h.http().put('/admin/v1/settings/inconnu.cle').set(auth).send({ value: 1 }).expect(404);
      const r = await h.http().put('/admin/v1/settings/projects.max_active').set(auth).send({ value: 1 }).expect(200);
      expect(r.body).toMatchObject({ key: 'projects.max_active', value: 1 });
      try {
        // Effet réel dans l'app : un seul projet en cours possible.
        const u = await registerAndActivate(h);
        const p = { mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 };
        await h.http().post('/v1/projects').set(bearer(u.tokens.accessToken)).send(p).expect(201);
        await h.http().post('/v1/projects').set(bearer(u.tokens.accessToken)).send(p).expect(409);
        const audit = await h.http().get('/admin/v1/audit-logs?action=admin.setting_updated&limit=1').set(auth).expect(200);
        expect(audit.body.items[0].metadata).toMatchObject({ key: 'projects.max_active', before: 5, after: 1 });
      } finally {
        await h.http().put('/admin/v1/settings/projects.max_active').set(auth).send({ value: 5 }).expect(200);
      }
    });

    it('utilisateurs : recherche journalisée, coordonnées masquées, suspension qui coupe les sessions', async () => {
      const auth = await signIn(await createAdmin(['support']));
      const u = await registerAndActivate(h);
      const found = await h.http().get(`/admin/v1/users?q=${u.body.username}`).set(auth).expect(200);
      expect(found.body.items[0].id).toBe(u.userId);
      const byPhone = await h.http().get(`/admin/v1/users?q=${u.destination.slice(-8)}`).set(auth).expect(200);
      expect(byPhone.body.items.map((x: { id: string }) => x.id)).toContain(u.userId);
      const d = await h.http().get(`/admin/v1/users/${u.userId}`).set(auth).expect(200);
      expect(d.body.contacts[0].value).toContain('••••');
      expect(JSON.stringify(d.body)).not.toContain(u.destination);
      await h.http().patch(`/admin/v1/users/${u.userId}/status`).set(auth).send({ status: 'suspended', reason: 'x' }).expect(400);
      await h.http().patch(`/admin/v1/users/${u.userId}/status`).set(auth).send({ status: 'suspended', reason: 'Signalements répétés (test)' }).expect(200);
      await h.http().get('/v1/me').set(bearer(u.tokens.accessToken)).expect(401);
      await h.http().post('/v1/auth/refresh').send({ refreshToken: u.tokens.refreshToken }).expect(401);
      await h.http().patch(`/admin/v1/users/${u.userId}/status`).set(auth).send({ status: 'active', reason: 'Vérification faite (test)' }).expect(200);
      const audit = await h.pool.query("select action from audit_logs where target_id = $1 and action like 'admin.user_%' order by created_at", [u.userId]);
      expect(audit.rows.map((x: { action: string }) => x.action)).toEqual(['admin.user_viewed', 'admin.user_suspended', 'admin.user_viewed', 'admin.user_reactivated', 'admin.user_viewed']);
    });

    it('programmes types : brouillon, publication validée, utilisé par les nouveaux projets, version figée', async () => {
      const commercial = await signIn(await createAdmin(['commercial']));
      const sa = await signIn(await createAdmin(['super_admin']));
      const body = {
        categoryCode: 'cheveux_coiffure',
        goalCode: null,
        title: 'Programme test cheveux',
        durationDays: 21,
        tasks: [{ title: 'Soin test', detail: 'Contenu de test', timeOfDay: '20:00', weekdays: 127 }],
      };
      const draft = (await h.http().post('/admin/v1/programs').set(commercial).send(body).expect(201)).body;
      expect(draft.status).toBe('draft');
      await h.http().post(`/admin/v1/programs/${draft.id}/publish`).set(commercial).send({ validatedBy: 'Personne test' }).expect(403);
      await h.http().post(`/admin/v1/programs/${draft.id}/publish`).set(sa).send({ validatedBy: 'x' }).expect(400);
      const pub = (await h.http().post(`/admin/v1/programs/${draft.id}/publish`).set(sa).send({ validatedBy: 'Personne test, coiffeuse' }).expect(200)).body;
      expect(pub).toMatchObject({ status: 'published', validatedBy: 'Personne test, coiffeuse' });
      try {
        await h.http().put(`/admin/v1/programs/${draft.id}`).set(commercial).send(body).expect(409);
        const u = await registerAndActivate(h);
        const p = (await h.http().post('/v1/projects').set(bearer(u.tokens.accessToken)).send({ mode: 'eco', categoryCode: 'cheveux_coiffure', description: 'Des cheveux plus forts' }).expect(201)).body;
        expect(p).toMatchObject({ programSource: 'template', durationDays: 21 });
        expect(p.tasks[0].title).toBe('Soin test');
        const cat = await h.http().get('/v1/projects/catalog').set(bearer(u.tokens.accessToken)).expect(200);
        expect(cat.body.categories.find((c: { code: string }) => c.code === 'cheveux_coiffure').hasValidatedPrograms).toBe(true);
      } finally {
        await h.http().post(`/admin/v1/programs/${draft.id}/archive`).set(commercial).expect(200);
      }
    });

    it('comptes admin : création par l’administrateur principal, jamais le dernier retiré', async () => {
      const saAdmin = await createAdmin(['super_admin']);
      const sa = await signIn(saAdmin);
      await h.http().post('/admin/v1/admins').set(sa).send({ email: 'nouveau@bim.test', fullName: 'Nouveau', password: 'court', roles: ['support'] }).expect(400);
      await h.http().post('/admin/v1/admins').set(sa).send({ email: `n${Date.now()}@bim.test`, fullName: 'Nouveau', password: 'Un-Mot-De-Passe-Long-2026', roles: ['inconnu'] }).expect(400);
      const created = (await h.http().post('/admin/v1/admins').set(sa).send({ email: `n${Date.now()}@bim.test`, fullName: 'Nouveau', password: 'Un-Mot-De-Passe-Long-2026', roles: ['support'] }).expect(201)).body;
      expect(created).toMatchObject({ roles: ['support'], totpEnabled: false });
      const self = await h.http().patch(`/admin/v1/admins/${saAdmin.id}`).set(sa).send({ status: 'disabled' }).expect(409);
      expect(self.body.error.code).toBe('SELF_LOCKOUT');
      const off = (await h.http().patch(`/admin/v1/admins/${created.id}`).set(sa).send({ status: 'disabled' }).expect(200)).body;
      expect(off.status).toBe('disabled');
    });
  });
});
