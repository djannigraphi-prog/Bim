import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Lot 6-B — Messagerie des boutiques (écrans 48, 49, 51) : « Discuter » depuis un article ou une offre, boîte de la
 * boutique partagée par l'équipe, lu / non lu, archives, marques, réponses rapides, droits, blocage, signalement.
 */
describe('Messagerie des boutiques (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const jpeg = () => sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 220, g: 30, b: 60 } } }).jpeg().toBuffer();
  type Auth = Record<string, string>;

  async function client(overrides: Record<string, unknown> = {}) {
    const u = await registerAndActivate(h, overrides);
    return { ...u, username: u.body.username as string, auth: bearer(u.tokens.accessToken) as Auth };
  }
  async function shop(name = 'Boutique Élégance') {
    const owner = await registerAndActivate(h);
    const shopId = uuidv7();
    const slug = `e-${shopId}`;
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, $3, $4, 'active', 'Abidjan')", [shopId, owner.userId, name, slug]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);
    const ownerUser = bearer(owner.tokens.accessToken) as Auth;
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(ownerUser).send({ type: 'merchant', id: shopId }).expect(200)).body.accessToken) as Auth;
    return { shopId, slug, ownerId: owner.userId, ownerUser, auth };
  }
  type S = Awaited<ReturnType<typeof shop>>;
  async function staff(s: S) {
    const u = await registerAndActivate(h);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')", [s.shopId, u.userId]);
    const auth = bearer((await h.http().post('/v1/auth/switch-space').set(bearer(u.tokens.accessToken)).send({ type: 'merchant', id: s.shopId }).expect(200)).body.accessToken) as Auth;
    return { userId: u.userId, auth };
  }
  async function product(s: S, title: string, stock = 2) {
    const p = (await h.http().post('/v1/shop/products').set(s.auth).send({ title, categoryCode: 'vetements_soiree', priceFcfa: 45000 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${p.id}/photos`).set(s.auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    await h.http().post(`/v1/shop/products/${p.id}/publish`).set(s.auth).expect(200);
    if (stock) await h.http().put(`/v1/shop/products/${p.id}/variants/${p.variants[0].id}/stock`).set(s.auth).send({ quantity: stock }).expect(200);
    return p.id as string;
  }
  const open = (c: { auth: Auth }, body: Record<string, unknown>, status = 201) => h.http().post('/v1/conversations/shop').set(c.auth).send(body).expect(status);
  const say = (auth: Auth, id: string, text: string, status = 201) => h.http().post(`/v1/conversations/${id}/messages`).set(auth).send({ text }).expect(status);
  const reply = (auth: Auth, id: string, text: string, status = 201) => h.http().post(`/v1/shop/inbox/${id}/messages`).set(auth).send({ text }).expect(status);
  const inbox = async (auth: Auth, box = 'all') => (await h.http().get(`/v1/shop/inbox?box=${box}`).set(auth).expect(200)).body.items as { id: string; unread: number; archived: boolean; marked: boolean; person: { username: string }; lastMessage: { preview: string; senderIsMe: boolean } }[];

  it('« Discuter » depuis un article : bandeau sans stock exact, réponse de la boutique, non-lus et « Vu » des deux côtés', async () => {
    const s = await shop();
    const robe = await product(s, 'Robe soirée à plumes');
    const a = await client();

    const c = (await open(a, { shopSlug: s.slug, productId: robe })).body;
    expect(c).toMatchObject({ kind: 'shop', status: 'active', pendingForOther: false, person: null, shop: { id: s.shopId, name: 'Boutique Élégance', slug: s.slug }, lastMessage: null });
    expect(c.context.product).toMatchObject({ id: robe, title: 'Robe soirée à plumes', priceFcfa: 45000, available: true });
    expect(c.context.product.stock).toBeUndefined();
    // Conversation vide : rien dans la boîte de la boutique.
    expect(await inbox(s.auth)).toEqual([]);

    const m1 = (await say(a.auth, c.id, 'Bonjour, la robe à plumes est disponible en M ?')).body;
    expect(m1).toMatchObject({ senderIsMe: true, read: false });
    expect((await h.http().get('/v1/shop/inbox/unread-count').set(s.auth).expect(200)).body).toEqual({ unread: 1, all: 1 });
    const box = await inbox(s.auth);
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ id: c.id, unread: 1, person: { username: a.username }, lastMessage: { senderIsMe: false } });
    expect((await h.http().get(`/v1/shop/inbox/${c.id}`).set(s.auth).expect(200)).body.context.product.id).toBe(robe);

    // La boutique lit : « Vu » chez la cliente ; elle répond.
    await h.http().post(`/v1/shop/inbox/${c.id}/read`).set(s.auth).expect(200);
    expect((await h.http().get(`/v1/conversations/${c.id}/messages`).set(a.auth).expect(200)).body.items[0]).toMatchObject({ id: m1.id, read: true });
    const r1 = (await reply(s.auth, c.id, 'Oui ! Il en reste 2 en noir.')).body;
    expect(r1).toMatchObject({ senderIsMe: true, read: false });
    const mine = (await h.http().get(`/v1/shop/inbox/${c.id}/messages`).set(s.auth).expect(200)).body.items;
    expect(mine.map((m: { senderIsMe: boolean }) => m.senderIsMe)).toEqual([true, false]);

    // Côté cliente : la boutique dans sa liste, un non-lu, le message de la boutique n'est pas « à moi ».
    expect((await h.http().get('/v1/conversations/unread-count').set(a.auth).expect(200)).body).toEqual({ conversations: 1, requests: 0 });
    const list = (await h.http().get('/v1/conversations').set(a.auth).expect(200)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: c.id, kind: 'shop', unread: 1, shop: { slug: s.slug }, lastMessage: { senderIsMe: false, preview: 'Oui ! Il en reste 2 en noir.' } });
    expect((await h.http().get(`/v1/conversations/${c.id}/messages`).set(a.auth).expect(200)).body.items[0]).toMatchObject({ id: r1.id, senderIsMe: false, read: null });
    await h.http().post(`/v1/conversations/${c.id}/read`).set(a.auth).expect(200);
    expect((await h.http().get(`/v1/shop/inbox/${c.id}/messages`).set(s.auth).expect(200)).body.items[0]).toMatchObject({ id: r1.id, read: true });

    // Même conversation à chaque « Discuter » ; le bandeau suit le dernier article ouvert.
    const sac = await product(s, 'Sac perlé', 0);
    const again = (await open(a, { shopSlug: s.slug, productId: sac })).body;
    expect(again.id).toBe(c.id);
    expect(again.context.product).toMatchObject({ id: sac, available: false });
    // Article d'une autre boutique, ou inconnu : refusé.
    const other = await shop('Autre boutique');
    const foreign = await product(other, 'Robe ailleurs');
    await open(a, { shopSlug: s.slug, productId: foreign }, 404);
    await open(a, { shopSlug: 'inconnue', productId: robe }, 404);
    // Sa propre boutique : on répond depuis l'espace boutique.
    expect((await open({ auth: s.ownerUser }, { shopSlug: s.slug }, 409)).body.error.code).toBe('OWN_SHOP');
  });

  it('équipe : boîte partagée ; suppression par l’auteur ou le propriétaire ; employé retiré ou espace utilisateur refusés', async () => {
    const s = await shop();
    const e = await staff(s);
    const a = await client();
    const c = (await open(a, { shopSlug: s.slug })).body;
    await say(a.auth, c.id, 'Livraison à Yopougon possible ?');

    // L'employé voit la même conversation, répond ; la boîte devient lue pour toute l'équipe.
    expect((await inbox(e.auth)).map((x) => x.id)).toEqual([c.id]);
    const byStaff = (await reply(e.auth, c.id, 'Oui, dès demain.')).body;
    expect((await inbox(s.auth))[0]).toMatchObject({ unread: 0, lastMessage: { senderIsMe: true } });
    const audit = await h.pool.query("select actor_id, metadata from audit_logs where action = 'messages.message_sent' and target_id = $1 order by created_at desc limit 1", [c.id]);
    expect(audit.rows[0]).toMatchObject({ actor_id: e.userId, metadata: { kind: 'text', shopId: s.shopId } });

    // Suppression : l'employé ne supprime pas le message du propriétaire ; le propriétaire supprime celui de l'employé.
    const byOwner = (await reply(s.auth, c.id, 'Merci pour ta commande à venir !')).body;
    await h.http().delete(`/v1/shop/inbox/messages/${byOwner.id}`).set(e.auth).expect(403);
    await h.http().delete(`/v1/shop/inbox/messages/${byStaff.id}`).set(s.auth).expect(204);
    // La cliente ne supprime pas un message de la boutique.
    await h.http().delete(`/v1/messages/${byOwner.id}`).set(a.auth).expect(404);
    const texts = (await h.http().get(`/v1/conversations/${c.id}/messages`).set(a.auth).expect(200)).body.items.map((m: { status: string }) => m.status);
    expect(texts).toEqual(['published', 'deleted', 'published']);

    // Employé retiré : plus d'accès, revérifié à chaque requête.
    await h.pool.query('update shop_members set revoked_at = now() where shop_id = $1 and user_id = $2', [s.shopId, e.userId]);
    await h.http().get('/v1/shop/inbox').set(e.auth).expect(403);
    await reply(e.auth, c.id, 'Encore moi', 403);
    // Espace utilisateur du propriétaire : la boîte de la boutique est refusée.
    await h.http().get('/v1/shop/inbox').set(s.ownerUser).expect(403);
    // Une autre boutique ne voit pas cette conversation.
    const other = await shop('Autre');
    await h.http().get(`/v1/shop/inbox/${c.id}`).set(other.auth).expect(404);
    await reply(other.auth, c.id, 'Je m’invite', 404);
    expect(await inbox(other.auth)).toEqual([]);
  });

  it('archives, marques, non-lus : une conversation archivée revient quand la cliente écrit', async () => {
    const s = await shop();
    const a = await client();
    const b = await client();
    const ca = (await open(a, { shopSlug: s.slug })).body;
    const cb = (await open(b, { shopSlug: s.slug })).body;
    await say(a.auth, ca.id, 'Premier');
    await say(b.auth, cb.id, 'Second');
    expect((await inbox(s.auth)).map((x) => x.id)).toEqual([cb.id, ca.id]);

    await h.http().post(`/v1/shop/inbox/${cb.id}/read`).set(s.auth).expect(200);
    expect((await inbox(s.auth, 'unread')).map((x) => x.id)).toEqual([ca.id]);

    expect((await h.http().put(`/v1/shop/inbox/${ca.id}/archive`).set(s.auth).expect(200)).body.archived).toBe(true);
    expect((await inbox(s.auth)).map((x) => x.id)).toEqual([cb.id]);
    expect((await inbox(s.auth, 'archived')).map((x) => x.id)).toEqual([ca.id]);
    await say(a.auth, ca.id, 'Toujours là ?');
    expect((await inbox(s.auth)).map((x) => x.id)).toEqual([ca.id, cb.id]);
    expect(await inbox(s.auth, 'archived')).toEqual([]);

    await h.http().put(`/v1/shop/inbox/${cb.id}/mark`).set(s.auth).expect(200);
    expect((await inbox(s.auth, 'marked')).map((x) => x.id)).toEqual([cb.id]);
    await h.http().delete(`/v1/shop/inbox/${cb.id}/mark`).set(s.auth).expect(200);
    expect(await inbox(s.auth, 'marked')).toEqual([]);
    await h.http().get('/v1/shop/inbox?cursor=abc').set(s.auth).expect(400);
  });

  it('blocage, compte suspendu, boutique fermée : la conversation disparaît des deux côtés', async () => {
    const s = await shop();
    const a = await client();
    const c = (await open(a, { shopSlug: s.slug })).body;
    await say(a.auth, c.id, 'Bonjour');

    // La cliente bloque le propriétaire : plus de conversation, ni d'un côté ni de l'autre.
    await h.pool.query('insert into user_blocks (blocker_id, blocked_id) values ($1, $2)', [a.userId, s.ownerId]);
    expect(await inbox(s.auth)).toEqual([]);
    await h.http().get(`/v1/shop/inbox/${c.id}`).set(s.auth).expect(404);
    await h.http().get(`/v1/conversations/${c.id}`).set(a.auth).expect(404);
    expect((await h.http().get('/v1/conversations').set(a.auth).expect(200)).body.items).toEqual([]);
    await open(a, { shopSlug: s.slug }, 404);
    await h.pool.query('delete from user_blocks where blocker_id = $1', [a.userId]);

    // Boutique suspendue : la cliente ne la voit plus.
    await h.pool.query("update shops set status = 'suspended' where id = $1", [s.shopId]);
    await say(a.auth, c.id, 'Allô ?', 404);
    expect((await h.http().get('/v1/conversations/unread-count').set(a.auth).expect(200)).body).toEqual({ conversations: 0, requests: 0 });
    await h.pool.query("update shops set status = 'active' where id = $1", [s.shopId]);

    // Cliente suspendue : la boutique ne la voit plus.
    await h.pool.query("update users set status = 'suspended' where id = $1", [a.userId]);
    expect(await inbox(s.auth)).toEqual([]);
    await reply(s.auth, c.id, 'Tu es là ?', 404);
    await h.pool.query("update users set status = 'active' where id = $1", [a.userId]);
    expect((await inbox(s.auth)).map((x) => x.id)).toEqual([c.id]);
  });

  it('offre de projet : « Discuter » seulement pour ses propres offres ; signalements dans les deux sens', async () => {
    const s = await shop();
    const legging = (await h.http().post('/v1/shop/products').set(s.auth).send({ title: 'Legging', categoryCode: 'vetements_sport', priceFcfa: 8500 }).expect(201)).body;
    await h.http().post(`/v1/shop/products/${legging.id}/photos`).set(s.auth).attach('photos', await jpeg(), 'a.jpg').expect(201);
    await h.http().post(`/v1/shop/products/${legging.id}/publish`).set(s.auth).expect(200);
    const a = await client();
    const pr = (await h.http().post('/v1/projects').set(a.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30, receiveMerchantOffers: true }).expect(201)).body;
    const projectId = (pr.project?.id ?? pr.id) as string;
    const offer = (await h.http().post(`/v1/shop/project-requests/${projectId}/offers`).set(s.auth).send({ message: 'Une offre pour ton projet sport.' }).expect(201)).body;

    const intruder = await client();
    await open(intruder, { shopSlug: s.slug, offerId: offer.id }, 404);
    const other = await shop('Autre');
    await open(a, { shopSlug: other.slug, offerId: offer.id }, 404);
    const c = (await open(a, { shopSlug: s.slug, offerId: offer.id })).body;
    expect(c.context).toMatchObject({ product: null, offer: { id: offer.id } });

    // Signalements : la cliente signale un message de la boutique, l'équipe signale un message de la cliente.
    const fromClient = (await say(a.auth, c.id, 'Message insultant')).body;
    const fromShop = (await reply(s.auth, c.id, 'Réponse déplacée')).body;
    await h.http().post('/v1/content-reports').set(a.auth).send({ targetType: 'message', targetId: fromShop.id, reason: 'harassment' }).expect(201);
    await h.http().post('/v1/content-reports').set(s.auth).send({ targetType: 'message', targetId: fromClient.id, reason: 'harassment' }).expect(201);
    // L'équipe ne signale pas un message de sa propre boutique ; une autre boutique ne signale rien ici.
    await h.http().post('/v1/content-reports').set(s.auth).send({ targetType: 'message', targetId: fromShop.id, reason: 'spam' }).expect(404);
    await h.http().post('/v1/content-reports').set(other.auth).send({ targetType: 'message', targetId: fromClient.id, reason: 'spam' }).expect(404);
    const reports = await h.pool.query("select target_id, target_user_id from content_reports where target_type = 'message' and target_id in ($1, $2)", [fromClient.id, fromShop.id]);
    expect(reports.rows).toHaveLength(2);
    expect(reports.rows.find((r: { target_id: string }) => r.target_id === fromShop.id).target_user_id).toBe(s.ownerId);

    // La modération voit le message signalé de la boutique (consultation journalisée).
    const moderator = await adminSession(h, ['moderator']);
    const list = (await h.http().get('/admin/v1/content-reports').set(moderator).expect(200)).body.items;
    expect(list.some((r: { targetId: string }) => r.targetId === fromShop.id)).toBe(true);
  });

  it('réponses rapides : 10 au plus même sous envois simultanés, propres à chaque boutique', async () => {
    const s = await shop();
    const other = await shop('Autre');
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => h.http().post('/v1/shop/inbox/quick-replies').set(s.auth).send({ text: `Réponse ${i}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const items = (await h.http().get('/v1/shop/inbox/quick-replies').set(s.auth).expect(200)).body.items as { id: string }[];
    expect(items).toHaveLength(10);
    expect((await h.http().get('/v1/shop/inbox/quick-replies').set(other.auth).expect(200)).body.items).toEqual([]);
    // Une autre boutique ne retire pas mes réponses rapides.
    await h.http().delete(`/v1/shop/inbox/quick-replies/${items[0].id}`).set(other.auth).expect(200);
    expect((await h.http().get('/v1/shop/inbox/quick-replies').set(s.auth).expect(200)).body.items).toHaveLength(10);
    await h.http().delete(`/v1/shop/inbox/quick-replies/${items[0].id}`).set(s.auth).expect(200);
    expect((await h.http().get('/v1/shop/inbox/quick-replies').set(s.auth).expect(200)).body.items).toHaveLength(9);
    await h.http().post('/v1/shop/inbox/quick-replies').set(s.auth).send({ text: '' }).expect(400);
  });
});
