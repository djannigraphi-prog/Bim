import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoute } from '../admin/admin.decorators';
import { ReminderWorkerService } from './reminder-worker.service';

/** Surveillance des rappels dans l'administration (même état que les alertes CloudWatch). */
@ApiTags('Administration')
@Controller('admin/v1/reminders')
export class RemindersAdminController {
  constructor(private readonly worker: ReminderWorkerService) {}

  @Get('health')
  @AdminRoute('system.health')
  @ApiOperation({ summary: 'État des rappels : worker, retards, envois de la dernière heure' })
  health() {
    return this.worker.health();
  }
}
