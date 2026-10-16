/// <reference types="multer" />
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import { decryptBytes, encryptBytes } from '../../common/crypto';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DB, Database, DbOrTx } from '../../database/database.module';
import { communes, courierAccounts, courierCommunes, courierDocuments, courierShopPartnerships, shops, users } from '../../database/schema';
import type { AdminContext } from '../admin/admin.decorators';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { AuditService } from '../audit/audit.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';

export const COURIER_DOC_KINDS = ['id_front', 'id_back', 'selfie'] as const;
type Courier = typeof courierAccounts.$inferSelect;
type Relation = typeof courierShopPartnerships.$inferSelect;

/** Catégorie d'un livreur pour une boutique : déduite de la relation active, jamais du type du compte (7-E). */
export type CourierCategory = 'employee' | 'partner' | 'independent';

/**
 * Lot 7-E — Comptes livreurs. Vérification à la main par l'équipe BIM (pièces chiffrées, lecture journalisée),
 * âge minimum `age.min_courier` (non décidé = fermé, F15), profil de travail (disponibilité, capacité, communes),
 * relations avec les boutiques (emploi ou partenariat) proposées par la boutique et acceptées par le livreur ; au plus
 * un emploi actif ; fin d'une relation prise en compte immédiatement. Aucun accès aux commandes d'une boutique (L7-04).
 */
@Injectable()
export class CouriersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly age: AgePolicyService,
    private readonly audit: AuditService,
  ) {}

  private get key(): string {
    if (!this.cfg.KYC_ENCRYPTION_KEY || !this.storage.available) throw Errors.notConfigured('Le compte livreur');
    return this.cfg.KYC_ENCRYPTION_KEY;
  }

  private async assertAllowed(userId: string) {
    const [u] = await this.db.select({ birthDate: users.birthDate, status: users.status }).from(users).where(eq(users.id, userId));
    if (!u || u.status !== 'active') throw Errors.forbidden();
    await this.age.assert('courier', u.birthDate);
    void this.key;
  }

  private async mineRow(userId: string): Promise<Courier | null> {
    const [c] = await this.db.select().from(courierAccounts).where(eq(courierAccounts.userId, userId)).limit(1);
    return c ?? null;
  }

  private stage(c: Courier) {
    if (c.status === 'active') return 'active';
    if (c.status === 'suspended' || c.status === 'closed') return c.status;
    if (c.submittedAt) return 'submitted';
    return c.rejectReason ? 'to_correct' : 'draft';
  }

  private async applicationView(c: Courier) {
    const docs = await this.db.select({ kind: courierDocuments.kind }).from(courierDocuments).where(eq(courierDocuments.courierId, c.id));
    const kinds = docs.map((d) => d.kind);
    return {
      id: c.id,
      stage: this.stage(c),
      idDocType: c.idDocType,
      vehicle: c.vehicle,
      rejectReason: c.rejectReason,
      checklist: { identity: kinds.includes('id_front') && kinds.includes('id_back'), selfie: kinds.includes('selfie'), details: !!c.idDocType && !!c.vehicle },
      submittedAt: c.submittedAt,
    };
  }

  // ------------------------------------------------------------------ Demande (espace personnel)

  async myApplication(userId: string) {
    const c = await this.mineRow(userId);
    return { application: c ? await this.applicationView(c) : null, available: !!this.cfg.KYC_ENCRYPTION_KEY && this.storage.available };
  }

  async apply(userId: string, meta: RequestMeta) {
    await this.assertAllowed(userId);
    if (await this.mineRow(userId)) throw Errors.conflict('COURIER_ACCOUNT_EXISTS', 'Tu as déjà un compte livreur ou une demande en cours.');
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(courierAccounts).values({ id, userId, type: 'independent', status: 'pending_verification' });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'courier.application_created', targetType: 'courier', targetId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return this.myApplication(userId);
  }

  private async editable(userId: string) {
    const c = await this.mineRow(userId);
    if (!c) throw Errors.notFound('Demande');
    const st = this.stage(c);
    if (st !== 'draft' && st !== 'to_correct') throw Errors.conflict('APPLICATION_LOCKED', st === 'submitted' ? 'Ta demande est en cours de vérification.' : 'Ton compte livreur est déjà vérifié.');
    return c;
  }

  async updateApplication(userId: string, input: { idDocType?: string; vehicle?: string }) {
    const c = await this.editable(userId);
    await this.db
      .update(courierAccounts)
      .set({ ...(input.idDocType ? { idDocType: input.idDocType } : {}), ...(input.vehicle ? { vehicle: input.vehicle } : {}), updatedAt: new Date() })
      .where(eq(courierAccounts.id, c.id));
    return this.myApplication(userId);
  }

  /** Pièce d'identité ou selfie : image ré-encodée sans métadonnées, chiffrée avant le stockage. */
  async uploadDocument(userId: string, kind: string, file: Express.Multer.File | undefined, meta: RequestMeta) {
    if (!(COURIER_DOC_KINDS as readonly string[]).includes(kind)) throw Errors.validation({ fields: { kind: ['Pièce inconnue.'] } });
    if (!file) throw Errors.validation({ fields: { photo: ['Ajoute une photo.'] } });
    await this.assertAllowed(userId);
    const c = await this.editable(userId);
    const key = this.key;
    const img = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
    const docId = uuidv7();
    const storageKey = `courier-kyc/${c.id}/${docId}.bin`;
    await this.storage.put(storageKey, encryptBytes(img.data, key), 'application/octet-stream');
    let prev: { storageKey: string } | undefined;
    try {
      await this.db.transaction(async (tx) => {
        [prev] = await tx.select({ storageKey: courierDocuments.storageKey }).from(courierDocuments).where(and(eq(courierDocuments.courierId, c.id), eq(courierDocuments.kind, kind)));
        await tx.delete(courierDocuments).where(and(eq(courierDocuments.courierId, c.id), eq(courierDocuments.kind, kind)));
        await tx.insert(courierDocuments).values({ id: docId, courierId: c.id, kind, storageKey, width: img.width, height: img.height, bytes: img.bytes });
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'courier.document_uploaded', targetType: 'courier', targetId: c.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind } }, tx);
      });
    } catch (e) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw e;
    }
    if (prev) await this.storage.remove(prev.storageKey).catch(() => undefined);
    return this.myApplication(userId);
  }

  async submit(userId: string, meta: RequestMeta) {
    await this.assertAllowed(userId);
    const c = await this.editable(userId);
    const v = await this.applicationView(c);
    const missing = Object.entries(v.checklist).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) throw Errors.validation({ fields: { checklist: missing } });
    await this.db.transaction(async (tx) => {
      await tx.update(courierAccounts).set({ submittedAt: new Date(), rejectReason: null, updatedAt: new Date() }).where(eq(courierAccounts.id, c.id));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'courier.application_submitted', targetType: 'courier', targetId: c.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return this.myApplication(userId);
  }

  // ------------------------------------------------------------------ Administration

  async adminList(stage: 'submitted' | 'active' | 'to_correct') {
    const where =
      stage === 'active'
        ? eq(courierAccounts.status, 'active')
        : stage === 'submitted'
          ? and(eq(courierAccounts.status, 'pending_verification'), isNotNull(courierAccounts.submittedAt))
          : and(eq(courierAccounts.status, 'pending_verification'), isNull(courierAccounts.submittedAt), isNotNull(courierAccounts.rejectReason));
    const rows = await this.db
      .select({ c: courierAccounts, fullName: users.fullName, username: users.username })
      .from(courierAccounts)
      .innerJoin(users, eq(users.id, courierAccounts.userId))
      .where(where)
      .orderBy(asc(courierAccounts.submittedAt), asc(courierAccounts.createdAt))
      .limit(100);
    return { items: await Promise.all(rows.map(async (r) => ({ ...(await this.applicationView(r.c)), fullName: r.fullName, username: r.username }))) };
  }

  /** Fiche complète (date de naissance) : chaque consultation est journalisée. */
  async adminDetail(a: AdminContext, id: string, meta: RequestMeta) {
    const [r] = await this.db
      .select({ c: courierAccounts, fullName: users.fullName, username: users.username, birthDate: users.birthDate })
      .from(courierAccounts)
      .innerJoin(users, eq(users.id, courierAccounts.userId))
      .where(eq(courierAccounts.id, id));
    if (!r) throw Errors.notFound('Demande');
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.courier_application_viewed', targetType: 'courier', targetId: id, ip: meta.ip, userAgent: meta.userAgent });
    return { ...(await this.applicationView(r.c)), fullName: r.fullName, username: r.username, birthDate: r.birthDate };
  }

  /** Image déchiffrée, pour l'administration seulement ; chaque lecture est inscrite au journal d'audit. */
  async adminDocument(a: AdminContext, id: string, kind: string, meta: RequestMeta): Promise<Buffer> {
    const [d] = await this.db.select().from(courierDocuments).where(and(eq(courierDocuments.courierId, id), eq(courierDocuments.kind, kind)));
    if (!d) throw Errors.notFound('Pièce');
    const data = decryptBytes(await this.storage.read(d.storageKey), this.key);
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.courier_document_viewed', targetType: 'courier', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind } });
    return data;
  }

  async approve(a: AdminContext, id: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [c] = await tx
        .update(courierAccounts)
        .set({ status: 'active', reviewedAt: new Date(), reviewedBy: a.adminId, updatedAt: new Date() })
        .where(and(eq(courierAccounts.id, id), eq(courierAccounts.status, 'pending_verification'), isNotNull(courierAccounts.submittedAt)))
        .returning();
      if (!c) throw Errors.conflict('APPLICATION_NOT_SUBMITTED', 'Cette demande n’est pas en attente de vérification.');
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.courier_approved', targetType: 'courier', targetId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return { ok: true };
  }

  async reject(a: AdminContext, id: string, reason: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [c] = await tx
        .update(courierAccounts)
        .set({ submittedAt: null, rejectReason: reason, reviewedAt: new Date(), reviewedBy: a.adminId, updatedAt: new Date() })
        .where(and(eq(courierAccounts.id, id), eq(courierAccounts.status, 'pending_verification'), isNotNull(courierAccounts.submittedAt)))
        .returning();
      if (!c) throw Errors.conflict('APPLICATION_NOT_SUBMITTED', 'Cette demande n’est pas en attente de vérification.');
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.courier_rejected', targetType: 'courier', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason } }, tx);
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ Espace livreur

  private async active(courierId: string) {
    const [c] = await this.db.select().from(courierAccounts).where(eq(courierAccounts.id, courierId)).limit(1);
    if (!c || c.status !== 'active') throw Errors.forbidden();
    return c;
  }

  async profile(courierId: string) {
    const c = await this.active(courierId);
    const cs = await this.db
      .select({ code: communes.code, name: communes.name, city: communes.city })
      .from(courierCommunes)
      .innerJoin(communes, eq(communes.code, courierCommunes.communeCode))
      .where(eq(courierCommunes.courierId, courierId))
      .orderBy(asc(communes.city), asc(communes.name));
    return { id: c.id, available: c.available, capacity: c.capacity, vehicle: c.vehicle, communes: cs, relations: await this.relationsFor(courierId) };
  }

  async updateProfile(userId: string, courierId: string, input: { available?: boolean; capacity?: number; vehicle?: string; communes?: string[] }, meta: RequestMeta) {
    await this.active(courierId);
    if (input.communes) {
      const codes = [...new Set(input.communes)];
      if (codes.length > 30) throw Errors.validation({ fields: { communes: ['30 communes au plus.'] } });
      const known = codes.length ? await this.db.select({ code: communes.code }).from(communes).where(and(inArray(communes.code, codes), eq(communes.active, true))) : [];
      if (known.length !== codes.length) throw Errors.validation({ fields: { communes: ['Commune inconnue.'] } });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(courierAccounts)
        .set({
          ...(input.available !== undefined ? { available: input.available } : {}),
          ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
          ...(input.vehicle !== undefined ? { vehicle: input.vehicle } : {}),
          updatedAt: new Date(),
        })
        .where(eq(courierAccounts.id, courierId));
      if (input.communes) {
        await tx.delete(courierCommunes).where(eq(courierCommunes.courierId, courierId));
        const codes = [...new Set(input.communes)];
        if (codes.length) await tx.insert(courierCommunes).values(codes.map((communeCode) => ({ courierId, communeCode })));
      }
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'courier.profile_updated', targetType: 'courier', targetId: courierId, ip: meta.ip, userAgent: meta.userAgent, metadata: { available: input.available, capacity: input.capacity, communes: input.communes?.length } }, tx);
    });
    return this.profile(courierId);
  }

  /** Relations du livreur : propositions reçues et relations actives, avec le nom de la boutique seulement. */
  private async relationsFor(courierId: string) {
    const rows = await this.db
      .select({ r: courierShopPartnerships, shop: shops.name, shopCity: shops.city, shopCommune: shops.commune })
      .from(courierShopPartnerships)
      .innerJoin(shops, eq(shops.id, courierShopPartnerships.shopId))
      .where(and(eq(courierShopPartnerships.courierId, courierId), ne(courierShopPartnerships.status, 'ended')))
      .orderBy(desc(courierShopPartnerships.createdAt));
    return rows.map((x) => ({ id: x.r.id, shop: { name: x.shop, city: x.shopCity, commune: x.shopCommune }, relation: x.r.relation, status: x.r.status, acceptedAt: x.r.acceptedAt }));
  }

  /** Le livreur accepte ou refuse une proposition ; au plus un emploi actif (contrainte de la base). */
  async answer(userId: string, courierId: string, relationId: string, accept: boolean, meta: RequestMeta) {
    await this.active(courierId);
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(courierShopPartnerships).where(and(eq(courierShopPartnerships.id, relationId), eq(courierShopPartnerships.courierId, courierId))).for('update').limit(1);
      if (!r || r.status !== 'pending') throw Errors.notFound('Proposition');
      if (accept && r.relation === 'employee') {
        const [other] = await tx
          .select({ id: courierShopPartnerships.id })
          .from(courierShopPartnerships)
          .where(and(eq(courierShopPartnerships.courierId, courierId), eq(courierShopPartnerships.relation, 'employee'), eq(courierShopPartnerships.status, 'active')))
          .limit(1);
        if (other) throw new AppError('ALREADY_EMPLOYED', 'Tu es déjà employé par une boutique : mets fin à cet emploi avant d’en accepter un autre.', HttpStatus.CONFLICT);
      }
      const now = new Date();
      await tx
        .update(courierShopPartnerships)
        .set(accept ? { status: 'active', acceptedAt: now, startedAt: now } : { status: 'ended', endedAt: now, endedBy: userId })
        .where(eq(courierShopPartnerships.id, relationId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: accept ? 'courier.relation_accepted' : 'courier.relation_declined', targetType: 'courier_relation', targetId: relationId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId: r.shopId, relation: r.relation } }, tx);
    });
    return this.profile(courierId);
  }

  /** Fin d'une relation par le livreur, effet immédiat. */
  async endByCourier(userId: string, courierId: string, relationId: string, meta: RequestMeta) {
    await this.active(courierId);
    await this.end(eq(courierShopPartnerships.courierId, courierId), relationId, userId, meta);
    return this.profile(courierId);
  }

  private async end(scope: ReturnType<typeof eq>, relationId: string, userId: string, meta: RequestMeta) {
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(courierShopPartnerships)
        .set({ status: 'ended', endedAt: new Date(), endedBy: userId })
        .where(and(eq(courierShopPartnerships.id, relationId), scope, ne(courierShopPartnerships.status, 'ended')))
        .returning();
      if (!r) throw Errors.notFound('Relation');
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'courier.relation_ended', targetType: 'courier_relation', targetId: relationId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId: r.shopId, courierId: r.courierId, relation: r.relation } }, tx);
    });
  }

  // ------------------------------------------------------------------ Côté boutique

  /** Livreurs de la boutique : nom, nom d'utilisateur, relation, état (aucune pièce, aucune donnée de vérification). */
  async shopCouriers(shopId: string) {
    const rows = await this.db
      .select({ r: courierShopPartnerships, fullName: users.fullName, username: users.username, available: courierAccounts.available, courierStatus: courierAccounts.status })
      .from(courierShopPartnerships)
      .innerJoin(courierAccounts, eq(courierAccounts.id, courierShopPartnerships.courierId))
      .innerJoin(users, eq(users.id, courierAccounts.userId))
      .where(and(eq(courierShopPartnerships.shopId, shopId), ne(courierShopPartnerships.status, 'ended')))
      .orderBy(asc(courierShopPartnerships.createdAt));
    return {
      items: rows.map((x) => ({
        id: x.r.id,
        fullName: x.fullName,
        username: x.username,
        relation: x.r.relation,
        status: x.r.status,
        available: x.r.status === 'active' && x.courierStatus === 'active' ? x.available : null,
      })),
    };
  }

  /** La boutique propose un emploi ou un partenariat à un livreur vérifié ; il doit l'accepter. */
  async invite(staffId: string, shopId: string, username: string, relation: 'employee' | 'partner', meta: RequestMeta) {
    const handle = username.replace(/^@/, '').trim().toLowerCase();
    const [c] = await this.db
      .select({ id: courierAccounts.id, status: courierAccounts.status, userId: users.id })
      .from(users)
      .innerJoin(courierAccounts, eq(courierAccounts.userId, users.id))
      .where(and(eq(sql`lower(${users.username})`, handle), eq(users.status, 'active')))
      .limit(1);
    if (!c || c.status !== 'active') throw new AppError('COURIER_NOT_FOUND', 'Aucun livreur vérifié avec ce nom d’utilisateur.', HttpStatus.NOT_FOUND);
    if (c.userId === staffId) throw Errors.forbidden('Tu ne peux pas te proposer toi-même.');
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: courierShopPartnerships.id })
        .from(courierShopPartnerships)
        .where(and(eq(courierShopPartnerships.courierId, c.id), eq(courierShopPartnerships.shopId, shopId), ne(courierShopPartnerships.status, 'ended')))
        .limit(1);
      if (dup) throw Errors.conflict('RELATION_EXISTS', 'Ce livreur travaille déjà avec ta boutique, ou une proposition est en attente.');
      await tx.insert(courierShopPartnerships).values({ id, courierId: c.id, shopId, relation, status: 'pending', invitedBy: staffId });
      await this.audit.log({ actorType: 'user', actorId: staffId, action: 'shop.courier_invited', targetType: 'courier_relation', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, courierId: c.id, relation } }, tx);
    });
    return this.shopCouriers(shopId);
  }

  async endByShop(staffId: string, shopId: string, relationId: string, meta: RequestMeta) {
    await this.end(eq(courierShopPartnerships.shopId, shopId), relationId, staffId, meta);
    return this.shopCouriers(shopId);
  }

  // ------------------------------------------------------------------ Règles pour les livraisons (7-F)

  /**
   * Catégorie d'un livreur pour une boutique, lue au moment de l'appel : employé ou partenaire seulement avec une
   * relation **active** ; sinon indépendant. Jamais déduite du type du compte ni de `can_collect_article_payment`.
   */
  async category(courierId: string, shopId: string, tx: DbOrTx = this.db): Promise<CourierCategory> {
    const [r] = await tx
      .select({ relation: courierShopPartnerships.relation })
      .from(courierShopPartnerships)
      .innerJoin(courierAccounts, eq(courierAccounts.id, courierShopPartnerships.courierId))
      .where(and(eq(courierShopPartnerships.courierId, courierId), eq(courierShopPartnerships.shopId, shopId), eq(courierShopPartnerships.status, 'active'), eq(courierAccounts.status, 'active')))
      .limit(1);
    return (r?.relation as Relation['relation'] as CourierCategory | undefined) ?? 'independent';
  }

  /** F3 bis : seuls les employés actifs de la boutique peuvent recevoir des espèces pour elle. */
  async canCollectCash(courierId: string, shopId: string, tx: DbOrTx = this.db) {
    return (await this.category(courierId, shopId, tx)) === 'employee';
  }
}
