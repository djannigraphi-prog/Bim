import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { SocialModule } from '../social/social.module';
import { AccountPurgeService } from './account-purge.service';
import { MaintenanceAdminController } from './maintenance-admin.controller';
import { MaintenanceRunner } from './maintenance-runner';
import { KycRetentionService } from './kyc-retention.service';
import { PeniRetentionService } from './peni-retention.service';

/**
 * Tâches de maintenance : purge des comptes jamais vérifiés (lot 2, désactivée et en simulation par défaut) et
 * conservation des discussions avec Peni (lot 3, inactive tant que la durée n'est pas validée).
 */
@Module({
  imports: [SocialModule, MediaModule],
  controllers: [MaintenanceAdminController],
  providers: [AccountPurgeService, PeniRetentionService, KycRetentionService, MaintenanceRunner],
  exports: [AccountPurgeService, PeniRetentionService, KycRetentionService],
})
export class MaintenanceModule {}
