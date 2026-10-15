import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth } from '../auth/auth.decorators';
import { InboxQueryDto, NotificationPreferencesDto, RegisterDeviceDto } from './dto';
import { InboxService } from './inbox.service';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('v1/me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly inbox: InboxService,
  ) {}

  @Get('notifications')
  @ApiOperation({ summary: 'Centre de notifications (30 derniers jours) : coffres, réponses du support, rappels envoyés' })
  list(@CurrentAuth() a: AuthContext, @Query() q: InboxQueryDto) {
    return this.inbox.list(a.userId, q);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Nombre de notifications pas encore vues (pastille de la cloche)' })
  unread(@CurrentAuth() a: AuthContext) {
    return this.inbox.unreadCount(a.userId);
  }

  @Post('notifications/seen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tout ce qui est arrivé jusqu’à maintenant devient « vu »' })
  seen(@CurrentAuth() a: AuthContext) {
    return this.inbox.markSeen(a.userId);
  }

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

  @Get('reminders/upcoming')
  @ApiOperation({ summary: 'Rappels des prochaines heures à programmer sur cet appareil (vide si le serveur les envoie)' })
  upcoming(@CurrentAuth() a: AuthContext) {
    return this.notifications.upcoming(a.userId, a.sessionId);
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
