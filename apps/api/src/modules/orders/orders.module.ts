import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { OrdersRunner } from './orders-runner';
import { OrdersController, PaymentsAdminController, ShopOrdersController } from './orders.controller';
import { PaymentsService } from './payments.service';
import { OrdersService } from './orders.service';

@Module({
  imports: [TariffsModule, MessagingModule],
  controllers: [OrdersController, ShopOrdersController, PaymentsAdminController],
  providers: [OrdersService, PaymentsService, OrdersRunner],
  exports: [OrdersService],
})
export class OrdersModule {}
