import { tmpdir } from 'node:os';
import path from 'node:path';

export const STATE_FILE = path.join(tmpdir(), 'bim-api-e2e-db.json');

export function testAdminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://bim:bim@localhost:5432/postgres';
}

export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
