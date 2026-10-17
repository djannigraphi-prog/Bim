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
  @ApiOperation({ summary: 'Versions de l’app par plateforme : recommandée (rappel non bloquant) et minimale (blocage, strict nécessaire) ; null : rien' })
  async config() {
    return {
      minVersion: { android: await this.guard.minimum('android'), ios: await this.guard.minimum('ios') },
      recommendedVersion: { android: await this.guard.recommended('android'), ios: await this.guard.recommended('ios') },
    };
  }
}
