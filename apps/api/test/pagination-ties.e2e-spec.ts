import { uuidv7 } from '../src/common/uuid';
import { adminSession } from './admin-helpers';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Défaut 4 (audit du 16/10/2026) : la page suivante du centre de notifications et du journal d'audit reprenait
 * strictement AVANT la date (arrondie à la milliseconde) du dernier élément affiché. Des éléments à la même date,
 * ou à quelques microsecondes près, étaient sautés au changement de page.
 */
describe('Pagination sans élément sauté (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  it('centre de notifications : 5 « j’aime » à la même date, pages de 2 → les 5 sont vus, une seule fois', async () => {
    const owner = await registerAndActivate(h);
    const auth = bearer(owner.tokens.accessToken);
    const post = (await h.http().post('/v1/posts').set(auth).field('text', 'Très aimée').field('visibility', 'public').expect(201)).body;
    const postId = (post.post?.id ?? post.id) as string;
    const at = new Date(Date.now() - 60_000);
    const likers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await registerAndActivate(h);
      likers.push(u.userId);
      // Même instant, à la microseconde près pour certains : le cas qui faisait sauter des éléments.
      await h.pool.query(`insert into post_likes (post_id, user_id, created_at) values ($1, $2, $3::timestamptz + make_interval(secs => $4))`, [postId, u.userId, at.toISOString(), i % 2 ? 0.0004 : 0]);
    }
    const seen: string[] = [];
    let query: Record<string, string> = { limit: '2', category: 'social' };
    for (let page = 0; page < 10; page++) {
      const r = (await h.http().get('/v1/me/notifications').query(query).set(auth).expect(200)).body;
      seen.push(...r.items.map((n: { id: string }) => n.id));
      if (!r.nextBefore) break;
      query = { limit: '2', category: 'social', before: r.nextBefore, ...(r.nextBeforeId ? { beforeId: r.nextBeforeId } : {}) };
    }
    const likes = seen.filter((id) => id.startsWith('like:'));
    expect(new Set(likes).size).toBe(likes.length);
    expect(likes.sort()).toEqual(likers.map((u) => `like:${postId}:${u}`).sort());
  });

  it('journal d’audit : 5 entrées à la même date, pages de 2 → les 5 sont vues, une seule fois', async () => {
    const admin = await adminSession(h, ['super_admin']);
    const action = `audit.pagination_test_${Date.now()}`;
    const at = new Date(Date.now() - 60_000).toISOString();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = uuidv7();
      ids.push(id);
      await h.pool.query(`insert into audit_logs (id, actor_type, action, created_at) values ($1, 'system', $2, $3::timestamptz + make_interval(secs => $4))`, [id, action, at, i % 2 ? 0.0004 : 0]);
    }
    const seen: string[] = [];
    let q = `action=${action}&limit=2`;
    for (let page = 0; page < 10; page++) {
      const r = (await h.http().get(`/admin/v1/audit-logs?${q}`).set(admin).expect(200)).body;
      seen.push(...r.items.map((e: { id: string }) => e.id));
      if (!r.nextBefore) break;
      q = `action=${action}&limit=2&before=${encodeURIComponent(r.nextBefore)}${r.nextBeforeId ? `&beforeId=${r.nextBeforeId}` : ''}`;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(ids.sort());
  });
});
