import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { OfferDto, ReceiveOffersDto } from './dto';
import { OffersService } from './offers.service';

/** Lot 5-D — Espace marchand : demandes de projet anonymisées et offres (écran 55, « Demandes »). */
@ApiTags('Espace marchand')
@ApiBearerAuth()
@RequireSpace('merchant')
// 7-A (A16) : les demandes et offres de projet ne figurent pas parmi les permissions des employés : propriétaire seul.
@RequireShopPermission('owner')
@Controller('v1/shop')
export class ShopOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get('project-requests')
  @ApiOperation({ summary: 'Demandes de projet anonymisées des rubriques de la boutique' })
  requests(@CurrentAuth() a: AuthContext) {
    return this.offers.requests(a.space!.id);
  }

  @Post('project-requests/:projectId/offers')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Faire une offre (une par projet ; 3 articles au plus ; limite quotidienne)' })
  offer(@CurrentAuth() a: AuthContext, @Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: OfferDto, @ReqMeta() meta: RequestMeta) {
    return this.offers.createOffer(a.space!.id, a.userId, projectId, dto, meta);
  }

  @Get('offers')
  @ApiOperation({ summary: 'Offres envoyées et leur suite (refusée, retirée)' })
  sent(@CurrentAuth() a: AuthContext) {
    return this.offers.shopOffers(a.space!.id);
  }

  @Delete('offers/:id')
  @ApiOperation({ summary: 'Retirer une offre' })
  withdraw(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.withdraw(a.space!.id, id);
  }
}

/** Lot 5-D — Offres reçues pour un projet (écran 49) et recommandations Premium (écran 24). */
@ApiTags('Projets')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/projects')
export class ProjectOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get(':id/offers')
  @ApiOperation({ summary: 'Offres des marchands pour mon projet' })
  list(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.offers.projectOffers(a.userId, id, apiBase(req));
  }

  @Post(':id/offers/:offerId/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une offre (la boutique ne pourra plus en faire pour ce projet)' })
  decline(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.offers.decline(a.userId, id, offerId);
  }

  @Put(':id/merchant-offers')
  @ApiOperation({ summary: 'Recevoir ou ne plus recevoir les offres des marchands' })
  receive(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveOffersDto) {
    return this.offers.setReceive(a.userId, id, dto.receive);
  }

  @Get(':id/recommendations')
  @ApiOperation({ summary: '« Recommandé pour toi » : articles du BimShop liés au projet (projets Premium)' })
  recommendations(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.offers.recommendations(a.userId, id, apiBase(req));
  }
}
