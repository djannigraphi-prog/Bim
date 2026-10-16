import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { OrdersRunner } from './orders-runner';
import { OrdersController, ShopOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TariffsModule, MessagingModule],
  controllers: [OrdersController, ShopOrdersController],
  providers: [OrdersService, OrdersRunner],
  exports: [OrdersService],
})
export class OrdersModule {}
