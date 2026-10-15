import { Module } from '@nestjs/common';
import { AccountPurgeService } from './account-purge.service';
import { MaintenanceAdminController } from './maintenance-admin.controller';
import { MaintenanceRunner } from './maintenance-runner';
import { PeniRetentionService } from './peni-retention.service';

/**
 * Tâches de maintenance : purge des comptes jamais vérifiés (lot 2, désactivée et en simulation par défaut) et
 * conservation des discussions avec Peni (lot 3, inactive tant que la durée n'est pas validée).
 */
@Module({
  controllers: [MaintenanceAdminController],
  providers: [AccountPurgeService, PeniRetentionService, MaintenanceRunner],
  exports: [AccountPurgeService, PeniRetentionService],
})
export class MaintenanceModule {}
