import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/** V1 — Recommandations sans publicité : « Pour toi » classé et personnes à suivre (jamais de mineurs). */
describe('Recommandations (e2e)', () => {
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
  const post = async (author: U, text: string, hoursAgo = 0) => {
    const id = uuidv7(Date.now() - hoursAgo * 3600_000);
    await h.pool.query("insert into posts (id, user_id, kind, text, visibility, created_at) values ($1, $2, 'post', $3, 'public', now() - ($4 || ' hours')::interval)", [id, author.userId, text, String(hoursAgo)]);
    return id;
  };
  const minor = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 17);
    return d.toISOString().slice(0, 10);
  };

  it('« Pour toi » : une personne suivie passe devant une publication un peu plus récente ; pages sans doublon', async () => {
    const v = await user();
    const friend = await user();
    const stranger = await user();
    const old = await post(friend, 'Publication de mon amie, il y a 5 h', 5);
    const fresh = await post(stranger, 'Publication récente d’une inconnue', 0);
    await follow(v, friend);
    const p1 = (await h.http().get('/v1/feed?tab=for_you').set(v.auth).expect(200)).body;
    const order = p1.items.map((x: { id: string }) => x.id).filter((id: string) => [old, fresh].includes(id));
    expect(order).toEqual([old, fresh]);
    // Pagination : curseur classé, pages disjointes.
    for (let i = 0; i < 25; i++) await post(stranger, `n°${i}`, 10 + i);
    const a = (await h.http().get('/v1/feed?tab=for_you').set(v.auth).expect(200)).body;
    expect(a.nextCursor).toMatch(/^r\.\d+\.20$/);
    const b = (await h.http().get(`/v1/feed?tab=for_you&cursor=${a.nextCursor}`).set(v.auth).expect(200)).body;
    const ids = [...a.items, ...b.items].map((x: { id: string }) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    await h.http().get('/v1/feed?tab=for_you&cursor=r.abc.1').set(v.auth).expect(400);
  });

  it('personnes à suivre : abonnements en commun d’abord ; ni déjà suivies, ni bloquées, ni mineures', async () => {
    const v = await user();
    const f1 = await user();
    const f2 = await user();
    const star = await user({ fullName: 'Star du sport' });
    const teen = await user({ birthDate: minor() });
    const blocked = await user();
    await follow(v, f1);
    await follow(v, f2);
    for (const x of [f1, f2]) {
      await follow(x, star);
      await follow(x, teen);
      await follow(x, blocked);
    }
    await h.http().put(`/v1/people/${blocked.username}/block`).set(v.auth).expect(200);
    const s = (await h.http().get('/v1/people/suggestions').set(v.auth).expect(200)).body.items;
    const names = s.map((x: { username: string }) => x.username);
    expect(names).toContain(star.username);
    expect(s.find((x: { username: string }) => x.username === star.username)).toMatchObject({ reason: 'followed_by_friends', mutualCount: 2 });
    expect(names).not.toContain(teen.username);
    expect(names).not.toContain(blocked.username);
    expect(names).not.toContain(f1.username);
    await follow(v, star);
    expect((await h.http().get('/v1/people/suggestions').set(v.auth).expect(200)).body.items.map((x: { username: string }) => x.username)).not.toContain(star.username);
  });
});
