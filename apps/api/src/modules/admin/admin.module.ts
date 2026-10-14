import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { PasswordService } from '../auth/password.service';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { ADMIN_CLOCK, AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminService,
    PasswordService,
    { provide: ADMIN_CLOCK, useValue: { now: () => Date.now() } },
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
})
export class AdminModule {}
