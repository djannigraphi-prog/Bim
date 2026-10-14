# Variables d'environnement de l'API

Validées au démarrage par `apps/api/src/config/config.ts` : une valeur invalide ou dangereuse empêche l'API de démarrer.
Développement : fichier `apps/api/.env` (copié de `.env.example`, jamais commité). Staging et production : AWS Secrets Manager, injectées dans la tâche ECS.

| Variable | Défaut | Rôle | Contraintes |
| --- | --- | --- | --- |
| `NODE_ENV` | **aucun (obligatoire)** | development · test · staging · production | un oubli empêche le démarrage |
| `PORT` | 3000 | port HTTP | |
| `LOG_LEVEL` | info | niveau des journaux JSON | |
| `TRUST_PROXY` | 0 | **nombre** de proxys de confiance devant l'API | `1` derrière l'ALB AWS ; jamais `true` (le client pourrait choisir son IP via X-Forwarded-For) |
| `CORS_ORIGINS` | (vide) | origines web autorisées, séparées par des virgules | admin web uniquement |
| `HTTP_THROTTLE_ENABLED` | true | limitation de débit HTTP | `false` refusé en staging/production |
| `DATABASE_URL` | — | connexion PostgreSQL | obligatoire |
| `DATABASE_POOL_MAX` | 10 | connexions max par instance | |
| `JWT_ACCESS_SECRET` | — | signature des jetons d'accès | ≥ 32 caractères, différent de `OTP_SECRET` |
| `JWT_ACCESS_TTL_SECONDS` | 900 | durée d'un jeton d'accès | 60 à 3600 |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | durée d'une session sans activité | 1 à 90 |
| `STEP_UP_TTL_SECONDS` | 300 | durée d'une autorisation d'opération sensible | 60 à 900 |
| `OTP_SECRET` | — | empreinte des codes de vérification | ≥ 32 caractères |
| `OTP_TTL_SECONDS` | 600 | validité d'un code | |
| `OTP_MAX_ATTEMPTS` | 5 | essais par code | 3 à 10 |
| `OTP_RESEND_COOLDOWN_SECONDS` | 60 | délai entre deux envois | |
| `OTP_MAX_SENDS_PER_DESTINATION_PER_HOUR` | 6 | codes envoyés au même téléphone ou e-mail par heure | anti-bombardement et anti force brute |
| `SMS_PROVIDER` | none | console · test · none (fournisseur réel au lot 2) | console/test refusés hors development/test |
| `EMAIL_PROVIDER` | none | idem | idem |
| `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `FACEBOOK_APP_ID` | (vide) | connexions sociales (pas encore intégrées) | |
| `DEFAULT_PHONE_REGION` | CI | région pour lire un numéro sans indicatif | |

Tests e2e uniquement : `TEST_DATABASE_ADMIN_URL` (défaut `postgres://bim:bim@localhost:5432/postgres`), `KEEP_TEST_DB=1` pour garder la base après les tests.

Application mobile : `--dart-define=BIM_API_URL=…` et `--dart-define=BIM_ENV=dev|staging|production`. Aucun secret dans l'application.
