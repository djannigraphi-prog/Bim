import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ShopPermission } from '../../database/schema';
import type { ActiveSpace, SpaceType } from './session.service';

export const IS_PUBLIC = 'bim:isPublic';
export const REQUIRED_SPACE = 'bim:requiredSpace';
export const REQUIRED_STEP_UP = 'bim:requiredStepUp';
export const REQUIRED_SHOP_PERMISSION = 'bim:requiredShopPermission';

/** Route accessible sans connexion (visiteur, écran 06). Par défaut, toutes les routes exigent une session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Exige que l'espace actif soit d'un type donné ; l'appartenance est revérifiée en base à chaque requête. */
export const RequireSpace = (type: SpaceType) => SetMetadata(REQUIRED_SPACE, type);

/**
 * 7-A (A16) — Exige une permission dans la boutique active (espace boutique obligatoire) : le propriétaire a tout, un
 * employé seulement ce que le propriétaire lui a accordé ; `owner` = réservé au propriétaire. Revérifié à chaque requête.
 */
export const RequireShopPermission = (permission: ShopPermission | 'owner') => SetMetadata(REQUIRED_SHOP_PERMISSION, permission);

/** Opérations sensibles listées ici ; chaque nouvelle opération (ex. retrait au lot 9) s'y ajoute. */
export const STEP_UP_SCOPES = ['contact_change', 'password_change', 'account_deletion', 'withdrawal'] as const;
export type StepUpScope = (typeof STEP_UP_SCOPES)[number];

/** Exige une confirmation récente (mot de passe + code) via l'en-tête X-Step-Up-Token, valable une seule fois. */
export const RequireStepUp = (scope: StepUpScope) => SetMetadata(REQUIRED_STEP_UP, scope);

export interface AuthContext {
  userId: string;
  sessionId: string;
  space: ActiveSpace;
}

export type AuthedRequest = Request & {
  auth?: AuthContext;
  /** Confirmation d'identité prise par la garde pour cette requête ; rendue si l'opération est refusée (4xx). */
  stepUpGrantId?: string;
};

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('CurrentAuth utilisé sur une route publique');
  return req.auth;
});
