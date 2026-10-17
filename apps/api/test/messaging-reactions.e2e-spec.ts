import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 6-C — Réactions et réponses citées, entre personnes et avec une boutique ; droits et protections inchangés. */
describe('Messagerie : réactions et réponses citées (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  type Auth = Record<string, string>;
  async function user() {
    const u = await registerAndActivate(h);
    return { userId: u.userId as string, username: u.body.username as string, auth: bearer(u.tokens.accessToken) as Auth };
  }
  type U = Awaited<ReturnType<typeof user>>;
  const follow = (a: U, b: U) => h.http().put(`/v1/people/${b.username}/follow`).set(a.auth).expect(200);
  const start = async (a: U, b: U) => (await h.http().post('/v1/conversations').set(a.auth).send({ username: b.username }).expect(201)).body.id as string;
  const say = (auth: Auth, id: string, body: Record<string, unknown>, status = 201) => h.http().post(`/v1/conversations/${id}/messages`).set(auth).send(body).expect(status);
  const react = (auth: Auth, mid: string, emoji: string, status = 200, base = '/v1') => h.http().put(`${base}/messages/${mid}/reaction`).set(auth).send({ emoji }).expect(status);
  const items = async (auth: Auth, id: string) => (await h.http().get(`/v1/conversations/${id}/messages`).set(auth).expect(200)).body.items as Record<string, any>[];

  it('entre personnes : une réaction par personne, modifiable, retirable ; liste fermée ; réponse citée', async () => {
    const a = await user();
    const b = await user();
    await follow(b, a);
    const c = await start(a, b);
    const m1 = (await say(a.auth, c, { text: 'On court demain à 6 h ?' })).body;

    // b réagit, change d'avis : une seule réaction ; a la voit.
    await react(b.auth, m1.id, '👍');
    const r = (await react(b.auth, m1.id, '❤️')).body;
    expect(r.reactions).toEqual({ items: [{ emoji: '❤️', count: 1 }], mine: '❤️' });
    expect((await items(a.auth, c))[0].reactions).toEqual({ items: [{ emoji: '❤️', count: 1 }], mine: null });
    // a réagit aussi à son propre message ; deux réactions différentes.
    await react(a.auth, m1.id, '😂');
    expect((await items(b.auth, c))[0].reactions).toEqual({ items: [{ emoji: '❤️', count: 1 }, { emoji: '😂', count: 1 }], mine: '❤️' });
    // Émoji hors liste : refusé.
    expect((await react(b.auth, m1.id, '💩', 400)).body.error.code).toBe('VALIDATION_FAILED');
    // Réactions simultanées de la même personne : toujours une seule ligne.
    await Promise.all(['🙏', '😮', '😢', '👍'].map((e) => react(b.auth, m1.id, e)));
    expect((await h.pool.query('select count(*)::int as n from message_reactions where message_id = $1 and user_id = $2', [m1.id, b.userId])).rows[0].n).toBe(1);
    // Retirer.
    expect((await h.http().delete(`/v1/messages/${m1.id}/reaction`).set(b.auth).expect(200)).body.reactions).toEqual({ items: [{ emoji: '😂', count: 1 }], mine: null });

    // Réponse citée : aperçu du message cité, du point de vue de chacun.
    const m2 = (await say(b.auth, c, { text: 'Oui, au parc !', replyToId: m1.id })).body;
    expect(m2.replyTo).toEqual({ id: m1.id, senderIsMe: false, kind: 'text', status: 'published', preview: 'On court demain à 6 h ?' });
    expect((await items(a.auth, c))[0].replyTo).toMatchObject({ id: m1.id, senderIsMe: true });
    // Le message cité est supprimé : « Message supprimé », ses réactions disparaissent.
    await h.http().delete(`/v1/messages/${m1.id}`).set(a.auth).expect(204);
    const after = await items(b.auth, c);
    expect(after[0].replyTo).toEqual({ id: m1.id, senderIsMe: false, kind: 'text', status: 'deleted', preview: 'Message supprimé' });
    expect(after[1].reactions).toEqual({ items: [], mine: null });
    expect((await h.pool.query('select count(*)::int as n from message_reactions where message_id = $1', [m1.id])).rows[0].n).toBe(0);
    // On ne cite ni un message supprimé, ni un message d'une autre conversation, ni un identifiant inconnu.
    await say(b.auth, c, { text: 'Hein ?', replyToId: m1.id }, 400);
    const d = await user();
    await follow(d, a);
    const other = await start(a, d);
    const foreign = (await say(a.auth, other, { text: 'Ailleurs' })).body;
    await say(b.auth, c, { text: 'Je cite ailleurs', replyToId: foreign.id }, 400);
    await say(b.auth, c, { text: 'Je cite rien', replyToId: uuidv7() }, 400);
    // La base refuse aussi une citation d'une autre conversation (déclencheur).
    await expect(h.pool.query("insert into messages (id, conversation_id, sender_id, kind, text, reply_to_id) values ($1, $2, $3, 'text', 'x', $4)", [uuidv7(), c, b.userId, foreign.id])).rejects.toThrow(/same conversation/);
  });

  it('protections : demande non acceptée, tiers, blocage ; réaction réservée aux membres', async () => {
    const a = await user();
    const b = await user();
    const c = await start(a, b); // b ne suit pas a : demande
    const m = (await say(a.auth, c, { text: 'Bonjour, coach à Cocody' })).body;
    // Réagir à une demande préviendrait a qu'elle a été lue : refusé tant que b n'a pas accepté.
    expect((await react(b.auth, m.id, '👍', 409)).body.error.code).toBe('REQUEST_PENDING');
    await h.http().post(`/v1/conversations/${c}/accept`).set(b.auth).expect(200);
    await react(b.auth, m.id, '👍');
    // Un tiers ne réagit pas et n'apprend rien.
    const t = await user();
    await react(t.auth, m.id, '👍', 404);
    // Blocage : plus aucune réaction possible.
    await h.http().put(`/v1/people/${a.username}/block`).set(b.auth).expect(200);
    await react(b.auth, m.id, '❤️', 404);
    await h.http().delete(`/v1/messages/${m.id}/reaction`).set(a.auth).expect(404);
  });

  it('avec une boutique : réaction de la boutique pour toute l’équipe (personne gardée), citations des deux côtés', async () => {
    const owner = await registerAndActivate(h);
    const shopId = uuidv7();
    const slug = `r-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Boutique Réaction', $3, 'active', 'Abidjan')", [shopId, owner.userId, slug]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const ownerAuth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(owner.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    const st = await registerAndActivate(h);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [shopId, st.userId]);
    await h.pool.query("insert into shop_member_permissions (shop_id, user_id, permission) values ($1, $2, 'messages.reply')", [shopId, st.userId]);
    const staffAuth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(st.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;

    const a = await user();
    const c = (await h.http().post('/v1/conversations/shop').set(a.auth).send({ shopSlug: slug }).expect(201)).body.id as string;
    const q = (await say(a.auth, c, { text: 'La robe existe en M ?' })).body;
    // L'employée réagit, le propriétaire change la réaction : une seule réaction de la boutique.
    await react(staffAuth, q.id, '👍', 200, '/v1/shop/inbox');
    const r = (await react(ownerAuth, q.id, '🙏', 200, '/v1/shop/inbox')).body;
    expect(r.reactions).toEqual({ items: [{ emoji: '🙏', count: 1 }], mine: '🙏' });
    const row = (await h.pool.query('select user_id, shop_id from message_reactions where message_id = $1', [q.id])).rows;
    expect(row).toEqual([{ user_id: owner.userId, shop_id: shopId }]);
    // La cliente voit la réaction de la boutique, réagit de son côté.
    expect((await items(a.auth, c))[0].reactions).toEqual({ items: [{ emoji: '🙏', count: 1 }], mine: null });
    // Réponse citée de la boutique, vue par la cliente.
    const ans = (await h.http().post(`/v1/shop/inbox/${c}/messages`).set(staffAuth).send({ text: 'Oui, en stock.', replyToId: q.id }).expect(201)).body;
    expect(ans.replyTo).toMatchObject({ id: q.id, senderIsMe: false, preview: 'La robe existe en M ?' });
    expect((await items(a.auth, c))[0].replyTo).toMatchObject({ id: q.id, senderIsMe: true });
    // La cliente cite la réponse de la boutique ; la boutique la voit comme son message.
    await say(a.auth, c, { text: 'Super, je passe.', replyToId: ans.id });
    const shopView = (await h.http().get(`/v1/shop/inbox/${c}/messages`).set(ownerAuth).expect(200)).body.items;
    expect(shopView[0].replyTo).toMatchObject({ id: ans.id, senderIsMe: true });
    // Une autre boutique ne réagit pas ; employé sans permission refusé.
    const noPerm = await registerAndActivate(h);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [shopId, noPerm.userId]);
    const noPermAuth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(noPerm.tokens.accessToken)).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    await react(noPermAuth, q.id, '👍', 403, '/v1/shop/inbox');
    // Depuis l'espace utilisateur, le propriétaire ne réagit pas au nom de la boutique (ni en son nom : pas membre).
    await react(bearer(owner.tokens.accessToken) as Auth, q.id, '👍', 404);
  });
});
