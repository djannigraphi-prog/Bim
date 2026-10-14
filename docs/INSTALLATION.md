# Installation et lancement (développement)

## Prérequis

| Outil | Version | Usage |
| --- | --- | --- |
| Node.js | 22 LTS | API |
| npm | 10+ | dépendances API |
| PostgreSQL | 16 | base de données (via Docker ou installé localement) |
| Docker + Compose | récent | méthode standard pour PostgreSQL |
| Flutter | 3.27+ (Dart 3.5+) | application mobile |
| Android Studio / Xcode | récents | émulateurs, signature |

## 1. Base de données

Méthode standard :

```bash
docker compose -f infra/docker-compose.yml up -d     # PostgreSQL 16 sur localhost:5432 (bim / bim, base bim_dev)
```

Sans Docker (PostgreSQL 16 déjà installé, Linux) :

```bash
scripts/local-postgres.sh start
```

## 2. API

```bash
cd apps/api
npm ci
cp .env.example .env            # puis remplacer JWT_ACCESS_SECRET et OTP_SECRET : openssl rand -hex 32 (deux fois)
set -a; . ./.env; set +a
npm run db:migrate              # applique les migrations versionnées
npm run start:dev               # http://localhost:3000 — documentation interactive : http://localhost:3000/docs
```

En développement, les codes de vérification (SMS, e-mail) s'affichent dans la console de l'API (`[ENVOI FACTICE …]`). Ce mode est refusé au démarrage en staging et en production.

## 3. Application mobile

Les dossiers `android/` et `ios/` ne sont pas encore générés (le SDK Flutter n'était pas disponible lors de la session 1). Une seule fois :

```bash
cd apps/mobile
flutter create --org ci.bim --project-name bim --platforms android,ios .   # ne touche pas à lib/ ni pubspec.yaml
flutter pub get
flutter analyze && flutter test
flutter run --dart-define=BIM_API_URL=http://10.0.2.2:3000     # émulateur Android
```

Ensuite : remplacer l'icône par `assets/brand/app_icon.svg` (exportée en PNG aux tailles requises), nommer l'application « BIM ».

## 3 bis. Administration web

```bash
cd apps/api && ADMIN_PASSWORD='un-mot-de-passe-long' npm run admin:create -- --email toi@exemple.ci --name "Ton nom" --roles super_admin
cd ../admin && npm ci && VITE_API_URL=http://localhost:3000 npm run dev    # http://localhost:5173
```
À la première connexion, scanne le QR code avec une application d'authentification (double authentification obligatoire). Voir `apps/admin/README.md`.

## 4. Vérifier que tout fonctionne

```bash
curl localhost:3000/health                       # {"status":"ok","database":"ok",…}
cd apps/api && npm test                          # tests unitaires + e2e (crée puis supprime une base de test)
```
