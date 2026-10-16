/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { QuickReplyDto, SendMessageDto } from './dto';
import { ShopInboxBox, ShopInboxService } from './shop-inbox.service';

const BOXES: ShopInboxBox[] = ['all', 'unread', 'archived', 'marked'];

/** Lot 6-B — Boîte de la boutique (écran 51) et conversations côté boutique (écran 48). Espace boutique uniquement. */
@ApiTags('Messages de la boutique')
@ApiBearerAuth()
@RequireSpace('merchant')
@Controller('v1/shop/inbox')
export class ShopInboxController {
  constructor(private readonly inbox: ShopInboxService) {}

  @Get()
  @ApiQuery({ name: 'box', required: false, enum: BOXES })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Conversations de la boutique : Tous, Non lus, Archivés, Marqués' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('box') box?: string, @Query('cursor') cursor?: string) {
    return this.inbox.list(a.space.id, BOXES.includes(box as ShopInboxBox) ? (box as ShopInboxBox) : 'all', cursor, apiBase(req));
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Conversations non lues par la boutique' })
  unread(@CurrentAuth() a: AuthContext) {
    return this.inbox.unreadCount(a.space.id);
  }

  @Get('quick-replies')
  @ApiOperation({ summary: 'Réponses rapides de la boutique' })
  quickReplies(@CurrentAuth() a: AuthContext) {
    return this.inbox.quickReplies(a.space.id);
  }

  @Post('quick-replies')
  @ApiOperation({ summary: 'Ajouter une réponse rapide (10 au plus)' })
  addQuickReply(@CurrentAuth() a: AuthContext, @Body() dto: QuickReplyDto) {
    return this.inbox.addQuickReply(a.space.id, dto.text);
  }

  @Delete('quick-replies/:id')
  @ApiOperation({ summary: 'Retirer une réponse rapide' })
  removeQuickReply(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.removeQuickReply(a.space.id, id);
  }

  @Delete('messages/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer un message de la boutique (son auteur ou le propriétaire)' })
  async remove(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.inbox.deleteMessage(a.userId, a.space.id, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Une conversation : la cliente, l’article ou l’offre dont on parle, les non-lus' })
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inbox.summary(a.space.id, id, apiBase(req));
  }

  @Get(':id/messages')
  @ApiQuery({ name: 'before', required: false, description: 'Identifiant du plus ancien message déjà affiché' })
  @ApiOperation({ summary: 'Messages, du plus récent au plus ancien' })
  messages(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Query('before') before?: string) {
    return this.inbox.messages(a.space.id, id, before, apiBase(req));
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { text: { type: 'string', maxLength: 2000 }, photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Répondre au nom de la boutique (texte ou photo ré-encodée sans métadonnées)' })
  send(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
  ) {
    return this.inbox.send(a.userId, a.space.id, id, { text: dto.text, photo }, meta, apiBase(req));
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Conversation lue par la boutique (« Vu » chez la cliente)' })
  read(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.read(a.space.id, id);
  }

  @Put(':id/archive')
  @ApiOperation({ summary: 'Archiver (revient dans « Tous » au prochain message de la cliente)' })
  archive(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inbox.setArchived(a.space.id, id, true, apiBase(req));
  }

  @Delete(':id/archive')
  @ApiOperation({ summary: 'Sortir des archives' })
  unarchive(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inbox.setArchived(a.space.id, id, false, apiBase(req));
  }

  @Put(':id/mark')
  @ApiOperation({ summary: 'Marquer la conversation (à suivre)' })
  mark(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inbox.setMarked(a.space.id, id, true, apiBase(req));
  }

  @Delete(':id/mark')
  @ApiOperation({ summary: 'Retirer la marque' })
  unmark(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inbox.setMarked(a.space.id, id, false, apiBase(req));
  }
}
