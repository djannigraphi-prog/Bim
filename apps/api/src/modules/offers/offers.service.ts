import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { privacySettings, products, projectCategories, projectCategoryRubriques, projectGoals, projectOfferProducts, projectOffers, projects, shopCategories, shops, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { BimShopService } from '../catalog/bimshop.service';
import { generateTitle } from '../projects/plan';
import { SettingsService } from '../settings/settings.service';

export const MAX_OFFER_PRODUCTS = 3;
const RECOMMENDATIONS = 6;

/**
 * Lot 5-D — Demandes et offres de projet (écrans 21, 49, 55) et recommandations des projets Premium.
 *
 * Une **demande** est un projet dont la personne a choisi « Recevoir les offres des marchands » (écran 21). Les
 * boutiques ne voient qu'une version **anonymisée** : catégorie, titre, objectif, mode, durée, ville seulement si la
 * personne la rend publique ; jamais son nom, son identifiant, sa description, ses mesures ni ses photos.
 * Seules les boutiques qui ont des articles en ligne dans une rubrique liée à la catégorie du projet la voient.
 * Les projets des **moins de 18 ans** ne sont jamais montrés aux marchands (protection, en attendant une décision).
 * Une boutique fait au plus une offre par projet ; la personne peut la refuser (définitif) ou ne plus recevoir d'offres.
 * Aucune commande ni paiement : l'offre présente des articles du BimShop.
 */
@Injectable()
export class OffersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bimshop: BimShopService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Rubriques (et sous-rubriques) où la boutique a des articles en ligne. */
  private async shopRubriques(shopId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ code: products.categoryCode, parent: shopCategories.parentCode })
      .from(products)
      .innerJoin(shopCategories, eq(shopCategories.code, products.categoryCode))
      .where(and(eq(products.shopId, shopId), eq(products.status, 'published')));
    return [...new Set(rows.flatMap((r) => [r.code, r.parent]).filter((c): c is string => !!c))];
  }

  /** Conditions SQL d'une demande visible par la boutique (hors projet donné). */
  private requestConditions(shopId: string, ownerUserId: string, rubriques: string[]) {
    return and(
      eq(projects.receiveMerchantOffers, true),
      eq(projects.status, 'active'),
      eq(users.status, 'active'),
      sql`${users.birthDate} <= (current_date - interval '18 years')`,
      sql`${projects.userId} <> ${ownerUserId}`,
      sql`EXISTS (SELECT 1 FROM ${projectCategoryRubriques} m WHERE m.project_category_code = ${projects.categoryCode} AND m.shop_category_code IN (${sql.join(
        rubriques.map((r) => sql`${r}`),
        sql`, `,
      )}))`,
      sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${projects.userId} AND b.blocked_id = ${ownerUserId}) OR (b.blocker_id = ${ownerUserId} AND b.blocked_id = ${projects.userId}))`,
      sql`NOT EXISTS (SELECT 1 FROM ${projectOffers} o WHERE o.project_id = ${projects.id} AND o.shop_id = ${shopId} AND o.status = 'declined')`,
    )!;
  }

  private async shopOwner(shopId: string) {
    const [s] = await this.db.select().from(shops).where(eq(shops.id, shopId));
    if (!s) throw Errors.notFound('Boutique');
    return s;
  }

  // ------------------------------------------------------------------------------------------------ Boutique (écran 55)

  /** Demandes de projet anonymisées pour la boutique, les plus récentes d'abord. */
  async requests(shopId: string) {
    const shop = await this.shopOwner(shopId);
    const rubriques = await this.shopRubriques(shopId);
    if (!rubriques.length) return { items: [], hint: 'Publie au moins un article pour recevoir les demandes de ta rubrique.' };
    const rows = await this.db
      .select({
        id: projects.id,
        pattern: projectGoals.titlePattern,
        mode: projects.mode,
        durationDays: projects.durationDays,
        targetQuantity: projects.targetQuantity,
        createdAt: projects.createdAt,
        category: projectCategories.label,
        goal: projectGoals.label,
        city: sql<string | null>`CASE WHEN ${privacySettings.cityPublic} THEN ${users.city} ELSE NULL END`,
        offer: projectOffers.status,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .innerJoin(projectCategories, eq(projectCategories.code, projects.categoryCode))
      .leftJoin(projectGoals, eq(projectGoals.code, projects.goalCode))
      .leftJoin(privacySettings, eq(privacySettings.userId, users.id))
      .leftJoin(projectOffers, and(eq(projectOffers.projectId, projects.id), eq(projectOffers.shopId, shopId)))
      .where(this.requestConditions(shopId, shop.ownerUserId, rubriques))
      .orderBy(desc(projects.createdAt))
      .limit(100);
    return {
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        // Jamais le titre saisi ni la description : ils peuvent contenir des informations personnelles (audit, E-1).
        title: generateTitle({ pattern: r.pattern, quantity: r.targetQuantity, description: null, categoryLabel: r.category }),
        goal: r.goal,
        mode: r.mode,
        durationDays: r.durationDays,
        targetQuantity: r.targetQuantity,
        city: r.city,
        createdAt: r.createdAt,
        offerStatus: r.offer ?? null,
      })),
      hint: null,
    };
  }

  async createOffer(shopId: string, userId: string, projectId: string, dto: { message: string; productIds?: string[] }, meta: RequestMeta) {
    const shop = await this.shopOwner(shopId);
    const rubriques = await this.shopRubriques(shopId);
    const ids = [...new Set(dto.productIds ?? [])];
    if (ids.length > MAX_OFFER_PRODUCTS) throw Errors.validation({ fields: { productIds: [`${MAX_OFFER_PRODUCTS} articles au plus.`] } });
    const [visible] = rubriques.length
      ? await this.db
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(users, eq(users.id, projects.userId))
          .where(and(eq(projects.id, projectId), this.requestConditions(shopId, shop.ownerUserId, rubriques)))
      : [];
    if (!visible) throw Errors.notFound('Demande');
    if (ids.length) {
      const mine = await this.db
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, ids), eq(products.shopId, shopId), eq(products.status, 'published')));
      if (mine.length !== ids.length) throw Errors.validation({ fields: { productIds: ['Choisis des articles en ligne de ta boutique.'] } });
    }
    const max = await this.settings.get<number>('offers.max_per_shop_per_day');
    const limit = typeof max?.value === 'number' && max.value > 0 ? max.value : 20;
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      // Une boutique à la fois : le compteur et l'insertion restent cohérents.
      await tx.execute(sql`SELECT 1 FROM ${shops} WHERE id = ${shopId} FOR UPDATE`);
      const [{ n }] = await tx
        .select({ n: count() })
        .from(projectOffers)
        .where(and(eq(projectOffers.shopId, shopId), gt(projectOffers.createdAt, new Date(Date.now() - 24 * 3600_000))));
      if (n >= limit) throw Errors.tooMany('Tu as atteint le nombre d’offres possibles pour aujourd’hui.', { limit });
      const [existing] = await tx.select({ status: projectOffers.status }).from(projectOffers).where(and(eq(projectOffers.projectId, projectId), eq(projectOffers.shopId, shopId)));
      if (existing) throw Errors.conflict('OFFER_EXISTS', 'Tu as déjà fait une offre pour ce projet.');
      await tx.insert(projectOffers).values({ id, projectId, shopId, message: dto.message.trim() });
      if (ids.length) await tx.insert(projectOfferProducts).values(ids.map((productId, position) => ({ offerId: id, productId, position })));
      await this.audit.log(
        { actorType: 'user', actorId: userId, action: 'offers.offer_sent', targetType: 'project', targetId: projectId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, products: ids.length } },
        tx,
      );
    });
    return { id, status: 'sent' as const };
  }

  /** Offres envoyées par la boutique (titre du projet seulement). */
  async shopOffers(shopId: string) {
    const rows = await this.db
      .select({
        id: projectOffers.id,
        status: projectOffers.status,
        message: projectOffers.message,
        createdAt: projectOffers.createdAt,
        respondedAt: projectOffers.respondedAt,
        pattern: projectGoals.titlePattern,
        quantity: projects.targetQuantity,
        category: projectCategories.label,
      })
      .from(projectOffers)
      .innerJoin(projects, eq(projects.id, projectOffers.projectId))
      .innerJoin(projectCategories, eq(projectCategories.code, projects.categoryCode))
      .leftJoin(projectGoals, eq(projectGoals.code, projects.goalCode))
      .where(eq(projectOffers.shopId, shopId))
      .orderBy(desc(projectOffers.createdAt))
      .limit(200);
    return {
      items: rows.map(({ pattern, quantity, ...r }) => ({ ...r, title: generateTitle({ pattern, quantity, description: null, categoryLabel: r.category }) })),
    };
  }

  async withdraw(shopId: string, offerId: string) {
    const [o] = await this.db.select().from(projectOffers).where(and(eq(projectOffers.id, offerId), eq(projectOffers.shopId, shopId)));
    if (!o) throw Errors.notFound('Offre');
    // Mise à jour conditionnelle : un refus simultané n'est jamais écrasé (audit, D-19).
    const done = await this.db
      .update(projectOffers)
      .set({ status: 'withdrawn', respondedAt: new Date() })
      .where(and(eq(projectOffers.id, offerId), eq(projectOffers.status, 'sent')))
      .returning({ id: projectOffers.id });
    if (!done.length) throw Errors.conflict('OFFER_CLOSED', 'Cette offre n’est plus active.');
    return { id: offerId, status: 'withdrawn' as const };
  }

  // ------------------------------------------------------------------------------------------------ Personne (écran 49)

  private async ownProject(userId: string, projectId: string) {
    const [p] = await this.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!p) throw Errors.notFound('Projet');
    return p;
  }

  /** Offres reçues pour un projet (boutiques ouvertes seulement ; articles encore en ligne seulement). */
  async projectOffers(userId: string, projectId: string, apiBase: string) {
    const p = await this.ownProject(userId, projectId);
    const rows = await this.db
      .select({ o: projectOffers, s: shops })
      .from(projectOffers)
      .innerJoin(shops, eq(shops.id, projectOffers.shopId))
      .innerJoin(users, eq(users.id, shops.ownerUserId))
      .where(
        and(
          eq(projectOffers.projectId, p.id),
          eq(projectOffers.status, 'sent'),
          eq(shops.status, 'active'),
          eq(users.status, 'active'),
          // Ni boutique d'une personne bloquée, dans un sens ou dans l'autre (audit, A-9).
          sql`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = ${shops.ownerUserId}) OR (b.blocker_id = ${shops.ownerUserId} AND b.blocked_id = ${userId}))`,
        ),
      )
      .orderBy(desc(projectOffers.createdAt));
    const links = rows.length
      ? await this.db
          .select()
          .from(projectOfferProducts)
          .where(
            inArray(
              projectOfferProducts.offerId,
              rows.map((r) => r.o.id),
            ),
          )
          .orderBy(asc(projectOfferProducts.position))
      : [];
    const items = [];
    for (const { o, s } of rows) {
      const ids = links.filter((l) => l.offerId === o.id).map((l) => l.productId);
      items.push({
        id: o.id,
        message: o.message,
        createdAt: o.createdAt,
        shop: { id: s.id, name: s.name, slug: s.slug, city: s.city, commune: s.commune, verified: !!s.verifiedAt },
        products: await this.bimshop.visibleCards(ids, apiBase),
      });
    }
    return { receiveOffers: p.receiveMerchantOffers, items };
  }

  async decline(userId: string, projectId: string, offerId: string) {
    await this.ownProject(userId, projectId);
    const [o] = await this.db.select().from(projectOffers).where(and(eq(projectOffers.id, offerId), eq(projectOffers.projectId, projectId)));
    if (!o) throw Errors.notFound('Offre');
    const done = await this.db
      .update(projectOffers)
      .set({ status: 'declined', respondedAt: new Date() })
      .where(and(eq(projectOffers.id, offerId), eq(projectOffers.status, 'sent')))
      .returning({ id: projectOffers.id });
    if (done.length) return { id: offerId, status: 'declined' as const };
    const [now] = await this.db.select({ status: projectOffers.status }).from(projectOffers).where(eq(projectOffers.id, offerId));
    return { id: offerId, status: now?.status ?? o.status };
  }

  async setReceive(userId: string, projectId: string, receive: boolean) {
    await this.ownProject(userId, projectId);
    await this.db.update(projects).set({ receiveMerchantOffers: receive, updatedAt: new Date() }).where(eq(projects.id, projectId));
    return { receiveOffers: receive };
  }

  /** « Recommandé pour toi » (écran 24, projets Premium) : articles en ligne des rubriques liées à la catégorie. */
  async recommendations(userId: string, projectId: string, apiBase: string) {
    const p = await this.ownProject(userId, projectId);
    if (p.mode !== 'premium') return { premiumOnly: true, items: [] };
    const codes = (await this.db.select({ code: projectCategoryRubriques.shopCategoryCode }).from(projectCategoryRubriques).where(eq(projectCategoryRubriques.projectCategoryCode, p.categoryCode))).map(
      (r) => r.code,
    );
    return { premiumOnly: false, items: await this.bimshop.recommend(codes, RECOMMENDATIONS, apiBase) };
  }
}
