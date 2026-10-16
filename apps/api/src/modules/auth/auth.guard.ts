import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { AppError, Errors } from '../../common/errors';
import { DB, Database } from '../../database/database.module';
import { users } from '../../database/schema';
import { SpacesService } from '../spaces/spaces.service';
import { ADMIN_ROUTE } from '../admin/admin.decorators';
import type { ShopPermission } from '../../database/schema';
import { AuthedRequest, IS_PUBLIC, REQUIRED_SHOP_PERMISSION, REQUIRED_SPACE, REQUIRED_STEP_UP, StepUpScope } from './auth.decorators';
import { SessionService, SpaceType } from './session.service';
import { StepUpService } from './step-up.service';

/**
 * Garde globale, appliquée à toutes les routes :
 *  1. jeton d'accès valide, session non révoquée, compte actif ;
 *  2. si la route l'exige, espace actif du bon type ET appartenance revérifiée en base ;
 *  3. si la route l'exige, permission dans la boutique active (7-A) ;
 *  4. si la route l'exige, autorisation d'opération sensible (step-up) consommée.
 */
/** Routes sans espace imposé encore ouvertes depuis l'espace livreur (compte, changement d'espace, support). */
export const COURIER_SPACE_OPEN = ['/v1/auth', '/v1/me', '/v1/reports'];

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly spaces: SpacesService,
    private readonly stepUp: StepUpService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    // Routes /admin : contrôlées par la garde d'administration (session admin + TOTP), jamais par un jeton de l'app.
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ROUTE, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    const claims = token ? this.sessions.verifyAccess(token) : null;
    if (!claims || !(await this.sessions.isAlive(claims.sid))) throw Errors.unauthenticated();

    const rows = await this.db.select({ status: users.status }).from(users).where(and(eq(users.id, claims.sub))).limit(1);
    if (rows[0]?.status !== 'active') throw Errors.unauthenticated();

    req.auth = { userId: claims.sub, sessionId: claims.sid, space: claims.space };

    const requiredSpace = this.reflector.getAllAndOverride<SpaceType>(REQUIRED_SPACE, targets);
    if (requiredSpace) {
      if (claims.space.type !== requiredSpace || !(await this.spaces.canUse(claims.sub, claims.space))) {
        throw Errors.forbidden("Cet espace n'est pas accessible avec ton compte.");
      }
    }

    // 7-E (L7-04) : depuis l'espace livreur, seules les routes de cet espace, du compte et du support sont ouvertes ;
    // le fil, les profils, la messagerie, les boutiques et les demandes de boutique restent fermés.
    if (!requiredSpace && claims.space.type === 'courier' && !COURIER_SPACE_OPEN.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      throw Errors.forbidden("Cette partie de BIM n'est pas accessible depuis l'espace livreur.");
    }

    // 7-A : permission de l'employé dans la boutique active (le propriétaire a tout), revérifiée en base.
    const shopPermission = this.reflector.getAllAndOverride<ShopPermission | 'owner'>(REQUIRED_SHOP_PERMISSION, targets);
    if (shopPermission) {
      if (claims.space.type !== 'merchant' || !(await this.spaces.hasShopPermission(claims.sub, claims.space.id, shopPermission))) {
        throw new AppError(
          'SHOP_PERMISSION_REQUIRED',
          shopPermission === 'owner' ? 'Seul le propriétaire de la boutique peut faire cette action.' : 'Le propriétaire de la boutique ne t’a pas donné cette permission.',
          HttpStatus.FORBIDDEN,
          { permission: shopPermission },
        );
      }
    }

    const scope = this.reflector.getAllAndOverride<StepUpScope>(REQUIRED_STEP_UP, targets);
    if (scope) {
      const stepUpToken = req.headers['x-step-up-token'];
      // Prise atomique (usage unique, même sous envois simultanés) ; rendue par StepUpReleaseInterceptor si la
      // requête est ensuite refusée (validation ou règle métier), car alors rien n'a été modifié (audit, défaut 2).
      req.stepUpGrantId = await this.stepUp.consume(claims.sub, claims.sid, scope, typeof stepUpToken === 'string' ? stepUpToken : '');
    }
    return true;
  }
}
