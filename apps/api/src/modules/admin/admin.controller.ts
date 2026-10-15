import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AdminContext, AdminRoute, CurrentAdmin } from './admin.decorators';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import {
  AdminLoginDto,
  AdminLoginTokenDto,
  AdminTotpDto,
  CategoryDto,
  GoalDto,
  CreateAdminDto,
  ProgramDto,
  ResolveReportDto,
  PublishProgramDto,
  UpdateAdminDto,
  UpdateSettingDto,
  UserStatusDto,
} from './dto';

@ApiTags('Administration — connexion')
@Controller('admin/v1/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @AdminRoute(null)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Étape 1 : e-mail et mot de passe → jeton d’étape ; la suite exige un code TOTP' })
  login(@Body() dto: AdminLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(dto.email, dto.password, meta);
  }

  @Post('totp/enrollment')
  @HttpCode(200)
  @AdminRoute(null)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Première connexion : secret à scanner dans une application d’authentification' })
  enrollment(@Body() dto: AdminLoginTokenDto) {
    return this.auth.enrollment(dto.loginToken);
  }

  @Post('totp/verify')
  @HttpCode(200)
  @AdminRoute(null)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Étape 2 : code à 6 chiffres → session d’administration' })
  verify(@Body() dto: AdminTotpDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verify(dto.loginToken, dto.code, meta);
  }

  @Get('me')
  @AdminRoute()
  me(@CurrentAdmin() a: AdminContext) {
    return this.auth.profile(a.adminId);
  }

  @Post('logout')
  @HttpCode(204)
  @AdminRoute()
  async logout(@CurrentAdmin() a: AdminContext, @ReqMeta() meta: RequestMeta) {
    await this.auth.logout(a, meta);
  }
}

@ApiTags('Administration')
@Controller('admin/v1')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('settings')
  @AdminRoute('settings.read')
  @ApiOperation({ summary: 'Réglages métier (âges F15, projets…) avec leur statut de décision' })
  settings() {
    return this.admin.listSettings();
  }

  @Put('settings/:key')
  @AdminRoute('settings.write')
  @ApiOperation({ summary: 'Modifier un réglage existant (valeur contrôlée, journalisé avec avant/après)' })
  updateSetting(@CurrentAdmin() a: AdminContext, @Param('key') key: string, @Body() dto: UpdateSettingDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.updateSetting(a, key, dto, meta);
  }

  @Get('audit-logs')
  @AdminRoute('audit.read')
  @ApiOperation({ summary: 'Journal d’audit (lecture seule), du plus récent au plus ancien' })
  audit(@Query('action') action?: string, @Query('actorId') actorId?: string, @Query('targetId') targetId?: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.admin.listAudit({ action, actorId, targetId, before, limit: limit ? Number(limit) : undefined });
  }

  @Get('users')
  @AdminRoute('users.read')
  @ApiOperation({ summary: 'Rechercher un compte (nom d’utilisateur, nom, téléphone, e-mail) ; journalisé' })
  users(@CurrentAdmin() a: AdminContext, @Query('q') q: string, @ReqMeta() meta: RequestMeta) {
    return this.admin.searchUsers(a, q ?? '', meta);
  }

  @Get('users/:id')
  @AdminRoute('users.read')
  user(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.admin.userDetail(a, id, meta);
  }

  @Patch('users/:id/status')
  @AdminRoute('users.suspend')
  @ApiOperation({ summary: 'Suspendre ou réactiver un compte (motif obligatoire ; la suspension ferme les sessions)' })
  userStatus(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.setUserStatus(a, id, dto.status, dto.reason, meta);
  }

  @Get('programs')
  @AdminRoute('programs.read')
  @ApiOperation({ summary: 'Programmes types (C7) : brouillons, publiés, archivés' })
  programs() {
    return this.admin.listPrograms();
  }

  @Post('programs')
  @AdminRoute('programs.write')
  createProgram(@CurrentAdmin() a: AdminContext, @Body() dto: ProgramDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.createProgram(a, dto, meta);
  }

  @Put('programs/:id')
  @AdminRoute('programs.write')
  updateProgram(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgramDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.updateProgram(a, id, dto, meta);
  }

  @Post('programs/:id/publish')
  @HttpCode(200)
  @AdminRoute('programs.publish')
  @ApiOperation({ summary: 'Publier un brouillon validé par une personne compétente (nom obligatoire)' })
  publish(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishProgramDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.publishProgram(a, id, dto.validatedBy, meta);
  }

  @Post('programs/:id/archive')
  @HttpCode(200)
  @AdminRoute('programs.write')
  archive(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.admin.archiveProgram(a, id, meta);
  }

  @Get('reports')
  @AdminRoute('reports.read')
  @ApiOperation({ summary: 'Signalements des projets (écran 27), à traiter ou traités' })
  reports(@Req() req: Request, @Query('status') status?: string) {
    return this.admin.listReports(status === 'resolved' ? 'resolved' : 'open', `${req.protocol}://${req.get('host')}`);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  @AdminRoute('reports.resolve')
  @ApiOperation({ summary: 'Clore un signalement avec la réponse donnée à la personne' })
  resolveReport(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.resolveReport(a, id, dto.resolution, meta);
  }

  @Get('catalog')
  @AdminRoute('programs.read')
  @ApiOperation({ summary: 'Catégories et objectifs de projet, y compris inactifs (écrans 20 et 21)' })
  catalog() {
    return this.admin.adminCatalog();
  }

  @Post('categories')
  @AdminRoute('catalog.write')
  createCategory(@CurrentAdmin() a: AdminContext, @Body() dto: CategoryDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.createCategory(a, dto, meta);
  }

  @Patch('categories/:code')
  @AdminRoute('catalog.write')
  updateCategory(@CurrentAdmin() a: AdminContext, @Param('code') code: string, @Body() dto: CategoryDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.updateCategory(a, code, dto, meta);
  }

  @Post('goals')
  @AdminRoute('catalog.write')
  createGoal(@CurrentAdmin() a: AdminContext, @Body() dto: GoalDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.createGoal(a, dto, meta);
  }

  @Patch('goals/:code')
  @AdminRoute('catalog.write')
  updateGoal(@CurrentAdmin() a: AdminContext, @Param('code') code: string, @Body() dto: GoalDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.updateGoal(a, code, dto, meta);
  }

  @Get('admins')
  @AdminRoute('admins.manage')
  admins() {
    return this.admin.listAdmins();
  }

  @Post('admins')
  @AdminRoute('admins.manage')
  createAdmin(@CurrentAdmin() a: AdminContext, @Body() dto: CreateAdminDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.createAdmin(a, dto, meta);
  }

  @Patch('admins/:id')
  @AdminRoute('admins.manage')
  updateAdmin(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto, @ReqMeta() meta: RequestMeta) {
    return this.admin.updateAdmin(a, id, dto, meta);
  }
}
