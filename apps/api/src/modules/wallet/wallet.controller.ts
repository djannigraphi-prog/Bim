import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AuthContext, CurrentAuth, RequireStepUp } from '../auth/auth.decorators';
import { BuyCoinsDto, DecideWithdrawalDto, SendCoinsDto, StorePurchaseDto, SubscribePremiumDto, WithdrawCoinsDto } from './dto';
import { WalletService } from './wallet.service';

/** Lot 9 (prototype) — Premium, portefeuille, envois et retraits de pièces. Circuit simulé seulement (DEMO_MODE). */
@ApiTags('Pièces et Premium')
@ApiBearerAuth()
@Controller('v1')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('premium')
  @ApiOperation({ summary: 'Mon abonnement Premium (prix, état, fin de période)' })
  premium(@CurrentAuth() a: AuthContext) {
    return this.wallet.premium(a.userId);
  }

  @Post('premium/subscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'S’abonner à Premium (prototype : simulé, aucun paiement)' })
  subscribe(@CurrentAuth() a: AuthContext, @Body() _dto: SubscribePremiumDto, @ReqMeta() meta: RequestMeta) {
    return this.wallet.subscribe(a.userId, meta);
  }

  @Post('premium/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Résilier : Premium reste actif jusqu’à la fin de la période' })
  cancel(@CurrentAuth() a: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.wallet.cancel(a.userId, meta);
  }

  @Post('store/purchases')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ApiOperation({ summary: 'Achat dans l’app (Google Play, App Store) : vérifié auprès du magasin, puis pièces créditées ou Premium ouvert' })
  storePurchase(@CurrentAuth() a: AuthContext, @Body() dto: StorePurchaseDto, @ReqMeta() meta: RequestMeta) {
    return this.wallet.storePurchase(a.userId, dto, meta);
  }

  @Get('wallet')
  @ApiOperation({ summary: 'Portefeuille (écran 58) : solde, pièces retirables, packs, cadeaux, historique, retraits' })
  get(@CurrentAuth() a: AuthContext) {
    return this.wallet.wallet(a.userId);
  }

  @Post('wallet/purchases')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Acheter un pack de pièces (prototype : simulé, aucun paiement)' })
  buy(@CurrentAuth() a: AuthContext, @Body() dto: BuyCoinsDto, @ReqMeta() meta: RequestMeta) {
    return this.wallet.buy(a.userId, dto.coins, dto.idempotencyKey, meta);
  }

  @Post('coins/gifts')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Encourager (écran 13) : envoyer des pièces sur une publication ou un commentaire' })
  gift(@CurrentAuth() a: AuthContext, @Body() dto: SendCoinsDto, @ReqMeta() meta: RequestMeta) {
    return this.wallet.gift(a.userId, dto, meta);
  }

  @Get('posts/:id/donors')
  @ApiOperation({ summary: 'Donateurs d’une publication (les envois anonymes sont regroupés, sans nom)' })
  donors(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.donors(a.userId, id);
  }

  @Post('wallet/withdrawals')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @RequireStepUp('withdrawal')
  @ApiHeader({ name: 'X-Step-Up-Token', required: true, description: 'Confirmation d’identité (mot de passe + code), portée « withdrawal »' })
  @ApiOperation({ summary: 'Retirer des pièces reçues vers mon Mobile Money (prototype : versement simulé ; confirmation d’identité exigée)' })
  withdraw(@CurrentAuth() a: AuthContext, @Body() dto: WithdrawCoinsDto, @ReqMeta() meta: RequestMeta) {
    return this.wallet.withdraw(a.userId, dto, meta);
  }
}

@ApiTags('Administration')
@Controller('admin/v1/withdrawals')
export class WithdrawalsAdminController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @AdminRoute('coins.payouts')
  @ApiQuery({ name: 'status', required: false, enum: ['review', 'paid', 'rejected'] })
  @ApiOperation({ summary: 'Retraits de pièces : à vérifier (premier retrait, gros montant), versés, refusés' })
  list(@CurrentAdmin() a: AdminContext, @ReqMeta() meta: RequestMeta, @Query('status') status?: string) {
    return this.wallet.adminList(status === 'paid' || status === 'rejected' ? status : 'review', a, meta);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @AdminRoute('coins.payouts')
  @ApiOperation({ summary: 'Valider (versement simulé) ou refuser (pièces rendues, motif obligatoire)' })
  decide(@CurrentAdmin() a: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideWithdrawalDto, @ReqMeta() meta: RequestMeta) {
    return this.wallet.adminDecide(a, id, dto.decision, dto.reason, meta);
  }
}
