import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { OrdersRunner } from './orders-runner';
import { MyReviewsController, OrdersController, PaymentsAdminController, PublicReviewsController, ShopOrdersController } from './orders.controller';
import { ReviewsService } from './reviews.service';
import { PaymentsService } from './payments.service';
import { OrdersService } from './orders.service';

@Module({
  imports: [TariffsModule, MessagingModule],
  controllers: [OrdersController, ShopOrdersController, PaymentsAdminController, MyReviewsController, PublicReviewsController],
  providers: [OrdersService, PaymentsService, ReviewsService, OrdersRunner],
  exports: [OrdersService],
})
export class OrdersModule {}
