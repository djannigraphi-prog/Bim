import { Module } from '@nestjs/common';
import { AccountPurgeService } from './account-purge.service';
import { MaintenanceAdminController } from './maintenance-admin.controller';
import { MaintenanceRunner } from './maintenance-runner';

/** Tâches de maintenance (lot 2 : purge des comptes jamais vérifiés, désactivée et en simulation par défaut). */
@Module({
  controllers: [MaintenanceAdminController],
  providers: [AccountPurgeService, MaintenanceRunner],
  exports: [AccountPurgeService],
})
export class MaintenanceModule {}
