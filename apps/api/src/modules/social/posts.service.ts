/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import { lockUserQuota } from '../../common/quota-lock';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { commentLikes, follows, postComments, postLikes, postMedia, postProducts, posts, projectPhotos, shops, userBlocks, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { BimShopService } from '../catalog/bimshop.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { CLOCK, Clock, ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { WalletService } from '../wallet/wallet.service';
import { notBlockedBetween, openReport, postVisibleTo, commentParentPublished, recountComments } from './access';
import { CreateBimPostDto, CreateCommentDto, CreatePostDto } from './dto';

export const MAX_POST_IMAGES = 4;
/** 5-E : « Produits et services utilisés » d'un « J'ai fait mon BIM » (5 au plus, garanti par la base). */
export const MAX_POST_PRODUCTS = 5;
const PAGE = 20;
const COMMENTS_PAGE = 30;
/** Visiteur sans compte (fil public) : aucun j'aime, aucun abonnement, rien n'est « à moi », aucun envoi. */
const NO_VIEWER = '00000000-0000-0000-0000-000000000000';

type PostRow = typeof posts.$inferSelect;
type Author = { id: string; username: string; fullName: string; avatarKey: string | null };

/**
 * Publications du lot 4 (écrans 10, 11, 12, 16, 31) : publication simple (texte et 4 images au plus) et « J'ai fait
 * mon BIM » (photos avant / après d'un projet, copiées dans la publication avec l'accord de la personne : le projet et
 * ses photos restent privés). Fils « Pour toi » et « Abonnés », j'aime, commentaires. Toutes les lectures appliquent
 * `postVisibleTo` (visibilité, comptes actifs, blocages) ; un contenu invisible répond « introuvable ».
 */
@Injectable()
export class PostsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly bimshop: BimShopService,
    private readonly wallet: WalletService,
  ) {}

  private async limit(key: string, fallback: number): Promise<number> {
    const s = await this.settings.get<number>(key);
    return typeof s?.value === 'number' && s.value > 0 ? s.value : fallback;
  }

  private since24h() {
    return new Date(this.clock.now().getTime() - 24 * 3600_000);
  }

  /** Limite sur 24 heures. Appelée une fois avant le travail coûteux (photos), puis sous verrou dans la transaction. */
  private async checkPostLimit(userId: string, db: Pick<Database, 'select'> = this.db) {
    const max = await this.limit('social.posts_daily_limit', 20);
    const [{ n }] = await db.select({ n: count() }).from(posts).where(and(eq(posts.userId, userId), gt(posts.createdAt, this.since24h())));
    if (n >= max) throw Errors.tooMany('Tu as déjà beaucoup publié aujourd’hui 😊 Réessaie demain.', { reason: 'SOCIAL_POSTS_DAILY_LIMIT', limit: max });
  }

  // ------------------------------------------------------------------------------------------------ Création

  async create(userId: string, dto: CreatePostDto, files: Express.Multer.File[] = [], meta: RequestMeta, apiBase: string) {
    const text = dto.text?.trim() || null;
    if (!text && files.length === 0) throw Errors.validation({ fields: { text: ['Écris quelque chose ou ajoute une photo.'] } });
    if (files.length > MAX_POST_IMAGES) throw Errors.validation({ fields: { images: [`${MAX_POST_IMAGES} photos au plus.`] } });
    if (files.length && !this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    await this.checkPostLimit(userId);
    const images = [];
    for (const f of files) images.push(await encodePrivateImage(f, this.cfg.MEDIA_MAX_UPLOAD_MB, 'images'));

    const id = uuidv7(this.clock.now().getTime());
    const stored: string[] = [];
    try {
      const media: Array<typeof postMedia.$inferInsert> = [];
      for (const [i, img] of images.entries()) {
        const mid = uuidv7();
        const key = `posts/${id}/${mid}.jpg`;
        await this.storage.put(key, img.data, 'image/jpeg');
        stored.push(key);
        media.push({ id: mid, postId: id, position: i, kind: 'image', storageKey: key, width: img.width, height: img.height, bytes: img.bytes });
      }
      await this.db.transaction(async (tx) => {
        await lockUserQuota(tx, 'posts', userId);
        await this.checkPostLimit(userId, tx);
        await tx.insert(posts).values({ id, userId, kind: 'post', text, visibility: dto.visibility ?? 'public', createdAt: this.clock.now(), updatedAt: this.clock.now() });
        if (media.length) await tx.insert(postMedia).values(media);
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.post_created', targetType: 'post', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { images: media.length } }, tx);
      });
    } catch (e) {
      for (const k of stored) await this.storage.remove(k).catch(() => undefined);
      throw e;
    }
    return this.detail(userId, id, apiBase);
  }

  async createBim(userId: string, dto: CreateBimPostDto, meta: RequestMeta, apiBase: string) {
    if (!this.storage.available) throw Errors.notConfigured('Le stockage des photos');
    const p = await this.projects.detail(userId, dto.projectId); // vérifie que le projet est à la personne
    const photos = await this.db
      .select()
      .from(projectPhotos)
      .where(and(eq(projectPhotos.projectId, p.id), eq(projectPhotos.userId, userId), isNull(projectPhotos.deletedAt)))
      .orderBy(desc(projectPhotos.createdAt));
    const before = photos.find((x) => x.kind === 'before');
    const after = photos.find((x) => x.kind === 'after');
    if (!before || !after) {
      throw Errors.conflict('BIM_PHOTOS_MISSING', 'Ajoute tes photos « avant » et « après » pour publier ton BIM.');
    }
    await this.checkPostLimit(userId);
    const productIds = dto.productIds?.length ? await this.linkableProducts(userId, dto.productIds) : [];

    const id = uuidv7(this.clock.now().getTime());
    const stored: string[] = [];
    try {
      const media: Array<typeof postMedia.$inferInsert> = [];
      for (const [i, ph] of [before, after].entries()) {
        const mid = uuidv7();
        const key = `posts/${id}/${mid}.jpg`;
        // Copie : la publication a son propre fichier ; supprimer le projet ou ses photos ne l'efface pas, et
        // supprimer la publication ne touche pas aux photos privées du projet.
        await this.storage.put(key, await this.storage.read(ph.storageKey), 'image/jpeg');
        stored.push(key);
        media.push({ id: mid, postId: id, position: i, kind: ph.kind, storageKey: key, width: ph.width, height: ph.height, bytes: ph.bytes, takenDay: ph.takenDay });
      }
      await this.db.transaction(async (tx) => {
        await lockUserQuota(tx, 'posts', userId);
        await this.checkPostLimit(userId, tx);
        await tx.insert(posts).values({
          id,
          userId,
          kind: 'bim',
          text: dto.text?.trim() || null,
          visibility: dto.visibility ?? 'public',
          projectId: p.id,
          journeyCategory: p.categoryLabel,
          journeyGoal: p.goal?.label ?? null,
          journeyDays: p.durationDays,
          journeyStepsDone: p.completedSteps,
          createdAt: this.clock.now(),
          updatedAt: this.clock.now(),
        });
        await tx.insert(postMedia).values(media);
        if (productIds.length) await tx.insert(postProducts).values(productIds.map((productId, position) => ({ postId: id, productId, position })));
        await this.audit.log(
          { actorType: 'user', actorId: userId, action: 'social.bim_published', targetType: 'post', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { projectId: p.id, products: productIds.length } },
          tx,
        );
      });
    } catch (e) {
      for (const k of stored) await this.storage.remove(k).catch(() => undefined);
      throw e;
    }
    return this.detail(userId, id, apiBase);
  }

  async remove(userId: string, postId: string, meta: RequestMeta) {
    const [p] = await this.db.select().from(posts).where(and(eq(posts.id, postId), eq(posts.userId, userId)));
    if (!p || p.status === 'deleted') throw Errors.notFound('Publication');
    const media = await this.db.select({ key: postMedia.storageKey }).from(postMedia).where(eq(postMedia.postId, postId));
    // Audit du 18/10/2026 : une publication masquée ou signalée (signalement ouvert) disparaît pour tous, mais son texte
    // et ses photos restent pour la modération (pas d'effacement de preuve).
    const evidence = p.status === 'hidden' || (await openReport(this.db, 'post', postId));
    await this.db.transaction(async (tx) => {
      await tx.update(posts).set({ status: 'deleted', ...(evidence ? {} : { text: null }), updatedAt: this.clock.now() }).where(eq(posts.id, postId));
      if (!evidence) await tx.delete(postMedia).where(eq(postMedia.postId, postId));
      await tx.delete(postProducts).where(eq(postProducts.postId, postId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.post_deleted', targetType: 'post', targetId: postId, ip: meta.ip, userAgent: meta.userAgent, metadata: { keptForModeration: evidence } }, tx);
    });
    // Fichiers effacés du stockage : une publication supprimée ne laisse pas d'image derrière elle.
    if (!evidence) for (const m of media) await this.storage.remove(m.key).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ Produits et services utilisés (5-E)

  /**
   * Articles que l'auteur peut associer : visibles dans le BimShop (fiche publiée, boutique ouverte, propriétaire
   * actif) et sans blocage entre l'auteur et le propriétaire de la boutique. Doublons retirés, ordre conservé.
   */
  private async linkableProducts(userId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_POST_PRODUCTS) throw Errors.validation({ fields: { productIds: [`${MAX_POST_PRODUCTS} articles au plus.`] } });
    if (!unique.length) return [];
    const cards = await this.bimshop.visibleCards(unique, '');
    const reachable = await this.reachableShopIds(userId, [...new Set(cards.map((c) => c.shop.id))]);
    const ok = new Set(cards.filter((c) => reachable.has(c.shop.id)).map((c) => c.id));
    if (unique.some((x) => !ok.has(x))) throw Errors.validation({ fields: { productIds: ['Un article n’est pas disponible dans le BimShop.'] } });
    return unique;
  }

  /** Boutiques dont le propriétaire n'a aucun blocage avec `userId` (dans un sens ou dans l'autre). */
  private async reachableShopIds(userId: string, shopIds: string[]): Promise<Set<string>> {
    if (!shopIds.length) return new Set();
    const rows = await this.db
      .select({ id: shops.id })
      .from(shops)
      .where(
        and(
          inArray(shops.id, shopIds),
          sql`NOT EXISTS (SELECT 1 FROM ${userBlocks} b WHERE (b.blocker_id = ${userId} AND b.blocked_id = ${shops.ownerUserId}) OR (b.blocker_id = ${shops.ownerUserId} AND b.blocked_id = ${userId}))`,
        ),
      );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Fiches associées à une publication, vues par `viewerId` : seulement celles qui sont visibles dans le BimShop et
   * dont la boutique n'a pas de blocage avec lui ; les autres sont omises sans rien en dire. Aucun prix ici (E2 :
   * la publication renvoie vers la fiche, jamais vers un achat).
   */
  private async usedProducts(viewerId: string, postId: string, apiBase: string) {
    const rows = await this.db.select({ productId: postProducts.productId }).from(postProducts).where(eq(postProducts.postId, postId)).orderBy(asc(postProducts.position));
    if (!rows.length) return [];
    const cards = await this.bimshop.visibleCards(
      rows.map((r) => r.productId),
      apiBase,
    );
    const reachable = await this.reachableShopIds(viewerId, [...new Set(cards.map((c) => c.shop.id))]);
    return cards
      .filter((c) => reachable.has(c.shop.id))
      .map((c) => ({ id: c.id, kind: c.kind, title: c.title, imageUrl: c.imageUrl, available: c.available, shop: { name: c.shop.name, slug: c.shop.slug, verified: c.shop.verified } }));
  }

  /** L'auteur remplace la liste des produits et services utilisés de son « J'ai fait mon BIM » (5 au plus). */
  async setProducts(userId: string, postId: string, ids: string[], meta: RequestMeta, apiBase: string) {
    const [p] = await this.db.select().from(posts).where(and(eq(posts.id, postId), eq(posts.userId, userId), eq(posts.status, 'published')));
    if (!p) throw Errors.notFound('Publication');
    if (p.kind !== 'bim') throw Errors.conflict('NOT_A_BIM', 'Les produits et services utilisés s’ajoutent à un « J’ai fait mon BIM ».');
    const productIds = await this.linkableProducts(userId, ids);
    await this.db.transaction(async (tx) => {
      // Modifications simultanées : verrou sur la publication, puis remplacement complet.
      await tx.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).for('update');
      await tx.delete(postProducts).where(eq(postProducts.postId, postId));
      if (productIds.length) await tx.insert(postProducts).values(productIds.map((productId, position) => ({ postId, productId, position })));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'social.post_products_set', targetType: 'post', targetId: postId, ip: meta.ip, userAgent: meta.userAgent, metadata: { count: productIds.length } }, tx);
    });
    return this.detail(userId, postId, apiBase);
  }

  // ------------------------------------------------------------------------------------------------ Lecture

  /** Fil « Pour toi » (publications publiques de tous) ou « Abonnés » (personnes suivies). Pagination par curseur. */
  async feed(viewerId: string, tab: 'for_you' | 'following', cursor: string | undefined, apiBase: string) {
    if (tab === 'for_you') return this.forYou(viewerId, cursor, apiBase);
    const conds = [postVisibleTo(viewerId), sql`EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = ${posts.userId})`];
    if (cursor) conds.push(lt(posts.id, cursor));
    const rows = await this.db
      .select({ post: posts, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(and(...conds))
      .orderBy(desc(posts.id))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    return { items: await this.views(viewerId, page, apiBase), nextCursor: rows.length > PAGE ? page[page.length - 1].post.id : null };
  }

  /**
   * V1 — « Pour toi » classé (décision du 18/10/2026 : abonnements, catégories des projets, j'aime ; aucune publicité).
   * Score = fraîcheur (heures) + 24 si je suis l'auteur, + 12 pour un « J'ai fait mon BIM » d'une catégorie de mes
   * projets, + 6 si une personne que je suis l'a aimée, + 2 × ln(1 + j'aime). Pagination stable : instantané figé par
   * la première page (curseur « r.<instant>.<décalage> »), aucune publication plus récente n'y entre.
   */
  private async forYou(viewerId: string, cursor: string | undefined, apiBase: string) {
    let snapshot = new Date();
    let offset = 0;
    if (cursor) {
      const m = /^r\.(\d{10,15})\.(\d{1,5})$/.exec(cursor);
      if (!m) throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
      snapshot = new Date(Number(m[1]));
      offset = Number(m[2]);
    }
    const score = sql`(
      extract(epoch from ${posts.createdAt}) / 3600.0
      + CASE WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = ${posts.userId}) THEN 24 ELSE 0 END
      + CASE WHEN ${posts.kind} = 'bim' AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = ${posts.projectId}
               AND pr.category_code IN (SELECT category_code FROM projects mp WHERE mp.user_id = ${viewerId})) THEN 12 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM post_likes l JOIN follows f2 ON f2.followee_id = l.user_id AND f2.follower_id = ${viewerId}
               WHERE l.post_id = ${posts.id}) THEN 6 ELSE 0 END
      + 2 * ln(1 + (SELECT count(*) FROM post_likes l2 WHERE l2.post_id = ${posts.id}))
    )`;
    const rows = await this.db
      .select({ post: posts, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(and(postVisibleTo(viewerId), eq(posts.visibility, 'public'), lte(posts.createdAt, snapshot)))
      .orderBy(desc(score), desc(posts.id))
      .offset(offset)
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    return { items: await this.views(viewerId, page, apiBase), nextCursor: rows.length > PAGE ? `r.${snapshot.getTime()}.${offset + PAGE}` : null };
  }

  /**
   * Fil des visiteurs sans compte (écran 06) : publications « Tout le monde » de comptes actifs seulement, en lecture.
   * Aucune donnée sur la personne qui regarde (pas de j'aime, pas d'abonnement).
   */
  async publicFeed(cursor: string | undefined, apiBase: string) {
    const conds = [eq(posts.status, 'published'), eq(posts.visibility, 'public'), eq(users.status, 'active')];
    if (cursor) conds.push(lt(posts.id, cursor));
    const rows = await this.db
      .select({ post: posts, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(and(...conds))
      .orderBy(desc(posts.id))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    // Identifiant nul pour la personne qui regarde : aucun j'aime, aucun abonnement, rien n'est « à moi ».
    return { items: await this.views(NO_VIEWER, page, apiBase), nextCursor: rows.length > PAGE ? page[page.length - 1].post.id : null };
  }

  /** Publications d'une personne visibles par `viewerId` (grille du profil, écran 52). */
  async byAuthor(viewerId: string, authorId: string, cursor: string | undefined, apiBase: string) {
    const conds = [postVisibleTo(viewerId), eq(posts.userId, authorId)];
    if (cursor) conds.push(lt(posts.id, cursor));
    const rows = await this.db
      .select({ post: posts, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(and(...conds))
      .orderBy(desc(posts.id))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    return { items: await this.views(viewerId, page, apiBase), nextCursor: rows.length > PAGE ? page[page.length - 1].post.id : null };
  }

  /** Publication visible par `viewerId`, sinon « introuvable » (pas de différence entre absente et cachée). */
  async visible(viewerId: string, postId: string): Promise<{ post: PostRow; author: Author }> {
    const [row] = await this.db
      .select({ post: posts, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .where(and(eq(posts.id, postId), postVisibleTo(viewerId)));
    if (!row) throw Errors.notFound('Publication');
    return row;
  }

  /** Écran 11 : détail, avec les produits et services utilisés (absents des fils : aucun achat depuis l'Accueil, E2). */
  async detail(viewerId: string, postId: string, apiBase: string) {
    const row = await this.visible(viewerId, postId);
    const [view] = await this.views(viewerId, [row], apiBase);
    return { ...view, usedProducts: row.post.kind === 'bim' ? await this.usedProducts(viewerId, postId, apiBase) : [] };
  }

  async avatarUrl(key: string | null, apiBase: string): Promise<string | null> {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  private async views(viewerId: string, rows: Array<{ post: PostRow; author: Author }>, apiBase: string) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.post.id);
    const authorIds = [...new Set(rows.map((r) => r.author.id))];
    const [media, liked, followed, premium] = await Promise.all([
      this.db.select().from(postMedia).where(inArray(postMedia.postId, ids)).orderBy(asc(postMedia.position)),
      this.db.select({ postId: postLikes.postId }).from(postLikes).where(and(eq(postLikes.userId, viewerId), inArray(postLikes.postId, ids))),
      this.db.select({ id: follows.followeeId }).from(follows).where(and(eq(follows.followerId, viewerId), inArray(follows.followeeId, authorIds))),
      this.wallet.premiumUsers(authorIds),
    ]);
    const likedSet = new Set(liked.map((l) => l.postId));
    const followedSet = new Set(followed.map((f) => f.id));
    const avatars = new Map<string, string | null>();
    for (const r of rows) if (!avatars.has(r.author.id)) avatars.set(r.author.id, await this.avatarUrl(r.author.avatarKey, apiBase));
    const out = [];
    for (const { post: p, author } of rows) {
      const items = [];
      for (const m of media.filter((x) => x.postId === p.id)) {
        const link = this.storage.available ? await this.storage.temporaryUrl(m.storageKey, apiBase) : null;
        items.push({ id: m.id, kind: m.kind, width: m.width, height: m.height, takenDay: m.takenDay, url: link?.url ?? null, expiresAt: link?.expiresAt ?? null });
      }
      out.push({
        id: p.id,
        kind: p.kind as 'post' | 'bim',
        text: p.text,
        visibility: p.visibility,
        createdAt: p.createdAt,
        author: { id: author.id, username: author.username, fullName: author.fullName, avatarUrl: avatars.get(author.id) ?? null },
        media: items,
        journey:
          p.kind === 'bim'
            ? { category: p.journeyCategory, goal: p.journeyGoal, days: p.journeyDays, stepsDone: p.journeyStepsDone, projectAvailable: p.projectId !== null }
            : null,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
        likedByMe: likedSet.has(p.id),
        // Lot 9 : pièces reçues ; « Encourager » seulement vers une personne Premium (prototype : DEMO_MODE).
        coinCount: p.coinCount,
        canGift: this.wallet.demo && viewerId !== NO_VIEWER && author.id !== viewerId && premium.has(author.id),
        isMine: author.id === viewerId,
        followingAuthor: followedSet.has(author.id),
      });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ J'aime

  async like(viewerId: string, postId: string, on: boolean) {
    await this.visible(viewerId, postId);
    await this.db.transaction(async (tx) => {
      if (on) {
        const ins = await tx.insert(postLikes).values({ postId, userId: viewerId }).onConflictDoNothing().returning({ postId: postLikes.postId });
        if (ins.length) await tx.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId));
      } else {
        const del = await tx.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, viewerId))).returning({ postId: postLikes.postId });
        if (del.length) await tx.update(posts).set({ likeCount: sql`greatest(${posts.likeCount} - 1, 0)` }).where(eq(posts.id, postId));
      }
    });
    const [p] = await this.db.select({ likeCount: posts.likeCount }).from(posts).where(eq(posts.id, postId));
    return { likeCount: p.likeCount, likedByMe: on };
  }

  // ------------------------------------------------------------------------------------------------ Commentaires

  async comments(viewerId: string, postId: string, cursor: string | undefined, apiBase: string) {
    await this.visible(viewerId, postId);
    // Premier niveau dans l'ordre chronologique, chaque réponse sous son commentaire ; auteurs bloqués ou inactifs exclus.
    const visibleComment = and(eq(postComments.postId, postId), eq(postComments.status, 'published'), eq(users.status, 'active'), notBlockedBetween(viewerId, postComments.userId));
    const topConds = [visibleComment, isNull(postComments.parentId)];
    if (cursor) topConds.push(gt(postComments.id, cursor));
    const top = await this.db
      .select({ c: postComments, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.userId))
      .where(and(...topConds))
      .orderBy(asc(postComments.id))
      .limit(COMMENTS_PAGE + 1);
    const page = top.slice(0, COMMENTS_PAGE);
    const replies = page.length
      ? await this.db
          .select({ c: postComments, author: { id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey } })
          .from(postComments)
          .innerJoin(users, eq(users.id, postComments.userId))
          .where(and(visibleComment, inArray(postComments.parentId, page.map((r) => r.c.id))))
          .orderBy(asc(postComments.id))
      : [];
    const all = [...page, ...replies];
    const liked = all.length
      ? await this.db.select({ id: commentLikes.commentId }).from(commentLikes).where(and(eq(commentLikes.userId, viewerId), inArray(commentLikes.commentId, all.map((r) => r.c.id))))
      : [];
    const likedSet = new Set(liked.map((l) => l.id));
    const premium = await this.wallet.premiumUsers([...new Set(all.map((r) => r.author.id))]);
    const [post] = await this.db.select({ userId: posts.userId, commentCount: posts.commentCount }).from(posts).where(eq(posts.id, postId));
    const avatars = new Map<string, string | null>();
    const view = async (r: (typeof all)[number]) => {
      if (!avatars.has(r.author.id)) avatars.set(r.author.id, await this.avatarUrl(r.author.avatarKey, apiBase));
      return {
        id: r.c.id,
        parentId: r.c.parentId,
        text: r.c.text,
        createdAt: r.c.createdAt,
        author: { id: r.author.id, username: r.author.username, fullName: r.author.fullName, avatarUrl: avatars.get(r.author.id) ?? null },
        likeCount: r.c.likeCount,
        likedByMe: likedSet.has(r.c.id),
        coinCount: r.c.coinCount,
        canGift: this.wallet.demo && r.author.id !== viewerId && premium.has(r.author.id),
        // L'auteur du commentaire ou de la publication peut le supprimer.
        canDelete: r.author.id === viewerId || post.userId === viewerId,
        isMine: r.author.id === viewerId,
      };
    };
    const items = [];
    for (const t of page) {
      items.push(await view(t));
      for (const r of replies.filter((x) => x.c.parentId === t.c.id)) items.push(await view(r));
    }
    return { total: post.commentCount, items, nextCursor: top.length > COMMENTS_PAGE ? page[page.length - 1].c.id : null };
  }

  async comment(viewerId: string, postId: string, dto: CreateCommentDto, meta: RequestMeta, apiBase: string) {
    const { post } = await this.visible(viewerId, postId);
    const text = dto.text.trim();
    if (!text) throw Errors.validation({ fields: { text: ['Écris ton commentaire.'] } });
    const max = await this.limit('social.comments_daily_limit', 200);
    const checkCommentLimit = async (db: Pick<Database, 'select'>) => {
      const [{ n }] = await db.select({ n: count() }).from(postComments).where(and(eq(postComments.userId, viewerId), gt(postComments.createdAt, this.since24h())));
      if (n >= max) throw Errors.tooMany('Tu as déjà beaucoup commenté aujourd’hui 😊 Réessaie demain.', { reason: 'SOCIAL_COMMENTS_DAILY_LIMIT', limit: max });
    };
    await checkCommentLimit(this.db);
    if (dto.parentId) {
      // Réponse impossible à un commentaire masqué, d'un compte inactif ou d'une personne bloquée (audit, A-9).
      const [row] = await this.db
        .select({ c: postComments })
        .from(postComments)
        .innerJoin(users, eq(users.id, postComments.userId))
        .where(and(eq(postComments.id, dto.parentId), eq(postComments.postId, postId), eq(postComments.status, 'published'), eq(users.status, 'active'), notBlockedBetween(viewerId, postComments.userId)));
      const parent = row?.c;
      // Un seul niveau de réponses : répondre à une réponse revient à répondre au commentaire d'origine.
      if (!parent) throw Errors.notFound('Commentaire');
      if (parent.parentId) dto.parentId = parent.parentId;
    }
    const now = this.clock.now();
    const id = uuidv7(now.getTime());
    await this.db.transaction(async (tx) => {
      // Sous verrou : des envois simultanés ne dépassent pas la limite (audit, défaut 1).
      await lockUserQuota(tx, 'comments', viewerId);
      await checkCommentLimit(tx);
      await tx.insert(postComments).values({ id, postId, userId: viewerId, parentId: dto.parentId ?? null, text, createdAt: now });
      await tx.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, post.id));
      await this.audit.log({ actorType: 'user', actorId: viewerId, action: 'social.comment_created', targetType: 'post', targetId: postId, ip: meta.ip, userAgent: meta.userAgent, metadata: { commentId: id } }, tx);
    });
    // Vue construite directement : au-delà des 30 premiers commentaires, la relecture de la première page ne le
    // contenait pas et l'API répondait « null » (audit, A-4).
    const [me] = await this.db.select({ id: users.id, username: users.username, fullName: users.fullName, avatarKey: users.avatarKey }).from(users).where(eq(users.id, viewerId));
    return {
      id,
      parentId: dto.parentId ?? null,
      text,
      createdAt: now,
      author: { id: me.id, username: me.username, fullName: me.fullName, avatarUrl: await this.avatarUrl(me.avatarKey, apiBase) },
      likeCount: 0,
      likedByMe: false,
      coinCount: 0,
      canGift: false,
      canDelete: true,
      isMine: true,
    };
  }

  private async visibleComment(viewerId: string, commentId: string) {
    const [c] = await this.db.select().from(postComments).where(and(eq(postComments.id, commentId), eq(postComments.status, 'published'), commentParentPublished()));
    if (!c) throw Errors.notFound('Commentaire');
    const { post } = await this.visible(viewerId, c.postId).catch(() => {
      throw Errors.notFound('Commentaire');
    });
    return { c, post };
  }

  async removeComment(viewerId: string, commentId: string, meta: RequestMeta) {
    const { c, post } = await this.visibleComment(viewerId, commentId);
    if (c.userId !== viewerId && post.userId !== viewerId) throw Errors.forbidden('Seul son auteur ou l’auteur de la publication peut supprimer ce commentaire.');
    await this.db.transaction(async (tx) => {
      // Le commentaire et ses réponses disparaissent ensemble ; le compteur suit.
      const gone = await tx
        .update(postComments)
        .set({ status: 'deleted', text: '' })
        .where(and(eq(postComments.status, 'published'), sql`(${postComments.id} = ${commentId} OR ${postComments.parentId} = ${commentId})`))
        .returning({ id: postComments.id });
      await recountComments(tx, post.id);
      await this.audit.log({ actorType: 'user', actorId: viewerId, action: 'social.comment_deleted', targetType: 'post', targetId: post.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { commentId, removed: gone.length } }, tx);
    });
  }

  async likeComment(viewerId: string, commentId: string, on: boolean) {
    await this.visibleComment(viewerId, commentId);
    // Comme à l'affichage : pas de réaction au commentaire d'un compte inactif ou d'une personne bloquée (audit, A-9).
    const [author] = await this.db
      .select({ id: users.id })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.userId))
      .where(and(eq(postComments.id, commentId), eq(users.status, 'active'), notBlockedBetween(viewerId, postComments.userId)));
    if (!author) throw Errors.notFound('Commentaire');
    await this.db.transaction(async (tx) => {
      if (on) {
        const ins = await tx.insert(commentLikes).values({ commentId, userId: viewerId }).onConflictDoNothing().returning({ id: commentLikes.commentId });
        if (ins.length) await tx.update(postComments).set({ likeCount: sql`${postComments.likeCount} + 1` }).where(eq(postComments.id, commentId));
      } else {
        const del = await tx.delete(commentLikes).where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, viewerId))).returning({ id: commentLikes.commentId });
        if (del.length) await tx.update(postComments).set({ likeCount: sql`greatest(${postComments.likeCount} - 1, 0)` }).where(eq(postComments.id, commentId));
      }
    });
    const [c] = await this.db.select({ likeCount: postComments.likeCount }).from(postComments).where(eq(postComments.id, commentId));
    return { likeCount: c.likeCount, likedByMe: on };
  }
}
