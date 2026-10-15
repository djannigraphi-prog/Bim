import { Body, Controller, Delete, Get, HttpCode, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth } from '../auth/auth.decorators';
import { NotificationPreferencesDto, RegisterDeviceDto } from './dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('v1/me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Put('push-device')
  @ApiOperation({ summary: 'Jeton de notification de cet appareil (remplacé à chaque renouvellement)' })
  register(@CurrentAuth() a: AuthContext, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(a.userId, a.sessionId, dto);
  }

  @Delete('push-device')
  @HttpCode(204)
  @ApiOperation({ summary: 'Ne plus recevoir de notifications sur cet appareil' })
  async remove(@CurrentAuth() a: AuthContext) {
    await this.notifications.removeDevice(a.sessionId);
  }

  @Get('notification-preferences')
  @ApiOperation({ summary: 'Préférences de notification (rappels, heures calmes)' })
  preferences(@CurrentAuth() a: AuthContext) {
    return this.notifications.preferences(a.userId);
  }

  @Patch('notification-preferences')
  @ApiOperation({ summary: 'Modifier les préférences de notification' })
  update(@CurrentAuth() a: AuthContext, @Body() dto: NotificationPreferencesDto) {
    return this.notifications.updatePreferences(a.userId, dto);
  }
}
