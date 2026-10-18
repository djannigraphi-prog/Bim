import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { WalletController, WithdrawalsAdminController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [ProjectsModule],
  controllers: [WalletController, WithdrawalsAdminController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
