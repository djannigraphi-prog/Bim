import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Défaut 3 (audit du 16/10/2026) : masquer un commentaire de premier niveau laissait ses réponses publiées.
 * Elles disparaissaient de la liste mais restaient comptées dans le compteur de la publication, notifiées à
 * son auteur, et on pouvait encore les aimer ou les signaler.
 */
describe('Réponses d’un commentaire masqué (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }

  it('masquage puis rétablissement : compteur exact, réponses ni visibles, ni notifiées, ni actionnables pendant le masquage', async () => {
    const author = await user();
    const a = await user();
    const b = await user();
    const post = (await h.http().post('/v1/posts').set(author.auth).field('text', 'Ma transformation').field('visibility', 'public').expect(201)).body;
    const postId = (post.post?.id ?? post.id) as string;
    const top = (await h.http().post(`/v1/posts/${postId}/comments`).set(a.auth).send({ text: 'Commentaire déplacé' }).expect(201)).body;
    const r1 = (await h.http().post(`/v1/posts/${postId}/comments`).set(b.auth).send({ text: 'Réponse 1', parentId: top.id }).expect(201)).body;
    await h.http().post(`/v1/posts/${postId}/comments`).set(author.auth).send({ text: 'Réponse 2', parentId: top.id }).expect(201);
    await h.http().post(`/v1/posts/${postId}/comments`).set(b.auth).send({ text: 'Autre commentaire' }).expect(201);
    const count = async () => (await h.http().get(`/v1/posts/${postId}/comments`).set(b.auth).expect(200)).body.total as number;
    expect(await count()).toBe(4);

    await h.http().post('/v1/content-reports').set(b.auth).send({ targetType: 'comment', targetId: top.id, reason: 'harassment' }).expect(201);
    const moderator = await adminSession(h, ['moderator']);
    const report = (await h.http().get('/admin/v1/content-reports').set(moderator).expect(200)).body.items.find((r: { targetId: string }) => r.targetId === top.id);
    await h.http().post(`/admin/v1/content-reports/${report.id}/resolve`).set(moderator).send({ action: 'hidden', resolution: 'Propos déplacés' }).expect(200);

    // Compteur : seul « Autre commentaire » reste (le commentaire masqué et ses 2 réponses sont retirés).
    expect(await count()).toBe(1);
    expect((await h.http().get(`/v1/posts/${postId}`).set(b.auth).expect(200)).body.commentCount ?? (await count())).toBe(1);
    // Notifications de l'auteur de la publication : plus de « a commenté » pour les réponses du commentaire masqué.
    const inbox = (await h.http().get('/v1/me/notifications').set(author.auth).expect(200)).body.items as { type: string; text: string }[];
    expect(inbox.filter((n) => n.type === 'post_commented').map((n) => n.text).join(' ')).not.toContain('Réponse 1');
    // Réponse d'un commentaire masqué : ni « j'aime » ni signalement.
    await h.http().put(`/v1/comments/${r1.id}/like`).set(a.auth).expect(404);
    await h.http().post('/v1/content-reports').set(a.auth).send({ targetType: 'comment', targetId: r1.id, reason: 'spam' }).expect(404);

    // Rétabli : le commentaire et ses réponses comptent de nouveau.
    await h.http().post(`/admin/v1/content/comment/${top.id}/restore`).set(moderator).expect(200);
    expect(await count()).toBe(4);
    await h.http().put(`/v1/comments/${r1.id}/like`).set(a.auth).expect(200);
  });

  it('suppression d’une réponse pendant le masquage du parent : impossible, compteur intact', async () => {
    const author = await user();
    const a = await user();
    const post = (await h.http().post('/v1/posts').set(author.auth).field('text', 'Publication').field('visibility', 'public').expect(201)).body;
    const postId = (post.post?.id ?? post.id) as string;
    const top = (await h.http().post(`/v1/posts/${postId}/comments`).set(a.auth).send({ text: 'Parent' }).expect(201)).body;
    const reply = (await h.http().post(`/v1/posts/${postId}/comments`).set(a.auth).send({ text: 'Réponse', parentId: top.id }).expect(201)).body;
    await h.pool.query("update post_comments set status = 'hidden' where id = $1", [top.id]);
    await h.pool.query('update posts set comment_count = 0 where id = $1', [postId]);
    await h.http().delete(`/v1/comments/${reply.id}`).set(a.auth).expect(404);
    expect((await h.pool.query('select comment_count from posts where id = $1', [postId])).rows[0].comment_count).toBe(0);
  });
});
