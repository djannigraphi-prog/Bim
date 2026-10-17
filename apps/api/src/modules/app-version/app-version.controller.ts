import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators';
import { AppVersionGuard } from './app-version.guard';

@ApiTags('Application')
@Controller('v1/app')
export class AppVersionController {
  constructor(private readonly guard: AppVersionGuard) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Version minimale de l’app par plateforme (null : aucune exigence)' })
  async config() {
    return { minVersion: { android: await this.guard.minimum('android'), ios: await this.guard.minimum('ios') } };
  }
}
