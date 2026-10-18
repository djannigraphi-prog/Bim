import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { WalletModule } from '../wallet/wallet.module';
import { LivesController } from './lives.controller';
import { LivesService } from './lives.service';

@Module({
  imports: [ProjectsModule, WalletModule],
  controllers: [LivesController],
  providers: [LivesService],
})
export class LivesModule {}
