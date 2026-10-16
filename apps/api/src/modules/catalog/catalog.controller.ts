/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, Public, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { ProductDto, StockDto, UpdateProductDto, UpdateShopDto, VariantsDto } from './dto';
import { BimShopService, BimShopSort } from './bimshop.service';
import { MAX_PRODUCT_IMAGES, MerchantCatalogService } from './merchant-catalog.service';

const UPLOAD = { limits: { fileSize: 25 * 1024 * 1024 } };

/** Lot 5-B — Espace marchand (écran 55) : boutique et catalogue. Espace marchand actif obligatoire. */
@ApiTags('Espace marchand')
@ApiBearerAuth()
@RequireSpace('merchant')
@Controller('v1/shop')
export class MerchantCatalogController {
  constructor(private readonly catalog: MerchantCatalogService) {}

  private shop(a: AuthContext) {
    return a.space!.id;
  }

  @Get()
  @ApiOperation({ summary: 'Ma boutique : présentation, compteurs' })
  dashboard(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.catalog.dashboard(this.shop(a), a.userId, apiBase(req));
  }

  @Patch()
  @RequireShopPermission('owner')
  @ApiOperation({ summary: 'Modifier la présentation de la boutique (propriétaire)' })
  update(@CurrentAuth() a: AuthContext, @Body() dto: UpdateShopDto, @Req() req: Request) {
    return this.catalog.updateShop(this.shop(a), a.userId, dto, apiBase(req));
  }

  @Put('logo')
  @RequireShopPermission('owner')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { ...UPLOAD, limits: { ...UPLOAD.limits, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  logo(@CurrentAuth() a: AuthContext, @UploadedFile() photo: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setLogo(this.shop(a), a.userId, photo, meta, apiBase(req));
  }

  @Get('products')
  @ApiQuery({ name: 'status', enum: ['published', 'draft', 'hidden'], required: false })
  @ApiOperation({ summary: 'Mes articles et prestations (hors retirés)' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('status') status?: string) {
    return this.catalog.list(this.shop(a), status, apiBase(req));
  }

  @Post('products')
  @RequireShopPermission('products.edit')
  @ApiOperation({ summary: 'Créer un article ou une prestation (brouillon) ; la référence BIM-… est attribuée par le serveur' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: ProductDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.create(this.shop(a), a.userId, dto, meta, apiBase(req));
  }

  @Get('products/:id')
  detail(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.catalog.detail(this.shop(a), id, apiBase(req));
  }

  @Patch('products/:id')
  @RequireShopPermission('products.edit')
  @ApiOperation({
    summary: 'Modifier le contenu ; un article déjà publié perd sa réputation (REPUTATION_RESET_REQUIRED tant que confirmReputationReset n’est pas envoyé)',
  })
  updateProduct(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.update(this.shop(a), a.userId, id, dto, meta, apiBase(req));
  }

  @Post('products/:id/publish')
  @RequireShopPermission('products.publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publier sur le BimShop (une photo et une rubrique au moins ; boutique ouverte) ; un article masqué exige aussi « masquer ou republier »' })
  publish(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    // Publier un brouillon, ou republier un article masqué (contrat du lot 5-B conservé). Republier relève aussi de
    // « Masquer ou republier » : le service l'exige pour un article masqué.
    return this.catalog.setStatus(this.shop(a), a.userId, id, 'published', meta, apiBase(req), ['draft', 'hidden'], 'products.visibility');
  }

  @Post('products/:id/hide')
  @RequireShopPermission('products.visibility')
  @HttpCode(200)
  @ApiOperation({ summary: '« Visible par moi uniquement » : masqué du BimShop, référence et réputation conservées' })
  hide(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setStatus(this.shop(a), a.userId, id, 'hidden', meta, apiBase(req), ['published']);
  }

  @Post('products/:id/show')
  @RequireShopPermission('products.visibility')
  @HttpCode(200)
  @ApiOperation({ summary: '« Visible publiquement » : republier un article masqué, avec sa réputation' })
  show(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setStatus(this.shop(a), a.userId, id, 'published', meta, apiBase(req), ['hidden']);
  }

  @Post('products/:id/unpublish')
  @RequireShopPermission('products.visibility')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ancien nom de « hide » : masquer un article publié (réputation conservée)' })
  unpublish(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setStatus(this.shop(a), a.userId, id, 'hidden', meta, apiBase(req), ['published']);
  }

  @Delete('products/:id')
  @RequireShopPermission('products.publish')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retirer l’article (photos effacées)' })
  async archive(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.catalog.setStatus(this.shop(a), a.userId, id, 'archived', meta, apiBase(req));
  }

  @Post('products/:id/photos')
  @RequireShopPermission('products.edit')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @UseInterceptors(FilesInterceptor('photos', MAX_PRODUCT_IMAGES, UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: MAX_PRODUCT_IMAGES } } } })
  @ApiOperation({ summary: 'Ajouter des photos (6 au plus), ré-encodées sans métadonnées ; la photo seule ne touche pas à la réputation' })
  addPhotos(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() photos: Express.Multer.File[] | undefined, @Req() req: Request) {
    return this.catalog.addPhotos(this.shop(a), id, photos ?? [], apiBase(req));
  }

  @Delete('products/:id/photos/:photoId')
  @RequireShopPermission('products.edit')
  removePhoto(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Req() req: Request) {
    return this.catalog.removePhoto(this.shop(a), id, photoId, apiBase(req));
  }

  @Put('products/:id/variants')
  @RequireShopPermission('products.edit')
  @ApiOperation({ summary: 'Variantes (tailles, couleurs…) ; vide : « Unique ». Les changer sur un article déjà publié remet sa réputation à zéro (confirmation)' })
  variants(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VariantsDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setVariants(this.shop(a), a.userId, id, dto.labels, dto.confirmReputationReset, meta, apiBase(req));
  }

  @Put('products/:id/variants/:variantId/stock')
  @RequireShopPermission('products.edit')
  @ApiOperation({ summary: 'Fixer le stock d’une variante (mouvement d’ajustement enregistré)' })
  stock(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('variantId', ParseUUIDPipe) variantId: string, @Body() dto: StockDto, @Req() req: Request) {
    return this.catalog.setStock(this.shop(a), a.userId, id, variantId, dto.quantity, apiBase(req));
  }
}

/** Rubriques du BimShop (écran 33), publiques. */
@ApiTags('BimShop')
@Controller('v1/shop-categories')
export class ShopCategoriesController {
  constructor(private readonly catalog: MerchantCatalogService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Rubriques et sous-rubriques (écran 33)' })
  list() {
    return this.catalog.categories();
  }
}

/** Lot 5-C — BimShop (écrans 32, 33, 34, 54). Parcourir est public (visiteurs compris) ; aucune commande ni paiement. */
@ApiTags('BimShop')
@Controller('v1/bimshop')
export class BimShopController {
  constructor(private readonly shop: BimShopService) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Rubriques avec le nombre d’articles en ligne (écran 33)' })
  categories() {
    return this.shop.categories();
  }

  @Public()
  @Get('products')
  @ApiQuery({ name: 'category', required: false, description: 'Rubrique ou sous-rubrique' })
  @ApiQuery({ name: 'q', required: false, description: 'Recherche dans le nom, la description et le nom de la boutique' })
  @ApiQuery({ name: 'sort', required: false, enum: ['recent', 'price_asc', 'price_desc'] })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Articles en ligne (écran 32)' })
  browse(@Req() req: Request, @Query('category') category?: string, @Query('q') q?: string, @Query('sort') sort?: string, @Query('cursor') cursor?: string) {
    return this.shop.browse({ category: category?.slice(0, 40), q, sort: sort as BimShopSort, cursor }, apiBase(req));
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'Fiche article (écran 34) ; disponibilité sans stock exact' })
  product(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.shop.product(id, apiBase(req));
  }

  @Public()
  @Get('shops/:slug')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Profil public d’une boutique et ses articles (écran 54)' })
  shopProfile(@Param('slug') slug: string, @Req() req: Request, @Query('cursor') cursor?: string) {
    return this.shop.shop(slug.slice(0, 80), apiBase(req), cursor);
  }

  @ApiBearerAuth()
  @Get('products/:id/me')
  @ApiOperation({ summary: 'Article mis de côté ? Boutique suivie ?' })
  productState(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.productState(a.userId, id);
  }

  @ApiBearerAuth()
  @Put('products/:id/favorite')
  @ApiOperation({ summary: 'Mettre de côté (cœur)' })
  favorite(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.setFavorite(a.userId, id, true);
  }

  @ApiBearerAuth()
  @Delete('products/:id/favorite')
  unfavorite(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.shop.setFavorite(a.userId, id, false);
  }

  @ApiBearerAuth()
  @Get('favorites')
  @ApiOperation({ summary: 'Mes articles mis de côté' })
  favorites(@CurrentAuth() a: AuthContext, @Req() req: Request) {
    return this.shop.favorites(a.userId, apiBase(req));
  }

  @ApiBearerAuth()
  @Get('shops/:slug/me')
  shopState(@CurrentAuth() a: AuthContext, @Param('slug') slug: string) {
    return this.shop.shopState(a.userId, slug.slice(0, 80));
  }

  @ApiBearerAuth()
  @Put('shops/:slug/follow')
  @ApiOperation({ summary: 'Suivre une boutique' })
  follow(@CurrentAuth() a: AuthContext, @Param('slug') slug: string) {
    return this.shop.setFollow(a.userId, slug.slice(0, 80), true);
  }

  @ApiBearerAuth()
  @Delete('shops/:slug/follow')
  unfollow(@CurrentAuth() a: AuthContext, @Param('slug') slug: string) {
    return this.shop.setFollow(a.userId, slug.slice(0, 80), false);
  }
}
