import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AppError } from '../../common/errors';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { UsersService } from '../users/users.service';
import {
  ChallengeRefDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  StepUpStartDto,
  SwitchSpaceDto,
  VerifyCodeDto,
} from './dto';

/** Limites spécifiques aux routes d'authentification (en plus des limites par identifiant en base). */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Authentification')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
    private readonly users: UsersService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Public()
  @Get('username-availability')
  @ApiOperation({ summary: "Disponibilité d'un nom d'utilisateur (écran 04)" })
  usernameAvailability(@Query('username') username = '') {
    return this.auth.usernameAvailability(username);
  }

  @Public()
  @Throttle(STRICT)
  @Post('register')
  @ApiOperation({ summary: 'Inscription (Q13, écrans 04-05) ; envoie un code sur le téléphone (privilégié) ou l’e-mail' })
  register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.register(dto, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('register/verify')
  @HttpCode(200)
  @ApiOperation({ summary: "Confirme le code d'inscription, active le compte et ouvre une session" })
  async verifySignup(@Body() dto: VerifyCodeDto, @ReqMeta() meta: RequestMeta) {
    const pair = await this.auth.verifySignup(dto, meta);
    return { tokens: pair, me: await this.users.me(pair.userId) };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('codes/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renvoie un code (délai minimal entre deux envois, 5 envois maximum)' })
  resend(@Body() dto: ChallengeRefDto) {
    return this.auth.resendCode(dto.challengeId);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion par e-mail, téléphone ou @nom d’utilisateur + mot de passe (écran 03)' })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    const pair = await this.auth.login(dto, meta);
    return { tokens: pair, me: await this.users.me(pair.userId) };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Échange le jeton de rafraîchissement contre une nouvelle paire (rotation)' })
  async refresh(@Body() dto: RefreshDto, @ReqMeta() meta: RequestMeta) {
    return { tokens: await this.auth.refresh(dto.refreshToken, meta) };
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() a: AuthContext, @ReqMeta() meta: RequestMeta) {
    await this.auth.logout(a.userId, a.sessionId, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/forgot')
  @HttpCode(202)
  @ApiOperation({ summary: 'Mot de passe oublié : réponse identique que le compte existe ou non' })
  forgot(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.forgotPassword(dto, meta);
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Nouveau mot de passe avec le code reçu ; déconnecte tous les appareils' })
  async reset(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.resetPassword(dto, meta);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('step-up')
  @ApiOperation({ summary: 'Opération sensible, étape 1 : mot de passe, puis code envoyé sur une coordonnée vérifiée' })
  startStepUp(@CurrentAuth() a: AuthContext, @Body() dto: StepUpStartDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.startStepUp(a.userId, dto.scope, dto.password, meta);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @Post('step-up/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Opération sensible, étape 2 : code → autorisation à usage unique (en-tête X-Step-Up-Token)' })
  completeStepUp(@CurrentAuth() a: AuthContext, @Body() dto: VerifyCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.completeStepUp(a.userId, a.sessionId, dto, meta);
  }

  @ApiBearerAuth()
  @Post('switch-space')
  @HttpCode(200)
  @ApiOperation({ summary: "Changer d'espace (utilisateur, boutique, livreur) — écran 53" })
  switchSpace(@CurrentAuth() a: AuthContext, @Body() dto: SwitchSpaceDto, @ReqMeta() meta: RequestMeta) {
    return this.account.switchSpace(a.userId, a.sessionId, { type: dto.type, id: dto.id }, meta);
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Méthodes de connexion sociale réellement disponibles' })
  providers() {
    return {
      // Préparées mais désactivées : aucune n'est présentée comme opérationnelle tant qu'elle n'est pas intégrée.
      google: { configured: this.cfg.GOOGLE_CLIENT_IDS !== '', available: false },
      apple: { configured: this.cfg.APPLE_CLIENT_IDS !== '', available: false },
      facebook: { configured: this.cfg.FACEBOOK_APP_ID !== '', available: false },
    };
  }

  @Public()
  @Post('oauth/:provider')
  @ApiOperation({ summary: 'Connexion Google / Apple / Facebook — pas encore disponible' })
  oauth(@Param('provider') provider: string) {
    throw new AppError('NOT_CONFIGURED', `La connexion avec ${provider} n'est pas encore disponible.`, 503, { provider });
  }
}
