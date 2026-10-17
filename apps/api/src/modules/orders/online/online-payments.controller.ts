import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { AdminContext, AdminRoute, CurrentAdmin } from '../../admin/admin.decorators';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../../common/request-meta';
import { AuthContext, CurrentAuth, Public, RequireSpace } from '../../auth/auth.decorators';
import { OnlinePaymentsService } from './online-payments.service';

/** Lot 8 (socle, désactivé) — Paiement en ligne de l'article par le client. Fermé : 503 NOT_CONFIGURED. */
@ApiTags('Commandes')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/orders')
export class OnlinePaymentsController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Post(':id/payment/online')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Lancer le paiement en ligne de l’article (fermé tant qu’aucun prestataire n’est autorisé)' })
  start(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.online.start(a.userId, id, meta);
  }

  @Post(':id/payment/online/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Vérifier auprès du prestataire le dernier paiement en ligne (après validation sur le téléphone)' })
  check(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.online.check(a.userId, id);
  }
}

export class ShopPaymentAccountDto {
  @ApiProperty({ example: 'boutique-elegance' }) @IsString() @Length(1, 80) shopSlug!: string;
  @ApiProperty({ example: 'ACCT_xxxxxxxx', description: 'Référence du compte de la boutique chez le prestataire (sous-compte)' }) @IsString() @Length(4, 60) accountRef!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class RefundDto {
  @ApiPropertyOptional({ description: 'Montant en F ; par défaut, le reste à rembourser' }) @IsOptional() @IsInt() @Min(1) amountFcfa?: number;
  @ApiProperty({ minLength: 5, maxLength: 300 }) @IsString() @Length(5, 300) reason!: string;
}

/** Lot 8 — Administration des paiements en ligne : suivi (journalisé), comptes des boutiques, remboursements. */
@ApiTags('Administration')
@ApiBearerAuth()
@Controller('admin/v1/online-payments')
export class OnlinePaymentsAdminController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Get()
  @AdminRoute('payments.online')
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'succeeded', 'failed', 'expired'] })
  list(@CurrentAdmin() a: AdminContext, @ReqMeta() meta: RequestMeta, @Query('status') status?: string) {
    return this.online.adminList(a, status, meta);
  }

  @Get('accounts')
  @AdminRoute('payments.online')
  accounts() {
    return this.online.adminAccounts();
  }

  @Post('accounts')
  @AdminRoute('payments.online')
  setAccount(@CurrentAdmin() a: AdminContext, @Body() dto: ShopPaymentAccountDto, @ReqMeta() meta: RequestMeta) {
    return this.online.setAccount(a, dto.shopSlug, dto.accountRef, dto.note, meta);
  }

  @Post('accounts/:id/disable')
  @HttpCode(200)
  @AdminRoute('payments.online')
  disable(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.online.disableAccount(a, id, meta);
  }

  @Post(':id/refund')
  @AdminRoute('payments.refund')
  refund(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto, @ReqMeta() meta: RequestMeta) {
    return this.online.refund(a, id, dto.amountFcfa, dto.reason, meta);
  }
}

/** Notifications signées des prestataires de paiement (aucun compte BIM : la signature fait foi, puis vérification serveur). */
@Controller('v1/payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.online.webhook(provider, req.headers, req.rawBody);
  }
}
