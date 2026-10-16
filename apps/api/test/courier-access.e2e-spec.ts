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
    // Rien n'est encore développé pour les livreurs : dès qu'une route l'est, ce test devra lister explicitement
    // les seules routes autorisées (annonces publiées, courses acceptées, historique personnel).
    expect(all.filter((r) => r.space === 'courier')).toEqual([]);
    const shopRoutes = all.filter((r) => r.path.startsWith('/v1/shop/') || r.path === '/v1/shop');
    expect(shopRoutes.length).toBeGreaterThan(20);
    expect(shopRoutes.filter((r) => r.space !== 'merchant')).toEqual([]);
    // Aucune route de commandes, de livraisons ni d'historique n'existe avant les sous-lots 7-B à 7-F.
    expect(all.filter((r) => /\/(orders|deliveries|courses)\b/.test(r.path))).toEqual([]);
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
    // Aucune route de commandes ou de livraisons n'existe encore.
    await h.http().get('/v1/orders').set(auth).expect(404);
    await h.http().get('/v1/deliveries').set(auth).expect(404);
  });
});
