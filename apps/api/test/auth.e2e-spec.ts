import { bearer, destinationOf, Harness, newUser, registerAndActivate, startHarness } from './harness';

/**
 * Parcours d'authentification de bout en bout, contre une vraie base PostgreSQL.
 * Couvre notamment les parcours n°1 (création de compte) et n°9 (accès non autorisé) du cahier des charges,
 * ainsi que les décisions F15 (âges) et F16 (récupération vérifiée).
 */
describe('Authentification (e2e)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  describe('Inscription', () => {
    it('crée un compte en attente, envoie un code par SMS, puis l’active et ouvre une session', async () => {
      const body = newUser();
      const reg = await h.http().post('/v1/auth/register').send(body).expect(201);
      expect(reg.body.verification.channel).toBe('phone');
      expect(reg.body.verification.destination).toContain('••••');

      const pending = await h.pool.query('select status, birth_date from users where id = $1', [reg.body.userId]);
      expect(pending.rows[0].status).toBe('pending_verification');

      const destination = await destinationOf(h, reg.body.verification.challengeId);
      const code = h.lastCodeFor(destination);
      const ver = await h.http().post('/v1/auth/register/verify').send({ challengeId: reg.body.verification.challengeId, code }).expect(200);
      expect(ver.body.tokens.accessToken).toBeDefined();
      expect(ver.body.me.status).toBe('active');
      expect(ver.body.me.contacts).toEqual([expect.objectContaining({ type: 'phone', verified: true })]);
      expect(ver.body.me.interests.map((i: { code: string }) => i.code).sort()).toEqual(['coiffure', 'mode', 'sport_coaching']);
      expect(ver.body.me.privacy).toEqual({ birthDatePublic: false, genderPublic: false, cityPublic: false });

      // Le code ne sert qu'une fois.
      await h.http().post('/v1/auth/register/verify').send({ challengeId: reg.body.verification.challengeId, code }).expect(400);
    });

    it('F16 : refuse une inscription sans téléphone ni e-mail', async () => {
      const res = await h.http().post('/v1/auth/register').send(newUser({ phone: undefined })).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields.phone[0]).toMatch(/récupérer ton compte/);
    });

    it('F16 : avec seulement un e-mail, le code part par e-mail', async () => {
      const res = await h.http().post('/v1/auth/register').send(newUser({ phone: undefined, email: `awa${Date.now()}@exemple.com` })).expect(201);
      expect(res.body.verification.channel).toBe('email');
    });

    it('F16 : avec téléphone et e-mail, le téléphone est privilégié', async () => {
      const res = await h.http().post('/v1/auth/register').send(newUser({ email: `deux${Date.now()}@exemple.com` })).expect(201);
      expect(res.body.verification.channel).toBe('phone');
    });

    it('F15 : refuse une personne de moins de 16 ans, accepte 16 ans révolus', async () => {
      const today = new Date();
      const iso = (y: number, plusDays = 0) => {
        const d = new Date(Date.UTC(today.getUTCFullYear() - y, today.getUTCMonth(), today.getUTCDate() + plusDays));
        return d.toISOString().slice(0, 10);
      };
      const young = await h.http().post('/v1/auth/register').send(newUser({ birthDate: iso(16, 1) })).expect(403);
      expect(young.body.error).toMatchObject({ code: 'AGE_REQUIREMENT_NOT_MET', details: { capability: 'registration', minAge: 16 } });
      await h.http().post('/v1/auth/register').send(newUser({ birthDate: iso(16) })).expect(201);
    });

    it('valide les champs obligatoires de Q13 et les centres d’intérêt (au moins 3)', async () => {
      const res = await h
        .http()
        .post('/v1/auth/register')
        .send(newUser({ fullName: ' ', birthDate: '2001-02-30', interests: ['mode', 'inconnu'], password: '12345678' }))
        .expect(400);
      const f = res.body.error.details.fields;
      expect(Object.keys(f).sort()).toEqual(['birthDate', 'fullName', 'interests', 'password']);
    });

    it('refuse un champ inattendu envoyé par le client', async () => {
      const res = await h.http().post('/v1/auth/register').send({ ...newUser(), status: 'active' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it("refuse un nom d'utilisateur déjà pris et un numéro déjà vérifié par un autre compte", async () => {
      const a = await registerAndActivate(h);
      const dupName = await h.http().post('/v1/auth/register').send(newUser({ username: a.body.username })).expect(409);
      expect(dupName.body.error.code).toBe('USERNAME_TAKEN');
      const dupPhone = await h.http().post('/v1/auth/register').send(newUser({ phone: a.body.phone })).expect(409);
      expect(dupPhone.body.error.code).toBe('CONTACT_TAKEN');
    });

    it('limite les essais de code et la fréquence de renvoi', async () => {
      const reg = await h.http().post('/v1/auth/register').send(newUser()).expect(201);
      const id = reg.body.verification.challengeId;
      await h.http().post('/v1/auth/codes/resend').send({ challengeId: id }).expect(429);
      for (let i = 0; i < 5; i += 1) await h.http().post('/v1/auth/register/verify').send({ challengeId: id, code: '000000' }).expect(400);
      const blocked = await h.http().post('/v1/auth/register/verify').send({ challengeId: id, code: h.lastCodeFor(await destinationOf(h, id)) }).expect(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });
  });

  describe('Connexion et sessions', () => {
    it('se connecte par @nom d’utilisateur, par téléphone et refuse un mauvais mot de passe', async () => {
      const a = await registerAndActivate(h);
      await h.http().post('/v1/auth/login').send({ identifier: `@${a.body.username}`, password: a.body.password }).expect(200);
      const byPhone = await h.http().post('/v1/auth/login').send({ identifier: `+225 ${a.body.phone}`, password: a.body.password }).expect(200);
      expect(byPhone.body.me.username).toBe(a.body.username);
      const bad = await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: 'mauvais-mdp' }).expect(401);
      expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('un compte non vérifié reçoit un nouveau code au lieu d’une session', async () => {
      const body = newUser();
      await h.http().post('/v1/auth/register').send(body).expect(201);
      const res = await h.http().post('/v1/auth/login').send({ identifier: body.username, password: body.password }).expect(403);
      expect(res.body.error.code).toBe('CONTACT_NOT_VERIFIED');
      expect(res.body.error.details.verification.challengeId).toBeDefined();
    });

    it('bloque après 5 échecs sur le même identifiant, même avec le bon mot de passe', async () => {
      const a = await registerAndActivate(h);
      for (let i = 0; i < 5; i += 1) await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: 'mauvais-mdp' }).expect(401);
      const res = await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: a.body.password }).expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('fait tourner le jeton de rafraîchissement et révoque toute la famille en cas de réutilisation', async () => {
      const a = await registerAndActivate(h);
      const r1 = await h.http().post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken }).expect(200);
      expect(r1.body.tokens.refreshToken).not.toBe(a.tokens.refreshToken);
      // Réutilisation de l'ancien jeton (vol simulé) :
      const reuse = await h.http().post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken }).expect(401);
      expect(reuse.body.error.details.reason).toBe('reuse');
      // Le nouveau jeton est lui aussi révoqué, et les jetons d'accès ne passent plus.
      await h.http().post('/v1/auth/refresh').send({ refreshToken: r1.body.tokens.refreshToken }).expect(401);
      await h.http().get('/v1/me').set(bearer(r1.body.tokens.accessToken)).expect(401);
      const audit = await h.pool.query("select count(*)::int as n from audit_logs where action = 'session.refresh_reuse_detected' and target_id = $1", [a.userId]);
      expect(audit.rows[0].n).toBe(1);
    });

    it('la déconnexion invalide immédiatement le jeton d’accès', async () => {
      const a = await registerAndActivate(h);
      await h.http().get('/v1/me').set(bearer(a.tokens.accessToken)).expect(200);
      await h.http().post('/v1/auth/logout').set(bearer(a.tokens.accessToken)).expect(204);
      await h.http().get('/v1/me').set(bearer(a.tokens.accessToken)).expect(401);
    });

    it('liste les appareils et permet d’en déconnecter un', async () => {
      const a = await registerAndActivate(h);
      const second = await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: a.body.password, deviceName: 'Tablette' }).expect(200);
      const list = await h.http().get('/v1/me/sessions').set(bearer(a.tokens.accessToken)).expect(200);
      expect(list.body.items).toHaveLength(2);
      const other = list.body.items.find((s: { deviceName: string }) => s.deviceName === 'Tablette');
      await h.http().delete(`/v1/me/sessions/${other.id}`).set(bearer(a.tokens.accessToken)).expect(204);
      await h.http().get('/v1/me').set(bearer(second.body.tokens.accessToken)).expect(401);
    });
  });

  describe('Accès non autorisés (parcours n°9)', () => {
    it('refuse les routes privées sans jeton ou avec un jeton falsifié', async () => {
      await h.http().get('/v1/me').expect(401);
      await h.http().get('/v1/me').set(bearer('abc.def.ghi')).expect(401);
      const a = await registerAndActivate(h);
      const [head, payload, sig] = a.tokens.accessToken.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: '00000000-0000-7000-8000-000000000000' })).toString('base64url');
      await h.http().get('/v1/me').set(bearer(`${head}.${forged}.${sig}`)).expect(401);
    });

    it("refuse de basculer vers la boutique d'un autre, même en connaissant son identifiant", async () => {
      const owner = await registerAndActivate(h);
      const intruder = await registerAndActivate(h);
      const shopId = '01a00000-0000-7000-8000-00000000abcd';
      await h.pool.query("insert into shops (id, owner_user_id, name, slug, status) values ($1, $2, 'Boutique Élégance', $3, 'active')", [shopId, owner.userId, `elegance-${Date.now()}`]);
      await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);

      const denied = await h.http().post('/v1/auth/switch-space').set(bearer(intruder.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');

      const ok = await h.http().post('/v1/auth/switch-space').set(bearer(owner.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200);
      expect(ok.body.activeSpace).toEqual({ type: 'merchant', id: shopId });
      const spaces = await h.http().get('/v1/me/spaces').set(bearer(ok.body.accessToken)).expect(200);
      expect(spaces.body.active).toEqual({ type: 'merchant', id: shopId });
      expect(spaces.body.items.map((s: { type: string }) => s.type)).toEqual(['user', 'merchant']);
    });

    it('un compte suspendu perd l’accès immédiatement', async () => {
      const a = await registerAndActivate(h);
      await h.pool.query("update users set status = 'suspended' where id = $1", [a.userId]);
      await h.http().get('/v1/me').set(bearer(a.tokens.accessToken)).expect(401);
      const login = await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: a.body.password }).expect(403);
      expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('Récupération et opérations sensibles (F16)', () => {
    it('mot de passe oublié : même réponse que le compte existe ou non, puis réinitialisation qui déconnecte tout', async () => {
      const a = await registerAndActivate(h);
      const unknown = await h.http().post('/v1/auth/password/forgot').send({ identifier: 'personne.inconnue' }).expect(202);
      const known = await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username }).expect(202);
      expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
      expect(known.body.destination).toBeUndefined();
      // Le défi leurre n'accepte aucun code.
      await h.http().post('/v1/auth/password/reset').send({ challengeId: unknown.body.challengeId, code: '123456', newPassword: 'Nouveau-Mdp-2026' }).expect(400);

      const code = h.lastCodeFor(a.destination);
      await h.http().post('/v1/auth/password/reset').send({ challengeId: known.body.challengeId, code, newPassword: 'Nouveau-Mdp-2026' }).expect(204);
      await h.http().get('/v1/me').set(bearer(a.tokens.accessToken)).expect(401);
      await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: 'Nouveau-Mdp-2026' }).expect(200);
      const alert = h.outbox.filter((m) => m.destination === a.destination && /mot de passe vient d’être modifié/.test(m.body));
      expect(alert.length).toBeGreaterThanOrEqual(1);
    });

    it('ajouter un e-mail exige mot de passe + code, puis un code sur la nouvelle adresse ; l’autorisation ne sert qu’une fois', async () => {
      const a = await registerAndActivate(h);
      const auth = bearer(a.tokens.accessToken);
      await h.http().post('/v1/me/contacts').set(auth).send({ type: 'email', value: 'x@exemple.com' }).expect(403);

      await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: 'faux-mdp-123' }).expect(401);
      const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password }).expect(201);
      const grant = await h
        .http()
        .post('/v1/auth/step-up/verify')
        .set(auth)
        .send({ challengeId: su.body.challengeId, code: h.lastCodeFor(a.destination) })
        .expect(200);

      const email = `nouvelle${Date.now()}@exemple.com`;
      const add = await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', grant.body.stepUpToken).send({ type: 'email', value: email }).expect(201);
      // Deuxième usage de la même autorisation : refusé.
      await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', grant.body.stepUpToken).send({ type: 'email', value: 'autre@exemple.com' }).expect(403);

      const me = await h.http().post('/v1/me/contacts/verify').set(auth).send({ challengeId: add.body.challengeId, code: h.lastCodeFor(email) }).expect(200);
      expect(me.body.contacts.filter((c: { verified: boolean }) => c.verified)).toHaveLength(2);
      expect(h.outbox.some((m) => m.destination === a.destination && /nouvelle coordonnée/.test(m.body))).toBe(true);
    });

    it('refuse de retirer la dernière coordonnée vérifiée', async () => {
      const a = await registerAndActivate(h);
      const auth = bearer(a.tokens.accessToken);
      const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password }).expect(201);
      const grant = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(a.destination) }).expect(200);
      const phoneId = a.me.contacts[0].id;
      const res = await h.http().delete(`/v1/me/contacts/${phoneId}`).set(auth).set('X-Step-Up-Token', grant.body.stepUpToken).expect(409);
      expect(res.body.error.code).toBe('LAST_RECOVERY_CONTACT');
    });

    it("une autorisation step-up d'une portée ne vaut pas pour une autre", async () => {
      const a = await registerAndActivate(h);
      const auth = bearer(a.tokens.accessToken);
      const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password }).expect(201);
      const grant = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(a.destination) }).expect(200);
      await h.http().post('/v1/me/password').set(auth).set('X-Step-Up-Token', grant.body.stepUpToken).send({ newPassword: 'Encore-Un-Mdp-26' }).expect(403);
    });
  });

  describe('Corrections de la relecture de sécurité', () => {
    it('H1 : deux suppressions simultanées ne laissent jamais un compte sans coordonnée vérifiée', async () => {
      const email = `h1${Date.now()}@exemple.com`;
      const a = await registerAndActivate(h, { email });
      const auth = bearer(a.tokens.accessToken);
      // Vérifie aussi l'e-mail pour avoir deux coordonnées vérifiées.
      const su0 = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password }).expect(201);
      const g0 = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su0.body.challengeId, code: h.lastCodeFor(a.destination) }).expect(200);
      const add = await h.http().post('/v1/me/contacts').set(auth).set('X-Step-Up-Token', g0.body.stepUpToken).send({ type: 'email', value: email }).expect(201);
      const me = await h.http().post('/v1/me/contacts/verify').set(auth).send({ challengeId: add.body.challengeId, code: h.lastCodeFor(email) }).expect(200);
      const ids = me.body.contacts.filter((c: { verified: boolean }) => c.verified).map((c: { id: string }) => c.id);
      expect(ids).toHaveLength(2);

      const grants: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        await h.pool.query("update verification_codes set last_sent_at = now() - interval '1 hour' where user_id = $1", [a.userId]);
        const su = await h.http().post('/v1/auth/step-up').set(auth).send({ scope: 'contact_change', password: a.body.password }).expect(201);
        const dest = await destinationOf(h, su.body.challengeId);
        const g = await h.http().post('/v1/auth/step-up/verify').set(auth).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(dest) }).expect(200);
        grants.push(g.body.stepUpToken);
      }
      const results = await Promise.all(
        ids.map((id: string, i: number) => h.http().delete(`/v1/me/contacts/${id}`).set(auth).set('X-Step-Up-Token', grants[i])),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const left = await h.pool.query('select count(*)::int as n from user_contacts where user_id = $1 and verified_at is not null', [a.userId]);
      expect(left.rows[0].n).toBe(1);
    });

    it('H1 : la base refuse elle-même de retirer la dernière coordonnée vérifiée d’un compte actif', async () => {
      const a = await registerAndActivate(h);
      await expect(h.pool.query('delete from user_contacts where user_id = $1', [a.userId])).rejects.toThrow(/F16/);
    });

    it('H2 : une adresse X-Forwarded-For inventée ne change pas l’IP enregistrée', async () => {
      const a = await registerAndActivate(h);
      await h.http().post('/v1/auth/login').set('X-Forwarded-For', '203.0.113.77').send({ identifier: a.body.username, password: 'mauvais-mdp' }).expect(401);
      const r = await h.pool.query("select count(*)::int as n from login_attempts where ip = '203.0.113.77'");
      expect(r.rows[0].n).toBe(0);
    });

    it('M1 : par @nom d’utilisateur, réponse identique (canal masqué) que le compte existe ou non, y compris au renvoi', async () => {
      const a = await registerAndActivate(h, { phone: undefined, email: `m1${Date.now()}@exemple.com` });
      const real = await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username }).expect(202);
      const fake = await h.http().post('/v1/auth/password/forgot').send({ identifier: `inconnu.${Date.now()}` }).expect(202);
      expect(real.body.channel).toBeUndefined();
      expect(fake.body.channel).toBeUndefined();
      await h.pool.query("update verification_codes set last_sent_at = now() - interval '2 minutes', expires_at = now() + interval '1 minute' where id = any($1)", [[real.body.challengeId, fake.body.challengeId]]);
      const r2 = await h.http().post('/v1/auth/codes/resend').send({ challengeId: real.body.challengeId }).expect(200);
      const f2 = await h.http().post('/v1/auth/codes/resend').send({ challengeId: fake.body.challengeId }).expect(200);
      expect(Object.keys(r2.body).sort()).toEqual(Object.keys(f2.body).sort());
      const delta = Math.abs(new Date(r2.body.expiresAt).getTime() - new Date(f2.body.expiresAt).getTime());
      expect(delta).toBeLessThan(5000);
    });

    it('audit du 18/10/2026 : une deuxième demande rend la première inutilisable, que le compte existe ou non', async () => {
      const a = await registerAndActivate(h);
      const unknownId = `inconnu.${Date.now()}`;
      const r1 = await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username }).expect(202);
      const f1 = await h.http().post('/v1/auth/password/forgot').send({ identifier: unknownId }).expect(202);
      await h.pool.query("update verification_codes set last_sent_at = now() - interval '2 minutes' where id = any($1)", [[r1.body.challengeId, f1.body.challengeId]]);
      await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username }).expect(202);
      await h.http().post('/v1/auth/password/forgot').send({ identifier: unknownId }).expect(202);
      const r = await h.http().post('/v1/auth/password/reset').send({ challengeId: r1.body.challengeId, code: '123456', newPassword: 'Nouveau-Mdp-2026' }).expect(400);
      const f = await h.http().post('/v1/auth/password/reset').send({ challengeId: f1.body.challengeId, code: '123456', newPassword: 'Nouveau-Mdp-2026' }).expect(400);
      expect(f.body.error.code).toBe(r.body.error.code);
      expect(f.body.error.message).toBe(r.body.error.message);
    });

    it('M1 : la réinitialisation ne révèle plus le nom d’utilisateur du titulaire du défi', async () => {
      const a = await registerAndActivate(h);
      const f = await h.http().post('/v1/auth/password/forgot').send({ identifier: `+225${a.body.phone}` }).expect(202);
      const res = await h.http().post('/v1/auth/password/reset').send({ challengeId: f.body.challengeId, code: '000000', newPassword: `X9!${a.body.username}` }).expect(400);
      expect(res.body.error.code).toBe('INVALID_CODE');
    });

    it('M2 : un nouveau défi rend le précédent inutilisable, et les essais restent comptés après un renvoi', async () => {
      const a = await registerAndActivate(h);
      const first = await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username }).expect(202);
      const firstCode = h.lastCodeFor(a.destination);
      await h.http().post('/v1/auth/password/forgot').send({ identifier: a.body.username }).expect(202);
      await h.http().post('/v1/auth/password/reset').send({ challengeId: first.body.challengeId, code: firstCode, newPassword: 'Nouveau-Mdp-2026' }).expect(400);
    });

    it('M4 : plafond d’envois par destinataire et pas de nouveau SMS à chaque connexion d’un compte non vérifié', async () => {
      const body = newUser();
      const reg = await h.http().post('/v1/auth/register').send(body).expect(201);
      const dest = await destinationOf(h, reg.body.verification.challengeId);
      const before = h.outbox.filter((m) => m.destination === dest).length;
      for (let i = 0; i < 3; i += 1) await h.http().post('/v1/auth/login').send({ identifier: body.username, password: body.password }).expect(403);
      expect(h.outbox.filter((m) => m.destination === dest).length).toBe(before);

      const a = await registerAndActivate(h);
      let lastStatus = 202;
      for (let i = 0; i < 8 && lastStatus === 202; i += 1) {
        lastStatus = (await h.http().post('/v1/auth/password/forgot').send({ identifier: `+225${a.body.phone}` })).status;
      }
      const sent = await h.pool.query('select coalesce(sum(send_count),0)::int as n from verification_codes where destination = $1', [a.destination]);
      expect(sent.rows[0].n).toBeLessThanOrEqual(6);
    });

    it('L4 : une autorisation step-up ne vaut que pour la session qui l’a obtenue', async () => {
      const a = await registerAndActivate(h);
      const other = await h.http().post('/v1/auth/login').send({ identifier: a.body.username, password: a.body.password }).expect(200);
      const su = await h.http().post('/v1/auth/step-up').set(bearer(a.tokens.accessToken)).send({ scope: 'contact_change', password: a.body.password }).expect(201);
      const g = await h.http().post('/v1/auth/step-up/verify').set(bearer(a.tokens.accessToken)).send({ challengeId: su.body.challengeId, code: h.lastCodeFor(a.destination) }).expect(200);
      await h.http().post('/v1/me/contacts').set(bearer(other.body.tokens.accessToken)).set('X-Step-Up-Token', g.body.stepUpToken).send({ type: 'email', value: 'z@exemple.com' }).expect(403);
    });

    it('L1 : un identifiant mal formé donne 400, pas 500', async () => {
      const res = await h.http().post('/v1/auth/register/verify').send({ challengeId: 'x'.repeat(36), code: '123456' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('L5 : le journal d’audit refuse aussi TRUNCATE', async () => {
      await expect(h.pool.query('truncate audit_logs')).rejects.toThrow(/écriture seule/);
    });
  });

  describe('Capacités liées à l’âge (F15)', () => {
    it('17 ans : inscription possible, pièces et abonnement payant refusés', async () => {
      const today = new Date();
      const birth = new Date(Date.UTC(today.getUTCFullYear() - 17, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
      const a = await registerAndActivate(h, { birthDate: birth });
      const caps = await h.http().get('/v1/me/capabilities').set(bearer(a.tokens.accessToken)).expect(200);
      expect(caps.body.age.registration).toMatchObject({ allowed: true, minAge: 16, ruleStatus: 'provisional' });
      expect(caps.body.age.coins_purchase).toMatchObject({ allowed: false, minAge: 18 });
      expect(caps.body.age.coins_withdrawal).toMatchObject({ allowed: false, minAge: 18 });
      // Lot 9 (prototype, 18/10/2026) : 18 ans provisoire pour l'abonnement payant, comme les pièces (à vérifier).
      expect(caps.body.age.paid_subscription).toEqual({ allowed: false, ruleStatus: 'provisional', minAge: 18 });
    });

    it('un seuil modifié dans les réglages s’applique sans changer le code', async () => {
      await h.pool.query("update app_settings set value = '17' where key = 'age.min_registration'");
      h.settings.invalidate();
      try {
        const today = new Date();
        const birth = new Date(Date.UTC(today.getUTCFullYear() - 16, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
        await h.http().post('/v1/auth/register').send(newUser({ birthDate: birth })).expect(403);
      } finally {
        await h.pool.query("update app_settings set value = '16' where key = 'age.min_registration'");
        h.settings.invalidate();
      }
    });
  });

  describe('Divers', () => {
    it('santé, référentiel des intérêts et connexions sociales honnêtement indisponibles', async () => {
      expect((await h.http().get('/health').expect(200)).body.database).toBe('ok');
      expect((await h.http().get('/v1/interests').expect(200)).body.items).toHaveLength(10);
      const providers = await h.http().get('/v1/auth/providers').expect(200);
      expect(providers.body.google.available).toBe(false);
      expect((await h.http().post('/v1/auth/oauth/google').expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    });

    it('le journal d’audit refuse toute modification', async () => {
      await expect(h.pool.query("update audit_logs set action = 'x'")).rejects.toThrow(/écriture seule/);
      await expect(h.pool.query('delete from audit_logs')).rejects.toThrow(/écriture seule/);
    });

    it('aucun secret en clair en base', async () => {
      const a = await registerAndActivate(h);
      const u = await h.pool.query('select password_hash from users where id = $1', [a.userId]);
      expect(u.rows[0].password_hash).toMatch(/^\$argon2id\$/);
      const s = await h.pool.query('select refresh_token_hash from sessions where user_id = $1', [a.userId]);
      expect(s.rows.every((r: { refresh_token_hash: string }) => r.refresh_token_hash !== a.tokens.refreshToken && r.refresh_token_hash.length === 64)).toBe(true);
    });
  });
});
