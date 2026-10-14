import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildOpenApi, createApp } from './bootstrap';

/** Écrit packages/api-contract/openapi.json, source des clients générés (Dart pour le mobile, TypeScript pour l'admin). */
async function main(): Promise<void> {
  const app = await createApp();
  const doc = buildOpenApi(app);
  const out = path.resolve(__dirname, '../../../packages/api-contract/openapi.json');
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI écrit dans ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
