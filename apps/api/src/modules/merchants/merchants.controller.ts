/// <reference types="multer" />
import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Errors } from '../../common/errors';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AuthContext, CurrentAuth } from '../auth/auth.decorators';
import { CreateApplicationDto, PayoutNumberDto, RejectApplicationDto, UpdateApplicationDto, VerifyPayoutDto } from './dto';
import { MerchantsService } from './merchants.service';

/** Lot 5-A — Ouvrir une boutique (écrans 07 à 09) : demande vérifiée par l'équipe BIM. */
@ApiTags('Marchands')
@ApiBearerAuth()
@Controller('v1/merchant/applications')
export class MerchantApplicationsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Ma demande d’ouverture de boutique (statut et liste de contrôle, écran 09)' })
  mine(@CurrentAuth() a: AuthContext) {
    return this.merchants.mine(a.userId);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Commencer une demande : la boutique (nom, ville, présentation). Âge minimum des marchands appliqué (F15).' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateApplicationDto, @ReqMeta() meta: RequestMeta) {
    return this.merchants.create(a.userId, dto, meta);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier la demande (boutique, type de pièce, adresse)' })
  update(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApplicationDto) {
    return this.merchants.update(a.userId, id, dto);
  }

  @Put(':id/documents/:kind')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Pièce d’identité (id_front, id_back) ou selfie : ré-encodée puis chiffrée' })
  upload(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @UploadedFile() photo: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta) {
    return this.merchants.uploadDocument(a.userId, id, kind, photo, meta);
  }

  @Post(':id/payout-number')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Numéro Mobile Money de la boutique : un code est envoyé par SMS' })
  startPayout(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayoutNumberDto, @ReqMeta() meta: RequestMeta) {
    return this.merchants.startPayout(a.userId, id, dto, meta.ip ?? null);
  }

  @Post(':id/payout-number/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Confirmer le numéro Mobile Money avec le code reçu' })
  verifyPayout(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPayoutDto, @ReqMeta() meta: RequestMeta) {
    return this.merchants.verifyPayout(a.userId, id, dto.challengeId, dto.code, meta);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envoyer pour validation par l’équipe BIM' })
  submit(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.merchants.submit(a.userId, id, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Abandonner une demande non validée (pièces effacées)' })
  withdraw(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.merchants.withdraw(a.userId, id, meta);
  }
}

@ApiTags('Administration — marchands')
@Controller('admin/v1/merchant-applications')
export class MerchantReviewController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @AdminRoute('merchants.review')
  @ApiQuery({ name: 'status', enum: ['submitted', 'approved', 'rejected'], required: false })
  @ApiOperation({ summary: 'Demandes d’ouverture de boutique' })
  list(@Query('status') status?: string) {
    return this.merchants.adminList(['approved', 'rejected'].includes(status ?? '') ? status! : 'submitted');
  }

  @Get(':id')
  @AdminRoute('merchants.review')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.adminDetail(id);
  }

  @Get(':id/documents/:kind')
  @AdminRoute('merchants.review')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Pièce d’identité ou selfie déchiffré (lecture inscrite au journal d’audit)' })
  async document(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    if (!['id_front', 'id_back', 'selfie'].includes(kind)) throw Errors.validation({ fields: { kind: ['Document inconnu.'] } });
    res.type('image/jpeg').send(await this.merchants.adminDocument(a, id, kind, meta));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @AdminRoute('merchants.review')
  @ApiOperation({ summary: 'Valider : la boutique est ouverte' })
  approve(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.merchants.approve(a, id, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @AdminRoute('merchants.review')
  @ApiOperation({ summary: 'Refuser avec un motif (la personne corrige et renvoie)' })
  reject(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectApplicationDto, @ReqMeta() meta: RequestMeta) {
    return this.merchants.reject(a, id, dto.reason, meta);
  }
}
