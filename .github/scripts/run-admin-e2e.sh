#!/usr/bin/env bash
# Prépare la base et l'API, crée les comptes de TEST, puis lance le test navigateur de l'administration.
# Variables attendues : DATABASE_URL, JWT_ACCESS_SECRET, OTP_SECRET, ADMIN_TOTP_ENCRYPTION_KEY (valeurs de test).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${RUNNER_TEMP:-/tmp}/admin-e2e-api.log"
export NODE_ENV=development SMS_PROVIDER=console EMAIL_PROVIDER=console PORT=3000 CORS_ORIGINS=http://localhost:5173 LOG_LEVEL=info
# Stockage local de test : l'image jointe à un signalement doit s'afficher dans l'administration.
export MEDIA_STORAGE=local MEDIA_LOCAL_DIR="${RUNNER_TEMP:-/tmp}/admin-e2e-media"
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
const sharp = require('sharp');
const fs = require('fs');
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const id = uuidv7();
  const c = await p.connect();
  await c.query('begin'); // F16 : compte actif et coordonnée vérifiée dans la même transaction
  await c.query(\"insert into users (id, status, full_name, username, birth_date, city) values (\$1, 'active', 'Utilisateur Test', \$2, '2000-01-01', 'Cocody')\", [id, process.env.ADMIN_E2E_APP_USERNAME]);
  await c.query(\"insert into user_contacts (id, user_id, type, value, verified_at) values (\$1, \$2, 'phone', \$3, now())\", [uuidv7(), id, '+22507' + String(Date.now()).slice(-8)]);
  // Un projet et un signalement de test, pour la page « Signalements ».
  const pid = uuidv7();
  await c.query(\"insert into projects (id, user_id, category_code, title, mode, start_date, duration_days, planned_end_date) values (\$1, \$2, 'sport', 'Projet de test', 'eco', current_date, 30, current_date + 29)\", [pid, id]);
  await c.query(\"insert into project_reports (id, project_id, user_id, day, reason, message) values (\$1, \$2, \$3, current_date, 'unavailable', 'Salle fermée (test)')\", [uuidv7(), pid, id]);
  // Un signalement général (« Résoudre un problème ») avec une capture d'écran jointe, stockée en privé.
  const rid = uuidv7();
  const key = 'reports/' + id + '/' + rid + '.jpg';
  fs.mkdirSync(process.env.MEDIA_LOCAL_DIR + '/reports/' + id, { recursive: true });
  fs.writeFileSync(process.env.MEDIA_LOCAL_DIR + '/' + key, await sharp({ create: { width: 320, height: 200, channels: 3, background: 'orange' } }).jpeg().toBuffer());
  await c.query(\"insert into project_reports (id, context, user_id, reason, message, attachment_key, attachment_width, attachment_height, attachment_bytes) values (\$1, 'general', \$2, 'app', 'Le bouton Continuer ne réagit pas (test)', \$3, 320, 200, 1000)\", [rid, id, key]);
  // Lot 4 : une publication avec une photo, signalée par une autre personne, pour la page « Modération ».
  const rep = uuidv7();
  await c.query(\"insert into users (id, status, full_name, username, birth_date, city) values (\$1, 'active', 'Signaleur Test', \$2, '2000-01-01', 'Yopougon')\", [rep, 'signal.' + String(Date.now()).slice(-7)]);
  await c.query(\"insert into user_contacts (id, user_id, type, value, verified_at) values (\$1, \$2, 'phone', \$3, now())\", [uuidv7(), rep, '+22501' + String(Date.now()).slice(-8)]);
  const post = uuidv7();
  const pkey = 'posts/' + post + '/' + uuidv7() + '.jpg';
  fs.mkdirSync(process.env.MEDIA_LOCAL_DIR + '/posts/' + post, { recursive: true });
  fs.writeFileSync(process.env.MEDIA_LOCAL_DIR + '/' + pkey, await sharp({ create: { width: 240, height: 300, channels: 3, background: 'purple' } }).jpeg().toBuffer());
  await c.query(\"insert into posts (id, user_id, kind, text, visibility) values (\$1, \$2, 'post', 'Achetez mes produits miracles (test)', 'public')\", [post, id]);
  await c.query(\"insert into post_media (id, post_id, position, kind, storage_key, width, height, bytes) values (\$1, \$2, 0, 'image', \$3, 240, 300, 1000)\", [uuidv7(), post, pkey]);
  await c.query(\"insert into content_reports (id, reporter_id, target_type, target_id, target_user_id, reason, message) values (\$1, \$2, 'post', \$3, \$4, 'spam', 'Publicité (test)')\", [uuidv7(), rep, post, id]);
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
