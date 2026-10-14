import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AdminPermission } from './permissions';

export const ADMIN_ROUTE = 'bim:adminRoute';
export const ADMIN_PERMISSION = 'bim:adminPermission';

/**
 * Route d'administration : la garde des utilisateurs de l'app ne s'applique pas ; la garde admin exige
 * une session d'administration (mot de passe + TOTP) et, si indiqué, une permission.
 * `permission: null` = route admin publique (connexion).
 */
export const AdminRoute = (permission?: AdminPermission | null) =>
  applyDecorators(SetMetadata(ADMIN_ROUTE, true), SetMetadata(ADMIN_PERMISSION, permission === undefined ? 'authenticated' : permission), ApiBearerAuth());

export interface AdminContext {
  adminId: string;
  sessionId: string;
  email: string;
  roles: string[];
}

export type AdminRequest = Request & { admin?: AdminContext };

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  const req = ctx.switchToHttp().getRequest<AdminRequest>();
  if (!req.admin) throw new Error('CurrentAdmin utilisé sur une route admin publique');
  return req.admin;
});
