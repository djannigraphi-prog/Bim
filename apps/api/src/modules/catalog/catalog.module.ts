import { Module } from '@nestjs/common';
import { BimShopService } from './bimshop.service';
import { BimShopController, MerchantCatalogController, ShopCategoriesController } from './catalog.controller';
import { MerchantCatalogService } from './merchant-catalog.service';

/** Lot 5 — Catalogue des boutiques (5-B) et BimShop (5-C). */
@Module({
  controllers: [MerchantCatalogController, ShopCategoriesController, BimShopController],
  providers: [MerchantCatalogService, BimShopService],
  exports: [MerchantCatalogService, BimShopService],
})
export class CatalogModule {}
