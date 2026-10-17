# Variables d'environnement de l'API

Validées au démarrage par `apps/api/src/config/config.ts` : une valeur invalide ou dangereuse empêche l'API de démarrer.
Développement : fichier `apps/api/.env` (copié de `.env.example`, jamais commité). Staging et production : AWS Secrets Manager, injectées dans la tâche ECS.

| Variable | Défaut | Rôle | Contraintes |
| --- | --- | --- | --- |
| `NODE_ENV` | **aucun (obligatoire)** | development · test · staging · production | un oubli empêche le démarrage |
| `PORT` | 3000 | port HTTP | |
| `LOG_LEVEL` | info | niveau des journaux JSON | |
| `TRUST_PROXY` | 0 | **nombre** de proxys de confiance devant l'API | `1` derrière l'ALB AWS ; jamais `true` (le client pourrait choisir son IP via X-Forwarded-For). **Obligatoire (≥ 1) hors développement** : l'API refuse de démarrer sinon (audit du 16/10/2026) |
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
| `MEDIA_STORAGE` | none | stockage des photos privées : `local` (développement/tests), `s3`, `none` (fonction fermée) | `local` refusé hors development/test |
| `MEDIA_LOCAL_DIR` | ./.media | dossier du stockage local | |
| `MEDIA_URL_TTL_SECONDS` | 300 | durée de validité d'un lien de photo | 30 à 3600 |
| `MEDIA_MAX_UPLOAD_MB` | 10 | taille maximale d'une photo envoyée | 1 à 25 |
| `KYC_ENCRYPTION_KEY` | (vide) | clé de chiffrement des pièces d'identité des marchands (lot 5), 32 octets en base64 | Différente de `ADMIN_TOTP_ENCRYPTION_KEY` ; sans elle, l'ouverture des boutiques répond « non configurée ». En production : AWS Secrets Manager, jamais dans Git |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | — , eu-west-3, — | compartiment privé (S3_ENDPOINT seulement pour un stockage compatible, ex. MinIO en test) ; identifiants par le rôle IAM de la tâche ECS | `S3_BUCKET` obligatoire si `s3` |
| `ADMIN_TOTP_ENCRYPTION_KEY` | — | clé de chiffrement des secrets de double authentification des administrateurs | **obligatoire**, 32 octets en base64 (`openssl rand -base64 32`) ; ne jamais la changer sans réenrôler les admins |
| `ADMIN_SESSION_TTL_MINUTES` | 480 | durée d'une session d'administration | 15 à 720 |
| `ADMIN_LOGIN_MAX_FAILURES` | 5 | échecs (mot de passe ou code) avant verrouillage | 3 à 10 |
| `ADMIN_LOCK_MINUTES` | 15 | durée du verrouillage et de la fenêtre de comptage | 5 à 1440 |
| `WORKER_MODE` | off | rappels (lot 2) : `off` (aucun envoi), `embedded` (dans le processus de l'API), `standalone` (service séparé `npm run start:worker`) | `PUSH_PROVIDER` obligatoire si différent de `off` ; le réglage `notifications.reminders_enabled` reste un second interrupteur |
| `WORKER_HEALTH_PORT` | 3100 | port du contrôle de santé `/health` du worker séparé (200 = ok/dégradé/désactivé, 503 = arrêté) | |
| `PUSH_PROVIDER` | none | envoi des notifications : `none`, `fcm` (Firebase), `test` (mémoire) | `test` refusé hors development/test |
| `PAYMENT_PROVIDER` | none | paiement en ligne (lot 8) : `none` (fermé), `simulator` (tests) ou `paystack` (clé de test seulement) ; aucun prestataire réel sans autorisation du fondateur | `simulator` refusé hors development/test ; le réglage `payments.online_enabled` reste un second interrupteur |
| `PAYMENT_SIMULATOR_SECRET` | (vide) | secret de signature des notifications du simulateur (valeur de test) | 16 caractères au moins avec `simulator` |
| `PAYSTACK_SECRET_KEY` | (vide) | clé secrète Paystack — **secret**, **clé de test seulement** (`sk_test_…`) | obligatoire avec `PAYMENT_PROVIDER=paystack` ; une clé de production est refusée |
| `PAYSTACK_API_BASE_URL` | (vide) | adresse de l'API remplacée par un faux serveur (tests) | refusée hors development/test |
| `PAYMENT_CALLBACK_URL` | (vide) | page de retour après le paiement | facultative |
| `PAYMENT_CUSTOMER_EMAIL_DOMAIN` | (vide) | domaine des adresses techniques transmises au prestataire quand le client n'a pas d'e-mail vérifié | obligatoire avec Paystack |
| `FCM_SERVICE_ACCOUNT_JSON` | (vide) | compte de service Firebase (JSON) — **secret**, injecté depuis Parameter Store chiffré ou Secrets Manager | obligatoire et vérifié si `PUSH_PROVIDER=fcm` |
| `PENI_LLM_PROVIDER` | none | fournisseur d'IA de Peni (lot 3) : seule valeur acceptée `none` (discussion guidée, aucune donnée envoyée) | un fournisseur ne sera ajouté qu'après accord du fondateur ; réglage `peni.llm_enabled` comme second interrupteur |
| `FCM_API_BASE_URL`, `FCM_TOKEN_URL` | (vide) | adresses de remplacement pour tester contre un faux serveur | refusées hors development/test |

Tests e2e uniquement : `TEST_DATABASE_ADMIN_URL` (défaut `postgres://bim:bim@localhost:5432/postgres`), `KEEP_TEST_DB=1` pour garder la base après les tests.

Administration web : `VITE_API_URL` (adresse de l'API) ; l'origine de l'administration doit figurer dans `CORS_ORIGINS` de l'API.

Application mobile : `--dart-define=BIM_API_URL=…` et `--dart-define=BIM_ENV=dev|staging|production`. Aucun secret dans l'application.
