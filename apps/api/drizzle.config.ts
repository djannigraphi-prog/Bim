import { defineConfig } from 'drizzle-kit';

// Génère les migrations SQL versionnées à partir du schéma TypeScript.
// Les fichiers produits dans src/database/migrations sont relus puis commités ; ils ne sont jamais modifiés après fusion.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://bim:bim@localhost:5432/bim_dev' },
  strict: true,
  verbose: true,
});
