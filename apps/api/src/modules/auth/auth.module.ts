import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { UsersService } from '../users/users.service';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { StepUpService } from './step-up.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.JWT_ACCESS_SECRET, signOptions: { algorithm: 'HS256', issuer: 'bim-api', audience: 'bim-app' }, verifyOptions: { algorithms: ['HS256'], issuer: 'bim-api', audience: 'bim-app' } }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    AccountService,
    PasswordService,
    SessionService,
    StepUpService,
    VerificationService,
    UsersService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
