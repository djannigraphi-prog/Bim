/// <reference types="multer" />
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Errors } from '../../common/errors';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AuthContext, CurrentAuth, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { CouriersService } from './couriers.service';
import { CourierApplicationDto, CourierProfileDto, InviteCourierDto, RejectCourierDto } from './dto';

/** Lot 7-E — Devenir livreur (espace personnel) : demande vérifiée par l'équipe BIM, pièces chiffrées. */
@ApiTags('Livreurs')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/courier-application')
export class CourierApplicationController {
  constructor(private readonly couriers: CouriersService) {}

  @Get()
  @ApiOperation({ summary: 'Ma demande de compte livreur (étape, liste de contrôle)' })
  mine(@CurrentAuth() a: AuthContext) {
    return this.couriers.myApplication(a.userId);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Commencer une demande (âge minimum des livreurs, F15 : non décidé = fermé)' })
  apply(@CurrentAuth() a: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.couriers.apply(a.userId, meta);
  }

  @Patch()
  update(@CurrentAuth() a: AuthContext, @Body() dto: CourierApplicationDto) {
    return this.couriers.updateApplication(a.userId, dto);
  }

  @Put('documents/:kind')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Pièce d’identité (id_front, id_back) ou selfie : ré-encodée puis chiffrée' })
  upload(@CurrentAuth() a: AuthContext, @Param('kind') kind: string, @UploadedFile() photo: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta) {
    return this.couriers.uploadDocument(a.userId, kind, photo, meta);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentAuth() a: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.couriers.submit(a.userId, meta);
  }
}

/**
 * Lot 7-E — Espace livreur : profil de travail et relations avec les boutiques. Aucune commande de boutique ici
 * (L7-04) : annonces, courses acceptées et historique personnel arrivent avec 7-F.
 */
@ApiTags('Livreurs')
@ApiBearerAuth()
@RequireSpace('courier')
@Controller('v1/courier')
export class CourierSpaceController {
  constructor(private readonly couriers: CouriersService) {}

  @Get('me')
  me(@CurrentAuth() a: AuthContext) {
    return this.couriers.profile(a.space!.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Disponibilité, capacité, moyen de transport, communes desservies' })
  update(@CurrentAuth() a: AuthContext, @Body() dto: CourierProfileDto, @ReqMeta() meta: RequestMeta) {
    return this.couriers.updateProfile(a.userId, a.space!.id, dto, meta);
  }

  @Post('relations/:id/accept')
  @HttpCode(200)
  accept(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.couriers.answer(a.userId, a.space!.id, id, true, meta);
  }

  @Post('relations/:id/decline')
  @HttpCode(200)
  decline(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.couriers.answer(a.userId, a.space!.id, id, false, meta);
  }

  @Post('relations/:id/end')
  @HttpCode(200)
  end(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.couriers.endByCourier(a.userId, a.space!.id, id, meta);
  }
}

/** Lot 7-E — Livreurs de la boutique (permission « paramètres de livraison »). */
@ApiTags('Espace marchand')
@ApiBearerAuth()
@RequireSpace('merchant')
@Controller('v1/shop/couriers')
export class ShopCouriersController {
  constructor(private readonly couriers: CouriersService) {}

  @Get()
  @RequireShopPermission('deliveries.settings')
  list(@CurrentAuth() a: AuthContext) {
    return this.couriers.shopCouriers(a.space!.id);
  }

  @Post()
  @RequireShopPermission('deliveries.settings')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Proposer un emploi ou un partenariat à un livreur vérifié (il doit accepter)' })
  invite(@CurrentAuth() a: AuthContext, @Body() dto: InviteCourierDto, @ReqMeta() meta: RequestMeta) {
    return this.couriers.invite(a.userId, a.space!.id, dto.username, dto.relation, meta);
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequireShopPermission('deliveries.settings')
  @ApiOperation({ summary: 'Mettre fin à la relation (effet immédiat)' })
  end(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.couriers.endByShop(a.userId, a.space!.id, id, meta);
  }
}

@ApiTags('Administration — livreurs')
@Controller('admin/v1/courier-applications')
export class CourierReviewController {
  constructor(private readonly couriers: CouriersService) {}

  @Get()
  @AdminRoute('couriers.review')
  @ApiQuery({ name: 'stage', enum: ['submitted', 'active', 'to_correct'], required: false })
  list(@Query('stage') stage?: string) {
    return this.couriers.adminList(stage === 'active' || stage === 'to_correct' ? stage : 'submitted');
  }

  @Get(':id')
  @AdminRoute('couriers.review')
  detail(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.couriers.adminDetail(a, id, meta);
  }

  @Get(':id/documents/:kind')
  @AdminRoute('couriers.review')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Pièce d’identité ou selfie déchiffré (lecture inscrite au journal d’audit)' })
  async document(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    if (!['id_front', 'id_back', 'selfie'].includes(kind)) throw Errors.validation({ fields: { kind: ['Document inconnu.'] } });
    res.type('image/jpeg').send(await this.couriers.adminDocument(a, id, kind, meta));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @AdminRoute('couriers.review')
  approve(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.couriers.approve(a, id, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @AdminRoute('couriers.review')
  reject(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCourierDto, @ReqMeta() meta: RequestMeta) {
    return this.couriers.reject(a, id, dto.reason, meta);
  }
}
