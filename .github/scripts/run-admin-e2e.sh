#!/usr/bin/env bash
# Prépare la base et l'API, crée les comptes de TEST, puis lance le test navigateur de l'administration.
# Variables attendues : DATABASE_URL, JWT_ACCESS_SECRET, OTP_SECRET, ADMIN_TOTP_ENCRYPTION_KEY (valeurs de test).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${RUNNER_TEMP:-/tmp}/admin-e2e-api.log"
export NODE_ENV=development SMS_PROVIDER=console EMAIL_PROVIDER=console PORT=3000 CORS_ORIGINS=http://localhost:5173 LOG_LEVEL=info
export ADMIN_E2E_EMAIL="admin.e2e.$(date +%s)@bim.test"
export ADMIN_E2E_PASSWORD="Admin-E2E-$(openssl rand -hex 8)"
export ADMIN_E2E_APP_USERNAME="e2e.user$(date +%s | tail -c 7)"

cd "$ROOT/apps/api"
npm run build >/dev/null
node dist/database/migrate.js
ADMIN_PASSWORD="$ADMIN_E2E_PASSWORD" node dist/admin-cli.js --email "$ADMIN_E2E_EMAIL" --name "Admin E2E" --roles super_admin
# Compte d'application de test, créé directement en base (il n'a pas besoin de se connecter).
node -e "
const { Pool } = require('pg');
const { uuidv7 } = require('./dist/common/uuid');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = uuidv7();
  const c = await p.connect();
  await c.query('begin'); // F16 : compte actif et coordonnée vérifiée dans la même transaction
  await c.query(\"insert into users (id, status, full_name, username, birth_date, city) values (\$1, 'active', 'Utilisateur Test', \$2, '2000-01-01', 'Cocody')\", [id, process.env.ADMIN_E2E_APP_USERNAME]);
  await c.query(\"insert into user_contacts (id, user_id, type, value, verified_at) values (\$1, \$2, 'phone', \$3, now())\", [uuidv7(), id, '+22507' + String(Date.now()).slice(-8)]);
  await c.query('commit');
  c.release();
  await p.end();
})().catch((e) => { console.error(e); process.exit(1); });
"
node dist/main.js > "$LOG" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf localhost:3000/health >/dev/null && break; sleep 1; done

cd "$ROOT/apps/admin"
VITE_API_URL=http://localhost:3000 npx playwright test
