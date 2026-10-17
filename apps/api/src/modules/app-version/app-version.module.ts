import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppVersionController } from './app-version.controller';
import { AppVersionGuard } from './app-version.guard';

@Module({
  controllers: [AppVersionController],
  providers: [AppVersionGuard, { provide: APP_GUARD, useExisting: AppVersionGuard }],
})
export class AppVersionModule {}
