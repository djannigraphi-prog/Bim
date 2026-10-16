import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, RequireShopPermission, RequireSpace } from '../auth/auth.decorators';
import { apiBase } from '../projects/projects.controller';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AcceptProposalDto, CashReceivedDto, CreateOrderDto, DeclarePaymentDto, HandoverDto, OptionalReasonDto, PreviewOrderDto, ProposeOrderDto, ReasonDto, ReviewNoteDto } from './dto';
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
  ) {}

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
    return this.orders.getForCustomer(a.userId, id, apiBase(req));
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
    return this.orders.getForCustomer(a.userId, id, apiBase(req));
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepter une proposition de la boutique (mode, adresse, moyen prévu ; montant vérifié)' })
  async accept(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptProposalDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.orders.accept(a.userId, id, dto, meta);
    return this.orders.getForCustomer(a.userId, id, apiBase(req));
  }

  @Post(':id/payment/declare')
  @HttpCode(200)
  @ApiOperation({ summary: '« J’ai payé » (Mobile Money, après la remise) : déclaration, jamais une confirmation' })
  async declare(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclarePaymentDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.declare(a.userId, id, dto.reference?.trim() || undefined, meta);
    return this.orders.getForCustomer(a.userId, id, apiBase(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une proposition, ou annuler avant la préparation' })
  async cancel(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto, @Req() req: Request) {
    await this.orders.cancelByCustomer(a.userId, id, dto.reason?.trim() || undefined);
    return this.orders.getForCustomer(a.userId, id, apiBase(req));
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
  ) {}

  private shop(a: AuthContext) {
    return a.space!.id;
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
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Get(':id')
  @RequireShopPermission('orders.read')
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async confirm(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.orders.confirm(a.userId, this.shop(a), id);
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/decline')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async decline(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    await this.orders.decline(a.userId, this.shop(a), id, dto.reason.trim());
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/prepare')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async prepare(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.orders.prepare(a.userId, this.shop(a), id);
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/ready')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  async ready(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.orders.ready(a.userId, this.shop(a), id);
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/handover')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Retrait en boutique : saisir le code du client (essais limités, usage unique)' })
  async handover(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HandoverDto, @Req() req: Request) {
    await this.orders.handover(a.userId, this.shop(a), id, dto.code.trim());
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/payment/cash')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @ApiOperation({ summary: 'Retrait en boutique : espèces reçues (constat visuel, montant attendu)' })
  async cash(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashReceivedDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.cashReceived(a.userId, this.shop(a), id, dto.amountFcfa, meta);
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/payment/confirm')
  @HttpCode(200)
  @RequireShopPermission('payments.decide')
  @ApiOperation({ summary: 'Confirmer le paiement reçu : la commande est terminée' })
  async confirmPayment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.decide(a.userId, this.shop(a), id, 'confirm', undefined, meta);
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/payment/contest')
  @HttpCode(200)
  @RequireShopPermission('payments.decide')
  @ApiOperation({ summary: 'Contester le paiement (motif) : file « à vérifier » du support' })
  async contestPayment(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @ReqMeta() meta: RequestMeta, @Req() req: Request) {
    await this.payments.decide(a.userId, this.shop(a), id, 'contest', dto.reason, meta);
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireShopPermission('orders.prepare')
  @ApiOperation({ summary: 'Annuler (motif obligatoire) ou retirer une proposition' })
  async cancel(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    await this.orders.cancelByShop(a.userId, this.shop(a), id, dto.reason.trim());
    return this.orders.getForShop(this.shop(a), id, apiBase(req));
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
