import { Module } from '@nestjs/common';
import { ShopInvitationsController, ShopTeamController } from './shop-team.controller';
import { ShopTeamService } from './shop-team.service';

/** Lot 7-A — Équipe des boutiques et permissions des employés (A16). */
@Module({
  controllers: [ShopTeamController, ShopInvitationsController],
  providers: [ShopTeamService],
  exports: [ShopTeamService],
})
export class ShopTeamModule {}
