import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 6-A — Messagerie entre personnes (écran 47) : demandes, texte, photos, lu / non lu, blocage, signalement. */
describe('Messagerie (e2e)', () => {
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
  const follow = (a: U, b: U) => h.http().put(`/v1/people/${b.username}/follow`).set(a.auth).expect(200);
  const start = (a: U, b: U, status = 201) => h.http().post('/v1/conversations').set(a.auth).send({ username: b.username }).expect(status);
  const say = (a: U, id: string, text: string, status = 201) => h.http().post(`/v1/conversations/${id}/messages`).set(a.auth).send({ text }).expect(status);
  const list = async (a: U, box = 'inbox') => (await h.http().get(`/v1/conversations?box=${box}`).set(a.auth).expect(200)).body.items as { id: string; unread: number; status: string; person: { username: string }; lastMessage: { preview: string } | null }[];
  const unread = async (a: U) => (await h.http().get('/v1/conversations/unread-count').set(a.auth).expect(200)).body;

  it('personne suivie : message direct, non-lus, « Vu », une seule conversation par paire', async () => {
    const a = await user();
    const b = await user();
    await follow(b, a); // b suit a : les messages de a arrivent directement
    const c = (await start(a, b)).body;
    expect(c).toMatchObject({ status: 'active', pendingForOther: false, person: { username: b.username }, lastMessage: null });
    expect(await list(b)).toEqual([]); // conversation vide : invisible pour b
    const m1 = (await say(a, c.id, 'Salut Awa !')).body;
    expect(m1).toMatchObject({ senderIsMe: true, kind: 'text', text: 'Salut Awa !', read: false });
    expect(await unread(b)).toEqual({ conversations: 1, requests: 0 });
    const lb = await list(b);
    expect(lb).toHaveLength(1);
    expect(lb[0]).toMatchObject({ id: c.id, unread: 1, status: 'active', person: { username: a.username }, lastMessage: { preview: 'Salut Awa !' } });
    // Lecture par b : « Vu » chez a, pastille à zéro.
    await h.http().post(`/v1/conversations/${c.id}/read`).set(b.auth).expect(200);
    expect(await unread(b)).toEqual({ conversations: 0, requests: 0 });
    const msgs = (await h.http().get(`/v1/conversations/${c.id}/messages`).set(a.auth).expect(200)).body.items;
    expect(msgs[0]).toMatchObject({ id: m1.id, read: true });
    // Ouvrir de nouveau (dans un sens ou dans l'autre) : même conversation.
    expect((await start(b, a)).body.id).toBe(c.id);
    expect((await start(a, b)).body.id).toBe(c.id);
  });

  it('personne qui ne suit pas : demande, acceptation en répondant ; refus sans avertir l’auteur', async () => {
    const a = await user();
    const b = await user();
    const c = (await start(a, b)).body;
    expect(c.pendingForOther).toBe(true);
    await say(a, c.id, 'Bonjour, je suis coach à Cocody');
    expect(await list(b)).toEqual([]);
    expect((await list(b, 'requests')).map((x) => x.id)).toEqual([c.id]);
    expect((await h.http().get(`/v1/conversations/${c.id}`).set(b.auth).expect(200)).body).toMatchObject({ id: c.id, status: 'request', person: { username: a.username } });
    expect(await unread(b)).toEqual({ conversations: 0, requests: 1 });
    // Répondre vaut acceptation.
    await say(b, c.id, 'Bonjour !');
    expect((await list(b)).map((x) => x.id)).toEqual([c.id]);
    expect(await list(b, 'requests')).toEqual([]);

    const d = await user();
    const c2 = (await start(d, b)).body;
    await say(d, c2.id, 'Promo spéciale !!!');
    await h.http().post(`/v1/conversations/${c2.id}/decline`).set(b.auth).expect(200);
    expect(await list(b, 'requests')).toEqual([]);
    expect(await unread(b)).toEqual({ conversations: 0, requests: 0 });
    // d n'est pas averti : il peut encore écrire, b ne le voit pas.
    await say(d, c2.id, 'Tu as vu ?');
    expect(await unread(b)).toEqual({ conversations: 0, requests: 0 });
    await h.http().get(`/v1/conversations/${c2.id}/messages`).set(b.auth).expect(404);
  });

  it('moins de 18 ans : jamais de message d’un compte non suivi ; possible si elle suit l’auteur', async () => {
    const birth = new Date();
    birth.setFullYear(birth.getFullYear() - 17);
    const minor = await user({ birthDate: birth.toISOString().slice(0, 10) });
    const adult = await user();
    // Audit du 18/10/2026 : aucun refus visible (sinon on devinerait l'âge) ; elle ne reçoit simplement rien.
    const c0 = (await start(adult, minor)).body;
    expect(c0).toMatchObject({ status: 'active', pendingForOther: true });
    await say(adult, c0.id, 'Salut !');
    expect(await list(minor)).toEqual([]);
    expect(await list(minor, 'requests')).toEqual([]);
    expect(await unread(minor)).toEqual({ conversations: 0, requests: 0 });
    await h.http().get(`/v1/conversations/${c0.id}/messages`).set(minor.auth).expect(404);
    // Elle suit l'adulte : le message suivant arrive comme une demande ordinaire.
    await follow(minor, adult);
    const c = (await start(adult, minor)).body;
    expect(c.status).toBe('active');
    await say(adult, c.id, 'Tu es là ?');
    expect((await list(minor, 'requests')).map((x) => x.id)).toEqual([c.id]);
    // Elle ne le suit plus : plus rien n'arrive, même dans une conversation déjà ouverte.
    await h.http().delete(`/v1/people/${adult.username}/follow`).set(minor.auth).expect(200);
    await say(adult, c.id, 'Encore moi');
    expect(await list(minor, 'requests')).toEqual([]);
  });

  it('accès : tiers refusés, blocage, compte suspendu, espace boutique', async () => {
    const a = await user();
    const b = await user();
    const x = await user();
    await follow(b, a);
    const c = (await start(a, b)).body;
    const m = (await say(a, c.id, 'Message privé')).body;
    await h.http().get(`/v1/conversations/${c.id}/messages`).set(x.auth).expect(404);
    await say(x, c.id, 'intrusion', 404);
    await h.http().delete(`/v1/messages/${m.id}`).set(x.auth).expect(404);
    await h.http().post('/v1/content-reports').set(x.auth).send({ targetType: 'message', targetId: m.id, reason: 'spam' }).expect(404);
    await start(a, a, 404);
    // Blocage : plus de conversation, ni dans un sens ni dans l'autre.
    await h.http().put(`/v1/people/${a.username}/block`).set(b.auth).expect(200);
    expect(await list(b)).toEqual([]);
    expect(await list(a)).toEqual([]);
    await say(a, c.id, 'tu es là ?', 404);
    await start(a, b, 404);
    await h.http().delete(`/v1/people/${a.username}/block`).set(b.auth).expect(200);
    // Compte suspendu : invisible.
    await h.pool.query("update users set status = 'suspended' where id = $1", [b.userId]);
    expect(await list(a)).toEqual([]);
    await h.pool.query("update users set status = 'active' where id = $1", [b.userId]);
    expect(await list(a)).toHaveLength(1);
    // Espace boutique : la messagerie des boutiques arrive au lot 6-B ; ici, refusée.
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status) values ($1, $2, 'Boutique A', $3, 'active')", [shopId, a.userId, `msg-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, a.userId]);
    const merchant = bearer((await h.http().post('/v1/auth/switch-space').set(a.auth).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken);
    await h.http().get('/v1/conversations').set(merchant).expect(403);
  });

  it('photo ré-encodée et privée ; suppression de son message ; signalement et modération journalisée', async () => {
    const a = await user();
    const b = await user();
    await follow(b, a);
    const c = (await start(a, b)).body;
    const jpeg = await sharp({ create: { width: 500, height: 400, channels: 3, background: { r: 200, g: 50, b: 80 } } }).withMetadata({ exif: { IFD0: { Copyright: 'x' } } }).jpeg().toBuffer();
    const photo = (await h.http().post(`/v1/conversations/${c.id}/messages`).set(a.auth).attach('photo', jpeg, 'p.jpg').expect(201)).body;
    expect(photo).toMatchObject({ kind: 'photo', photo: { width: 500, height: 400 } });
    expect(photo.photoUrl).toEqual(expect.any(String));
    await h.http().post(`/v1/conversations/${c.id}/messages`).set(a.auth).send({}).expect(400);

    const t = (await say(a, c.id, 'Message à supprimer')).body;
    await h.http().delete(`/v1/messages/${t.id}`).set(b.auth).expect(404); // pas le sien
    await h.http().delete(`/v1/messages/${t.id}`).set(a.auth).expect(204);
    expect((await list(b))[0].lastMessage!.preview).toBe('Message supprimé');

    const bad = (await say(a, c.id, 'Contenu insultant')).body;
    await h.http().post('/v1/content-reports').set(a.auth).send({ targetType: 'message', targetId: bad.id, reason: 'harassment' }).expect(404); // son propre message
    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'message', targetId: bad.id, reason: 'harassment' }).expect(201);
    const moderator = await adminSession(h, ['moderator']);
    const report = (await h.http().get('/admin/v1/content-reports').set(moderator).expect(200)).body.items.find((r: { targetId: string }) => r.targetId === bad.id);
    expect(report.content).toMatchObject({ kind: 'message', text: 'Contenu insultant' });
    const logged = await h.pool.query("select count(*)::int as n from audit_logs where action = 'admin.reported_message_viewed' and target_id = $1", [bad.id]);
    expect(logged.rows[0].n).toBeGreaterThanOrEqual(1);
    await h.http().post(`/admin/v1/content-reports/${report.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'Propos insultants' }).expect(200);
    const after = (await h.http().get(`/v1/conversations/${c.id}/messages`).set(b.auth).expect(200)).body.items.find((x: { id: string }) => x.id === bad.id);
    expect(after).toMatchObject({ status: 'hidden', text: null });
    await h.http().post(`/admin/v1/content/message/${bad.id}/restore`).set(moderator).expect(200);
  });

  it('pagination des messages et limites quotidiennes (simultanées)', async () => {
    const a = await user();
    const b = await user();
    await follow(b, a);
    const c = (await start(a, b)).body;
    for (let i = 0; i < 35; i++) await say(a, c.id, `Message ${i}`);
    const p1 = (await h.http().get(`/v1/conversations/${c.id}/messages`).set(b.auth).expect(200)).body;
    expect(p1.items).toHaveLength(30);
    expect(p1.items[0].text).toBe('Message 34');
    const p2 = (await h.http().get(`/v1/conversations/${c.id}/messages?before=${p1.nextBefore}`).set(b.auth).expect(200)).body;
    expect(p2.items.map((m: { text: string }) => m.text)).toEqual(['Message 4', 'Message 3', 'Message 2', 'Message 1', 'Message 0']);
    expect(p2.nextBefore).toBeNull();

    await h.pool.query("update app_settings set value = '1'::jsonb where key = 'messages.new_conversations_daily_limit'");
    h.settings.invalidate();
    try {
      const s = await user();
      const targets = await Promise.all([1, 2, 3, 4].map(() => user()));
      const rs = await Promise.all(targets.map((t) => h.http().post('/v1/conversations').set(s.auth).send({ username: t.username })));
      expect(rs.map((r) => r.status).sort()).toEqual([201, 429, 429, 429]);
    } finally {
      await h.pool.query("update app_settings set value = '20'::jsonb where key = 'messages.new_conversations_daily_limit'");
      h.settings.invalidate();
    }
  });
});
