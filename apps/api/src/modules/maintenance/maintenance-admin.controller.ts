import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminContext, AdminRoute, CurrentAdmin } from '../admin/admin.decorators';
import { AccountPurgeService } from './account-purge.service';

/** Purge des comptes jamais vérifiés dans l'administration : état et simulation (jamais de suppression d'ici). */
@ApiTags('Administration')
@Controller('admin/v1/maintenance/account-purge')
export class MaintenanceAdminController {
  constructor(private readonly purge: AccountPurgeService) {}

  @Get()
  @AdminRoute('system.health')
  @ApiOperation({ summary: 'Purge des comptes jamais vérifiés : réglages effectifs et derniers passages' })
  overview() {
    return this.purge.overview();
  }

  @Post('simulate')
  @HttpCode(200)
  @AdminRoute('system.health')
  @ApiOperation({ summary: 'Simulation de la purge : compte les comptes concernés, ne supprime rien' })
  simulate(@CurrentAdmin() a: AdminContext) {
    return this.purge.simulate(a.adminId);
  }
}
