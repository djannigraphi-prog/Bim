/// <reference types="multer" />
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { inventoryMovements, productFavorites, productMedia, products, productVariants, productVideos, ShopPermission, shopCategories, shopFollows, shops } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { inspectMp4, Mp4Error, scrubMp4Metadata } from '../media/mp4';
import { encodePrivateImage, PRODUCT_ASPECT } from '../media/private-image';
import { StorageService } from '../media/storage';
import { certifiedShopIds } from '../wallet/premium';
import { SpacesService } from '../spaces/spaces.service';
import { ProductDto, UpdateProductDto, UpdateShopDto } from './dto';

export const MAX_PRODUCT_IMAGES = 6;
/** V1 (19/10/2026) : une vidéo par article, 60 secondes au plus (décision du fondateur). */
export const PRODUCT_VIDEO_MAX_SECONDS = 60;
/** Portrait le plus haut accepté pour une vidéo : 9:16 (format des téléphones), avec une petite tolérance. */
const VIDEO_MIN_RATIO = 9 / 16 - 0.02;
type ProductRow = typeof products.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** L7-04 — Éléments de l'identité d'une fiche, figés (nom, description, prix normal ; rubrique, durée et variantes une fois publiée). */
type ContentField = 'title' | 'description' | 'priceFcfa' | 'categoryCode' | 'durationMinutes' | 'variants';

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
    private readonly spaces: SpacesService,
  ) {}

  private async url(key: string | null, apiBase: string) {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  // ------------------------------------------------------------------------------------------------ Boutique

  async dashboard(shopId: string, userId: string, apiBase: string) {
    const [shop] = await this.db.select().from(shops).where(eq(shops.id, shopId));
    if (!shop) throw Errors.notFound('Boutique');
    const [[published], [drafts], [hidden], [followers], viewer] = await Promise.all([
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, shopId), eq(products.status, 'published'))),
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, shopId), eq(products.status, 'draft'))),
      this.db.select({ n: count() }).from(products).where(and(eq(products.shopId, shopId), eq(products.status, 'hidden'))),
      this.db.select({ n: count() }).from(shopFollows).where(eq(shopFollows.shopId, shopId)),
      this.spaces.shopAccess(userId, shopId),
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
      /** V1-1910-C : badge de certification (propriétaire Premium). */
      certified: (await certifiedShopIds(this.db, [shop.id])).has(shop.id),
      logoUrl: await this.url(shop.logoKey, apiBase),
      counts: { published: published.n, drafts: drafts.n, hidden: hidden.n, followers: followers.n },
      /** 7-A : mon rôle et mes permissions dans cette boutique (l'app adapte ses boutons ; le serveur contrôle). */
      viewer: viewer ?? { role: 'staff', permissions: [] },
    };
  }

  async updateShop(shopId: string, userId: string, dto: UpdateShopDto, apiBase: string) {
    const set: Partial<typeof shops.$inferInsert> = { updatedAt: new Date() };
    if (dto.description !== undefined) set.description = dto.description.trim() || null;
    if (dto.city !== undefined) set.city = dto.city.trim();
    if (dto.commune !== undefined) set.commune = dto.commune.trim() || null;
    await this.db.update(shops).set(set).where(eq(shops.id, shopId));
    return this.dashboard(shopId, userId, apiBase);
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
    return this.dashboard(shopId, userId, apiBase);
  }

  // ------------------------------------------------------------------------------------------------ Articles

  private async checkCategory(code: string) {
    const [c] = await this.db.select().from(shopCategories).where(and(eq(shopCategories.code, code), eq(shopCategories.active, true)));
    if (!c) throw Errors.validation({ fields: { categoryCode: ['Rubrique inconnue.'] } });
  }

  private checkPromo(price: number, promo: number | null | undefined) {
    if (promo != null && promo >= price) throw Errors.validation({ fields: { promoPriceFcfa: ['La promotion doit être inférieure au prix normal.'] } });
  }

  /** Prix à afficher : promotion (prix payé) et prix normal barré, ou prix normal seul. */
  static prices(p: { priceFcfa: number; promoPriceFcfa: number | null }) {
    return {
      priceFcfa: p.promoPriceFcfa ?? p.priceFcfa,
      compareAtFcfa: p.promoPriceFcfa != null ? p.priceFcfa : null,
      normalPriceFcfa: p.priceFcfa,
      promoPriceFcfa: p.promoPriceFcfa,
    };
  }

  private async own(shopId: string, productId: string): Promise<ProductRow> {
    const [p] = await this.db.select().from(products).where(and(eq(products.id, productId), eq(products.shopId, shopId), ne(products.status, 'archived')));
    if (!p) throw Errors.notFound('Article');
    return p;
  }

  async create(shopId: string, userId: string, dto: ProductDto, meta: RequestMeta, apiBase: string) {
    await this.checkCategory(dto.categoryCode);
    this.checkPromo(dto.priceFcfa, dto.promoPriceFcfa);
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
        promoPriceFcfa: dto.promoPriceFcfa ?? null,
        durationMinutes: dto.kind === 'service' ? (dto.durationMinutes ?? null) : null,
      });
      // Une variante « Unique » par défaut, sans stock.
      await tx.insert(productVariants).values({ id: uuidv7(), productId: id, label: 'Unique', position: 0 });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'shop.product_created', targetType: 'product', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
    return this.detail(shopId, id, apiBase);
  }

  /** Cœurs donnés à la version courante du contenu (réputation active). */
  private async activeFavorites(p: ProductRow, tx: Tx | Database = this.db) {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(productFavorites)
      .where(and(eq(productFavorites.productId, p.id), eq(productFavorites.productVersion, p.contentVersion)));
    return n;
  }

  /** L7-04 : l'identité d'une fiche est figée ; un autre produit se crée comme une nouvelle fiche. */
  private locked(fields: ContentField[]) {
    return new AppError(
      'PRODUCT_CONTENT_LOCKED',
      'Le nom, la description et le prix normal ne se modifient pas (ni la rubrique, la durée et les variantes d’un article déjà publié). Crée une nouvelle fiche : elle aura sa propre référence. Tu peux changer la photo et la promotion.',
      HttpStatus.CONFLICT,
      { fields },
    );
  }

  /**
   * L7-04 — Modifications autorisées : promotion (activer, modifier, supprimer) à tout moment ; rubrique et durée tant
   * que la fiche n'a jamais été publiée. Nom, description et prix normal : jamais après la création (aussi garanti par
   * la base). Renvoyer la même valeur n'est pas une modification. La réputation n'est jamais remise à zéro ici.
   */
  async update(shopId: string, userId: string, productId: string, dto: UpdateProductDto, meta: RequestMeta, apiBase: string) {
    await this.own(shopId, productId);
    if (dto.categoryCode !== undefined) await this.checkCategory(dto.categoryCode);
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.shopId, shopId), ne(products.status, 'archived'))).for('update');
      if (!p) throw Errors.notFound('Article');
      const fields: ContentField[] = [];
      if (dto.title !== undefined && dto.title.trim() !== p.title) fields.push('title');
      if (dto.description !== undefined && (dto.description.trim() || null) !== p.description) fields.push('description');
      if (dto.priceFcfa !== undefined && dto.priceFcfa !== p.priceFcfa) fields.push('priceFcfa');
      const category = dto.categoryCode ?? p.categoryCode;
      const duration = p.kind === 'service' ? (dto.durationMinutes === undefined ? p.durationMinutes : dto.durationMinutes) : null;
      if (p.publishedAt && category !== p.categoryCode) fields.push('categoryCode');
      if (p.publishedAt && duration !== p.durationMinutes) fields.push('durationMinutes');
      if (fields.length) throw this.locked(fields);
      const promo = dto.promoPriceFcfa === undefined ? p.promoPriceFcfa : dto.promoPriceFcfa;
      this.checkPromo(p.priceFcfa, promo);
      if (promo === p.promoPriceFcfa && category === p.categoryCode && duration === p.durationMinutes) return;
      await tx.update(products).set({ promoPriceFcfa: promo, categoryCode: category, durationMinutes: duration, updatedAt: new Date() }).where(eq(products.id, p.id));
      if (promo !== p.promoPriceFcfa) {
        await this.audit.log(
          {
            actorType: 'user',
            actorId: userId,
            action: 'shop.product_promotion_changed',
            targetType: 'product',
            targetId: p.id,
            ip: meta.ip,
            userAgent: meta.userAgent,
            metadata: { reference: p.reference, before: p.promoPriceFcfa, after: promo },
          },
          tx,
        );
      }
    });
    return this.detail(shopId, productId, apiBase);
  }

  /**
   * Statut d'un article. `published` : première publication (brouillon) ou republication (masqué) ; `hidden` :
   * « visible par moi uniquement » (7-A, depuis « publié ») ; `archived` : retiré. Masquer et republier ne changent ni la
   * référence ni la version du contenu : la réputation est conservée.
   */
  async setStatus(
    shopId: string,
    userId: string,
    productId: string,
    to: 'published' | 'hidden' | 'archived',
    meta: RequestMeta,
    apiBase: string,
    from?: ProductRow['status'][],
    /** Permission supplémentaire exigée pour republier un article masqué (7-A). */
    republishPermission?: ShopPermission,
  ) {
    const p = await this.own(shopId, productId);
    if (republishPermission && p.status === 'hidden' && to === 'published' && !(await this.spaces.hasShopPermission(userId, shopId, republishPermission))) {
      throw new AppError('SHOP_PERMISSION_REQUIRED', 'Le propriétaire de la boutique ne t’a pas donné cette permission.', HttpStatus.FORBIDDEN, { permission: republishPermission });
    }
    const invalid = (status: string) => !!from && status !== to && !from.includes(status as ProductRow['status']);
    if (invalid(p.status)) throw this.invalidStatus(to, from);
    if (p.status === to) return this.detail(shopId, p.id, apiBase);
    if (to === 'published') {
      if (!p.categoryCode) throw Errors.validation({ fields: { categoryCode: ['Choisis une rubrique.'] } });
      const [shop] = await this.db.select({ status: shops.status }).from(shops).where(eq(shops.id, shopId));
      if (shop?.status !== 'active') throw Errors.conflict('SHOP_NOT_ACTIVE', 'Ta boutique doit être ouverte pour publier.');
    }
    await this.db.transaction(async (tx) => {
      // Même verrou que les photos : on ne publie jamais un article dont la dernière photo vient d'être retirée.
      const [cur] = await tx.select({ status: products.status }).from(products).where(eq(products.id, p.id)).for('update');
      if (!cur || cur.status === 'archived') throw Errors.notFound('Article');
      if (invalid(cur.status)) throw this.invalidStatus(to, from);
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
      const [video] = await this.db.delete(productVideos).where(eq(productVideos.productId, p.id)).returning({ key: productVideos.storageKey });
      if (video) await this.storage.remove(video.key).catch(() => undefined);
      return null;
    }
    return this.detail(shopId, p.id, apiBase);
  }

  private invalidStatus(to: string, from?: ProductRow['status'][]) {
    const message =
      to === 'hidden'
        ? 'Seul un article visible publiquement peut être masqué.'
        : from?.includes('draft')
          ? 'Cet article est déjà visible publiquement.'
          : 'Cet article n’est pas masqué.';
    return Errors.conflict('INVALID_PRODUCT_STATUS', message);
  }

  async addPhotos(shopId: string, productId: string, files: Express.Multer.File[], apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const p = await this.own(shopId, productId);
    if (!files.length) throw Errors.validation({ fields: { photos: ['Ajoute au moins une photo.'] } });
    if (files.length > MAX_PRODUCT_IMAGES) throw Errors.validation({ fields: { photos: [`${MAX_PRODUCT_IMAGES} photos au plus par article.`] } });
    const images: Awaited<ReturnType<typeof encodePrivateImage>>[] = [];
    // V1 : carré ou portrait seulement ; une photo en paysage (ou trop haute) est recadrée.
    for (const f of files) images.push(await encodePrivateImage(f, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photos', PRODUCT_ASPECT));
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

  /**
   * V1 — Vidéo de l'article (une seule ; une nouvelle remplace l'ancienne) : MP4, 60 secondes au plus, carré ou
   * portrait comme les photos (une vidéo en paysage est refusée : pas de recadrage sans réencodage). Métadonnées
   * effacées (position GPS). Comme une photo, elle ne touche pas à la réputation.
   */
  async setVideo(shopId: string, productId: string, file: Express.Multer.File | undefined, apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des vidéos');
    const p = await this.own(shopId, productId);
    if (!file) throw Errors.validation({ fields: { video: ['Vidéo manquante.'] } });
    if (file.size > this.cfg.MEDIA_MAX_VIDEO_MB * 1024 * 1024) throw Errors.validation({ fields: { video: [`Vidéo trop lourde (${this.cfg.MEDIA_MAX_VIDEO_MB} Mo au plus).`] } });
    let info: ReturnType<typeof inspectMp4>;
    try {
      info = inspectMp4(file.buffer);
    } catch (e) {
      if (e instanceof Mp4Error) throw Errors.validation({ fields: { video: ['Format non reconnu : envoie une vidéo MP4.'] } });
      throw e;
    }
    if (info.metadataTrack) throw Errors.validation({ fields: { video: ['Cette vidéo contient des données de position. Désactive la localisation de la caméra ou choisis une autre vidéo.'] } });
    if (info.durationMs <= 0 || info.durationMs > PRODUCT_VIDEO_MAX_SECONDS * 1000 + 500) {
      throw new AppError('PRODUCT_VIDEO_TOO_LONG', `La vidéo d’un article dure ${PRODUCT_VIDEO_MAX_SECONDS} secondes au plus.`, HttpStatus.BAD_REQUEST, { maxSeconds: PRODUCT_VIDEO_MAX_SECONDS, durationMs: info.durationMs });
    }
    if (!info.width || !info.height) throw Errors.validation({ fields: { video: ['Vidéo sans image.'] } });
    const ratio = info.width / info.height;
    if (ratio > 1.02 || ratio < VIDEO_MIN_RATIO) {
      throw new AppError('PRODUCT_VIDEO_FORMAT', 'Filme ta vidéo en portrait ou au format carré : le BimShop n’affiche pas de vidéo en paysage.', HttpStatus.BAD_REQUEST, { width: info.width, height: info.height });
    }
    const key = `products/${p.id}/${uuidv7()}.mp4`;
    await this.storage.put(key, scrubMp4Metadata(file.buffer), 'video/mp4');
    let previous: string | undefined;
    try {
      await this.db.transaction(async (tx) => {
        // Verrou de l'article : une suppression simultanée de l'article ne laisse pas de vidéo orpheline.
        const [cur] = await tx.select({ status: products.status }).from(products).where(eq(products.id, p.id)).for('update');
        if (!cur || cur.status === 'archived') throw Errors.notFound('Article');
        const [old] = await tx.delete(productVideos).where(eq(productVideos.productId, p.id)).returning({ key: productVideos.storageKey });
        previous = old?.key;
        // Légère tolérance d'arrondi : une vidéo presque carrée est enregistrée comme carrée.
        const width = Math.min(info.width!, info.height!);
        await tx.insert(productVideos).values({ productId: p.id, storageKey: key, width, height: info.height!, durationMs: info.durationMs, bytes: file.size });
      });
    } catch (e) {
      await this.storage.remove(key).catch(() => undefined);
      throw e;
    }
    if (previous) await this.storage.remove(previous).catch(() => undefined);
    return this.detail(shopId, p.id, apiBase);
  }

  async removeVideo(shopId: string, productId: string, apiBase: string) {
    const p = await this.own(shopId, productId);
    const [old] = await this.db.delete(productVideos).where(eq(productVideos.productId, p.id)).returning({ key: productVideos.storageKey });
    if (!old) throw Errors.notFound('Vidéo');
    await this.storage.remove(old.key).catch(() => undefined);
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
  /** Variantes : librement tant que la fiche n'a jamais été publiée ; ensuite seul l'ordre change (L7-04). */
  async setVariants(shopId: string, productId: string, labels: string[], apiBase: string) {
    await this.own(shopId, productId);
    const wanted = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
    const list = wanted.length ? wanted : ['Unique'];
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.shopId, shopId), ne(products.status, 'archived'))).for('update');
      if (!p) throw Errors.notFound('Article');
      const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, p.id));
      const before = existing.filter((v) => v.active).sort((a, b) => a.position - b.position).map((v) => v.label);
      // Ajouter, retirer ou renommer une variante change l'article ; changer seulement l'ordre, non.
      const changed = before.length !== list.length || before.some((l) => !list.includes(l));
      if (changed && p.publishedAt) throw this.locked(['variants']);
      for (const v of existing) {
        const pos = list.indexOf(v.label);
        await tx.update(productVariants).set({ active: pos >= 0, position: pos >= 0 ? pos : v.position }).where(eq(productVariants.id, v.id));
      }
      for (const [i, label] of list.entries()) {
        if (!existing.some((v) => v.label === label)) await tx.insert(productVariants).values({ id: uuidv7(), productId: p.id, label, position: i });
      }
    });
    return this.detail(shopId, productId, apiBase);
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
    if (status === 'published' || status === 'draft' || status === 'hidden') conds.push(eq(products.status, status));
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
        reference: r.reference,
        kind: r.kind,
        title: r.title,
        ...MerchantCatalogService.prices(r),
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
    const [video] = await this.db.select().from(productVideos).where(eq(productVideos.productId, p.id));
    return {
      id: p.id,
      reference: p.reference,
      kind: p.kind,
      title: p.title,
      description: p.description,
      categoryCode: p.categoryCode,
      video: video ? { url: await this.url(video.storageKey, apiBase), width: video.width, height: video.height, durationMs: video.durationMs } : null,
      ...MerchantCatalogService.prices(p),
      durationMinutes: p.durationMinutes,
      status: p.status,
      publishedAt: p.publishedAt,
      /** 7-A : version du contenu (traçabilité des commandes et avis) et réputation active. */
      contentVersion: p.contentVersion,
      activeFavorites: await this.activeFavorites(p),
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

