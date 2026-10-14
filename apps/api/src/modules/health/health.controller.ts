import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { Public } from '../auth/auth.decorators';

@ApiTags('Santé')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Utilisé par l'hébergeur (ECS) et la surveillance : 200 si l'API et la base répondent. */
  @Public()
  @Get()
  async check() {
    const started = Date.now();
    await this.pool.query('select 1');
    return { status: 'ok', database: 'ok', databaseLatencyMs: Date.now() - started, version: process.env.npm_package_version ?? '0.1.0' };
  }
}
