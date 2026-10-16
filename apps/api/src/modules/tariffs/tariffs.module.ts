import { Module } from '@nestjs/common';
import { TariffsAdminController, TariffsController } from './tariffs.controller';
import { TariffsService } from './tariffs.service';

@Module({ controllers: [TariffsController, TariffsAdminController], providers: [TariffsService], exports: [TariffsService] })
export class TariffsModule {}
