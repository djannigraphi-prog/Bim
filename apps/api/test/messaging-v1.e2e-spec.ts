import { bearer, Harness, registerAndActivate, startHarness } from './harness';
import { testMp4 } from './mp4-fixture';

/** V1 (décisions du 18/10/2026) — Messages vocaux (2 minutes au plus) et groupes (32 personnes, création dès 18 ans). */
describe('Messagerie : vocaux et groupes (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function user(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, username: u.body.username as string, auth: bearer(u.tokens.accessToken) };
  }
  type U = Awaited<ReturnType<typeof user>>;
  const minorBirth = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 17);
    return d.toISOString().slice(0, 10);
  };
  const follow = (a: U, b: U) => h.http().put(`/v1/people/${b.username}/follow`).set(a.auth).expect(200);
  const voice = (a: U, id: string, file: Buffer, status = 201) =>
    h.http().post(`/v1/conversations/${id}/messages`).set(a.auth).attach('voice', file, { filename: 'vocal.m4a', contentType: 'audio/mp4' }).expect(status);
  const say = (a: U, id: string, text: string, status = 201) => h.http().post(`/v1/conversations/${id}/messages`).set(a.auth).send({ text }).expect(status);
  const msgs = async (a: U, id: string) => (await h.http().get(`/v1/conversations/${id}/messages`).set(a.auth).expect(200)).body.items;

  it('message vocal : M4A, durée lue dans le fichier, métadonnées effacées, 2 minutes au plus ; lien temporaire', async () => {
    const a = await user();
    const b = await user();
    await follow(b, a);
    const c = (await h.http().post('/v1/conversations').set(a.auth).send({ username: b.username }).expect(201)).body;
    const m = (await voice(a, c.id, testMp4({ audio: true, seconds: 42, gps: 'Abidjan-appareil-secret' }))).body;
    expect(m).toMatchObject({ kind: 'voice', durationMs: 42000, text: null, voiceUrl: expect.any(String) });
    const file = await h.http().get(new URL(m.voiceUrl).pathname).expect(200);
    expect(file.headers['content-type']).toMatch(/^audio\/mp4/);
    expect((file.body as Buffer).includes(Buffer.from('Abidjan-appareil-secret'))).toBe(false);
    expect((await h.http().get('/v1/conversations?box=inbox').set(b.auth).expect(200)).body.items[0].lastMessage.preview).toBe('Message vocal');
    // Trop long, vidéo, autre format, texte + vocal : refusés.
    expect((await voice(a, c.id, testMp4({ audio: true, seconds: 125 }), 400)).body.error).toMatchObject({ code: 'VOICE_TOO_LONG', details: { maxSeconds: 120 } });
    await voice(a, c.id, testMp4({ seconds: 10 }), 400);
    await voice(a, c.id, Buffer.from('pas un fichier audio'), 400);
    await h.http().post(`/v1/conversations/${c.id}/messages`).set(a.auth).field('text', 'coucou').attach('voice', testMp4({ audio: true, seconds: 3 }), { filename: 'v.m4a', contentType: 'audio/mp4' }).expect(400);
    // Supprimé par son auteur : fichier effacé.
    await h.http().delete(`/v1/messages/${m.id}`).set(a.auth).expect(204);
    await h.http().get(new URL(m.voiceUrl).pathname).expect(404);
  });

  it('groupe : création dès 18 ans, invitations, 16-17 ans seulement s’ils suivent, « Vu », départ et administrateur', async () => {
    const owner = await user({ fullName: 'Awa Koné' });
    const friend = await user({ fullName: 'Koffi Yao' });
    const stranger = await user({ fullName: 'Paul Tano' });
    const teenFan = await user({ fullName: 'Fatou Bamba', birthDate: minorBirth() });
    const teenOther = await user({ fullName: 'Inès Kouassi', birthDate: minorBirth() });
    await follow(friend, owner);
    await follow(teenFan, owner);

    // Un mineur ne crée pas de groupe.
    expect((await h.http().post('/v1/conversations/groups').set(teenFan.auth).send({ title: 'Ados', usernames: [friend.username] }).expect(403)).body.error.code).toBe('AGE_REQUIREMENT_NOT_MET');

    const r = (
      await h
        .http()
        .post('/v1/conversations/groups')
        .set(owner.auth)
        .send({ title: 'Team running', usernames: [friend.username, stranger.username, teenFan.username, teenOther.username, 'inconnu.total'] })
        .expect(201)
    ).body;
    // Personnes écartées sans motif (âge jamais révélé).
    expect(r.notAdded.sort()).toEqual(['inconnu.total', teenOther.username].sort());
    const g = r.conversation;
    expect(g).toMatchObject({ kind: 'group', group: { title: 'Team running', memberCount: 3, myRole: 'admin' }, person: null });
    // Celui qui ne suit pas l'administratrice reçoit une invitation (demande).
    expect((await h.http().get('/v1/conversations?box=requests').set(stranger.auth).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([g.id]);
    await h.http().get(`/v1/conversations/${g.id}`).set(teenOther.auth).expect(404);

    const m1 = (await say(owner, g.id, 'Rendez-vous samedi 7 h')).body;
    const seen = await msgs(friend, g.id);
    expect(seen.find((x: { id: string }) => x.id === m1.id)).toMatchObject({ senderIsMe: false, sender: { username: owner.username, fullName: 'Awa Koné' } });
    expect(seen.some((x: { kind: string; text: string }) => x.kind === 'system' && /créé le groupe/.test(x.text))).toBe(true);
    // « Vu » : lu par tous les membres actifs.
    await h.http().post(`/v1/conversations/${g.id}/read`).set(friend.auth).expect(200);
    expect((await msgs(owner, g.id)).find((x: { id: string }) => x.id === m1.id).read).toBe(false);
    await h.http().post(`/v1/conversations/${g.id}/read`).set(teenFan.auth).expect(200);
    expect((await msgs(owner, g.id)).find((x: { id: string }) => x.id === m1.id).read).toBe(true);

    // Membres : réservé aux membres ; ajout et retrait réservés à l'administratrice.
    const members = (await h.http().get(`/v1/conversations/${g.id}/members`).set(friend.auth).expect(200)).body;
    expect(members.items.map((x: { username: string; invited: boolean }) => [x.username, x.invited])).toEqual(
      expect.arrayContaining([
        [owner.username, false],
        [stranger.username, true],
      ]),
    );
    expect(members.maxMembers).toBe(32);
    expect((await h.http().post(`/v1/conversations/${g.id}/members`).set(friend.auth).send({ usernames: [teenOther.username] }).expect(403)).body.error.code).toBe('GROUP_ADMIN_ONLY');
    await h.http().patch(`/v1/conversations/${g.id}`).set(owner.auth).send({ title: 'Team running Cocody' }).expect(200);

    // Arrivée tardive : les messages d'avant ne sont pas lus.
    await follow(teenOther, owner);
    const added = (await h.http().post(`/v1/conversations/${g.id}/members`).set(owner.auth).send({ usernames: [teenOther.username] }).expect(201)).body;
    expect(added.notAdded).toEqual([]);
    expect((await msgs(teenOther, g.id)).some((x: { id: string }) => x.id === m1.id)).toBe(false);

    // Retrait par l'administratrice ; départ de l'administratrice : le membre le plus ancien prend le relais.
    await h.http().delete(`/v1/conversations/${g.id}/members/${teenOther.username}`).set(owner.auth).expect(200);
    await h.http().get(`/v1/conversations/${g.id}/messages`).set(teenOther.auth).expect(404);
    await h.http().post(`/v1/conversations/${g.id}/leave`).set(owner.auth).expect(200);
    await say(owner, g.id, 'encore là ?', 404);
    expect((await h.http().get(`/v1/conversations/${g.id}`).set(friend.auth).expect(200)).body.group).toMatchObject({ title: 'Team running Cocody', myRole: 'admin' });
  });

  it('groupe : 32 personnes au plus ; personne bloquée : jamais ajoutée, ses messages masqués', async () => {
    const owner = await user();
    const a = await user();
    const b = await user();
    await h.http().put(`/v1/people/${owner.username}/block`).set(b.auth).expect(200);
    const r = (await h.http().post('/v1/conversations/groups').set(owner.auth).send({ title: 'Petit groupe', usernames: [a.username, b.username] }).expect(201)).body;
    expect(r.notAdded).toEqual([b.username]);
    // Personne bloquée après coup (par un membre) : ses messages lui sont masqués.
    await h.http().post(`/v1/conversations/${r.conversation.id}/accept`).set(a.auth).expect(200);
    const m = (await say(owner, r.conversation.id, 'Bonjour à tous')).body;
    await h.http().put(`/v1/people/${owner.username}/block`).set(a.auth).expect(200);
    const seen = (await msgs(a, r.conversation.id)).find((x: { id: string }) => x.id === m.id);
    expect(seen).toMatchObject({ blockedSender: true, text: null });

    await h.pool.query("update app_settings set value = '3' where key = 'messages.group_max_members'");
    h.settings.invalidate();
    try {
      const x = await user();
      const y = await user();
      const z = await user();
      expect((await h.http().post('/v1/conversations/groups').set(x.auth).send({ title: 'Trop', usernames: [y.username, z.username, owner.username] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      const ok = (await h.http().post('/v1/conversations/groups').set(x.auth).send({ title: 'Juste', usernames: [y.username, z.username] }).expect(201)).body;
      await h.http().post(`/v1/conversations/${ok.conversation.id}/members`).set(x.auth).send({ usernames: [owner.username] }).expect(400);
    } finally {
      await h.pool.query("update app_settings set value = '32' where key = 'messages.group_max_members'");
      h.settings.invalidate();
    }
  });
});
