/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, Public, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { ProductDto, StockDto, UpdateProductDto, UpdateShopDto, VariantsDto } from './dto';
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
    return this.catalog.dashboard(this.shop(a), apiBase(req));
  }

  @Patch()
  @ApiOperation({ summary: 'Modifier la présentation de la boutique' })
  update(@CurrentAuth() a: AuthContext, @Body() dto: UpdateShopDto, @Req() req: Request) {
    return this.catalog.updateShop(this.shop(a), dto, apiBase(req));
  }

  @Put('logo')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { ...UPLOAD, limits: { ...UPLOAD.limits, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } } })
  logo(@CurrentAuth() a: AuthContext, @UploadedFile() photo: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setLogo(this.shop(a), a.userId, photo, meta, apiBase(req));
  }

  @Get('products')
  @ApiQuery({ name: 'status', enum: ['published', 'draft'], required: false })
  @ApiOperation({ summary: 'Mes articles et prestations (hors retirés)' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('status') status?: string) {
    return this.catalog.list(this.shop(a), status, apiBase(req));
  }

  @Post('products')
  @ApiOperation({ summary: 'Créer un article ou une prestation (brouillon)' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: ProductDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.create(this.shop(a), a.userId, dto, meta, apiBase(req));
  }

  @Get('products/:id')
  detail(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.catalog.detail(this.shop(a), id, apiBase(req));
  }

  @Patch('products/:id')
  updateProduct(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @Req() req: Request) {
    return this.catalog.update(this.shop(a), id, dto, apiBase(req));
  }

  @Post('products/:id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publier sur le BimShop (une photo et une rubrique au moins ; boutique ouverte)' })
  publish(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setStatus(this.shop(a), a.userId, id, 'published', meta, apiBase(req));
  }

  @Post('products/:id/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Repasser en brouillon (plus visible sur le BimShop)' })
  unpublish(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    return this.catalog.setStatus(this.shop(a), a.userId, id, 'draft', meta, apiBase(req));
  }

  @Delete('products/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retirer l’article (photos effacées)' })
  async archive(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.catalog.setStatus(this.shop(a), a.userId, id, 'archived', meta, apiBase(req));
  }

  @Post('products/:id/photos')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @UseInterceptors(FilesInterceptor('photos', MAX_PRODUCT_IMAGES, UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photos: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: MAX_PRODUCT_IMAGES } } } })
  @ApiOperation({ summary: 'Ajouter des photos (6 au plus par article), ré-encodées sans métadonnées' })
  addPhotos(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() photos: Express.Multer.File[] | undefined, @Req() req: Request) {
    return this.catalog.addPhotos(this.shop(a), id, photos ?? [], apiBase(req));
  }

  @Delete('products/:id/photos/:photoId')
  removePhoto(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Req() req: Request) {
    return this.catalog.removePhoto(this.shop(a), id, photoId, apiBase(req));
  }

  @Put('products/:id/variants')
  @ApiOperation({ summary: 'Variantes (tailles, couleurs…) ; vide : « Unique »' })
  variants(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VariantsDto, @Req() req: Request) {
    return this.catalog.setVariants(this.shop(a), id, dto.labels, apiBase(req));
  }

  @Put('products/:id/variants/:variantId/stock')
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
