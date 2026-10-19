/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { AddGroupMembersDto, CreateGroupDto, ReactionDto, RenameGroupDto, SendMessageDto, StartConversationDto, StartShopConversationDto } from './dto';
import { MessagingService } from './messaging.service';

/** Lot 6-A — Messagerie entre personnes (écran 47) ; 6-B : conversations avec une boutique, côté cliente. Espace utilisateur ; aucune notification sur le téléphone. */
@ApiTags('Messages')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  @ApiQuery({ name: 'box', required: false, enum: ['inbox', 'requests'] })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Conversations (« Tous ») ou demandes, la plus récente d’abord' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('box') box?: string, @Query('cursor') cursor?: string) {
    return this.messaging.list(a.userId, box === 'requests' ? 'requests' : 'inbox', cursor, apiBase(req));
  }

  @Get('conversations/unread-count')
  @ApiOperation({ summary: 'Pastille de l’onglet Messages : conversations non lues, demandes en attente' })
  unread(@CurrentAuth() a: AuthContext) {
    return this.messaging.unreadCount(a.userId);
  }

  @Post('conversations')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Ouvrir ou retrouver la conversation avec une personne' })
  start(@CurrentAuth() a: AuthContext, @Body() dto: StartConversationDto, @Req() req: Request) {
    return this.messaging.start(a.userId, dto.username, apiBase(req));
  }

  @Post('conversations/shop')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Écrire à une boutique (« Discuter ») : ouvre ou retrouve la conversation, avec l’article ou l’offre dont on parle' })
  startWithShop(@CurrentAuth() a: AuthContext, @Body() dto: StartShopConversationDto, @Req() req: Request) {
    return this.messaging.startWithShop(a.userId, dto, apiBase(req));
  }

  @Get('conversations/:id/messages')
  @ApiQuery({ name: 'before', required: false, description: 'Identifiant du plus ancien message déjà affiché' })
  @ApiOperation({ summary: 'Messages, du plus récent au plus ancien' })
  messages(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Query('before') before?: string) {
    return this.messaging.messages(a.userId, id, before, apiBase(req));
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileFieldsInterceptor([{ name: 'photo', maxCount: 1 }, { name: 'voice', maxCount: 1 }], { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 2000 }, photo: { type: 'string', format: 'binary' }, voice: { type: 'string', format: 'binary', description: 'Message vocal M4A (AAC), 2 minutes au plus' }, replyToId: { type: 'string', format: 'uuid' }, productId: { type: 'string', format: 'uuid', description: 'Article du BimShop partagé' } },
    },
  })
  @ApiOperation({ summary: 'Envoyer un texte, une photo (ré-encodée sans métadonnées) ou un message vocal, en citant éventuellement un message' })
  send(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @UploadedFiles() files: { photo?: Express.Multer.File[]; voice?: Express.Multer.File[] } | undefined,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
  ) {
    return this.messaging.send(a.userId, id, { text: dto.text, photo: files?.photo?.[0], voice: files?.voice?.[0], productId: dto.productId, replyToId: dto.replyToId }, meta, apiBase(req));
  }

  @Post('conversations/groups')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Créer un groupe (18 ans et plus, 32 personnes au plus) ; renvoie les personnes non ajoutées, sans motif' })
  createGroup(@CurrentAuth() a: AuthContext, @Body() dto: CreateGroupDto, @Req() req: Request) {
    return this.messaging.createGroup(a.userId, dto, apiBase(req));
  }

  @Get('conversations/:id/members')
  @ApiOperation({ summary: 'Membres d’un groupe (actifs et invités)' })
  members(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.messaging.groupMembers(a.userId, id, apiBase(req));
  }

  @Post('conversations/:id/members')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Ajouter des personnes à un groupe (administrateur)' })
  addMembers(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddGroupMembersDto, @Req() req: Request) {
    return this.messaging.addGroupMembers(a.userId, id, dto.usernames, apiBase(req));
  }

  @Delete('conversations/:id/members/:username')
  @ApiOperation({ summary: 'Retirer une personne d’un groupe (administrateur)' })
  removeMember(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('username') username: string) {
    return this.messaging.leaveGroup(a.userId, id, username.slice(0, 40));
  }

  @Post('conversations/:id/leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Quitter un groupe' })
  leave(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.leaveGroup(a.userId, id);
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: 'Renommer un groupe (administrateur)' })
  rename(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameGroupDto, @Req() req: Request) {
    return this.messaging.renameGroup(a.userId, id, dto.title, apiBase(req));
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Conversation lue (« Vu » chez l’autre personne)' })
  read(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.read(a.userId, id);
  }

  @Post('conversations/:id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter une demande' })
  accept(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.messaging.accept(a.userId, id, apiBase(req));
  }

  @Post('conversations/:id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une demande (l’autre personne n’est pas avertie)' })
  decline(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.decline(a.userId, id);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Une conversation : la personne, le statut (demande ou non), les non-lus' })
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.messaging.summary(a.userId, id, apiBase(req));
  }

  @Put('messages/:id/reaction')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Réagir à un message (une réaction par personne, remplace la précédente)' })
  react(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactionDto, @Req() req: Request) {
    return this.messaging.react(a.userId, id, dto.emoji, apiBase(req));
  }

  @Delete('messages/:id/reaction')
  @ApiOperation({ summary: 'Retirer ma réaction' })
  unreact(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.messaging.react(a.userId, id, null, apiBase(req));
  }

  @Delete('messages/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer mon message (« Message supprimé » chez les deux)' })
  async remove(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.messaging.deleteMessage(a.userId, id);
  }
}
