/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Errors } from '../../common/errors';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AuthContext, CurrentAuth, Public } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { CreateBimPostDto, CreateCommentDto, CreatePostDto, ReportContentDto, ResolveContentReportDto, VISIBILITIES } from './dto';
import { ModerationService } from './moderation.service';
import { PeopleService } from './people.service';
import { MAX_POST_IMAGES, PostsService } from './posts.service';
import { StoriesService } from './stories.service';

const UPLOAD_LIMIT = 25 * 1024 * 1024; // taille réelle contrôlée par le service (MEDIA_MAX_UPLOAD_MB), message clair

/** Lot 4 — Social : fil, publications, « J'ai fait mon BIM », j'aime, commentaires, profils, abonnements, blocages. */
@ApiTags('Social')
@ApiBearerAuth()
@Controller('v1')
export class SocialController {
  constructor(
    private readonly posts: PostsService,
    private readonly people: PeopleService,
    private readonly stories: StoriesService,
  ) {}

  @Public()
  @Get('public/feed')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Fil des visiteurs sans compte (écran 06) : publications « Tout le monde », en lecture' })
  publicFeed(@Req() req: Request, @Query('cursor') cursor?: string) {
    return this.posts.publicFeed(this.cursor(cursor), apiBase(req));
  }

  @Get('stories')
  @ApiOperation({ summary: 'Stories (écran 10) : les miennes et celles des personnes suivies, 24 heures' })
  storyTray(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.stories.tray(a.userId, apiBase(req));
  }

  @Post('stories')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: UPLOAD_LIMIT, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Publier une story (photo, visible 24 h par mes abonnés)' })
  createStory(@CurrentAuth() a: AuthContext, @UploadedFile() photo: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta) {
    return this.stories.create(a.userId, photo, meta);
  }

  @Put('stories/:id/view')
  @HttpCode(204)
  @ApiOperation({ summary: 'Story vue (anneau gris)' })
  viewStory(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.stories.markSeen(a.userId, id);
  }

  @Delete('stories/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer ma story' })
  removeStory(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.stories.remove(a.userId, id, meta);
  }

  @Get('feed')
  @ApiQuery({ name: 'tab', enum: ['for_you', 'following'], required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Fil « Pour toi » ou « Abonnés » (écran 10), 20 publications par page' })
  feed(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('tab') tab?: string, @Query('cursor') cursor?: string) {
    return this.posts.feed(a.userId, tab === 'following' ? 'following' : 'for_you', this.cursor(cursor), apiBase(req));
  }

  @Post('posts')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseInterceptors(FilesInterceptor('images', MAX_POST_IMAGES + 1, { limits: { fileSize: UPLOAD_LIMIT } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 2200 },
        visibility: { type: 'string', enum: [...VISIBILITIES] },
        images: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: MAX_POST_IMAGES, description: 'Ré-encodées, métadonnées supprimées' },
      },
    },
  })
  @ApiOperation({ summary: 'Publier (écran 16) : texte et 4 photos au plus' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreatePostDto, @UploadedFiles() images: Express.Multer.File[] | undefined, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.posts.create(a.userId, dto, images ?? [], meta, apiBase(req));
  }

  @Post('posts/bim')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Publier « J’ai fait mon BIM » (écran 31) : photos avant / après d’un projet, avec l’accord de la personne' })
  createBim(@CurrentAuth() a: AuthContext, @Body() dto: CreateBimPostDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.posts.createBim(a.userId, dto, meta, apiBase(req));
  }

  @Get('posts/:id')
  @ApiOperation({ summary: 'Détail d’une publication (écran 11)' })
  detail(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.posts.detail(a.userId, id, apiBase(req));
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer sa publication (images effacées du stockage)' })
  remove(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.posts.remove(a.userId, id, meta);
  }

  @Put('posts/:id/like')
  @ApiOperation({ summary: 'Aimer une publication' })
  like(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.like(a.userId, id, true);
  }

  @Delete('posts/:id/like')
  @ApiOperation({ summary: 'Ne plus aimer une publication' })
  unlike(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.like(a.userId, id, false);
  }

  @Get('posts/:id/comments')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Commentaires (écran 12), réponses sous chaque commentaire' })
  comments(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Query('cursor') cursor?: string) {
    return this.posts.comments(a.userId, id, this.cursor(cursor), apiBase(req));
  }

  @Post('posts/:id/comments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Commenter ou répondre à un commentaire' })
  comment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCommentDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.posts.comment(a.userId, id, dto, meta, apiBase(req));
  }

  @Delete('comments/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer un commentaire (son auteur ou l’auteur de la publication)' })
  removeComment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.posts.removeComment(a.userId, id, meta);
  }

  @Put('comments/:id/like')
  likeComment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.likeComment(a.userId, id, true);
  }

  @Delete('comments/:id/like')
  unlikeComment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.likeComment(a.userId, id, false);
  }

  @Get('people')
  @ApiQuery({ name: 'q', required: true })
  @ApiOperation({ summary: 'Rechercher une personne (nom d’utilisateur ou nom)' })
  search(@CurrentAuth() a: AuthContext, @Query('q') q: string | undefined, @Req() req: Request) {
    return this.people.search(a.userId, q ?? '', apiBase(req));
  }

  @Get('people/:username')
  @ApiOperation({ summary: 'Profil (écran 52) : compteurs, abonnement, blocage' })
  profile(@CurrentAuth() a: AuthContext, @Param('username') username: string, @Req() req: Request) {
    return this.people.profile(a.userId, username, apiBase(req));
  }

  @Get('people/:username/posts')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Publications d’une personne visibles par moi (grille du profil)' })
  async personPosts(@CurrentAuth() a: AuthContext, @Param('username') username: string, @Req() req: Request, @Query('cursor') cursor?: string) {
    const u = await this.people.visiblePerson(a.userId, { username });
    return this.posts.byAuthor(a.userId, u.id, this.cursor(cursor), apiBase(req));
  }

  @Put('people/:username/follow')
  @ApiOperation({ summary: 'S’abonner' })
  follow(@CurrentAuth() a: AuthContext, @Param('username') username: string) {
    return this.people.follow(a.userId, username, true);
  }

  @Delete('people/:username/follow')
  @ApiOperation({ summary: 'Se désabonner' })
  unfollow(@CurrentAuth() a: AuthContext, @Param('username') username: string) {
    return this.people.follow(a.userId, username, false);
  }

  @Put('people/:username/block')
  @ApiOperation({ summary: 'Bloquer : plus aucune interaction, abonnements retirés dans les deux sens' })
  block(@CurrentAuth() a: AuthContext, @Param('username') username: string, @ReqMeta() meta: RequestMeta) {
    return this.people.block(a.userId, username, true, meta);
  }

  @Delete('people/:username/block')
  @ApiOperation({ summary: 'Débloquer' })
  unblock(@CurrentAuth() a: AuthContext, @Param('username') username: string, @ReqMeta() meta: RequestMeta) {
    return this.people.block(a.userId, username, false, meta);
  }

  @Get('me/blocks')
  @ApiOperation({ summary: 'Personnes que j’ai bloquées' })
  blocks(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.people.blocked(a.userId, apiBase(req));
  }

  @Put('me/avatar')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: UPLOAD_LIMIT, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Photo de profil (écrans 05 et 52), ré-encodée, métadonnées supprimées' })
  setAvatar(@CurrentAuth() a: AuthContext, @UploadedFile() photo: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.people.setAvatar(a.userId, photo, meta, apiBase(req));
  }

  @Delete('me/avatar')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retirer sa photo de profil' })
  removeAvatar(@CurrentAuth() a: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.people.removeAvatar(a.userId, meta);
  }

  @Post('content-reports')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Signaler une publication, un commentaire ou une personne à la modération' })
  report(@CurrentAuth() a: AuthContext, @Body() dto: ReportContentDto, @ReqMeta() meta: RequestMeta) {
    return this.people.report(a.userId, dto, meta);
  }

  private cursor(c?: string): string | undefined {
    if (!c) return undefined;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) throw Errors.validation({ fields: { cursor: ['Curseur invalide.'] } });
    return c;
  }
}

@ApiTags('Administration — modération')
@Controller('admin/v1')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('content-reports')
  @AdminRoute('content.read')
  @ApiOperation({ summary: 'Signalements de contenus (publications, commentaires, personnes)' })
  list(@Req() req: Request, @Query('status') status?: string) {
    return this.moderation.list(status === 'resolved' ? 'resolved' : 'open', `${req.protocol}://${req.get('host')}`);
  }

  @Post('content-reports/:id/resolve')
  @HttpCode(200)
  @AdminRoute('content.moderate')
  @ApiOperation({ summary: 'Décider : rien à reprocher, ou contenu masqué' })
  resolve(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveContentReportDto, @ReqMeta() meta: RequestMeta) {
    return this.moderation.resolve(a, id, dto.action, dto.resolution, meta);
  }

  @Post('content/:type/:id/restore')
  @HttpCode(200)
  @AdminRoute('content.moderate')
  @ApiOperation({ summary: 'Rétablir une publication ou un commentaire masqué' })
  restore(@CurrentAdmin() a: AdminContext, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    if (type !== 'post' && type !== 'comment' && type !== 'story') throw Errors.validation({ fields: { type: ['« post », « comment » ou « story ».'] } });
    return this.moderation.restore(a, type, id, meta);
  }
}
