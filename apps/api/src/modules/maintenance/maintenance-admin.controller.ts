import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AccountPurgeService } from './account-purge.service';
import { PeniRetentionService } from './peni-retention.service';

/** Maintenance dans l'administration : état et simulation (jamais de suppression depuis ces routes). */
@ApiTags('Administration')
@Controller('admin/v1/maintenance')
export class MaintenanceAdminController {
  constructor(
    private readonly purge: AccountPurgeService,
    private readonly peniRetention: PeniRetentionService,
  ) {}

  @Get('account-purge')
  @AdminRoute('system.health')
  @ApiOperation({ summary: 'Purge des comptes jamais vérifiés : réglages effectifs et derniers passages' })
  overview() {
    return this.purge.overview();
  }

  @Post('account-purge/simulate')
  @HttpCode(200)
  @AdminRoute('system.health')
  @ApiOperation({ summary: 'Simulation de la purge : compte les comptes concernés, ne supprime rien' })
  simulate(@CurrentAdmin() a: AdminContext) {
    return this.purge.simulate(a.adminId);
  }

  @Get('peni-retention')
  @AdminRoute('system.health')
  @ApiOperation({ summary: 'Conservation des discussions avec Peni : durée réglée, discussions expirées, derniers passages' })
  peniRetentionOverview() {
    return this.peniRetention.overview();
  }
}
