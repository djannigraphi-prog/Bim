import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DB, Database } from '../../database/database.module';
import { courierAccounts, shopMembers, shops, users } from '../../database/schema';
import type { ActiveSpace } from '../auth/session.service';

export interface SpaceSummary {
  type: 'user' | 'merchant' | 'courier';
  id: string;
  label: string;
  status: string;
  /** Vrai si l'espace peut être activé maintenant (boutique active, compte livreur actif). */
  usable: boolean;
}

/**
 * Espaces d'une personne (écran 53 « Changer de profil »).
 * Règle : le serveur seul décide si un espace est accessible ; connaître l'identifiant d'une boutique ne donne aucun droit.
 */
@Injectable()
export class SpacesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(userId: string): Promise<SpaceSummary[]> {
    const me = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
    const out: SpaceSummary[] = [{ type: 'user', id: userId, label: me[0]?.fullName ?? '', status: 'active', usable: true }];

    const myShops = await this.db
      .select({ id: shops.id, name: shops.name, status: shops.status })
      .from(shopMembers)
      .innerJoin(shops, eq(shops.id, shopMembers.shopId))
      .where(and(eq(shopMembers.userId, userId), isNull(shopMembers.revokedAt), inArray(shops.status, ['draft', 'pending_verification', 'active', 'suspended'])));
    for (const s of myShops) out.push({ type: 'merchant', id: s.id, label: s.name, status: s.status, usable: s.status === 'active' });

    const courier = await this.db.select().from(courierAccounts).where(eq(courierAccounts.userId, userId)).limit(1);
    if (courier[0] && courier[0].status !== 'closed') {
      out.push({ type: 'courier', id: courier[0].id, label: 'Compte livreur', status: courier[0].status, usable: courier[0].status === 'active' });
    }
    return out;
  }

  async canUse(userId: string, space: ActiveSpace): Promise<boolean> {
    if (space.type === 'user') return space.id === userId;
    if (space.type === 'merchant') {
      const rows = await this.db
        .select({ id: shops.id })
        .from(shopMembers)
        .innerJoin(shops, eq(shops.id, shopMembers.shopId))
        .where(and(eq(shopMembers.userId, userId), eq(shopMembers.shopId, space.id), isNull(shopMembers.revokedAt), eq(shops.status, 'active')))
        .limit(1);
      return rows.length === 1;
    }
    const rows = await this.db
      .select({ id: courierAccounts.id })
      .from(courierAccounts)
      .where(and(eq(courierAccounts.id, space.id), eq(courierAccounts.userId, userId), eq(courierAccounts.status, 'active')))
      .limit(1);
    return rows.length === 1;
  }
}
