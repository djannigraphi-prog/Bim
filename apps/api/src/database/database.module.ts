import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Type d'une transaction Drizzle : les services acceptent `Database | Tx` pour pouvoir participer à une transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        new Pool({ connectionString: cfg.DATABASE_URL, max: cfg.DATABASE_POOL_MAX, application_name: 'bim-api' }),
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool): Database => drizzle(pool, { schema }) },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
