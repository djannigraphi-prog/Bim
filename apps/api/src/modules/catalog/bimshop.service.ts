import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lt, or, sql, SQL } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { DB, Database } from '../../database/database.module';
import { inventoryMovements, productFavorites, productMedia, products, productVariants, shopCategories, shopFollows, shops, users } from '../../database/schema';
import { StorageService } from '../media/storage';

export type BimShopSort = 'recent' | 'price_asc' | 'price_desc';
const PAGE = 20;
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

  private publicShop(s: ShopRow) {
    return { id: s.id, name: s.name, slug: s.slug, city: s.city, commune: s.commune, verified: !!s.verifiedAt };
  }

  /** Résumés publics : première photo, disponibilité (articles), boutique. */
  async cards(rows: { p: ProductRow; s: ShopRow }[], apiBase: string) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.p.id);
    const [media, stock] = await Promise.all([
      this.db.select().from(productMedia).where(inArray(productMedia.productId, ids)).orderBy(asc(productMedia.position)),
      this.stockByProduct(ids),
    ]);
    const out = [];
    for (const { p, s } of rows) {
      const first = media.find((m) => m.productId === p.id);
      out.push({
        id: p.id,
        kind: p.kind,
        title: p.title,
        priceFcfa: p.priceFcfa,
        compareAtFcfa: p.compareAtFcfa,
        categoryCode: p.categoryCode,
        imageUrl: first ? await this.url(first.storageKey, apiBase) : null,
        available: p.kind === 'service' || (stock.get(p.id) ?? 0) > 0,
        shop: this.publicShop(s),
      });
    }
    return out;
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
        conds.push(sort === 'price_asc' ? or(gt(products.priceFcfa, v), and(eq(products.priceFcfa, v), gt(products.id, c.id)))! : or(lt(products.priceFcfa, v), and(eq(products.priceFcfa, v), lt(products.id, c.id)))!);
      }
    }
    const order = sort === 'recent' ? [desc(products.publishedAt), desc(products.id)] : sort === 'price_asc' ? [asc(products.priceFcfa), asc(products.id)] : [desc(products.priceFcfa), desc(products.id)];
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
      rows.length > PAGE && last ? Buffer.from(JSON.stringify({ v: sort === 'recent' ? last.p.publishedAt!.toISOString() : last.p.priceFcfa, id: last.p.id })).toString('base64url') : null;
    return { items: await this.cards(page, apiBase), nextCursor };
  }

  /** Articles visibles parmi `ids`, dans l'ordre donné (offres de projet, lot 5-D). */
  async visibleCards(ids: string[], apiBase: string) {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ p: products, s: shops })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(inArray(products.id, ids), this.visible()));
    rows.sort((a, b) => ids.indexOf(a.p.id) - ids.indexOf(b.p.id));
    return this.cards(rows, apiBase);
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
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      description: p.description,
      priceFcfa: p.priceFcfa,
      compareAtFcfa: p.compareAtFcfa,
      durationMinutes: p.durationMinutes,
      category: category ? { code: category.code, label: category.label } : null,
      photos,
      variants: variants.map((v) => ({ id: v.id, label: v.label, available: service || v.stock > 0 })),
      available: service || variants.some((v) => v.stock > 0),
      shop: { ...this.publicShop(s), logoUrl: await this.url(s.logoKey, apiBase) },
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
    const [[followers], [published], page] = await Promise.all([
      this.db.select({ n: count() }).from(shopFollows).where(eq(shopFollows.shopId, s.id)),
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, s.id), eq(products.status, 'published'))),
      this.browse({ shopId: s.id, cursor }, apiBase),
    ]);
    return {
      ...this.publicShop(s),
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
    const { s } = await this.visibleProduct(id);
    const [[fav], [follow]] = await Promise.all([
      this.db.select({ n: count() }).from(productFavorites).where(and(eq(productFavorites.userId, userId), eq(productFavorites.productId, id))),
      this.db.select({ n: count() }).from(shopFollows).where(and(eq(shopFollows.userId, userId), eq(shopFollows.shopId, s.id))),
    ]);
    return { favorite: fav.n > 0, followingShop: follow.n > 0 };
  }

  async setFavorite(userId: string, id: string, on: boolean) {
    await this.visibleProduct(id);
    if (on) await this.db.insert(productFavorites).values({ userId, productId: id }).onConflictDoNothing();
    else await this.db.delete(productFavorites).where(and(eq(productFavorites.userId, userId), eq(productFavorites.productId, id)));
    return { favorite: on };
  }

  /** Articles mis de côté encore visibles (les autres restent enregistrés mais ne s'affichent pas). */
  async favorites(userId: string, apiBase: string) {
    const rows = await this.db
      .select({ p: products, s: shops })
      .from(productFavorites)
      .innerJoin(products, eq(products.id, productFavorites.productId))
      .innerJoin(shops, eq(shops.id, products.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(and(eq(productFavorites.userId, userId), this.visible()))
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
