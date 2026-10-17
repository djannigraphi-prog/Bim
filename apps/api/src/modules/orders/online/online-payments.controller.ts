import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
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
