import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { Client } from 'pg';
import { STATE_FILE, testAdminUrl } from './test-db';

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;
  const { name } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { name: string };
  if (process.env.KEEP_TEST_DB !== '1') {
    const admin = new Client({ connectionString: testAdminUrl() });
    await admin.connect();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
  unlinkSync(STATE_FILE);
}
