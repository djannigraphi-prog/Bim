import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { uuidv7 } from '../src/common/uuid';
import { REQUIRED_SPACE } from '../src/modules/auth/auth.decorators';
import { bearer, Harness, registerAndActivate, startHarness } from './harness';

/**
 * L7-04 — Accès des livreurs. Un livreur ne voit jamais les commandes internes d'une boutique : seulement les annonces
 * de livraison publiées, les courses qu'il a acceptées et son propre historique (7-E / 7-F, pas encore développés).
 * Aujourd'hui aucune route n'est ouverte à l'espace livreur ; ces tests verrouillent cette séparation côté serveur.
 */
describe('Accès des livreurs (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  /** Toutes les routes déclarées : chemin complet et espace exigé (méthode, sinon contrôleur). */
  function routes() {
    const out: { path: string; method: string; space: string | undefined }[] = [];
    for (const mod of h.app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined;
        if (!ctrl?.prototype) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const handler = (ctrl.prototype as Record<string, unknown>)[name];
          if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
          const sub = String(Reflect.getMetadata(PATH_METADATA, handler));
          out.push({
            path: `/${[base, sub].filter((x) => x && x !== '/').join('/')}`.replace(/\/+/g, '/'),
            method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number],
            space: Reflect.getMetadata(REQUIRED_SPACE, handler) ?? Reflect.getMetadata(REQUIRED_SPACE, ctrl),
          });
        }
      }
    }
    return out;
  }

  it('aucune route n’est ouverte à l’espace livreur ; toutes les routes des boutiques exigent l’espace boutique', () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(100);
    // 7-E / 7-F : les seules routes de l'espace livreur sont sous /v1/courier/ : profil, relations, missions qui lui
    // sont proposées, ses courses, son historique ; aucune route de commandes de boutique.
    const courierRoutes = all.filter((r) => r.space === 'courier');
    expect(courierRoutes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /v1/courier/courses',
      'GET /v1/courier/courses/:id',
      'GET /v1/courier/me',
      'GET /v1/courier/missions',
      'PATCH /v1/courier/me',
      'POST /v1/courier/courses/:id/arrived',
      'POST /v1/courier/courses/:id/cash',
      'POST /v1/courier/courses/:id/client-absent',
      'POST /v1/courier/courses/:id/close',
      'POST /v1/courier/courses/:id/code',
      'POST /v1/courier/courses/:id/incidents',
      'POST /v1/courier/courses/:id/picked-up',
      'POST /v1/courier/incidents/:id/notes',
      'POST /v1/courier/incidents/:id/support',
      'POST /v1/courier/missions/:offerId/accept',
      'POST /v1/courier/missions/:offerId/decline',
      'POST /v1/courier/relations/:id/accept',
      'POST /v1/courier/relations/:id/decline',
      'POST /v1/courier/relations/:id/end',
      'POST /v1/courier/reviews/:id/report',
    ]);
    const shopRoutes = all.filter((r) => r.path.startsWith('/v1/shop/') || r.path === '/v1/shop');
    expect(shopRoutes.length).toBeGreaterThan(20);
    expect(shopRoutes.filter((r) => r.space !== 'merchant')).toEqual([]);
    // 7-B : les commandes sont réservées au client (espace personnel) et à la boutique (espace boutique) ; aucune
    // route de livraison ni d'historique de courses n'existe avant 7-E / 7-F.
    const orderRoutes = all.filter((r) => /\/orders\b/.test(r.path));
    expect(orderRoutes.length).toBeGreaterThan(5);
    expect(orderRoutes.filter((r) => !(r.path.startsWith('/v1/orders') ? r.space === 'user' : r.path.startsWith('/v1/shop/orders') && r.space === 'merchant'))).toEqual([]);
    // Courses : seulement dans l'espace livreur ; livraisons d'une commande : client et boutique via leurs commandes.
    expect(all.filter((r) => /\/(deliveries|courses|missions)\b/.test(r.path) && r.space !== 'courier')).toEqual([]);
  });

  it('un compte livreur actif n’accède à aucune donnée d’une boutique ni à la messagerie des clients', async () => {
    // Une boutique avec un article, une conversation de client et une équipe.
    const owner = await registerAndActivate(h);
    const shopId = uuidv7();
    await h.pool.query("insert into shops (id, owner_user_id, name, slug, status, city) values ($1, $2, 'Boutique Élégance', $3, 'active', 'Abidjan')", [shopId, owner.userId, `c-${shopId}`]);
    await h.pool.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shopId, owner.userId]);

    // Un livreur : compte livreur actif, même partenaire de cette boutique.
    const courier = await registerAndActivate(h);
    const courierId = uuidv7();
    await h.pool.query("insert into courier_accounts (id, user_id, type, status) values ($1, $2, 'freelance', 'active')", [courierId, courier.userId]);
    await h.pool.query("insert into courier_shop_partnerships (id, courier_id, shop_id, status) values ($1, $2, $3, 'active')", [uuidv7(), courierId, shopId]);
    const userAuth = bearer(courier.tokens.accessToken);
    const sw = await h.http().post('/v1/auth/switch-space').set(userAuth).send({ type: 'courier', id: courierId }).expect(200);
    const auth = bearer(sw.body.accessToken);

    // Espace livreur : refus sur toutes les routes de boutique (commandes internes, catalogue, messages, équipe…).
    for (const url of ['/v1/shop', '/v1/shop/products', '/v1/shop/inbox', '/v1/shop/team', '/v1/shop/project-requests', '/v1/shop/offers']) {
      const r = await h.http().get(url).set(auth);
      expect([url, r.status]).toEqual([url, 403]);
    }
    // Ni la messagerie ni les projets des personnes depuis l'espace livreur.
    await h.http().get('/v1/conversations').set(auth).expect(403);
    await h.http().get('/v1/projects').set(auth).expect(403);
    // Un partenariat ne donne pas l'espace boutique.
    await h.http().post('/v1/auth/switch-space').set(userAuth).send({ type: 'merchant', id: shopId }).expect(403);
    // 7-E : le fil, les profils et les demandes de boutique sont fermés depuis l'espace livreur ; le compte reste ouvert.
    await h.http().get('/v1/feed').set(auth).expect(403);
    await h.http().get('/v1/merchant/applications/mine').set(auth).expect(403);
    await h.http().get('/v1/courier-application').set(auth).expect(403);
    await h.http().get('/v1/me').set(auth).expect(200);
    // Son propre espace : profil et relation avec la boutique (nom seulement), aucune donnée de commande.
    const me = (await h.http().get('/v1/courier/me').set(auth).expect(200)).body;
    expect(me.relations).toEqual([expect.objectContaining({ shop: { name: 'Boutique Élégance', city: 'Abidjan', commune: null }, status: 'active' })]);
    expect(JSON.stringify(me)).not.toMatch(/order|commande/i);
    // Commandes : ni celles des clients ni celles de la boutique depuis l'espace livreur ; pas encore de livraisons.
    await h.http().get('/v1/orders').set(auth).expect(403);
    await h.http().get('/v1/shop/orders').set(auth).expect(403);
    await h.http().get('/v1/deliveries').set(auth).expect(404);
  });
});
