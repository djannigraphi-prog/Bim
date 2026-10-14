import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Applique les migrations versionnées (src/database/migrations) dans l'ordre, une seule fois chacune. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(__dirname, 'migrations') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL manquant');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations appliquées.'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
