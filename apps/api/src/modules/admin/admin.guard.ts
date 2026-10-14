import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../../common/errors';
import { ADMIN_PERMISSION, ADMIN_ROUTE, AdminRequest } from './admin.decorators';
import { AdminAuthService } from './admin-auth.service';
import { ADMIN_PERMISSIONS, AdminPermission } from './permissions';

/** Garde globale des routes /admin : session d'administration valide (après TOTP), compte actif, permission. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(ADMIN_ROUTE, targets)) return true;
    const permission = this.reflector.getAllAndOverride<AdminPermission | 'authenticated' | null>(ADMIN_PERMISSION, targets);
    if (permission === null) return true;

    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const admin = await this.auth.authenticate(token);
    if (!admin) throw Errors.unauthenticated();
    req.admin = admin;
    if (permission !== 'authenticated' && !(ADMIN_PERMISSIONS[permission] as readonly string[]).some((r) => admin.roles.includes(r))) {
      throw Errors.forbidden("Ton rôle d'administration ne permet pas cette action.");
    }
    return true;
  }
}
