/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, AppConfig } from '../../config/config';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, Public, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AcceptProposalDto, CashReceivedDto, CreateOrderDto, DeclarePaymentDto, HandoverDto, OptionalReasonDto, PreviewOrderDto, ProposeOrderDto, ReasonDto, ReviewDto, ReviewNoteDto, RefuseDeliveryDto, IncidentDto, OfferCourierDto, IncidentNoteDto, CodeDto, CourierNoteDto, ReportReviewDto } from './dto';
import { ReviewsService } from './reviews.service';
import { DeliveriesService } from './deliveries.service';
import { DeliveryFeesService } from './delivery-fees.service';
import { IncidentsService } from './incidents.service';
import { PaymentsService } from './payments.service';
import { OrdersService } from './orders.service';

/** Lot 7-B — Mes commandes (client). Aucun paiement en ligne. */
@ApiTags('Commandes')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly reviews: ReviewsService,
    private readonly deliveries: DeliveriesService,
    private readonly incidents: IncidentsService,
    private readonly fees: DeliveryFeesService,
  ) {}

  @Post(':id/delivery/refuse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser la remise après examen (motif obligatoire ; ouvre un incident ; jamais « livrée »)' })
  async refuse(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefuseDeliveryDto, @Req() req: Request) {
    await this.deliveries.refuse(a.userId, id, dto.reason, dto.details);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post(':id/delivery/review')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Évaluer la livraison (une fois, après la clôture ; distincte de l’article et de la boutique)' })
  async reviewDelivery(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.deliveries.reviewDelivery(a.userId, id, dto.rating, dto.comment, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Get(':id/incidents')
  incidentsList(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.incidents.forOrder(a.userId, 'customer', id, {}, apiBase(req));
  }

  @Post(':id/incidents')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Signaler un incident (motif, description) ; aucune pénalité ni remboursement automatique' })
  openIncident(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IncidentDto, @ReqMeta() meta: RequestMeta) {
    return this.incidents.open(a.userId, 'customer', id, dto.reason, dto.description, meta);
  }

  @Post(':id/reviews/items/:position')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Évaluer un article de la commande (une fois par ligne, après la remise, dans le délai)' })
  async reviewItem(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('position', ParseIntPipe) position: number, @Body() dto: ReviewDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.reviews.reviewItem(a.userId, id, position, dto.rating, dto.comment, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post(':id/reviews/shop')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Évaluer la boutique pour cette commande (une fois)' })
  async reviewShop(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.reviews.reviewShop(a.userId, id, dto.rating, dto.comment, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Récapitulatif avant confirmation : lignes, frais calculés par le serveur, délai, règle d’attente' })
  preview(@CurrentAuth() a: AuthContext, @Body() dto: PreviewOrderDto) {
    const { shopId, items, ...f } = dto;
    return this.orders.preview(a.userId, shopId, items, f);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Commander sur le BimShop (en attente de la boutique) ; clé anti-doublon' })
  async create(@CurrentAuth() a: AuthContext, @Body() dto: CreateOrderDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    const id = await this.orders.create(a.userId, dto, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Get()
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'Mes commandes' })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('cursor') cursor?: string) {
    return this.orders.listForCustomer(a.userId, cursor, apiBase(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail : lignes figées, frais, état, historique, code de remise (client seulement)' })
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter une proposition de la boutique (mode, adresse, moyen prévu ; montant vérifié)' })
  async accept(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptProposalDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.orders.accept(a.userId, id, dto, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post(':id/payment/declare')
  @HttpCode(200)
  @ApiOperation({ summary: '« J’ai payé » (Mobile Money, après la remise) : déclaration, jamais une confirmation' })
  async declare(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclarePaymentDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.declare(a.userId, id, dto.reference?.trim() || undefined, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post(':id/payment/delivery-fee/declare')
  @HttpCode(200)
  @ApiOperation({ summary: 'A3-b : « J’ai payé le livreur » (frais d’un livreur indépendant, Mobile Money) — déclaration, jamais une confirmation' })
  async declareDeliveryFee(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclarePaymentDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.fees.declare(a.userId, id, dto.reference?.trim() || undefined, meta);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une proposition, ou annuler avant la préparation' })
  async cancel(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto, @Req() req: Request) {
    await this.orders.cancelByCustomer(a.userId, id, dto.reason?.trim() || undefined);
    return this.deliveries.customerView(a.userId, id, apiBase(req));
  }
}

/** Lot 7-B — Commandes reçues par la boutique ; permissions séparées contrôlées à chaque requête (A16). */
@ApiTags('Espace marchand')
@ApiBearerAuth()
@RequireSpace('merchant')
@Controller('v1/shop/orders')
export class ShopOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly deliveries: DeliveriesService,
    private readonly incidents: IncidentsService,
    private readonly fees: DeliveryFeesService,
  ) {}

  private shop(a: AuthContext) {
    return a.space!.id;
  }

  @Post(':id/delivery/start')
  @HttpCode(200)
  @RequireShopPermission('deliveries.select_courier')
  @ApiOperation({ summary: 'Lancer la recherche d’un livreur pour une commande prête' })
  async startDelivery(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.deliveries.start(a.userId, this.shop(a), id, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Get(':id/delivery/candidates')
  @RequireShopPermission('deliveries.select_courier')
  @ApiOperation({ summary: 'Livreurs éligibles, calculés par le serveur (employés, puis partenaires, puis indépendants)' })
  candidates(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.candidatesForShop(this.shop(a), id);
  }

  @Post(':id/delivery/offer')
  @HttpCode(200)
  @RequireShopPermission('deliveries.select_courier')
  @ApiOperation({ summary: 'Solliciter un livreur éligible (il doit accepter dans le délai) ; motif si un prioritaire est passé (économique)' })
  async offer(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OfferCourierDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.deliveries.offer(a.userId, this.shop(a), id, dto.courierId, dto.reason, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/delivery/withdraw')
  @HttpCode(200)
  @RequireShopPermission('deliveries.select_courier')
  async withdrawOffer(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.deliveries.withdraw(a.userId, this.shop(a), id);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/delivery/returned')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @ApiOperation({ summary: 'Colis revenu en boutique après un refus ou une absence du client : la commande est annulée, le stock remis' })
  async confirmReturn(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.deliveries.confirmReturn(a.userId, this.shop(a), id, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Get(':id/incidents')
  @RequireShopPermission('orders.read')
  incidentsList(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.incidents.forOrder(a.userId, 'shop', id, { shopId: this.shop(a) }, apiBase(req));
  }

  @Post(':id/incidents')
  @RequireShopPermission('orders.prepare')
  openIncident(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IncidentDto, @ReqMeta() meta: RequestMeta) {
    return this.incidents.open(a.userId, 'shop', id, dto.reason, dto.description, meta, { shopId: this.shop(a) });
  }

  @Get()
  @RequireShopPermission('orders.read')
  @ApiQuery({ name: 'box', enum: ['todo', 'active', 'done'], required: false })
  @ApiQuery({ name: 'cursor', required: false })
  list(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('box') box?: 'todo' | 'active' | 'done', @Query('cursor') cursor?: string) {
    return this.orders.listForShop(this.shop(a), box ?? 'todo', cursor, apiBase(req));
  }

  @Get('counts')
  @RequireShopPermission('orders.read')
  counts(@CurrentAuth() a: AuthContext) {
    return this.orders.shopCounts(this.shop(a));
  }

  @Post('proposals')
  @RequireShopPermission('orders.prepare')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Proposer une commande dans une conversation (vaut confirmation de la boutique)' })
  async propose(@CurrentAuth() a: AuthContext, @Body() dto: ProposeOrderDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    const id = await this.orders.propose(a.userId, this.shop(a), dto, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Get(':id')
  @RequireShopPermission('orders.read')
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async confirm(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.orders.confirm(a.userId, this.shop(a), id);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/decline')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async decline(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    await this.orders.decline(a.userId, this.shop(a), id, dto.reason.trim());
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/prepare')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async prepare(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.orders.prepare(a.userId, this.shop(a), id);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/ready')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async ready(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.orders.ready(a.userId, this.shop(a), id);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/handover')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Retrait en boutique : saisir le code du client (essais limités, usage unique)' })
  async handover(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HandoverDto, @Req() req: Request) {
    await this.orders.handover(a.userId, this.shop(a), id, dto.code.trim());
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/payment/cash')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @ApiOperation({ summary: 'Retrait en boutique : espèces reçues (constat visuel, montant attendu)' })
  async cash(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashReceivedDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.cashReceived(a.userId, this.shop(a), id, dto.amountFcfa, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/payment/confirm')
  @HttpCode(200)
  @RequireShopPermission('payments.decide')
  @ApiOperation({ summary: 'Confirmer le paiement reçu : la commande est terminée' })
  async confirmPayment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.decide(a.userId, this.shop(a), id, 'confirm', undefined, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/payment/contest')
  @HttpCode(200)
  @RequireShopPermission('payments.decide')
  @ApiOperation({ summary: 'Contester le paiement (motif) : file « à vérifier » du support' })
  async contestPayment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.decide(a.userId, this.shop(a), id, 'contest', dto.reason, meta);
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @ApiOperation({ summary: 'Annuler (motif obligatoire) ou retirer une proposition' })
  async cancel(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    await this.orders.cancelByShop(a.userId, this.shop(a), id, dto.reason.trim());
    return this.deliveries.shopView(this.shop(a), id, apiBase(req));
  }
}

/** Lot 7-C — File « à vérifier » des paiements (support), consultation journalisée. */
@ApiTags('Administration')
@Controller('admin/v1/payments')
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('review')
  @AdminRoute('payments.review')
  queue(@CurrentAdmin() a: AdminContext, @ReqMeta() meta: RequestMeta) {
    return this.payments.reviewQueue(a, meta);
  }

  @Post(':id/reviewed')
  @HttpCode(200)
  @AdminRoute('payments.review')
  reviewed(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @ReqMeta() meta: RequestMeta) {
    return this.payments.markReviewed(a, id, dto.note.trim(), meta);
  }
}

/** Lot 7-H — Retirer sa propre évaluation (elle reste en base, non affichée). */
@ApiTags('Commandes')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/reviews')
export class MyReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.reviews.remove(a.userId, id, meta);
  }
}

/** Lot 7-H — Évaluations publiques d'un article et d'une boutique (aucune moyenne : A17). */
@ApiTags('BimShop')
@Controller('v1/bimshop')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('products/:id/reviews')
  @ApiQuery({ name: 'before', required: false })
  product(@Param('id', ParseUUIDPipe) id: string, @Query('before') before?: string) {
    return this.reviews.forProduct(id, before);
  }

  @Public()
  @Get('shops/:slug/reviews')
  @ApiQuery({ name: 'before', required: false })
  shop(@Param('slug') slug: string, @Query('before') before?: string) {
    return this.reviews.forShop(slug, before);
  }
}

/** Lot 7-G — Suite d'un incident par le client (précisions, transmission au support). */
@ApiTags('Commandes')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/incidents')
export class MyIncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post(':id/photos')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Joindre une photo au problème signalé (3 au plus ; privée ; supprimée 30 jours après la clôture)' })
  photo(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.incidents.addPhoto(a.userId, 'customer', id, file, this.cfg.MEDIA_MAX_UPLOAD_MB, {}, apiBase(req));
  }


  @Post(':id/notes')
  @HttpCode(200)
  note(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IncidentNoteDto) {
    return this.incidents.addNote(a.userId, 'customer', id, dto.note);
  }

  @Post(':id/support')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transmettre l’incident au support' })
  transfer(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.transfer(a.userId, 'customer', id);
  }
}

/** Lot 7-G — Incidents vus par la boutique (permission « préparer les commandes »). */
@ApiTags('Espace marchand')
@ApiBearerAuth()
@RequireSpace('merchant')
@Controller('v1/shop/incidents')
export class ShopIncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post(':id/photos')
  @RequireShopPermission('orders.prepare')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Joindre une photo au problème signalé (3 au plus ; privée ; supprimée 30 jours après la clôture)' })
  photo(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.incidents.addPhoto(a.userId, 'shop', id, file, this.cfg.MEDIA_MAX_UPLOAD_MB, { shopId: a.space!.id }, apiBase(req));
  }


  @Post(':id/notes')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  note(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IncidentNoteDto) {
    return this.incidents.addNote(a.userId, 'shop', id, dto.note, { shopId: a.space!.id });
  }

  @Post(':id/support')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  transfer(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.transfer(a.userId, 'shop', id, { shopId: a.space!.id });
  }
}

/**
 * Lot 7-F — Espace livreur : missions proposées, courses acceptées, historique personnel. Rien d'autre d'une boutique
 * (L7-04) : ni ses commandes, ni celles des autres livreurs.
 */
@ApiTags('Livreurs')
@ApiBearerAuth()
@RequireSpace('courier')
@Controller('v1/courier')
export class CourierDeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly incidents: IncidentsService,
    private readonly fees: DeliveryFeesService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private c(a: AuthContext) {
    return a.space!.id;
  }

  @Get('missions')
  @ApiOperation({ summary: 'Missions qui me sont proposées (sans adresse ni client avant acceptation)' })
  missions(@CurrentAuth() a: AuthContext) {
    return this.deliveries.missions(this.c(a));
  }

  @Post('missions/:offerId/accept')
  @HttpCode(200)
  async accept(@CurrentAuth() a: AuthContext, @Param('offerId', ParseUUIDPipe) offerId: string, @ReqMeta() meta: RequestMeta) {
    await this.deliveries.answer(a.userId, this.c(a), offerId, true, meta);
    return this.deliveries.courses(this.c(a), 'current');
  }

  @Post('missions/:offerId/decline')
  @HttpCode(200)
  async decline(@CurrentAuth() a: AuthContext, @Param('offerId', ParseUUIDPipe) offerId: string, @ReqMeta() meta: RequestMeta) {
    await this.deliveries.answer(a.userId, this.c(a), offerId, false, meta);
    return this.deliveries.missions(this.c(a));
  }

  @Get('courses')
  @ApiQuery({ name: 'box', enum: ['current', 'history'], required: false })
  @ApiOperation({ summary: 'Mes courses en cours ou mon historique (seulement mes propres livraisons)' })
  courses(@CurrentAuth() a: AuthContext, @Query('box') box?: string) {
    return this.deliveries.courses(this.c(a), box === 'history' ? 'history' : 'current');
  }

  @Get('courses/:id')
  course(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Je ne peux plus faire la course (avant la prise en charge) : la boutique sollicite un autre livreur' })
  async release(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @ReqMeta() meta: RequestMeta) {
    await this.deliveries.release(a.userId, this.c(a), id, dto.reason, meta);
    return { released: true };
  }

  @Post('courses/:id/picked-up')
  @HttpCode(200)
  async pickedUp(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.deliveries.pickedUp(a.userId, this.c(a), id);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/arrived')
  @HttpCode(200)
  @ApiOperation({ summary: '« Je suis arrivé » (heure du serveur, début de l’attente)' })
  async arrived(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.deliveries.arrived(a.userId, this.c(a), id);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/code')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Saisir le code donné par le client après examen (essais limités, usage unique ; pas une preuve de paiement)' })
  async code(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CodeDto) {
    await this.deliveries.validateCode(a.userId, this.c(a), id, dto.code.trim());
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/cash')
  @HttpCode(200)
  @ApiOperation({ summary: 'Espèces reçues (employé actif de la boutique seulement)' })
  async cash(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashReceivedDto, @ReqMeta() meta: RequestMeta) {
    await this.deliveries.cashReceived(a.userId, this.c(a), id, dto.amountFcfa, meta);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/delivery-fee/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'A3-b : le livreur indépendant confirme avoir reçu les frais de livraison' })
  async feeConfirm(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.fees.courierDecide(a.userId, this.c(a), id, 'confirm', undefined, meta);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/delivery-fee/contest')
  @HttpCode(200)
  @ApiOperation({ summary: 'A3-b : le livreur indépendant conteste (frais non reçus, montant différent) avec un motif' })
  async feeContest(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @ReqMeta() meta: RequestMeta) {
    await this.fees.courierDecide(a.userId, this.c(a), id, 'contest', dto.reason, meta);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clôturer la livraison (code validé, paiement déclaré ou espèces constatées, aucun incident ouvert)' })
  async close(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.deliveries.close(a.userId, this.c(a), id, meta);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/client-absent')
  @HttpCode(200)
  async absent(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CourierNoteDto) {
    await this.deliveries.clientAbsent(a.userId, this.c(a), id, dto.note);
    return this.deliveries.course(this.c(a), id);
  }

  @Post('courses/:id/incidents')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async incident(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IncidentDto, @ReqMeta() meta: RequestMeta) {
    // Seulement pour une course qui m'est attribuée (revérifié par le service des incidents).
    const [orderId] = await this.deliveries.orderIdOf(id);
    return this.incidents.open(a.userId, 'courier', orderId, dto.reason, dto.description, meta, { courierId: this.c(a) });
  }

  @Post('incidents/:id/photos')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Joindre une photo au problème signalé (3 au plus ; privée ; supprimée 30 jours après la clôture)' })
  incidentPhoto(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.incidents.addPhoto(a.userId, 'courier', id, file, this.cfg.MEDIA_MAX_UPLOAD_MB, { courierId: this.c(a) }, apiBase(req));
  }

  @Post('incidents/:id/notes')
  @HttpCode(200)
  incidentNote(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: IncidentNoteDto) {
    return this.incidents.addNote(a.userId, 'courier', id, dto.note, { courierId: this.c(a) });
  }

  @Post('incidents/:id/support')
  @HttpCode(200)
  incidentSupport(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.transfer(a.userId, 'courier', id, { courierId: this.c(a) });
  }

  @Post('reviews/:id/report')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signaler l’évaluation reçue pour une de mes courses (modération)' })
  reportReview(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportReviewDto) {
    return this.deliveries.reportReview(a.userId, this.c(a), id, dto.reason);
  }
}

/** Lot 7-G — Incidents transmis au support (consultation journalisée ; décision = note, sans effet financier). */
@ApiTags('Administration')
@Controller('admin/v1/incidents')
export class IncidentsAdminController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @AdminRoute('incidents.review')
  @ApiQuery({ name: 'status', enum: ['with_support', 'open', 'resolved'], required: false })
  list(@CurrentAdmin() a: AdminContext, @ReqMeta() meta: RequestMeta, @Req() req: Request, @Query('status') status?: string) {
    return this.incidents.adminList(a, status === 'open' || status === 'resolved' ? status : 'with_support', meta, apiBase(req));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @AdminRoute('incidents.review')
  resolve(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @ReqMeta() meta: RequestMeta) {
    return this.incidents.resolve(a, id, dto.note, meta);
  }
}
