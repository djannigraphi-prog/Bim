import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { Public } from '../auth/auth.decorators';
import { CommuneDto, CommuneStatusDto, DurationDto, QuoteQueryDto, SimulateDto, TariffDraftDto } from './dto';
import { TariffsService } from './tariffs.service';

/** 7-D — Communes desservables et devis de livraison, publics (aucune donnée personnelle). */
@ApiTags('Livraisons — tarifs')
@Controller('v1')
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  @Public()
  @Get('communes')
  @ApiOperation({ summary: 'Communes desservables (adresse de livraison)' })
  communes() {
    return this.tariffs.listCommunes();
  }

  @Public()
  @Get('shops/:shopId/delivery-quote')
  @ApiOperation({ summary: 'Frais de livraison par mode vers une commune, calculés par le serveur ; indisponible si commune, durée ou grille absente' })
  quote(@Param('shopId', ParseUUIDPipe) shopId: string, @Query() q: QuoteQueryDto) {
    return this.tariffs.quoteForShop(shopId, q.commune);
  }
}

/** 7-D — Administration des tarifs (permission dédiée `delivery_tariffs.write`, journalisée avant / après). */
@ApiTags('Administration')
@Controller('admin/v1/delivery')
export class TariffsAdminController {
  constructor(private readonly tariffs: TariffsService) {}

  @Get('communes')
  @AdminRoute('delivery_tariffs.read')
  communes() {
    return this.tariffs.listCommunes(true);
  }

  @Post('communes')
  @AdminRoute('delivery_tariffs.write')
  createCommune(@CurrentAdmin() a: AdminContext, @Body() dto: CommuneDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.createCommune(a, dto.city, dto.name, meta);
  }

  @Patch('communes/:code')
  @AdminRoute('delivery_tariffs.write')
  communeStatus(@CurrentAdmin() a: AdminContext, @Param('code') code: string, @Body() dto: CommuneStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.setCommuneActive(a, code, dto.active, meta);
  }

  @Get('durations')
  @AdminRoute('delivery_tariffs.read')
  durations() {
    return this.tariffs.listDurations();
  }

  @Put('durations')
  @AdminRoute('delivery_tariffs.write')
  @ApiOperation({ summary: 'Durée estimée d’un trajet entre deux communes pour un mode (null : retirer)' })
  setDuration(@CurrentAdmin() a: AdminContext, @Body() dto: DurationDto, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.setDuration(a, dto.fromCode, dto.toCode, dto.mode, dto.minutes, meta);
  }

  @Get('tariffs')
  @AdminRoute('delivery_tariffs.read')
  tariffsList() {
    return this.tariffs.listTariffs();
  }

  @Put('tariffs/draft')
  @AdminRoute('delivery_tariffs.write')
  @ApiOperation({ summary: 'Créer ou modifier le brouillon de grille d’un mode' })
  draft(@CurrentAdmin() a: AdminContext, @Body() dto: TariffDraftDto, @ReqMeta() meta: RequestMeta) {
    const { mode, ...v } = dto;
    return this.tariffs.saveDraft(a, mode, v, meta);
  }

  @Post('tariffs/:id/publish')
  @AdminRoute('delivery_tariffs.write')
  @ApiOperation({ summary: 'Publier un brouillon : grille en vigueur, immuable' })
  publish(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.publish(a, id, meta);
  }

  @Delete('tariffs/:id')
  @AdminRoute('delivery_tariffs.write')
  deleteDraft(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.tariffs.deleteDraft(a, id, meta);
  }

  @Post('tariffs/:id/simulate')
  @AdminRoute('delivery_tariffs.read')
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateDto) {
    return this.tariffs.simulate(id, dto.minutes);
  }
}
