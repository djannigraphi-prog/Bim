import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { SpacesService } from '../spaces/spaces.service';
import { UsersService } from '../users/users.service';
import { AccountService } from './account.service';
import { AuthContext, CurrentAuth, RequireStepUp } from './auth.decorators';
import { AddContactDto, ChangePasswordDto, UpdatePreferencesDto, VerifyCodeDto } from './dto';
import { SessionService } from './session.service';

const STEP_UP_HEADER = { name: 'X-Step-Up-Token', required: true, description: 'Autorisation obtenue via /v1/auth/step-up/verify' };

@ApiTags('Mon compte')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly account: AccountService,
    private readonly sessions: SessionService,
    private readonly spaces: SpacesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mon profil privé complet' })
  me(@CurrentAuth() a: AuthContext) {
    return this.users.me(a.userId);
  }

  @Get('capabilities')
  @ApiOperation({ summary: "Ce que l'âge permet (F15), calculé par le serveur" })
  capabilities(@CurrentAuth() a: AuthContext) {
    return this.users.capabilities(a.userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Thème clair / sombre / système (écran 62) et fuseau horaire' })
  preferences(@CurrentAuth() a: AuthContext, @Body() dto: UpdatePreferencesDto) {
    return this.users.updatePreferences(a.userId, { theme: dto.theme, timezone: dto.timezone });
  }

  @Post('contacts')
  @RequireStepUp('contact_change')
  @ApiHeader(STEP_UP_HEADER)
  @ApiOperation({ summary: 'Ajouter un téléphone ou un e-mail (opération sensible) ; un code y est envoyé' })
  addContact(@CurrentAuth() a: AuthContext, @Body() dto: AddContactDto, @ReqMeta() meta: RequestMeta) {
    return this.account.addContact(a.userId, dto, meta);
  }

  @Post('contacts/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmer la nouvelle coordonnée avec le code reçu' })
  verifyContact(@CurrentAuth() a: AuthContext, @Body() dto: VerifyCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.account.verifyContact(a.userId, dto, meta);
  }

  @Delete('contacts/:id')
  @RequireStepUp('contact_change')
  @ApiHeader(STEP_UP_HEADER)
  @ApiOperation({ summary: 'Retirer une coordonnée (jamais la dernière vérifiée)' })
  removeContact(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.account.removeContact(a.userId, id, meta);
  }

  @Post('password')
  @HttpCode(204)
  @RequireStepUp('password_change')
  @ApiHeader(STEP_UP_HEADER)
  @ApiOperation({ summary: 'Changer de mot de passe ; les autres appareils sont déconnectés' })
  async changePassword(@CurrentAuth() a: AuthContext, @Body() dto: ChangePasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.account.changePassword(a.userId, a.sessionId, dto.newPassword, meta);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Appareils connectés' })
  async listSessions(@CurrentAuth() a: AuthContext) {
    return { items: await this.sessions.listActive(a.userId), currentSessionId: a.sessionId };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Déconnecter un appareil' })
  async revokeSession(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.account.revokeSession(a.userId, id, meta);
  }

  @Get('spaces')
  @ApiOperation({ summary: 'Mes espaces : utilisateur, boutiques, compte livreur (écran 53)' })
  async listSpaces(@CurrentAuth() a: AuthContext) {
    return { items: await this.spaces.list(a.userId), active: a.space };
  }
}
