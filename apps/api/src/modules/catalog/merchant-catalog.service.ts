/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { inventoryMovements, productMedia, products, productVariants, shopCategories, shopFollows, shops } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { ProductDto, UpdateProductDto, UpdateShopDto } from './dto';

export const MAX_PRODUCT_IMAGES = 6;
type ProductRow = typeof products.$inferSelect;

/**
 * Lot 5-B — Espace marchand (écran 55) : la boutique et son catalogue. Toutes les routes exigent l'espace marchand
 * actif ; l'appartenance à la boutique est revérifiée en base à chaque requête (garde d'authentification).
 * Aucun paiement : prix affichés, commandes au lot 7.
 */
@Injectable()
export class MerchantCatalogService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async url(key: string | null, apiBase: string) {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  // ------------------------------------------------------------------------------------------------ Boutique

  async dashboard(shopId: string, apiBase: string) {
    const [shop] = await this.db.select().from(shops).where(eq(shops.id, shopId));
    if (!shop) throw Errors.notFound('Boutique');
    const [[published], [drafts], [followers]] = await Promise.all([
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, shopId), eq(products.status, 'published'))),
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, shopId), eq(products.status, 'draft'))),
      this.db.select({ n: count() }).from(shopFollows).where(eq(shopFollows.shopId, shopId)),
    ]);
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      status: shop.status,
      description: shop.description,
      city: shop.city,
      commune: shop.commune,
      verified: !!shop.verifiedAt,
      logoUrl: await this.url(shop.logoKey, apiBase),
      counts: { published: published.n, drafts: drafts.n, followers: followers.n },
    };
  }

  async updateShop(shopId: string, dto: UpdateShopDto, apiBase: string) {
    const set: Partial<typeof shops.$inferInsert> = { updatedAt: new Date() };
    if (dto.description !== undefined) set.description = dto.description.trim() || null;
    if (dto.city !== undefined) set.city = dto.city.trim();
    if (dto.commune !== undefined) set.commune = dto.commune.trim() || null;
    await this.db.update(shops).set(set).where(eq(shops.id, shopId));
    return this.dashboard(shopId, apiBase);
  }

  async setLogo(shopId: string, userId: string, file: Express.Multer.File | undefined, meta: RequestMeta, apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const img = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
    const key = `shops/${shopId}/logo-${uuidv7()}.jpg`;
    await this.storage.put(key, img.data, 'image/jpeg');
    const [prev] = await this.db.select({ key: shops.logoKey }).from(shops).where(eq(shops.id, shopId));
    await this.db.update(shops).set({ logoKey: key, updatedAt: new Date() }).where(eq(shops.id, shopId));
    await this.audit.log({ actorType: 'user', actorId: userId, action: 'shop.logo_changed', targetType: 'shop', targetId: shopId, ip: meta.ip, userAgent: meta.userAgent });
    if (prev?.key) await this.storage.remove(prev.key).catch(() => undefined);
    return this.dashboard(shopId, apiBase);
  }

  // ------------------------------------------------------------------------------------------------ Articles

  private async checkCategory(code: string) {
    const [c] = await this.db.select().from(shopCategories).where(and(eq(shopCategories.code, code), eq(shopCategories.active, true)));
    if (!c) throw Errors.validation({ fields: { categoryCode: ['Rubrique inconnue.'] } });
  }

  private checkPrices(price: number, compareAt: number | null | undefined) {
    if (compareAt != null && compareAt <= price) throw Errors.validation({ fields: { compareAtFcfa: ['Le prix barré doit être supérieur au prix.'] } });
  }

  private async own(shopId: string, productId: string): Promise<ProductRow> {
    const [p] = await this.db.select().from(products).where(and(eq(products.id, productId), eq(products.shopId, shopId), ne(products.status, 'archived')));
    if (!p) throw Errors.notFound('Article');
    return p;
  }

  async create(shopId: string, userId: string, dto: ProductDto, meta: RequestMeta, apiBase: string) {
    await this.checkCategory(dto.categoryCode);
    this.checkPrices(dto.priceFcfa, dto.compareAtFcfa);
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(products).values({
        id,
        shopId,
        kind: dto.kind ?? 'product',
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        categoryCode: dto.categoryCode,
        priceFcfa: dto.priceFcfa,
        compareAtFcfa: dto.compareAtFcfa ?? null,
        durationMinutes: dto.kind === 'service' ? (dto.durationMinutes ?? null) : null,
      });
      // Une variante « Unique » par défaut, sans stock.
      await tx.insert(productVariants).values({ id: uuidv7(), productId: id, label: 'Unique', position: 0 });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'shop.product_created', targetType: 'product', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
    return this.detail(shopId, id, apiBase);
  }

  async update(shopId: string, productId: string, dto: UpdateProductDto, apiBase: string) {
    const p = await this.own(shopId, productId);
    if (dto.categoryCode !== undefined) await this.checkCategory(dto.categoryCode);
    const price = dto.priceFcfa ?? p.priceFcfa;
    const compareAt = dto.compareAtFcfa === undefined ? p.compareAtFcfa : dto.compareAtFcfa;
    this.checkPrices(price, compareAt);
    await this.db
      .update(products)
      .set({
        title: dto.title?.trim() ?? p.title,
        description: dto.description === undefined ? p.description : dto.description.trim() || null,
        categoryCode: dto.categoryCode ?? p.categoryCode,
        priceFcfa: price,
        compareAtFcfa: compareAt,
        durationMinutes: p.kind === 'service' ? (dto.durationMinutes === undefined ? p.durationMinutes : dto.durationMinutes) : null,
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));
    return this.detail(shopId, productId, apiBase);
  }

  async setStatus(shopId: string, userId: string, productId: string, to: 'published' | 'draft' | 'archived', meta: RequestMeta, apiBase: string) {
    const p = await this.own(shopId, productId);
    if (to === 'published') {
      if (!p.categoryCode) throw Errors.validation({ fields: { categoryCode: ['Choisis une rubrique.'] } });
      const [shop] = await this.db.select({ status: shops.status }).from(shops).where(eq(shops.id, shopId));
      if (shop?.status !== 'active') throw Errors.conflict('SHOP_NOT_ACTIVE', 'Ta boutique doit être ouverte pour publier.');
    }
    await this.db.transaction(async (tx) => {
      // Même verrou que les photos : on ne publie jamais un article dont la dernière photo vient d'être retirée.
      await tx.select({ id: products.id }).from(products).where(eq(products.id, p.id)).for('update');
      if (to === 'published') {
        const [{ n }] = await tx.select({ n: count() }).from(productMedia).where(eq(productMedia.productId, p.id));
        if (n === 0) throw Errors.validation({ fields: { photos: ['Ajoute au moins une photo avant de publier.'] } });
      }
      await tx
        .update(products)
        .set({ status: to, publishedAt: to === 'published' ? (p.publishedAt ?? new Date()) : p.publishedAt, updatedAt: new Date() })
        .where(eq(products.id, p.id));
      await this.audit.log({ actorType: 'user', actorId: userId, action: `shop.product_${to}`, targetType: 'product', targetId: p.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
    if (to === 'archived') {
      // Article retiré : ses photos sont effacées du stockage.
      const media = await this.db.select({ id: productMedia.id, key: productMedia.storageKey }).from(productMedia).where(eq(productMedia.productId, p.id));
      if (media.length) await this.db.delete(productMedia).where(inArray(productMedia.id, media.map((m) => m.id)));
      for (const m of media) await this.storage.remove(m.key).catch(() => undefined);
      return null;
    }
    return this.detail(shopId, p.id, apiBase);
  }

  async addPhotos(shopId: string, productId: string, files: Express.Multer.File[], apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const p = await this.own(shopId, productId);
    if (!files.length) throw Errors.validation({ fields: { photos: ['Ajoute au moins une photo.'] } });
    if (files.length > MAX_PRODUCT_IMAGES) throw Errors.validation({ fields: { photos: [`${MAX_PRODUCT_IMAGES} photos au plus par article.`] } });
    const images: Awaited<ReturnType<typeof encodePrivateImage>>[] = [];
    for (const f of files) images.push(await encodePrivateImage(f, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photos'));
    const stored: string[] = [];
    try {
      for (const img of images) {
        const key = `products/${p.id}/${uuidv7()}.jpg`;
        await this.storage.put(key, img.data, 'image/jpeg');
        stored.push(key);
      }
      // Article verrouillé : deux envois simultanés ne dépassent pas 6 photos ni ne prennent la même place (audit, D-3).
      await this.db.transaction(async (tx) => {
        await tx.select({ id: products.id }).from(products).where(eq(products.id, p.id)).for('update');
        const [{ n, max }] = await tx
          .select({ n: count(), max: sql<number>`coalesce(max(${productMedia.position}), -1)`.mapWith(Number) })
          .from(productMedia)
          .where(eq(productMedia.productId, p.id));
        if (n + images.length > MAX_PRODUCT_IMAGES) throw Errors.validation({ fields: { photos: [`${MAX_PRODUCT_IMAGES} photos au plus par article.`] } });
        let pos = max;
        await tx.insert(productMedia).values(
          images.map((img, i) => ({ id: uuidv7(), productId: p.id, position: ++pos, storageKey: stored[i], width: img.width, height: img.height, bytes: img.bytes })),
        );
      });
    } catch (e) {
      // Aucun fichier orphelin dans le stockage.
      for (const key of stored) await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    return this.detail(shopId, p.id, apiBase);
  }

  async removePhoto(shopId: string, productId: string, mediaId: string, apiBase: string) {
    const p = await this.own(shopId, productId);
    const m = await this.db.transaction(async (tx) => {
      // Verrou : deux suppressions simultanées ne laissent pas un article publié sans photo (audit, D-3).
      const [locked] = await tx.select({ status: products.status }).from(products).where(eq(products.id, p.id)).for('update');
      const [row] = await tx.select().from(productMedia).where(and(eq(productMedia.id, mediaId), eq(productMedia.productId, p.id)));
      if (!row) throw Errors.notFound('Photo');
      const [{ n }] = await tx.select({ n: count() }).from(productMedia).where(eq(productMedia.productId, p.id));
      if (locked?.status === 'published' && n <= 1) throw Errors.conflict('LAST_PHOTO', 'Un article publié garde au moins une photo.');
      await tx.delete(productMedia).where(eq(productMedia.id, row.id));
      return row;
    });
    await this.storage.remove(m.storageKey).catch(() => undefined);
    return this.detail(shopId, p.id, apiBase);
  }

  /** Variantes : la liste donnée remplace les actives (une variante retirée est désactivée, son historique gardé). */
  async setVariants(shopId: string, productId: string, labels: string[], apiBase: string) {
    const p = await this.own(shopId, productId);
    const wanted = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
    const list = wanted.length ? wanted : ['Unique'];
    const existing = await this.db.select().from(productVariants).where(eq(productVariants.productId, p.id));
    await this.db.transaction(async (tx) => {
      for (const v of existing) {
        const pos = list.indexOf(v.label);
        await tx.update(productVariants).set({ active: pos >= 0, position: pos >= 0 ? pos : v.position }).where(eq(productVariants.id, v.id));
      }
      for (const [i, label] of list.entries()) {
        if (!existing.some((v) => v.label === label)) await tx.insert(productVariants).values({ id: uuidv7(), productId: p.id, label, position: i });
      }
    });
    return this.detail(shopId, p.id, apiBase);
  }

  /** Stock d'une variante fixé à `quantity` : un mouvement d'ajustement de la différence est enregistré. */
  async setStock(shopId: string, userId: string, productId: string, variantId: string, quantity: number, apiBase: string) {
    const p = await this.own(shopId, productId);
    await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.productId, p.id))).for('update');
      if (!v) throw Errors.notFound('Variante');
      const [{ stock }] = await tx.select({ stock: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)`.mapWith(Number) }).from(inventoryMovements).where(eq(inventoryMovements.variantId, v.id));
      const delta = quantity - stock;
      if (delta !== 0) await tx.insert(inventoryMovements).values({ id: uuidv7(), variantId: v.id, delta, reason: 'adjustment', createdBy: userId });
    });
    return this.detail(shopId, p.id, apiBase);
  }

  async list(shopId: string, status: string | undefined, apiBase: string) {
    const conds = [eq(products.shopId, shopId), ne(products.status, 'archived')];
    if (status === 'published' || status === 'draft') conds.push(eq(products.status, status));
    const rows = await this.db.select().from(products).where(and(...conds)).orderBy(desc(products.updatedAt)).limit(200);
    return { items: await this.summaries(rows, apiBase) };
  }

  /** Résumé d'articles : première photo, stock total (articles), prix. */
  async summaries(rows: ProductRow[], apiBase: string) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [media, stock] = await Promise.all([
      this.db.select().from(productMedia).where(inArray(productMedia.productId, ids)).orderBy(asc(productMedia.position)),
      this.db
        .select({ productId: productVariants.productId, stock: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)`.mapWith(Number) })
        .from(productVariants)
        .leftJoin(inventoryMovements, eq(inventoryMovements.variantId, productVariants.id))
        .where(and(inArray(productVariants.productId, ids), eq(productVariants.active, true)))
        .groupBy(productVariants.productId),
    ]);
    const out = [];
    for (const r of rows) {
      const first = media.find((m) => m.productId === r.id);
      out.push({
        id: r.id,
        kind: r.kind,
        title: r.title,
        priceFcfa: r.priceFcfa,
        compareAtFcfa: r.compareAtFcfa,
        status: r.status,
        categoryCode: r.categoryCode,
        imageUrl: first ? await this.url(first.storageKey, apiBase) : null,
        stock: r.kind === 'service' ? null : (stock.find((s) => s.productId === r.id)?.stock ?? 0),
      });
    }
    return out;
  }

  async detail(shopId: string, productId: string, apiBase: string) {
    const p = await this.own(shopId, productId);
    const [media, variants] = await Promise.all([
      this.db.select().from(productMedia).where(eq(productMedia.productId, p.id)).orderBy(asc(productMedia.position)),
      this.db
        .select({ id: productVariants.id, label: productVariants.label, position: productVariants.position, stock: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)`.mapWith(Number) })
        .from(productVariants)
        .leftJoin(inventoryMovements, eq(inventoryMovements.variantId, productVariants.id))
        .where(and(eq(productVariants.productId, p.id), eq(productVariants.active, true)))
        .groupBy(productVariants.id)
        .orderBy(asc(productVariants.position)),
    ]);
    const photos = [];
    for (const m of media) photos.push({ id: m.id, url: await this.url(m.storageKey, apiBase), width: m.width, height: m.height });
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      description: p.description,
      categoryCode: p.categoryCode,
      priceFcfa: p.priceFcfa,
      compareAtFcfa: p.compareAtFcfa,
      durationMinutes: p.durationMinutes,
      status: p.status,
      publishedAt: p.publishedAt,
      photos,
      variants: variants.map((v) => ({ id: v.id, label: v.label, stock: p.kind === 'service' ? null : v.stock })),
    };
  }

  /** Rubriques actives (écran 33), en arbre. Public : sert aussi au BimShop. */
  async categories() {
    const rows = await this.db.select().from(shopCategories).where(eq(shopCategories.active, true)).orderBy(asc(shopCategories.sortOrder));
    return {
      items: rows
        .filter((r) => r.parentCode === null)
        .map((r) => ({ code: r.code, label: r.label, children: rows.filter((c) => c.parentCode === r.code).map((c) => ({ code: c.code, label: c.label })) })),
    };
  }
}

