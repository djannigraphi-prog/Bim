import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { DB, Database } from '../../database/database.module';
import { users } from '../../database/schema';
import { AuthContext, CurrentAuth, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { InviteMemberDto, MemberPermissionsDto } from './dto';
import { ShopTeamService } from './shop-team.service';

/** Lot 7-A — Équipe de la boutique : réservée au propriétaire (A16). */
@ApiTags('Équipe de la boutique')
@ApiBearerAuth()
@RequireSpace('merchant')
@RequireShopPermission('owner')
@Controller('v1/shop/team')
export class ShopTeamController {
  constructor(private readonly team: ShopTeamService) {}

  @Get()
  @ApiOperation({ summary: 'L’équipe : propriétaire, employés et invitations, avec leurs permissions' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.team.list(a.space.id, apiBase(req));
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Inviter une personne (aucun accès avant son accord, aucune permission par défaut)' })
  invite(@CurrentAuth() a: AuthContext, @Body() dto: InviteMemberDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.team.invite(a.userId, a.space.id, dto.username, meta, apiBase(req));
  }

  @Put(':userId/permissions')
  @ApiOperation({ summary: 'Permissions d’un employé (ensemble complet)' })
  permissions(@CurrentAuth() a: AuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: MemberPermissionsDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.team.setPermissions(a.userId, a.space.id, userId, dto.permissions, meta, apiBase(req));
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Retirer un employé ou annuler une invitation' })
  remove(@CurrentAuth() a: AuthContext, @Param('userId', ParseUUIDPipe) userId: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.team.remove(a.userId, a.space.id, userId, meta, apiBase(req));
  }
}

/** Lot 7-A — Invitations reçues (espace utilisateur). */
@ApiTags('Équipe de la boutique')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/shop-invitations')
export class ShopInvitationsController {
  constructor(
    private readonly team: ShopTeamService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Invitations à rejoindre l’équipe d’une boutique' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.team.invitations(a.userId, apiBase(req));
  }

  private async birthDate(userId: string) {
    const [u] = await this.db.select({ b: users.birthDate }).from(users).where(eq(users.id, userId));
    return u.b;
  }

  @Post(':shopId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter : la boutique apparaît dans mes espaces' })
  async accept(@CurrentAuth() a: AuthContext, @Param('shopId', ParseUUIDPipe) shopId: string, @ReqMeta() meta: RequestMeta) {
    return this.team.answer(a.userId, await this.birthDate(a.userId), shopId, true, meta);
  }

  @Post(':shopId/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser l’invitation' })
  async decline(@CurrentAuth() a: AuthContext, @Param('shopId', ParseUUIDPipe) shopId: string, @ReqMeta() meta: RequestMeta) {
    return this.team.answer(a.userId, await this.birthDate(a.userId), shopId, false, meta);
  }
}
