#!/bin/sh
# Démonstration gratuite : clés propres à cet ordinateur (créées au premier démarrage, gardées dans le volume /data,
# jamais dans le dépôt), migrations, données de démo, puis l'API.
set -e
if [ ! -f /data/secrets.env ]; then
  node -e "
    const c = require('crypto');
    const r = (n) => c.randomBytes(n).toString('base64url');
    console.log('export JWT_ACCESS_SECRET=' + r(48));
    console.log('export OTP_SECRET=' + r(48));
    console.log('export ADMIN_TOTP_ENCRYPTION_KEY=' + c.randomBytes(32).toString('base64'));
    console.log('export KYC_ENCRYPTION_KEY=' + c.randomBytes(32).toString('base64'));
  " > /data/secrets.env
fi
. /data/secrets.env
node dist/database/migrate.js
node dist/demo/seed.js
exec node dist/main.js
