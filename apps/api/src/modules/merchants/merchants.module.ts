import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantApplicationsController, MerchantReviewController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

/** Lot 5 — Marchands : ouverture de boutique vérifiée (5-A). */
@Module({
  imports: [AuthModule],
  controllers: [MerchantApplicationsController, MerchantReviewController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
