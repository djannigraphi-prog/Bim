# Conventions

## Langues
- Code, noms de tables, de colonnes et d'API : **anglais**.
- Interface, messages d'erreur, documentation métier, commentaires expliquant une règle BIM : **français**.

## Nommage
| Élément | Convention | Exemple |
| --- | --- | --- |
| Tables et colonnes | `snake_case`, tables au pluriel | `user_contacts.verified_at` |
| TypeScript | `camelCase` (variables), `PascalCase` (classes) | `AgePolicyService` |
| Fichiers TypeScript | `kebab-case.type.ts` | `step-up.service.ts` |
| Dart | `snake_case.dart`, classes `PascalCase` | `verify_code_screen.dart` |
| Routes API | `/v1/<ressource>` au pluriel, verbes HTTP | `POST /v1/me/contacts` |
| Codes d'erreur | `MAJUSCULES_SOULIGNÉES`, stables | `LAST_RECOVERY_CONTACT` |
| Réglages | `domaine.nom` | `age.min_registration` |

## Organisation
- API : `src/modules/<domaine>/` = contrôleurs (minces), services (règles), DTO (validation). Les règles importantes sont appliquées par l'API, jamais seulement par l'app.
- Mobile : `lib/features/<domaine>/{data,application,presentation}` ; `lib/core/` pour le transverse. Aucune couleur ni taille en dur : tout vient de `core/theme/tokens.dart`.
- Une valeur métier (tarif, âge, plafond, limite) ne s'écrit jamais en dur : elle vient de `app_settings`.
- Une fonction non intégrée affiche « Bientôt disponible » ; jamais de simulation présentée comme réelle.

## Git
- `main` protégée : fusion par pull request, CI verte, une relecture minimum.
- Branches : `feat/<module>-<sujet>`, `fix/<module>-<sujet>`, `docs/<sujet>`, `chore/<sujet>`.
- Commits conventionnels : `feat(auth): …`, `fix(projects): …`, `docs: …`, `test(auth): …`.
- Une pull request = un sujet ; elle met à jour la documentation et `PROJECT_STATUS.md` si l'état change.
- Jamais de secret, de `.env`, de clé ou de fichier de signature dans Git.
