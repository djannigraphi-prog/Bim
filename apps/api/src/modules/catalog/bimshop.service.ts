import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql, SQL } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { DB, Database } from '../../database/database.module';
import { inventoryMovements, productFavorites, productMedia, productRecommendations, products, productVariants, productVideos, reviews, shopCategories, shopFollows, shopMembers, shops, users } from '../../database/schema';
import { StorageService } from '../media/storage';
import { certifiedShopIds } from '../wallet/premium';

export type BimShopSort = 'recent' | 'price_asc' | 'price_desc';
const PAGE = 20;
/** Nombre d'avis sur la boutique avant d'afficher ses étoiles (décision du fondateur, 19/10/2026). */
export const SHOP_RATING_MIN_REVIEWS = 3;
type ProductRow = typeof products.$inferSelect;
type ShopRow = typeof shops.$inferSelect;

/** Échappe % _ \ pour une recherche ILIKE. */
const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Lot 5-C — BimShop (écrans 32, 33, 34, 54) : parcourir, chercher, fiche article, profil public d'une boutique,
 * articles mis de côté, boutiques suivies. **Aucune commande ni paiement** (lots 7 et 8).
 * Seuls les articles publiés des boutiques ouvertes dont le propriétaire a un compte actif sont visibles.
 * Le stock exact n'est jamais montré au public : seulement « disponible » ou « épuisé ».
 */

/** Prix payé (promotion ou prix normal), pour le tri et la pagination. */
const PAID = sql<number>`coalesce(${products.promoPriceFcfa}, ${products.priceFcfa})`;

/** L7-04 : prix affiché = promotion (prix normal barré) ou prix normal. Contrat de lecture inchangé. */
function publicPrices(p: { priceFcfa: number; promoPriceFcfa: number | null }) {
  return { priceFcfa: p.promoPriceFcfa ?? p.priceFcfa, compareAtFcfa: p.promoPriceFcfa != null ? p.priceFcfa : null };
}

@Injectable()
export class BimShopService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  private async url(key: string | null, apiBase: string) {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  /** Conditions de visibilité publique d'un article (jointure shops + users obligatoire). */
  private visible(): SQL {
    return and(eq(products.status, 'published'), eq(shops.status, 'active'), eq(users.status, 'active'))!;
  }

  /**
   * `verified` : boutique validée par l'équipe (identité contrôlée), plus affiché comme badge.
   * `certified` : badge de certification, réservé aux boutiques dont le propriétaire est Premium (V1-1910-C).
   */
  private publicShop(s: ShopRow, certified: Set<string>) {
    return { id: s.id, name: s.name, slug: s.slug, city: s.city, commune: s.commune, verified: !!s.verifiedAt, certified: certified.has(s.id) };
  }

  /** Résumés publics : première photo, disponibilité (articles), boutique. */
  /** `rich: false` : sans vidéo ni compteurs (articles cités dans une publication ou une conversation). */
  async cards(rows: { p: ProductRow; s: ShopRow }[], apiBase: string, opts: { rich?: boolean } = {}) {
    if (!rows.length) return [];
    const rich = opts.rich !== false;
    const ids = rows.map((r) => r.p.id);
    const [media, stock, videos, counts, certified] = await Promise.all([
      this.db.select().from(productMedia).where(inArray(productMedia.productId, ids)).orderBy(asc(productMedia.position)),
      this.stockByProduct(ids),
      rich ? this.db.select().from(productVideos).where(inArray(productVideos.productId, ids)) : Promise.resolve([] as (typeof productVideos.$inferSelect)[]),
      rich ? this.counts(ids) : Promise.resolve(new Map<string, { recommendations: number; likes: number; reviews: number }>()),
      certifiedShopIds(this.db, rows.map((r) => r.s.id)),
    ]);
    const out = [];
    for (const { p, s } of rows) {
      const first = media.find((m) => m.productId === p.id);
      const video = videos.find((v) => v.productId === p.id);
      out.push({
        id: p.id,
        reference: p.reference,
        kind: p.kind,
        title: p.title,
        ...publicPrices(p),
        categoryCode: p.categoryCode,
        imageUrl: first ? await this.url(first.storageKey, apiBase) : null,
        /** V1 : taille de la première photo, pour la mosaïque (carré ou portrait). */
        imageWidth: first?.width ?? null,
        imageHeight: first?.height ?? null,
        video: video ? await this.videoView(video, apiBase) : null,
        counts: counts.get(p.id) ?? { recommendations: 0, likes: 0, reviews: 0 },
        available: p.kind === 'service' || (stock.get(p.id) ?? 0) > 0,
        shop: this.publicShop(s, certified),
      });
    }
    return out;
  }

  private async videoView(v: typeof productVideos.$inferSelect, apiBase: string) {
    return { url: await this.url(v.storageKey, apiBase), width: v.width, height: v.height, durationMs: v.durationMs };
  }

  /**
   * V1 — Compteurs publics d'un article (écrans 32 et 34) : recommandations et j'aime (cœurs) de la version courante du
   * contenu (7-A) ; avis : tous ceux publiés, comme la liste de la fiche. Jamais de note moyenne (A17).
   */
  async counts(ids: string[]) {
    const out = new Map<string, { recommendations: number; likes: number; reviews: number }>();
    if (!ids.length) return out;
    for (const id of ids) out.set(id, { recommendations: 0, likes: 0, reviews: 0 });
    const [recs, likes, revs] = await Promise.all([
      this.db
        .select({ id: productRecommendations.productId, n: count() })
        .from(productRecommendations)
        .innerJoin(products, and(eq(products.id, productRecommendations.productId), eq(products.contentVersion, productRecommendations.productVersion)))
        .where(inArray(productRecommendations.productId, ids))
        .groupBy(productRecommendations.productId),
      this.db
        .select({ id: productFavorites.productId, n: count() })
        .from(productFavorites)
        .innerJoin(products, and(eq(products.id, productFavorites.productId), eq(products.contentVersion, productFavorites.productVersion)))
        .where(inArray(productFavorites.productId, ids))
        .groupBy(productFavorites.productId),
      // Avis : tous ceux publiés pour l'article, comme la liste affichée sur la fiche (les anciens y sont signalés).
      this.db
        .select({ id: sql<string>`${reviews.productId}`, n: count() })
        .from(reviews)
        .where(and(inArray(reviews.productId, ids), eq(reviews.kind, 'item'), eq(reviews.status, 'published')))
        .groupBy(reviews.productId),
    ]);
    for (const r of recs) out.get(r.id)!.recommendations = r.n;
    for (const r of likes) out.get(r.id)!.likes = r.n;
    for (const r of revs) out.get(r.id)!.reviews = r.n;
    return out;
  }

  /**
   * V1 (19/10/2026, décision du fondateur) — Étoiles de la **boutique** (jamais d'un article) : moyenne des notes que les
   * clients donnent à la boutique après la remise, une par commande, avis publiés seulement. Affichée à partir de
   * `SHOP_RATING_MIN_REVIEWS` avis ; avant, `average` est nul (« Nouvelle boutique »).
   */
  async shopRating(shopId: string) {
    const [r] = await this.db
      .select({ n: count(), avg: sql<string | null>`round(avg(${reviews.rating})::numeric, 1)` })
      .from(reviews)
      .where(and(eq(reviews.shopId, shopId), eq(reviews.kind, 'shop'), eq(reviews.status, 'published')));
    return { average: r.n >= SHOP_RATING_MIN_REVIEWS && r.avg !== null ? Number(r.avg) : null, reviews: r.n };
  }

  private async stockByProduct(ids: string[]) {
    const rows = await this.db
      .select({ productId: productVariants.productId, stock: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)`.mapWith(Number) })
      .from(productVariants)
      .leftJoin(inventoryMovements, eq(inventoryMovements.variantId, productVariants.id))
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.active, true)))
      .groupBy(productVariants.productId);
    return new Map(rows.map((r) => [r.productId, r.stock]));
  }

  private decodeCursor(cursor: string | undefined): { v: string | number; id: string } | null {
    if (!cursor) return null;
    try {
      const c = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { v: unknown; id: unknown };
      if ((typeof c.v === 'string' || typeof c.v === 'number') && typeof c.id === 'string' && /^[0-9a-f-]{36}$/.test(c.id)) return { v: c.v, id: c.id };
    } catch {
      // curseur illisible : on repart du début
    }
    throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
  }

  /** Écran 32 : articles publiés, par rubrique ou sous-rubrique, recherche texte, tri. */
  async browse(q: { category?: string; q?: string; sort?: BimShopSort; cursor?: string; shopId?: string }, apiBase: string) {
    const sort: BimShopSort = q.sort === 'price_asc' || q.sort === 'price_desc' ? q.sort : 'recent';
    const conds: SQL[] = [this.visible()];
    if (q.shopId) conds.push(eq(products.shopId, q.shopId));
    if (q.category) {
      const codes = (await this.db.select({ code: shopCategories.code }).from(shopCategories).where(or(eq(shopCategories.code, q.category), eq(shopCategories.parentCode, q.category)))).map((r) => r.code);
      if (!codes.length) return { items: [], nextCursor: null };
      conds.push(inArray(products.categoryCode, codes));
    }
    const text = q.q?.trim();
    if (text) {
      if (text.length > 80) throw Errors.validation({ fields: { q: ['80 caractères au plus.'] } });
      conds.push(or(sql`${products.title} ILIKE ${like(text)}`, sql`${products.description} ILIKE ${like(text)}`, sql`${shops.name} ILIKE ${like(text)}`)!);
    }
    const c = this.decodeCursor(q.cursor);
    if (c) {
      if (sort === 'recent') {
        const at = new Date(String(c.v));
        if (Number.isNaN(at.getTime())) throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
        conds.push(or(lt(products.publishedAt, at), and(eq(products.publishedAt, at), lt(products.id, c.id)))!);
      } else {
        const v = Number(c.v);
        // Curseur forgé (prix non entier) : 400 et non une erreur de la base (audit, A-11).
        if (!Number.isSafeInteger(v)) throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
        conds.push(sort === 'price_asc' ? or(gt(PAID, v), and(eq(PAID, v), gt(products.id, c.id)))! : or(lt(PAID, v), and(eq(PAID, v), lt(products.id, c.id)))!);
      }
    }
    // Tri sur le prix payé : la promotion si elle existe, sinon le prix normal.
    const order = sort === 'recent' ? [desc(products.publishedAt), desc(products.id)] : sort === 'price_asc' ? [asc(PAID), asc(products.id)] : [desc(PAID), desc(products.id)];
    const rows = await this.db
      .select({ p: products, s: shops })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(...conds))
      .orderBy(...order)
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > PAGE && last ? Buffer.from(JSON.stringify({ v: sort === 'recent' ? last.p.publishedAt!.toISOString() : (last.p.promoPriceFcfa ?? last.p.priceFcfa), id: last.p.id })).toString('base64url') : null;
    return { items: await this.cards(page, apiBase), nextCursor };
  }

  /** Articles visibles parmi `ids`, dans l'ordre donné (offres de projet, lot 5-D). */
  async visibleCards(ids: string[], apiBase: string, opts: { rich?: boolean } = {}) {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ p: products, s: shops })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(inArray(products.id, ids), this.visible()));
    rows.sort((a, b) => ids.indexOf(a.p.id) - ids.indexOf(b.p.id));
    return this.cards(rows, apiBase, opts);
  }

  /** Recommandations : articles en ligne des rubriques données (et de leurs sous-rubriques), les plus récents. */
  async recommend(categoryCodes: string[], limit: number, apiBase: string) {
    if (!categoryCodes.length) return [];
    const codes = (
      await this.db
        .select({ code: shopCategories.code })
        .from(shopCategories)
        .where(and(eq(shopCategories.active, true), or(inArray(shopCategories.code, categoryCodes), inArray(shopCategories.parentCode, categoryCodes))))
    ).map((r) => r.code);
    if (!codes.length) return [];
    const rows = await this.db
      .select({ p: products, s: shops })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(inArray(products.categoryCode, codes), this.visible()))
      .orderBy(desc(products.publishedAt), desc(products.id))
      .limit(limit);
    return this.cards(rows, apiBase);
  }

  private async visibleProduct(id: string) {
    const [row] = await this.db
      .select({ p: products, s: shops })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(eq(products.id, id), this.visible()));
    if (!row) throw Errors.notFound('Article');
    return row;
  }

  /** Écran 34 : fiche article (photos, variantes disponibles, boutique, autres articles de la boutique). */
  async product(id: string, apiBase: string) {
    const { p, s } = await this.visibleProduct(id);
    const [media, variants, [category], more] = await Promise.all([
      this.db.select().from(productMedia).where(eq(productMedia.productId, p.id)).orderBy(asc(productMedia.position)),
      this.db
        .select({ id: productVariants.id, label: productVariants.label, stock: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)`.mapWith(Number) })
        .from(productVariants)
        .leftJoin(inventoryMovements, eq(inventoryMovements.variantId, productVariants.id))
        .where(and(eq(productVariants.productId, p.id), eq(productVariants.active, true)))
        .groupBy(productVariants.id)
        .orderBy(asc(productVariants.position)),
      p.categoryCode ? this.db.select().from(shopCategories).where(eq(shopCategories.code, p.categoryCode)) : Promise.resolve([]),
      this.db
        .select({ p: products, s: shops })
        .from(products)
        .innerJoin(shops, eq(shops.id, products.shopId))
        .innerJoin(users, eq(users.id, shops.ownerUserId))
        .where(and(eq(products.shopId, s.id), sql`${products.id} <> ${p.id}`, this.visible()))
        .orderBy(desc(products.publishedAt))
        .limit(6),
    ]);
    const photos = [];
    for (const m of media) photos.push({ id: m.id, url: await this.url(m.storageKey, apiBase), width: m.width, height: m.height });
    const service = p.kind === 'service';
    const [[video], counts] = await Promise.all([this.db.select().from(productVideos).where(eq(productVideos.productId, p.id)), this.counts([p.id])]);
    return {
      id: p.id,
      reference: p.reference,
      kind: p.kind,
      title: p.title,
      description: p.description,
      ...publicPrices(p),
      durationMinutes: p.durationMinutes,
      category: category ? { code: category.code, label: category.label } : null,
      photos,
      video: video ? await this.videoView(video, apiBase) : null,
      counts: counts.get(p.id)!,
      variants: variants.map((v) => ({ id: v.id, label: v.label, available: service || v.stock > 0 })),
      available: service || variants.some((v) => v.stock > 0),
      shop: { ...this.publicShop(s, await certifiedShopIds(this.db, [s.id])), logoUrl: await this.url(s.logoKey, apiBase), rating: await this.shopRating(s.id) },
      moreFromShop: await this.cards(more, apiBase),
    };
  }

  private async visibleShop(slug: string) {
    const [s] = await this.db
      .select({ s: shops })
      .from(shops)
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(eq(shops.slug, slug), eq(shops.status, 'active'), eq(users.status, 'active')));
    if (!s) throw Errors.notFound('Boutique');
    return s.s;
  }

  /** Écran 54 : profil public d'une boutique et ses articles. */
  async shop(slug: string, apiBase: string, cursor?: string) {
    const s = await this.visibleShop(slug);
    const [[followers], [published], page, rating, certified] = await Promise.all([
      this.db.select({ n: count() }).from(shopFollows).where(eq(shopFollows.shopId, s.id)),
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, s.id), eq(products.status, 'published'))),
      this.browse({ shopId: s.id, cursor }, apiBase),
      this.shopRating(s.id),
      certifiedShopIds(this.db, [s.id]),
    ]);
    return {
      ...this.publicShop(s, certified),
      rating,
      description: s.description,
      logoUrl: await this.url(s.logoKey, apiBase),
      counts: { followers: followers.n, products: published.n },
      items: page.items,
      nextCursor: page.nextCursor,
    };
  }

  /** Rubriques avec le nombre d'articles visibles (écran 33). */
  async categories() {
    const [cats, counts] = await Promise.all([
      this.db.select().from(shopCategories).where(eq(shopCategories.active, true)).orderBy(asc(shopCategories.sortOrder)),
      this.db
        .select({ code: products.categoryCode, n: count() })
        .from(products)
        .innerJoin(shops, eq(shops.id, products.shopId))
        .innerJoin(users, eq(users.id, shops.ownerUserId))
        .where(this.visible())
        .groupBy(products.categoryCode),
    ]);
    const n = new Map(counts.map((c) => [c.code, c.n]));
    return {
      items: cats
        .filter((c) => c.parentCode === null)
        .map((c) => {
          const children = cats.filter((x) => x.parentCode === c.code).map((x) => ({ code: x.code, label: x.label, products: n.get(x.code) ?? 0 }));
          return { code: c.code, label: c.label, products: (n.get(c.code) ?? 0) + children.reduce((a, x) => a + x.products, 0), children };
        }),
    };
  }

  // ------------------------------------------------------------------------------------------------ Compte connecté

  /** État personnel sur une fiche : article mis de côté, boutique suivie. */
  async productState(userId: string, id: string) {
    const { p, s } = await this.visibleProduct(id);
    const [[fav], [follow]] = await Promise.all([
      // 7-A : un cœur donné à une version précédente du contenu ne compte plus (réputation remise à zéro).
      this.db
        .select({ n: count() })
        .from(productFavorites)
        .where(and(eq(productFavorites.userId, userId), eq(productFavorites.productId, id), eq(productFavorites.productVersion, p.contentVersion))),
      this.db.select({ n: count() }).from(shopFollows).where(and(eq(shopFollows.userId, userId), eq(shopFollows.shopId, s.id))),
    ]);
    const [rec] = await this.db
      .select({ n: count() })
      .from(productRecommendations)
      .where(and(eq(productRecommendations.userId, userId), eq(productRecommendations.productId, id), eq(productRecommendations.productVersion, p.contentVersion)));
    return { favorite: fav.n > 0, followingShop: follow.n > 0, recommended: rec.n > 0 };
  }

  /** V1 — Recommander un article (pouce) : une fois par personne, jamais sa propre boutique. */
  async setRecommendation(userId: string, id: string, on: boolean) {
    const { p, s } = await this.visibleProduct(id);
    if (on) {
      const [member] = await this.db
        .select({ n: count() })
        .from(shopMembers)
        .where(and(eq(shopMembers.shopId, s.id), eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt), isNotNull(shopMembers.acceptedAt)));
      if (s.ownerUserId === userId || member.n > 0) throw Errors.conflict('OWN_PRODUCT', 'Tu ne peux pas recommander un article de ta boutique.');
      await this.db
        .insert(productRecommendations)
        .values({ userId, productId: id, productVersion: p.contentVersion })
        .onConflictDoUpdate({
          target: [productRecommendations.userId, productRecommendations.productId],
          set: { productVersion: p.contentVersion, createdAt: new Date() },
          where: sql`${productRecommendations.productVersion} <> ${p.contentVersion}`,
        });
    } else await this.db.delete(productRecommendations).where(and(eq(productRecommendations.userId, userId), eq(productRecommendations.productId, id)));
    const counts = await this.counts([id]);
    return { recommended: on, counts: counts.get(id)! };
  }

  async setFavorite(userId: string, id: string, on: boolean) {
    const { p } = await this.visibleProduct(id);
    if (on) {
      // Cœur rattaché à la version courante du contenu ; un ancien cœur (version précédente) est remplacé.
      await this.db
        .insert(productFavorites)
        .values({ userId, productId: id, productVersion: p.contentVersion })
        .onConflictDoUpdate({
          target: [productFavorites.userId, productFavorites.productId],
          set: { productVersion: p.contentVersion, createdAt: new Date() },
          where: sql`${productFavorites.productVersion} <> ${p.contentVersion}`,
        });
    }
    else await this.db.delete(productFavorites).where(and(eq(productFavorites.userId, userId), eq(productFavorites.productId, id)));
    return { favorite: on };
  }

  /**
   * Articles mis de côté encore visibles, pour la version courante de leur contenu (les autres restent enregistrés mais
   * ne s'affichent pas : article masqué, ou contenu modifié depuis — 7-A).
   */
  async favorites(userId: string, apiBase: string) {
    const rows = await this.db
      .select({ p: products, s: shops })
      .from(productFavorites)
      .innerJoin(products, eq(products.id, productFavorites.productId))
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(eq(productFavorites.userId, userId), eq(productFavorites.productVersion, products.contentVersion), this.visible()))
      .orderBy(desc(productFavorites.createdAt))
      .limit(200);
    return { items: await this.cards(rows, apiBase) };
  }

  async shopState(userId: string, slug: string) {
    const s = await this.visibleShop(slug);
    const [[f]] = await Promise.all([this.db.select({ n: count() }).from(shopFollows).where(and(eq(shopFollows.userId, userId), eq(shopFollows.shopId, s.id)))]);
    return { following: f.n > 0, own: s.ownerUserId === userId };
  }

  async setFollow(userId: string, slug: string, on: boolean) {
    const s = await this.visibleShop(slug);
    if (s.ownerUserId === userId) throw Errors.conflict('OWN_SHOP', 'C’est ta boutique.');
    if (on) await this.db.insert(shopFollows).values({ userId, shopId: s.id }).onConflictDoNothing();
    else await this.db.delete(shopFollows).where(and(eq(shopFollows.userId, userId), eq(shopFollows.shopId, s.id)));
    return { following: on };
  }
}
