import { Module } from '@nestjs/common';
import { CourierApplicationController, CourierReviewController, CourierSpaceController, ShopCouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';

/** Lot 7-E — Livreurs : comptes vérifiés, profil de travail, relations avec les boutiques. */
@Module({
  controllers: [CourierApplicationController, CourierSpaceController, ShopCouriersController, CourierReviewController],
  providers: [CouriersService],
  exports: [CouriersService],
})
export class CouriersModule {}
