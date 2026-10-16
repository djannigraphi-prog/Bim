import { Module } from '@nestjs/common';
import { MerchantCatalogController, ShopCategoriesController } from './catalog.controller';
import { MerchantCatalogService } from './merchant-catalog.service';

/** Lot 5 — Catalogue des boutiques (5-B) et BimShop (5-C). */
@Module({
  controllers: [MerchantCatalogController, ShopCategoriesController],
  providers: [MerchantCatalogService],
  exports: [MerchantCatalogService],
})
export class CatalogModule {}
