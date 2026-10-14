# BIM — Beauté, Image et Motivation

Application mobile ivoirienne d'amélioration personnelle (physique, esthétique, style) qui relie projets accompagnés par Peni, réseau social, BimShop, Lives, messagerie, livraisons et monétisation des créateurs.

> **État : lot 0 (fondations) en cours.** Voir `PROJECT_STATUS.md` pour ce qui fonctionne réellement, ce qui reste à faire et les tests exécutés.

## Organisation du dépôt

```
bim/
├─ apps/
│  ├─ api/            API NestJS (TypeScript) — monolithe modulaire, PostgreSQL via Drizzle
│  ├─ mobile/         Application Flutter (Android + iOS)
│  └─ admin/          Administration web (non commencée)
├─ packages/
│  └─ api-contract/   openapi.json généré depuis l'API
├─ infra/             docker-compose (développement) ; Terraform AWS à venir
├─ docs/              analyse, installation, variables, base, tests, déploiement, sauvegarde, conventions…
├─ scripts/           outils (PostgreSQL local sans Docker)
├─ PROJECT_STATUS.md  état réel du projet, note de reprise
└─ DECISIONS.md       décisions du fondateur et décisions techniques, avec leur statut
```

## Démarrage rapide

```bash
docker compose -f infra/docker-compose.yml up -d          # PostgreSQL 16
cd apps/api && npm ci && cp .env.example .env            # puis générer les deux secrets (voir le fichier)
set -a; . ./.env; set +a && npm run db:migrate && npm run start:dev
npm test                                                  # unitaires + bout en bout
```

Application mobile : `docs/INSTALLATION.md`, section 3.

## Documentation

| Sujet | Fichier |
| --- | --- |
| Analyse produit et technique (référence) | `docs/ANALYSE.md` |
| Décisions et questions en attente | `DECISIONS.md` |
| État du projet et reprise | `PROJECT_STATUS.md` |
| Installation | `docs/INSTALLATION.md` |
| Variables d'environnement | `docs/ENVIRONMENT.md` |
| Erreurs de l'API | `docs/API_ERRORS.md` |
| API (contrat) | `packages/api-contract/openapi.json` · `/docs` en développement |
| Base de données | `docs/DATABASE.md` |
| Tests | `docs/TESTING.md` |
| Déploiement | `docs/DEPLOYMENT.md` |
| Sauvegarde et restauration | `docs/BACKUP_RESTORE.md` |
| Services externes | `docs/EXTERNAL_SERVICES.md` |
| Conventions et Git | `docs/CONVENTIONS.md`, `CONTRIBUTING.md` |
| Arrivée d'un développeur | `docs/ONBOARDING.md` |

## Règles qui ne se négocient pas

- Les décisions du fondateur sont respectées ; une règle non décidée reste fermée et figure dans `DECISIONS.md`.
- Le serveur décide : prix, soldes, droits, âges et espaces sont vérifiés par l'API, jamais seulement par l'app.
- Aucune fonction n'est présentée comme opérationnelle si son intégration n'existe pas (« Bientôt disponible »).
- Aucun secret dans Git.
