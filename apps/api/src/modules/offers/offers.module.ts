import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ProjectOffersController, ShopOffersController } from './offers.controller';
import { OffersService } from './offers.service';

/** Lot 5-D — Demandes et offres de projet, recommandations Premium. */
@Module({
  imports: [CatalogModule],
  controllers: [ShopOffersController, ProjectOffersController],
  providers: [OffersService],
})
export class OffersModule {}
