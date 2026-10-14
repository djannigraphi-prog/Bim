import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { Errors } from '../../common/errors';
import { DB, Database } from '../../database/database.module';
import { users } from '../../database/schema';
import { SpacesService } from '../spaces/spaces.service';
import { AuthedRequest, IS_PUBLIC, REQUIRED_SPACE, REQUIRED_STEP_UP, StepUpScope } from './auth.decorators';
import { SessionService, SpaceType } from './session.service';
import { StepUpService } from './step-up.service';

/**
 * Garde globale, appliquée à toutes les routes :
 *  1. jeton d'accès valide, session non révoquée, compte actif ;
 *  2. si la route l'exige, espace actif du bon type ET appartenance revérifiée en base ;
 *  3. si la route l'exige, autorisation d'opération sensible (step-up) consommée.
 */
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

    const scope = this.reflector.getAllAndOverride<StepUpScope>(REQUIRED_STEP_UP, targets);
    if (scope) {
      const stepUpToken = req.headers['x-step-up-token'];
      await this.stepUp.consume(claims.sub, claims.sid, scope, typeof stepUpToken === 'string' ? stepUpToken : '');
    }
    return true;
  }
}
