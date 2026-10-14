import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { runMigrations } from '../src/database/migrate';
import { STATE_FILE, testAdminUrl, withDatabase } from './test-db';

/**
 * Crée une base PostgreSQL vierge et dédiée à cette exécution, puis applique toutes les migrations.
 * Les tests e2e tournent donc contre le vrai schéma, contraintes et déclencheurs compris.
 * Prérequis : un PostgreSQL accessible via TEST_DATABASE_ADMIN_URL (défaut : postgres://bim:bim@localhost:5432/postgres).
 */
export default async function globalSetup(): Promise<void> {
  const name = `bim_test_${Date.now()}_${process.pid}`;
  const admin = new Client({ connectionString: testAdminUrl() });
  await admin.connect();
  await admin.query(`create database "${name}"`);
  await admin.end();
  const url = withDatabase(testAdminUrl(), name);
  await runMigrations(url);
  writeFileSync(STATE_FILE, JSON.stringify({ name, url }));
}
