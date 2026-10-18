import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { CreateLiveDto, CreateShopLiveDto, LiveCommentDto, LiveHeartsDto, PinProductDto, LiveGadgetsDto } from './dto';
import { LivesService } from './lives.service';

/** Lot 10 (prototype) — Lives sans service vidéo (mode démonstration). */
@ApiTags('Lives')
@ApiBearerAuth()
@Controller('v1')
export class LivesController {
  constructor(private readonly lives: LivesService) {}

  @Get('lives')
  @ApiOperation({ summary: 'Lives en cours et programmés (écran 39)' })
  list(@CurrentAuth() a: AuthContext) {
    return this.lives.list(a.userId);
  }

  @Post('lives')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Lancer ou programmer un Live simple (écran 44)' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateLiveDto, @ReqMeta() meta: RequestMeta) {
    return this.lives.create(a.userId, dto, null, meta);
  }

  @Post('shop/lives')
  @RequireSpace('merchant')
  @RequireShopPermission('owner')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Lancer ou programmer un Live vente de la boutique active (écran 40), article épinglé facultatif' })
  createForShop(@CurrentAuth() a: AuthContext, @Body() dto: CreateShopLiveDto, @ReqMeta() meta: RequestMeta) {
    return this.lives.create(a.userId, dto, a.space.id, meta);
  }

  @Get('lives/:id')
  @ApiOperation({ summary: 'Un Live' })
  detail(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.lives.detail(a.userId, id);
  }

  @Get('lives/:id/state')
  // Lu toutes les 2 s par chaque spectateur ; plusieurs téléphones peuvent partager une même adresse (opérateur, Wi-Fi).
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @ApiQuery({ name: 'after', required: false, description: 'Dernier commentaire déjà reçu' })
  @ApiQuery({ name: 'giftsAfter', required: false, description: 'Dernier cadeau déjà reçu' })
  @ApiOperation({ summary: 'État du Live, lu toutes les 2 secondes : spectateurs, cœurs, pièces, nouveaux commentaires et cadeaux' })
  state(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query('after') after?: string, @Query('giftsAfter') giftsAfter?: string) {
    const uuid = /^[0-9a-f-]{36}$/i;
    return this.lives.state(a.userId, id, after && uuid.test(after) ? after : undefined, giftsAfter && uuid.test(giftsAfter) ? giftsAfter : undefined);
  }

  @Post('lives/:id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Commencer un Live programmé' })
  start(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.lives.start(a.userId, id, meta);
  }

  @Post('lives/:id/end')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terminer (ou annuler s’il est programmé)' })
  end(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.lives.end(a.userId, id, meta);
  }

  @Put('lives/:id/pinned-product')
  @ApiOperation({ summary: 'Épingler un article publié de la boutique (Live vente)' })
  pin(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PinProductDto) {
    return this.lives.pin(a.userId, id, dto.productId);
  }

  @Put('lives/:id/gadgets')
  @ApiOperation({ summary: 'Gadgets Premium de l’hôte : message épinglé, ambiance de la scène' })
  gadgets(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LiveGadgetsDto) {
    return this.lives.gadgets(a.userId, id, dto);
  }

  @Post('lives/:id/comments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Commenter un Live en cours' })
  comment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LiveCommentDto) {
    return this.lives.comment(a.userId, id, dto.text);
  }

  @Delete('lives/:id/comments/:commentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retirer un commentaire de mon Live' })
  async hideComment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    await this.lives.hideComment(a.userId, id, commentId);
  }

  @Post('lives/:id/hearts')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envoyer des cœurs' })
  hearts(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LiveHeartsDto) {
    return this.lives.hearts(a.userId, id, dto.count);
  }
}
