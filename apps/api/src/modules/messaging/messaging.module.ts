import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { ShopInboxController } from './shop-inbox.controller';
import { ShopInboxService } from './shop-inbox.service';

/** Lot 6 — Messagerie : entre personnes (6-A) et avec les boutiques (6-B). */
@Module({
  imports: [CatalogModule],
  controllers: [MessagingController, ShopInboxController],
  providers: [MessagingService, ShopInboxService],
  exports: [MessagingService],
})
export class MessagingModule {}
