import sharp from 'sharp';
import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** Lot 4 — Social (écrans 10, 11, 12, 16, 31, 52) : publications, « J'ai fait mon BIM », fil, j'aime, commentaires,
 * abonnements, blocages, photo de profil, signalements et modération. */
describe('Social (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  let n = 0;
  async function user() {
    n += 1;
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken), username: u.me.username as string };
  }
  const jpeg = (color: { r: number; g: number; b: number } = { r: 200, g: 30, b: 60 }) =>
    sharp({ create: { width: 800, height: 1000, channels: 3, background: color } })
      .withMetadata({ exif: { IFD0: { Copyright: 'test' } } })
      .jpeg()
      .toBuffer();
  const post = (auth: Record<string, string>, fields: Record<string, string>, images: Buffer[] = [], status = 201) => {
    let r = h.http().post('/v1/posts').set(auth);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const [i, img] of images.entries()) r = r.attach('images', img, { filename: `p${i}.jpg`, contentType: 'image/jpeg' });
    return r.expect(status);
  };
  const feed = async (auth: Record<string, string>, tab = 'for_you') => (await h.http().get(`/v1/feed?tab=${tab}`).set(auth).expect(200)).body;
  const ids = (f: { items: Array<{ id: string }> }) => f.items.map((p) => p.id);

  it('publication simple : texte et photos ré-encodées (sans métadonnées), visible dans « Pour toi », supprimée avec ses fichiers', async () => {
    const a = await user();
    const b = await user();
    const p = (await post(a.auth, { text: 'Premier mois terminé 💪', visibility: 'public' }, [await jpeg(), await jpeg({ r: 0, g: 0, b: 0 })])).body;
    expect(p).toMatchObject({ kind: 'post', text: 'Premier mois terminé 💪', visibility: 'public', likeCount: 0, commentCount: 0, likedByMe: false, isMine: true, journey: null });
    expect(p.author).toMatchObject({ username: a.username, avatarUrl: null });
    expect(p.media).toHaveLength(2);
    const img = await h.http().get(new URL(p.media[0].url).pathname).expect(200);
    expect((await sharp(img.body).metadata()).exif).toBeUndefined();

    expect(ids(await feed(b.auth))).toContain(p.id);
    const seen = (await h.http().get(`/v1/posts/${p.id}`).set(b.auth).expect(200)).body;
    expect(seen).toMatchObject({ isMine: false, followingAuthor: false });

    // Contrôles : vide, trop de photos, fichier non image, visibilité inconnue.
    await post(a.auth, { text: '   ' }, [], 400);
    await post(a.auth, { text: 'x' }, [await jpeg(), await jpeg(), await jpeg(), await jpeg(), await jpeg()], 400);
    await h.http().post('/v1/posts').set(a.auth).field('text', 'x').attach('images', Buffer.from('%PDF'), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(400);
    await post(a.auth, { text: 'x', visibility: 'amis' }, [], 400);

    // Seul l'auteur supprime ; ensuite introuvable pour tous, fichiers effacés.
    await h.http().delete(`/v1/posts/${p.id}`).set(b.auth).expect(404);
    await h.http().delete(`/v1/posts/${p.id}`).set(a.auth).expect(204);
    await h.http().get(`/v1/posts/${p.id}`).set(a.auth).expect(404);
    expect(ids(await feed(b.auth))).not.toContain(p.id);
    await h.http().get(new URL(p.media[0].url).pathname).expect(404);
    expect((await h.pool.query('select count(*)::int as n from post_media where post_id = $1', [p.id])).rows[0].n).toBe(0);
  });

  it('visibilité : tout le monde, abonnés, moi seul ; fil « Abonnés »', async () => {
    const a = await user();
    const fan = await user();
    const other = await user();
    const pub = (await post(a.auth, { text: 'public' })).body;
    const fol = (await post(a.auth, { text: 'abonnés', visibility: 'followers' })).body;
    const me = (await post(a.auth, { text: 'moi seul', visibility: 'private' })).body;
    await h.http().put(`/v1/people/${a.username}/follow`).set(fan.auth).expect(200);

    expect(ids(await feed(other.auth))).toEqual(expect.arrayContaining([pub.id]));
    expect(ids(await feed(other.auth))).not.toEqual(expect.arrayContaining([fol.id]));
    await h.http().get(`/v1/posts/${fol.id}`).set(other.auth).expect(404);
    await h.http().get(`/v1/posts/${me.id}`).set(other.auth).expect(404);

    const following = ids(await feed(fan.auth, 'following'));
    expect(following).toEqual(expect.arrayContaining([pub.id, fol.id]));
    expect(following).not.toContain(me.id);
    await h.http().get(`/v1/posts/${me.id}`).set(fan.auth).expect(404);
    expect((await h.http().get(`/v1/posts/${me.id}`).set(a.auth).expect(200)).body.visibility).toBe('private');
    // « Pour toi » ne montre que les publications publiques, même de personnes suivies.
    expect(ids(await feed(fan.auth))).not.toContain(fol.id);
    // Grille du profil : selon ce que chacun a le droit de voir.
    expect(ids((await h.http().get(`/v1/people/${a.username}/posts`).set(other.auth).expect(200)).body)).toEqual([pub.id]);
    expect(ids((await h.http().get(`/v1/people/${a.username}/posts`).set(fan.auth).expect(200)).body)).toEqual([fol.id, pub.id]);
    expect(ids((await h.http().get(`/v1/people/${a.username}/posts`).set(a.auth).expect(200)).body)).toEqual([me.id, fol.id, pub.id]);
  });

  it('pagination du fil par curseur, sans doublon ni trou', async () => {
    const a = await user();
    const v = await user();
    const mine: string[] = [];
    // Insérées directement : l'API limite les envois à 10 par 10 minutes (protection contre le spam).
    for (let i = 0; i < 23; i++) {
      const id = uuidv7(Date.now() + i);
      await h.pool.query("insert into posts (id, user_id, kind, text, visibility) values ($1, $2, 'post', $3, 'public')", [id, a.userId, `n°${i}`]);
      mine.push(id);
    }
    await h.http().put(`/v1/people/${a.username}/follow`).set(v.auth).expect(200);
    const p1 = await feed(v.auth, 'following');
    expect(p1.items).toHaveLength(20);
    const p2 = (await h.http().get(`/v1/feed?tab=following&cursor=${p1.nextCursor}`).set(v.auth).expect(200)).body;
    expect([...ids(p1), ...ids(p2)]).toEqual([...mine].reverse());
    expect(p2.nextCursor).toBeNull();
    await h.http().get('/v1/feed?cursor=abc').set(v.auth).expect(400);
  });

  it('j’aime et commentaires : compteurs exacts, réponses sur un niveau, suppression par l’auteur ou le propriétaire', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const p = (await post(a.auth, { text: 'Merci Peni' })).body;
    await h.http().put(`/v1/posts/${p.id}/like`).set(b.auth).expect(200);
    await h.http().put(`/v1/posts/${p.id}/like`).set(b.auth).expect(200); // deux fois : compté une fois
    expect((await h.http().put(`/v1/posts/${p.id}/like`).set(c.auth).expect(200)).body).toEqual({ likeCount: 2, likedByMe: true });
    expect((await h.http().delete(`/v1/posts/${p.id}/like`).set(c.auth).expect(200)).body).toEqual({ likeCount: 1, likedByMe: false });
    expect((await h.http().get(`/v1/posts/${p.id}`).set(b.auth).expect(200)).body).toMatchObject({ likeCount: 1, likedByMe: true });

    const c1 = (await h.http().post(`/v1/posts/${p.id}/comments`).set(b.auth).send({ text: 'Bravo !' }).expect(201)).body;
    const r1 = (await h.http().post(`/v1/posts/${p.id}/comments`).set(c.auth).send({ text: 'Oui, j’ai testé', parentId: c1.id }).expect(201)).body;
    // Répondre à une réponse : rattachée au commentaire d'origine.
    const r2 = (await h.http().post(`/v1/posts/${p.id}/comments`).set(a.auth).send({ text: 'Merci à vous', parentId: r1.id }).expect(201)).body;
    expect(r2.parentId).toBe(c1.id);
    const c2 = (await h.http().post(`/v1/posts/${p.id}/comments`).set(c.auth).send({ text: 'Top' }).expect(201)).body;
    await h.http().post(`/v1/posts/${p.id}/comments`).set(c.auth).send({ text: '' }).expect(400);
    await h.http().post(`/v1/posts/${p.id}/comments`).set(c.auth).send({ text: 'x'.repeat(1001) }).expect(400);

    let list = (await h.http().get(`/v1/posts/${p.id}/comments`).set(b.auth).expect(200)).body;
    expect(list.total).toBe(4);
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([c1.id, r1.id, r2.id, c2.id]);
    expect(list.items.find((x: { id: string }) => x.id === c2.id)).toMatchObject({ canDelete: false, isMine: false });

    expect((await h.http().put(`/v1/comments/${c1.id}/like`).set(c.auth).expect(200)).body).toEqual({ likeCount: 1, likedByMe: true });
    // Un tiers ne supprime pas ; l'auteur de la publication peut supprimer un commentaire et ses réponses.
    await h.http().delete(`/v1/comments/${c2.id}`).set(b.auth).expect(403);
    await h.http().delete(`/v1/comments/${c1.id}`).set(a.auth).expect(204);
    await h.http().delete(`/v1/comments/${c2.id}`).set(c.auth).expect(204);
    list = (await h.http().get(`/v1/posts/${p.id}/comments`).set(b.auth).expect(200)).body;
    expect(list).toMatchObject({ total: 0, items: [] });
    expect((await h.http().get(`/v1/posts/${p.id}`).set(b.auth).expect(200)).body.commentCount).toBe(0);
  });

  it('« J’ai fait mon BIM » : photos avant / après copiées, parcours résumé, projet et photos privées intacts', async () => {
    const a = await user();
    const b = await user();
    const pr = (await h.http().post('/v1/projects').set(a.auth).send({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', durationDays: 30 }).expect(201)).body;
    // Sans les deux photos : refusé.
    expect((await h.http().post('/v1/posts/bim').set(a.auth).send({ projectId: pr.id }).expect(409)).body.error.code).toBe('BIM_PHOTOS_MISSING');
    for (const kind of ['before', 'after']) {
      await h.http().post(`/v1/projects/${pr.id}/photos?kind=${kind}`).set(a.auth).attach('photo', await jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
    }
    // Projet d'une autre personne : introuvable.
    await h.http().post('/v1/posts/bim').set(b.auth).send({ projectId: pr.id }).expect(404);

    const bim = (await h.http().post('/v1/posts/bim').set(a.auth).send({ projectId: pr.id, text: 'De 90 kg à 65 kg' }).expect(201)).body;
    expect(bim).toMatchObject({ kind: 'bim', text: 'De 90 kg à 65 kg', journey: { category: 'Sport', goal: 'Abdos', days: 30, stepsDone: 0, projectAvailable: true } });
    expect(bim.media.map((m: { kind: string }) => m.kind)).toEqual(['before', 'after']);
    expect(bim.media.every((m: { takenDay: string }) => /^\d{4}-\d{2}-\d{2}$/.test(m.takenDay))).toBe(true);
    // Fichiers distincts de ceux du projet.
    const projectKeys = (await h.pool.query('select storage_key from project_photos where project_id = $1', [pr.id])).rows.map((r: { storage_key: string }) => r.storage_key);
    const postKeys = (await h.pool.query('select storage_key from post_media where post_id = $1', [bim.id])).rows.map((r: { storage_key: string }) => r.storage_key);
    expect(postKeys.some((k: string) => projectKeys.includes(k))).toBe(false);
    // Visible des autres, sans rien du projet privé (identifiant, description, mesures).
    const seen = (await h.http().get(`/v1/posts/${bim.id}`).set(b.auth).expect(200)).body;
    expect(JSON.stringify(seen)).not.toContain(pr.id);
    await h.http().get(`/v1/projects/${pr.id}`).set(b.auth).expect(404);
    // Supprimer la publication ne touche pas aux photos du projet.
    await h.http().delete(`/v1/posts/${bim.id}`).set(a.auth).expect(204);
    expect((await h.http().get(`/v1/projects/${pr.id}/photos`).set(a.auth).expect(200)).body.items).toHaveLength(2);
    // Profil : compteur BIM.
    const again = (await h.http().post('/v1/posts/bim').set(a.auth).send({ projectId: pr.id, visibility: 'public' }).expect(201)).body;
    expect((await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(200)).body.counts.bims).toBe(1);
    expect(again.kind).toBe('bim');
  });

  it('profil, abonnements, recherche ; photo de profil ; nombre de projets visible seulement par soi', async () => {
    const a = await user();
    const b = await user();
    await h.http().put(`/v1/people/${a.username}/follow`).set(b.auth).expect(200);
    await h.http().put(`/v1/people/${a.username}/follow`).set(b.auth).expect(200);
    await h.http().put(`/v1/people/${b.username}/follow`).set(b.auth).expect(400);
    let pa = (await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(200)).body;
    expect(pa).toMatchObject({ username: a.username, isMe: false, followedByMe: true, followsMe: false, counts: { followers: 1, following: 0, projects: null } });
    expect(pa).not.toHaveProperty('birthDate');
    expect(pa.city).toBeNull(); // ville privée par défaut
    const self = (await h.http().get(`/v1/people/@${a.username}`).set(a.auth).expect(200)).body;
    expect(self).toMatchObject({ isMe: true, followedByMe: false, counts: { followers: 1, projects: 0 } });
    expect(self.city).not.toBeNull();

    const found = (await h.http().get(`/v1/people?q=@${a.username}`).set(b.auth).expect(200)).body.items;
    expect(found[0]).toMatchObject({ username: a.username, followedByMe: true }); // nom exact en premier
    expect((await h.http().get('/v1/people?q=a').set(b.auth).expect(200)).body.items).toEqual([]);

    const av = (await h.http().put('/v1/me/avatar').set(a.auth).attach('photo', await jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(200)).body;
    expect(av.avatarUrl).toContain('/v1/media/');
    pa = (await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(200)).body;
    expect(pa.avatarUrl).toContain('/v1/media/');
    const key = (await h.pool.query('select avatar_key from users where id = $1', [a.userId])).rows[0].avatar_key;
    await h.http().put('/v1/me/avatar').set(a.auth).attach('photo', await jpeg(), { filename: 'b.jpg', contentType: 'image/jpeg' }).expect(200);
    await h.http().get(new URL(av.avatarUrl).pathname).expect(404); // l'ancienne photo est effacée
    expect((await h.pool.query('select avatar_key from users where id = $1', [a.userId])).rows[0].avatar_key).not.toBe(key);
    await h.http().delete('/v1/me/avatar').set(a.auth).expect(204);
    expect((await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(200)).body.avatarUrl).toBeNull();

    await h.http().delete(`/v1/people/${a.username}/follow`).set(b.auth).expect(200);
    expect((await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(200)).body.counts.followers).toBe(0);
    await h.http().get('/v1/people/personne_inexistante_xyz').set(b.auth).expect(404);
    await h.http().get(`/v1/people/${a.username}`).expect(401);
  });

  it('blocage : plus rien de visible ni d’interaction dans les deux sens ; abonnements retirés ; déblocage', async () => {
    const a = await user();
    const b = await user();
    await h.http().put(`/v1/people/${a.username}/follow`).set(b.auth).expect(200);
    await h.http().put(`/v1/people/${b.username}/follow`).set(a.auth).expect(200);
    const pa = (await post(a.auth, { text: 'de a' })).body;
    const pb = (await post(b.auth, { text: 'de b' })).body;
    const cb = (await h.http().post(`/v1/posts/${pa.id}/comments`).set(b.auth).send({ text: 'commentaire de b' }).expect(201)).body;

    await h.http().put(`/v1/people/${b.username}/block`).set(a.auth).expect(200);
    expect((await h.pool.query('select count(*)::int as n from follows where (follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)', [a.userId, b.userId])).rows[0].n).toBe(0);
    // Dans les deux sens : profils, publications, fil, commentaires, recherche.
    await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(404);
    await h.http().get(`/v1/people/${b.username}`).set(a.auth).expect(404);
    await h.http().get(`/v1/posts/${pa.id}`).set(b.auth).expect(404);
    await h.http().get(`/v1/posts/${pb.id}`).set(a.auth).expect(404);
    expect(ids(await feed(b.auth))).not.toContain(pa.id);
    expect(ids(await feed(a.auth))).not.toContain(pb.id);
    expect((await h.http().get(`/v1/posts/${pa.id}/comments`).set(a.auth).expect(200)).body.items.map((x: { id: string }) => x.id)).not.toContain(cb.id);
    expect((await h.http().get(`/v1/people?q=${a.username}`).set(b.auth).expect(200)).body.items).toEqual([]);
    await h.http().put(`/v1/posts/${pa.id}/like`).set(b.auth).expect(404);
    await h.http().post(`/v1/posts/${pa.id}/comments`).set(b.auth).send({ text: 'encore' }).expect(404);
    await h.http().put(`/v1/people/${a.username}/follow`).set(b.auth).expect(404);
    // La personne bloquée ne peut pas « contre-bloquer » pour savoir qu'elle l'est.
    await h.http().put(`/v1/people/${a.username}/block`).set(b.auth).expect(404);
    expect((await h.http().get('/v1/me/blocks').set(a.auth).expect(200)).body.items.map((x: { username: string }) => x.username)).toEqual([b.username]);

    await h.http().delete(`/v1/people/${b.username}/block`).set(a.auth).expect(200);
    await h.http().get(`/v1/posts/${pa.id}`).set(b.auth).expect(200);
  });

  it('signalement et modération : un seul signalement ouvert par contenu, masquer, rétablir, droits d’administration', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const p = (await post(a.auth, { text: 'contenu douteux' }, [await jpeg()])).body;
    const com = (await h.http().post(`/v1/posts/${p.id}/comments`).set(a.auth).send({ text: 'commentaire douteux' }).expect(201)).body;

    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'post', targetId: p.id, reason: 'spam', message: 'Publicité' }).expect(201);
    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'post', targetId: p.id, reason: 'spam' }).expect(201); // doublon ignoré
    await h.http().post('/v1/content-reports').set(c.auth).send({ targetType: 'post', targetId: p.id, reason: 'harassment' }).expect(201);
    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'comment', targetId: com.id, reason: 'hate' }).expect(201);
    await h.http().post('/v1/content-reports').set(a.auth).send({ targetType: 'post', targetId: p.id, reason: 'spam' }).expect(400); // son propre contenu
    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'post', targetId: p.id, reason: 'autre' }).expect(400);
    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'user', targetId: a.userId, reason: 'harassment' }).expect(201);

    const support = await adminSession(h, ['support']);
    const moderator = await adminSession(h, ['moderator']);
    const commercial = await adminSession(h, ['commercial']);
    await h.http().get('/admin/v1/content-reports').set(commercial).expect(403);
    const open = (await h.http().get('/admin/v1/content-reports').set(support).expect(200)).body.items.filter((r: { targetId: string }) => [p.id, com.id, a.userId].includes(r.targetId));
    expect(open).toHaveLength(4);
    const postReport = open.find((r: { targetType: string; reason: string }) => r.targetType === 'post' && r.reason === 'spam');
    expect(postReport).toMatchObject({ message: 'Publicité', author: { username: a.username }, content: { kind: 'post', text: 'contenu douteux', status: 'published' } });
    expect(postReport.content.images).toHaveLength(1);

    // Le support lit, la modération décide.
    await h.http().post(`/admin/v1/content-reports/${postReport.id}/resolve`).set(support).send({ action: 'hidden', resolution: 'Spam' }).expect(403);
    await h.http().post(`/admin/v1/content-reports/${postReport.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'Spam commercial' }).expect(200);
    await h.http().post(`/admin/v1/content-reports/${postReport.id}/resolve`).set(moderator).send({ action: 'none', resolution: 'x' }).expect(409);
    // Masquée : introuvable pour tous, y compris son auteur ; les deux signalements de la publication sont clos.
    await h.http().get(`/v1/posts/${p.id}`).set(b.auth).expect(404);
    await h.http().get(`/v1/posts/${p.id}`).set(a.auth).expect(404);
    expect(ids(await feed(c.auth))).not.toContain(p.id);
    const stillOpen = (await h.http().get('/admin/v1/content-reports').set(moderator).expect(200)).body.items.filter((r: { targetId: string }) => r.targetId === p.id);
    expect(stillOpen).toHaveLength(0);

    // Personne : pas de « masquer » (la suspension se fait depuis l'écran Utilisateurs).
    const userReport = open.find((r: { targetType: string }) => r.targetType === 'user');
    await h.http().post(`/admin/v1/content-reports/${userReport.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'x' }).expect(400);
    await h.http().post(`/admin/v1/content-reports/${userReport.id}/resolve`).set(moderator).send({ action: 'none', resolution: 'Rien à reprocher' }).expect(200);

    // Rétablir : visible de nouveau ; audit des décisions.
    await h.http().post(`/admin/v1/content/post/${p.id}/restore`).set(moderator).expect(200);
    await h.http().post(`/admin/v1/content/post/${p.id}/restore`).set(moderator).expect(409);
    await h.http().get(`/v1/posts/${p.id}`).set(b.auth).expect(200);
    const audit = (await h.pool.query("select action from audit_logs where target_id = $1 and action like 'admin.content%' order by created_at", [p.id])).rows.map((r: { action: string }) => r.action);
    expect(audit).toEqual(['admin.content_report_resolved', 'admin.content_restored']);

    // Commentaire masqué : retiré de la liste et du compteur.
    const comReport = open.find((r: { targetType: string }) => r.targetType === 'comment');
    await h.http().post(`/admin/v1/content-reports/${comReport.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'Propos haineux' }).expect(200);
    expect((await h.http().get(`/v1/posts/${p.id}/comments`).set(b.auth).expect(200)).body).toMatchObject({ total: 0, items: [] });
  });

  it('compte suspendu : ses publications disparaissent du fil ; limite de publications par 24 h (réglage administrable)', async () => {
    const a = await user();
    const b = await user();
    const p = (await post(a.auth, { text: 'avant suspension' })).body;
    await h.pool.query("update users set status = 'suspended' where id = $1", [a.userId]);
    expect(ids(await feed(b.auth))).not.toContain(p.id);
    await h.http().get(`/v1/people/${a.username}`).set(b.auth).expect(404);
    await h.pool.query("update users set status = 'active' where id = $1", [a.userId]);

    await h.pool.query("update app_settings set value = '2'::jsonb where key = 'social.posts_daily_limit'");
    h.settings.invalidate();
    try {
      const c = await user();
      await post(c.auth, { text: '1' });
      await post(c.auth, { text: '2' });
      expect((await post(c.auth, { text: '3' }, [], 429)).body.error.details).toMatchObject({ reason: 'SOCIAL_POSTS_DAILY_LIMIT', limit: 2 });
    } finally {
      await h.pool.query("update app_settings set value = '20'::jsonb where key = 'social.posts_daily_limit'");
      h.settings.invalidate();
    }
    expect(n).toBeGreaterThan(0);
  });
});
