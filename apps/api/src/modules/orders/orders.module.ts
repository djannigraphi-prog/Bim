import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { OrdersRunner } from './orders-runner';
import { CourierDeliveriesController, IncidentsAdminController, MyIncidentsController, MyReviewsController, OrdersController, PaymentsAdminController, PublicReviewsController, ShopIncidentsController, ShopOrdersController } from './orders.controller';
import { CouriersModule } from '../couriers/couriers.module';
import { DeliveriesService } from './deliveries.service';
import { IncidentsService } from './incidents.service';
import { ReviewsService } from './reviews.service';
import { PaymentsService } from './payments.service';
import { OrdersService } from './orders.service';
import { OnlinePaymentsController, PaymentWebhooksController } from './online/online-payments.controller';
import { OnlinePaymentsService } from './online/online-payments.service';

@Module({
  imports: [TariffsModule, MessagingModule, CouriersModule],
  controllers: [OrdersController, ShopOrdersController, PaymentsAdminController, MyReviewsController, PublicReviewsController, MyIncidentsController, ShopIncidentsController, CourierDeliveriesController, IncidentsAdminController, OnlinePaymentsController, PaymentWebhooksController],
  providers: [OrdersService, PaymentsService, ReviewsService, IncidentsService, DeliveriesService, OrdersRunner, OnlinePaymentsService],
  exports: [OrdersService],
})
export class OrdersModule {}
