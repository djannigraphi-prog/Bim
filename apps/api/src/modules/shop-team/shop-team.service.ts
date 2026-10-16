import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import type { RequestMeta } from '../../common/request-meta';
import { DB, Database } from '../../database/database.module';
import { SHOP_PERMISSIONS, ShopPermission, shopMemberPermissions, shopMembers, shops, users } from '../../database/schema';
import { AgePolicyService } from '../age-policy/age-policy.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../media/storage';

/** Employés d'une boutique au plus (propriétaire non compris). */
export const MAX_SHOP_STAFF = 20;

/**
 * Lot 7-A (A16) — Équipe d'une boutique. Le propriétaire invite une personne (qui accepte ou refuse), lui accorde et
 * retire des permissions séparées, la retire de l'équipe. Un employé n'a aucune permission par défaut ; aucune
 * permission ne donne le droit d'encaisser des espèces (F3 bis). La gestion de l'équipe est réservée au propriétaire.
 * Chaque changement est journalisé (permissions avant / après).
 */
@Injectable()
export class ShopTeamService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ages: AgePolicyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async avatar(key: string | null, apiBase: string) {
    if (!key || !this.storage.available) return null;
    return (await this.storage.temporaryUrl(key, apiBase)).url;
  }

  private async permissionsOf(shopId: string, userIds: string[]) {
    if (!userIds.length) return new Map<string, ShopPermission[]>();
    const rows = await this.db
      .select({ userId: shopMemberPermissions.userId, p: shopMemberPermissions.permission })
      .from(shopMemberPermissions)
      .where(and(eq(shopMemberPermissions.shopId, shopId), inArray(shopMemberPermissions.userId, userIds)));
    const out = new Map<string, ShopPermission[]>();
    for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.p as ShopPermission].sort());
    return out;
  }

  /** L'équipe : propriétaire, employés actifs et invitations en attente. */
  async list(shopId: string, apiBase: string) {
    const rows = await this.db
      .select({ m: shopMembers, u: users })
      .from(shopMembers)
      .innerJoin(users, eq(users.id, shopMembers.userId))
      .where(and(eq(shopMembers.shopId, shopId), isNull(shopMembers.revokedAt)))
      .orderBy(asc(shopMembers.createdAt));
    const perms = await this.permissionsOf(shopId, rows.map((r) => r.u.id));
    const items = [];
    for (const { m, u } of rows) {
      items.push({
        userId: u.id,
        username: u.username,
        fullName: u.fullName,
        avatarUrl: await this.avatar(u.avatarKey, apiBase),
        role: m.role,
        status: m.acceptedAt ? 'active' : 'invited',
        permissions: m.role === 'owner' ? [...SHOP_PERMISSIONS] : (perms.get(u.id) ?? []),
        since: m.acceptedAt ?? m.createdAt,
      });
    }
    return { items, availablePermissions: [...SHOP_PERMISSIONS], maxStaff: MAX_SHOP_STAFF };
  }

  /** Inviter une personne : elle n'a aucun accès tant qu'elle n'a pas accepté, et aucune permission par défaut. */
  async invite(ownerId: string, shopId: string, username: string, meta: RequestMeta, apiBase: string) {
    const [u] = await this.db.select().from(users).where(eq(users.username, username.trim().toLowerCase()));
    if (!u || u.status !== 'active') throw Errors.notFound('Personne');
    if (u.id === ownerId) throw Errors.conflict('ALREADY_MEMBER', 'Tu es déjà le propriétaire de cette boutique.');
    await this.ages.assert('merchant', u.birthDate);
    await this.db.transaction(async (tx) => {
      // Verrou de la boutique : deux invitations simultanées ne dépassent pas la limite.
      await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).for('update');
      const [existing] = await tx.select().from(shopMembers).where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, u.id)));
      if (existing && !existing.revokedAt) {
        throw Errors.conflict('ALREADY_MEMBER', existing.acceptedAt ? 'Cette personne fait déjà partie de l’équipe.' : 'Cette personne est déjà invitée.');
      }
      const [{ n }] = await tx.select({ n: count() }).from(shopMembers).where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.role, 'staff'), isNull(shopMembers.revokedAt)));
      if (n >= MAX_SHOP_STAFF) throw Errors.conflict('TEAM_LIMIT', `${MAX_SHOP_STAFF} employés au plus.`);
      if (existing) {
        await tx
          .update(shopMembers)
          .set({ role: 'staff', revokedAt: null, acceptedAt: null, invitedBy: ownerId, createdAt: new Date() })
          .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, u.id)));
      } else {
        await tx.insert(shopMembers).values({ shopId, userId: u.id, role: 'staff', acceptedAt: null, invitedBy: ownerId });
      }
      await this.audit.log({ actorType: 'user', actorId: ownerId, action: 'shop.member_invited', targetType: 'user', targetId: u.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
    return this.list(shopId, apiBase);
  }

  private async staffMember(shopId: string, userId: string) {
    const [m] = await this.db.select().from(shopMembers).where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt)));
    if (!m) throw Errors.notFound('Membre');
    if (m.role === 'owner') throw new AppError('OWNER_IMMUTABLE', 'Le propriétaire a tous les droits ; ils ne se modifient pas.', HttpStatus.CONFLICT);
    return m;
  }

  /** Remplace l'ensemble des permissions d'un employé ; journal avec avant / après. */
  async setPermissions(ownerId: string, shopId: string, userId: string, permissions: ShopPermission[], meta: RequestMeta, apiBase: string) {
    await this.staffMember(shopId, userId);
    const wanted = [...new Set(permissions)].sort();
    await this.db.transaction(async (tx) => {
      const before = (
        await tx
          .select({ p: shopMemberPermissions.permission })
          .from(shopMemberPermissions)
          .where(and(eq(shopMemberPermissions.shopId, shopId), eq(shopMemberPermissions.userId, userId)))
      )
        .map((r) => r.p)
        .sort();
      await tx.delete(shopMemberPermissions).where(and(eq(shopMemberPermissions.shopId, shopId), eq(shopMemberPermissions.userId, userId)));
      if (wanted.length) await tx.insert(shopMemberPermissions).values(wanted.map((permission) => ({ shopId, userId, permission, grantedBy: ownerId })));
      await this.audit.log(
        { actorType: 'user', actorId: ownerId, action: 'shop.member_permissions_changed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId, before, after: wanted } },
        tx,
      );
    });
    return this.list(shopId, apiBase);
  }

  /** Retirer un employé (ou annuler une invitation) : accès et permissions supprimés immédiatement. */
  async remove(ownerId: string, shopId: string, userId: string, meta: RequestMeta, apiBase: string) {
    await this.staffMember(shopId, userId);
    await this.db.transaction(async (tx) => {
      await tx.update(shopMembers).set({ revokedAt: new Date() }).where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId)));
      await tx.delete(shopMemberPermissions).where(and(eq(shopMemberPermissions.shopId, shopId), eq(shopMemberPermissions.userId, userId)));
      await this.audit.log({ actorType: 'user', actorId: ownerId, action: 'shop.member_removed', targetType: 'user', targetId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { shopId } }, tx);
    });
    return this.list(shopId, apiBase);
  }

  // ------------------------------------------------------------------------------------------------ Côté personne invitée

  async invitations(userId: string, apiBase: string) {
    const rows = await this.db
      .select({ m: shopMembers, s: shops })
      .from(shopMembers)
      .innerJoin(shops, eq(shops.id, shopMembers.shopId))
      .where(and(eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt), isNull(shopMembers.acceptedAt), inArray(shops.status, ['active', 'pending_verification', 'draft'])))
      .orderBy(asc(shopMembers.createdAt));
    const items = [];
    for (const { m, s } of rows) {
      items.push({ shop: { id: s.id, name: s.name, slug: s.slug, logoUrl: await this.avatar(s.logoKey, apiBase) }, invitedAt: m.createdAt });
    }
    return { items };
  }

  async answer(userId: string, birthDate: string, shopId: string, accept: boolean, meta: RequestMeta) {
    if (accept) await this.ages.assert('merchant', birthDate);
    const done = await this.db
      .update(shopMembers)
      .set(accept ? { acceptedAt: new Date() } : { revokedAt: new Date() })
      .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt), isNull(shopMembers.acceptedAt)))
      .returning({ userId: shopMembers.userId });
    if (!done.length) throw Errors.notFound('Invitation');
    await this.audit.log({ actorType: 'user', actorId: userId, action: accept ? 'shop.invitation_accepted' : 'shop.invitation_declined', targetType: 'shop', targetId: shopId, ip: meta.ip, userAgent: meta.userAgent });
    return { accepted: accept };
  }

  /** Membre actif (accepté) d'une boutique. */
  async isActiveMember(shopId: string, userId: string) {
    const [m] = await this.db
      .select({ x: shopMembers.userId })
      .from(shopMembers)
      .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt), isNotNull(shopMembers.acceptedAt)));
    return !!m;
  }
}
