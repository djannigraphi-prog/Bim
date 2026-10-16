/// <reference types="multer" />
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { decryptBytes, encryptBytes } from '../../common/crypto';
import { Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { uuidv7 } from '../../common/uuid';
import { DB, Database } from '../../database/database.module';
import { merchantApplications, merchantDocuments, shopMembers, shops, users } from '../../database/schema';
import { AdminContext } from '../admin/admin.decorators';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhone } from '../auth/identifiers';
import { VerificationService } from '../auth/verification.service';
import { encodePrivateImage } from '../media/private-image';
import { StorageService } from '../media/storage';
import { CreateApplicationDto, PayoutNumberDto, UpdateApplicationDto } from './dto';

export const DOC_KINDS = ['id_front', 'id_back', 'selfie'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
type Application = typeof merchantApplications.$inferSelect;

/** Une personne ne peut avoir qu'une demande en cours à la fois (brouillon, envoyée ou à corriger). */
const OPEN_STATUSES = ['draft', 'submitted', 'rejected'];

/**
 * Lot 5-A — Ouvrir une boutique (écrans 07 à 09, 53) : demande vérifiée à la main par l'équipe BIM.
 *
 * Garde-fous : âge minimum des marchands (F15, `age.min_merchant` : null = fermé) ; clé de chiffrement obligatoire
 * (aucune pièce d'identité en clair, ni sur le disque ni dans le stockage) ; numéro Mobile Money confirmé par SMS ;
 * pièces et selfie lus seulement par l'administration autorisée, chaque lecture inscrite au journal d'audit.
 * La vérification du visage est faite par une personne de l'équipe (aucune biométrie automatique, aucun prestataire).
 */
@Injectable()
export class MerchantsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly age: AgePolicyService,
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
  ) {}

  private get key(): string {
    if (!this.cfg.KYC_ENCRYPTION_KEY || !this.storage.available) throw Errors.notConfigured('L’ouverture des boutiques');
    return this.cfg.KYC_ENCRYPTION_KEY;
  }

  private async assertAllowed(userId: string) {
    const [u] = await this.db.select({ birthDate: users.birthDate, status: users.status }).from(users).where(eq(users.id, userId));
    if (!u || u.status !== 'active') throw Errors.forbidden();
    await this.age.assert('merchant', u.birthDate);
    void this.key;
  }

  private async own(userId: string, id: string): Promise<Application> {
    const [a] = await this.db.select().from(merchantApplications).where(and(eq(merchantApplications.id, id), eq(merchantApplications.userId, userId)));
    if (!a) throw Errors.notFound('Demande');
    return a;
  }

  private editable(a: Application) {
    if (a.status !== 'draft' && a.status !== 'rejected') {
      throw Errors.conflict('APPLICATION_LOCKED', a.status === 'submitted' ? 'Ta demande est en cours de vérification.' : 'Ta boutique est déjà ouverte.');
    }
  }

  // ------------------------------------------------------------------------------------------------ Personne

  async create(userId: string, dto: CreateApplicationDto, meta: RequestMeta) {
    await this.assertAllowed(userId);
    const open = await this.db
      .select({ id: merchantApplications.id })
      .from(merchantApplications)
      .where(and(eq(merchantApplications.userId, userId), inArray(merchantApplications.status, OPEN_STATUSES)));
    if (open.length) throw Errors.conflict('APPLICATION_IN_PROGRESS', 'Tu as déjà une demande d’ouverture de boutique en cours.');
    const shopId = uuidv7();
    const id = uuidv7();
    const base = slugify(dto.name);
    await this.db.transaction(async (tx) => {
      // Deux envois simultanés : un seul passe (verrou par personne, puis index unique en dernier rempart).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merchant_application'), hashtext(${userId}))`);
      const again = await tx
        .select({ id: merchantApplications.id })
        .from(merchantApplications)
        .where(and(eq(merchantApplications.userId, userId), inArray(merchantApplications.status, OPEN_STATUSES)));
      if (again.length) throw Errors.conflict('APPLICATION_IN_PROGRESS', 'Tu as déjà une demande d’ouverture de boutique en cours.');
      await tx.insert(shops).values({
        id: shopId,
        ownerUserId: userId,
        name: dto.name.trim(),
        slug: `${base}-${shopId.slice(-6)}`,
        status: 'draft',
        description: dto.description?.trim() || null,
        city: dto.city.trim(),
        commune: dto.commune?.trim() || null,
      });
      await tx.insert(shopMembers).values({ shopId, userId, role: 'owner' });
      await tx.insert(merchantApplications).values({ id, userId, shopId });
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'merchant.application_created', targetType: 'shop', targetId: shopId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return this.mine(userId);
  }

  /** Ma demande en cours ou la dernière (écran 09 : liste de contrôle et statut). */
  async mine(userId: string) {
    const [a] = await this.db.select().from(merchantApplications).where(eq(merchantApplications.userId, userId)).orderBy(desc(merchantApplications.createdAt)).limit(1);
    if (!a) return { application: null, available: !!this.cfg.KYC_ENCRYPTION_KEY && this.storage.available };
    return { application: await this.view(a), available: !!this.cfg.KYC_ENCRYPTION_KEY && this.storage.available };
  }

  private async view(a: Application) {
    const [shop] = await this.db.select().from(shops).where(eq(shops.id, a.shopId));
    const docs = await this.db.select({ kind: merchantDocuments.kind }).from(merchantDocuments).where(eq(merchantDocuments.applicationId, a.id));
    const has = (k: DocKind) => docs.some((d) => d.kind === k);
    const idOk = !!a.idDocType && has('id_front') && (a.idDocType === 'passport' || has('id_back'));
    return {
      id: a.id,
      status: a.status as 'draft' | 'submitted' | 'approved' | 'rejected',
      shop: { id: shop.id, name: shop.name, description: shop.description, city: shop.city, commune: shop.commune, status: shop.status },
      idDocType: a.idDocType,
      documents: { idFront: has('id_front'), idBack: has('id_back'), selfie: has('selfie') },
      // Numéro masqué : seuls les 2 derniers chiffres sont rappelés.
      payout: a.payoutPhone ? { operator: a.payoutOperator, phoneEnd: a.payoutPhone.slice(-2), verified: !!a.payoutVerifiedAt } : null,
      address: a.address,
      checklist: { identity: idOk, selfie: has('selfie'), payout: !!a.payoutVerifiedAt, address: !!a.address },
      ready: idOk && has('selfie') && !!a.payoutVerifiedAt,
      submittedAt: a.submittedAt,
      reviewedAt: a.reviewedAt,
      rejectionReason: a.rejectionReason,
    };
  }

  async update(userId: string, id: string, dto: UpdateApplicationDto) {
    const a = await this.own(userId, id);
    this.editable(a);
    await this.db.transaction(async (tx) => {
      const set: Partial<Application> = { updatedAt: new Date() };
      if (dto.idDocType !== undefined) set.idDocType = dto.idDocType;
      if (dto.address !== undefined) set.address = dto.address?.trim() || null;
      await tx.update(merchantApplications).set(set).where(eq(merchantApplications.id, id));
      const shopSet: Partial<typeof shops.$inferInsert> = { updatedAt: new Date() };
      if (dto.name !== undefined) shopSet.name = dto.name.trim();
      if (dto.description !== undefined) shopSet.description = dto.description?.trim() || null;
      if (dto.city !== undefined) shopSet.city = dto.city.trim();
      if (dto.commune !== undefined) shopSet.commune = dto.commune?.trim() || null;
      await tx.update(shops).set(shopSet).where(eq(shops.id, a.shopId));
    });
    return { application: await this.view(await this.own(userId, id)) };
  }

  async uploadDocument(userId: string, id: string, kind: string, file: Express.Multer.File | undefined, meta: RequestMeta) {
    if (!(DOC_KINDS as readonly string[]).includes(kind)) throw Errors.validation({ fields: { kind: ['« id_front », « id_back » ou « selfie ».'] } });
    const key = this.key;
    const a = await this.own(userId, id);
    this.editable(a);
    const img = await encodePrivateImage(file, this.cfg.MEDIA_MAX_UPLOAD_MB, 'photo');
    const docId = uuidv7();
    const storageKey = `kyc/${a.id}/${docId}.bin`;
    await this.storage.put(storageKey, encryptBytes(img.data, key), 'application/octet-stream');
    let prev: typeof merchantDocuments.$inferSelect | undefined;
    try {
      await this.db.transaction(async (tx) => {
        // Demande verrouillée : deux envois simultanés de la même pièce se suivent au lieu de se heurter.
        const [locked] = await tx.select({ status: merchantApplications.status }).from(merchantApplications).where(eq(merchantApplications.id, a.id)).for('update');
        if (!locked || !['draft', 'rejected'].includes(locked.status)) throw Errors.conflict('APPLICATION_LOCKED', 'Ta demande ne peut plus être modifiée.');
        [prev] = await tx.select().from(merchantDocuments).where(and(eq(merchantDocuments.applicationId, a.id), eq(merchantDocuments.kind, kind)));
        if (prev) await tx.delete(merchantDocuments).where(eq(merchantDocuments.id, prev.id));
        await tx.insert(merchantDocuments).values({ id: docId, applicationId: a.id, kind, storageKey, width: img.width, height: img.height, bytes: img.bytes });
        await tx.update(merchantApplications).set({ updatedAt: new Date() }).where(eq(merchantApplications.id, a.id));
        await this.audit.log({ actorType: 'user', actorId: userId, action: 'merchant.document_uploaded', targetType: 'merchant_application', targetId: a.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind } }, tx);
      });
    } catch (e) {
      // Pas de pièce chiffrée orpheline dans le stockage (audit, D-4).
      await this.storage.remove(storageKey).catch(() => undefined);
      throw e;
    }
    if (prev) await this.storage.remove(prev.storageKey).catch(() => undefined);
    return { application: await this.view(await this.own(userId, id)) };
  }

  /** Numéro Mobile Money : un code est envoyé par SMS au numéro donné (écran 07). */
  async startPayout(userId: string, id: string, dto: PayoutNumberDto, ip: string | null) {
    const a = await this.own(userId, id);
    this.editable(a);
    const phone = normalizePhone(dto.phone, this.cfg.DEFAULT_PHONE_REGION);
    if (!phone) throw Errors.validation({ fields: { phone: ['Numéro de téléphone invalide.'] } });
    await this.db.update(merchantApplications).set({ payoutPhone: phone, payoutOperator: dto.operator, payoutVerifiedAt: null, updatedAt: new Date() }).where(eq(merchantApplications.id, a.id));
    const challenge = await this.verification.create({ purpose: 'payout_number', channel: 'phone', destination: phone, userId, scope: a.id, ip });
    return { challenge };
  }

  async verifyPayout(userId: string, id: string, challengeId: string, code: string, meta: RequestMeta) {
    const a = await this.own(userId, id);
    this.editable(a);
    const row = await this.verification.consume(challengeId, code, 'payout_number');
    // Le code doit correspondre à cette personne, cette demande et le numéro enregistré.
    if (row.userId !== userId || row.scope !== a.id || row.destination !== a.payoutPhone) throw Errors.validation({ fields: { code: ['Ce code ne correspond pas à ce numéro.'] } });
    await this.db.transaction(async (tx) => {
      await tx.update(merchantApplications).set({ payoutVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(merchantApplications.id, a.id));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'merchant.payout_verified', targetType: 'merchant_application', targetId: a.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return { application: await this.view(await this.own(userId, id)) };
  }

  async submit(userId: string, id: string, meta: RequestMeta) {
    await this.assertAllowed(userId);
    const a = await this.own(userId, id);
    this.editable(a);
    const v = await this.view(a);
    if (!v.ready) {
      throw Errors.validation({
        fields: {
          ...(v.checklist.identity ? {} : { identity: ['Ajoute ta pièce d’identité (recto, et verso sauf passeport).'] }),
          ...(v.checklist.selfie ? {} : { selfie: ['Ajoute ton selfie.'] }),
          ...(v.checklist.payout ? {} : { payout: ['Confirme ton numéro Mobile Money.'] }),
        },
      });
    }
    await this.db.transaction(async (tx) => {
      const sent = await tx
        .update(merchantApplications)
        .set({ status: 'submitted', submittedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
        .where(and(eq(merchantApplications.id, a.id), inArray(merchantApplications.status, ['draft', 'rejected'])))
        .returning({ id: merchantApplications.id });
      if (!sent.length) throw Errors.conflict('APPLICATION_LOCKED', 'Ta demande ne peut plus être modifiée.');
      await tx.update(shops).set({ status: 'pending_verification', updatedAt: new Date() }).where(eq(shops.id, a.shopId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'merchant.application_submitted', targetType: 'merchant_application', targetId: a.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    return { application: await this.view(await this.own(userId, id)) };
  }

  /** Abandonner une demande non encore validée : boutique fermée, pièces effacées du stockage. */
  async withdraw(userId: string, id: string, meta: RequestMeta) {
    const a = await this.own(userId, id);
    if (a.status === 'approved') throw Errors.conflict('APPLICATION_LOCKED', 'Ta boutique est déjà ouverte.');
    const docs = await this.db.select().from(merchantDocuments).where(eq(merchantDocuments.applicationId, a.id));
    await this.db.transaction(async (tx) => {
      // Une validation simultanée l'emporte : rien n'est supprimé si la demande vient d'être validée (audit, D-1).
      const gone = await tx
        .delete(merchantApplications)
        .where(and(eq(merchantApplications.id, a.id), ne(merchantApplications.status, 'approved')))
        .returning({ id: merchantApplications.id });
      if (!gone.length) throw Errors.conflict('APPLICATION_LOCKED', 'Ta boutique est déjà ouverte.');
      await tx.update(shops).set({ status: 'closed', updatedAt: new Date() }).where(eq(shops.id, a.shopId));
      await this.audit.log({ actorType: 'user', actorId: userId, action: 'merchant.application_withdrawn', targetType: 'shop', targetId: a.shopId, ip: meta.ip, userAgent: meta.userAgent }, tx);
    });
    for (const d of docs) await this.storage.remove(d.storageKey).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ Administration

  async adminList(status: string) {
    const rows = await this.db
      .select({ a: merchantApplications, shopName: shops.name, city: shops.city, commune: shops.commune, username: users.username, fullName: users.fullName })
      .from(merchantApplications)
      .innerJoin(shops, eq(shops.id, merchantApplications.shopId))
      .innerJoin(users, eq(users.id, merchantApplications.userId))
      .where(eq(merchantApplications.status, status))
      .orderBy(status === 'submitted' ? merchantApplications.submittedAt : desc(merchantApplications.updatedAt))
      .limit(200);
    return {
      items: rows.map((r) => ({
        id: r.a.id,
        status: r.a.status,
        shopName: r.shopName,
        city: r.city,
        commune: r.commune,
        username: r.username,
        fullName: r.fullName,
        idDocType: r.a.idDocType,
        payoutOperator: r.a.payoutOperator,
        payoutVerified: !!r.a.payoutVerifiedAt,
        submittedAt: r.a.submittedAt,
        reviewedAt: r.a.reviewedAt,
        rejectionReason: r.a.rejectionReason,
      })),
    };
  }

  /** Fiche complète (date de naissance, numéro, adresse) : chaque consultation est journalisée (audit, A-2). */
  async adminDetail(admin: AdminContext, id: string, meta: RequestMeta) {
    const [r] = await this.db
      .select({ a: merchantApplications, u: { username: users.username, fullName: users.fullName, birthDate: users.birthDate, city: users.city } })
      .from(merchantApplications)
      .innerJoin(users, eq(users.id, merchantApplications.userId))
      .where(eq(merchantApplications.id, id));
    if (!r) throw Errors.notFound('Demande');
    await this.audit.log({ actorType: 'admin', actorId: admin.adminId, action: 'admin.merchant_application_viewed', targetType: 'merchant_application', targetId: id, ip: meta.ip, userAgent: meta.userAgent });
    const v = await this.view(r.a);
    return {
      ...v,
      person: r.u,
      // L'équipe voit le numéro complet (pour vérifier qu'il correspond à la pièce d'identité).
      payout: r.a.payoutPhone ? { operator: r.a.payoutOperator, phone: r.a.payoutPhone, verified: !!r.a.payoutVerifiedAt } : null,
    };
  }

  /** Image déchiffrée, pour l'administration seulement ; chaque lecture est inscrite au journal d'audit. */
  async adminDocument(a: AdminContext, id: string, kind: string, meta: RequestMeta): Promise<Buffer> {
    const [d] = await this.db.select().from(merchantDocuments).where(and(eq(merchantDocuments.applicationId, id), eq(merchantDocuments.kind, kind)));
    if (!d) throw Errors.notFound('Document');
    const data = decryptBytes(await this.storage.read(d.storageKey), this.key);
    await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.kyc_document_viewed', targetType: 'merchant_application', targetId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind } });
    return data;
  }

  async approve(a: AdminContext, id: string, meta: RequestMeta) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Vérification et changement d'état en une seule écriture : un refus, un retrait ou une autre validation
      // simultanés ne peuvent pas aboutir à une boutique ouverte sans demande valide (audit, D-1).
      const [app] = await tx
        .update(merchantApplications)
        .set({ status: 'approved', reviewedBy: a.adminId, reviewedAt: now, rejectionReason: null, updatedAt: now })
        .where(and(eq(merchantApplications.id, id), eq(merchantApplications.status, 'submitted')))
        .returning();
      if (!app) throw Errors.conflict('APPLICATION_NOT_SUBMITTED', 'Cette demande n’est pas en attente de vérification.');
      const [owner] = await tx.select({ status: users.status }).from(users).where(eq(users.id, app.userId));
      if (owner?.status !== 'active') throw Errors.conflict('ACCOUNT_NOT_ACTIVE', 'Le compte de cette personne n’est pas actif.');
      await tx.update(shops).set({ status: 'active', verifiedAt: now, updatedAt: now }).where(eq(shops.id, app.shopId));
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.merchant_approved', targetType: 'shop', targetId: app.shopId, ip: meta.ip, userAgent: meta.userAgent, metadata: { applicationId: id } }, tx);
    });
    return { id, status: 'approved' };
  }

  async reject(a: AdminContext, id: string, reason: string, meta: RequestMeta) {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [app] = await tx
        .update(merchantApplications)
        .set({ status: 'rejected', reviewedBy: a.adminId, reviewedAt: now, rejectionReason: reason.trim(), updatedAt: now })
        .where(and(eq(merchantApplications.id, id), eq(merchantApplications.status, 'submitted')))
        .returning();
      if (!app) throw Errors.conflict('APPLICATION_NOT_SUBMITTED', 'Cette demande n’est pas en attente de vérification.');
      await tx.update(shops).set({ status: 'draft', updatedAt: now }).where(and(eq(shops.id, app.shopId), isNull(shops.verifiedAt)));
      await this.audit.log({ actorType: 'admin', actorId: a.adminId, action: 'admin.merchant_rejected', targetType: 'shop', targetId: app.shopId, ip: meta.ip, userAgent: meta.userAgent, metadata: { applicationId: id } }, tx);
    });
    return { id, status: 'rejected' };
  }
}

/** « Boutique Élégance » → « boutique-elegance ». */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'boutique'
  );
}
