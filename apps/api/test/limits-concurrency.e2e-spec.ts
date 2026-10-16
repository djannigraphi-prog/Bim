import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { APP_CONFIG, AppConfig } from '../src/config/config';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * Défaut 1 (audit du 16/10/2026) : les limites sur 24 heures étaient comptées hors de tout verrou. Des envois
 * simultanés lisaient tous le même compteur et dépassaient la limite. Chaque test envoie 5 requêtes en même temps
 * alors qu'une seule place reste : exactement une doit passer, les autres reçoivent 429.
 */
describe('Limites quotidiennes sous envois simultanés (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  const PARALLEL = 5;
  const jpeg = () => sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
  async function setLimit(key: string, value: number) {
    await h.pool.query('update app_settings set value = $1::jsonb where key = $2', [JSON.stringify(value), key]);
    h.settings.invalidate();
  }
  async function user() {
    const u = await registerAndActivate(h);
    return { ...u, auth: bearer(u.tokens.accessToken) };
  }
  const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();
  const oneOk = (status: number) => [status, ...Array(PARALLEL - 1).fill(429)].sort();

  it('publications : limite à 1, 5 envois simultanés → une seule publication', async () => {
    await setLimit('social.posts_daily_limit', 1);
    try {
      const u = await user();
      const rs = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => h.http().post('/v1/posts').set(u.auth).field('text', `Publication ${i}`).field('visibility', 'public')));
      expect(statuses(rs)).toEqual(oneOk(201));
      expect((await h.pool.query('select count(*)::int as n from posts where user_id = $1', [u.userId])).rows[0].n).toBe(1);
    } finally {
      await setLimit('social.posts_daily_limit', 20);
    }
  });

  it('commentaires : limite à 1, 5 envois simultanés → un seul commentaire', async () => {
    const author = await user();
    const post = (await h.http().post('/v1/posts').set(author.auth).field('text', 'À commenter').field('visibility', 'public').expect(201)).body;
    const postId = (post.post?.id ?? post.id) as string;
    await setLimit('social.comments_daily_limit', 1);
    try {
      const u = await user();
      const rs = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => h.http().post(`/v1/posts/${postId}/comments`).set(u.auth).send({ text: `Commentaire ${i}` })));
      expect(statuses(rs)).toEqual(oneOk(201));
      expect((await h.pool.query('select count(*)::int as n from post_comments where user_id = $1', [u.userId])).rows[0].n).toBe(1);
      expect((await h.pool.query('select comment_count from posts where id = $1', [postId])).rows[0].comment_count).toBe(1);
    } finally {
      await setLimit('social.comments_daily_limit', 200);
    }
  });

  it('stories : limite à 1, 5 envois simultanés → une seule story, aucun fichier orphelin', async () => {
    await setLimit('social.stories_daily_limit', 1);
    try {
      const u = await user();
      const img = await jpeg();
      const rs = await Promise.all(Array.from({ length: PARALLEL }, () => h.http().post('/v1/stories').set(u.auth).attach('photo', img, { filename: 's.jpg', contentType: 'image/jpeg' })));
      expect(statuses(rs)).toEqual(oneOk(201));
      expect((await h.pool.query('select count(*)::int as n from stories where user_id = $1', [u.userId])).rows[0].n).toBe(1);
      // Les fichiers des envois refusés sous verrou sont effacés : un seul fichier reste dans le stockage.
      expect(readdirSync(join(h.app.get<AppConfig>(APP_CONFIG).MEDIA_LOCAL_DIR, 'stories', u.userId))).toHaveLength(1);
    } finally {
      await setLimit('social.stories_daily_limit', 20);
    }
  });

  it('signalements : 19 déjà envoyés sur 20, 5 envois simultanés → un seul de plus', async () => {
    const u = await user();
    for (let i = 0; i < 19; i++) {
      await h.pool.query("insert into project_reports (id, context, user_id, reason, message) values ($1, 'general', $2, 'app', 'Ancien signalement de test')", [uuidv7(), u.userId]);
    }
    const rs = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => h.http().post('/v1/reports').set(u.auth).field('reason', 'app').field('message', `Le bouton ne réagit pas (essai ${i}).`)),
    );
    expect(statuses(rs)).toEqual(oneOk(201));
    expect((await h.pool.query('select count(*)::int as n from project_reports where user_id = $1', [u.userId])).rows[0].n).toBe(20);
  });

  it('Peni : limite à 1 message, 5 messages simultanés dans 5 discussions → un seul passe', async () => {
    const u = await user();
    const ids: string[] = [];
    for (let i = 0; i < PARALLEL; i++) ids.push((await h.http().post('/v1/peni/conversations').set(u.auth).send({ purpose: 'new_project' }).expect(201)).body.id);
    await setLimit('peni.daily_message_limit', 1);
    try {
      const rs = await Promise.all(ids.map((id) => h.http().post(`/v1/peni/conversations/${id}/messages`).set(u.auth).send({ text: 'Je veux me remettre au sport' })));
      expect(statuses(rs)).toEqual(oneOk(200));
      expect((await h.pool.query("select count(*)::int as n from peni_messages where user_id = $1 and role = 'user'", [u.userId])).rows[0].n).toBe(1);
    } finally {
      await setLimit('peni.daily_message_limit', 100);
    }
  });
});
