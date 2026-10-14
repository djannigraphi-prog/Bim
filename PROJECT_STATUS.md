# PROJECT_STATUS.md — État réel du projet BIM

Dernière mise à jour : 14/10/2026 (soir), session 1 — lot 0 partie 1 + enregistrement des décisions F1 à F17.

## Résumé

L'analyse est validée avec corrections (`docs/ANALYSE.md`). Les fondations de l'API sont en place et testées : comptes, vérification du contact, sessions, récupération, opérations sensibles, âges (F15), récupération vérifiée (F16), espaces. L'application mobile (écrans 01 à 06 et écrans de code) est écrite mais **n'a pas encore été compilée** : le SDK Flutter n'était pas disponible dans l'environnement de travail. Aucune règle financière n'est programmée.

## Légende des états

Conception · Interface · Backend · Intégration · Tests exécutés · Tests réussis · Dépendance externe · En attente de configuration · En attente de validation.

## Modules

| Module | Conception | Backend | Interface mobile | Intégration | Tests | Bloqué par |
| --- | --- | --- | --- | --- | --- | --- |
| Socle API (config, journaux, santé, erreurs, OpenAPI, limitation) | Terminée | Fait | — | — | Exécutés, réussis | — |
| Base + migrations (20 tables, 4 migrations, garde-fous dont F16 garanti par la base) | Terminée | Fait | — | — | Exécutés (e2e sur base vierge) | — |
| Authentification (inscription, code, connexion, sessions, mot de passe oublié) | Terminée | Fait | Écrite, **non compilée** | Écrite, **non exécutée** | API : exécutés, réussis | Fournisseur SMS réel (lot 2) |
| F15 — âges par capacité | Terminée | Fait (réglages `age.*`) | — | — | Exécutés, réussis | Vérifications légales (DECISIONS.md) |
| F16 — récupération vérifiée, step-up | Terminée | Fait | Écran « code » écrit ; écrans de gestion des coordonnées à faire | Partielle | API : exécutés, réussis | — |
| Espaces (utilisateur / boutique / livreur) | Terminée | Contrôle d'accès et bascule faits ; création de boutique et de compte livreur : lots 5 et 7 | Écran 53 à faire | — | Exécutés (accès refusé) | KYC (lot 5) |
| Connexions Google / Apple / Facebook | Terminée | Préparées, **désactivées** (`NOT_CONFIGURED`) | Boutons affichés, « Bientôt disponible » | — | Exécutés (indisponibilité honnête) | Comptes développeur + clés |
| Thème clair / sombre | Terminée | Préférence enregistrée | Écrit, non compilé | Écrit | — | — |
| Administration web | Esquissée | Tables et rôles seulement | — | — | — | Lot 0 partie 2 |
| Lots 1 à 12 (projets, Peni, social, boutique, commandes, paiements, pièces, Lives…) | Analyse faite | Non commencés | Non commencés | — | — | Voir `DECISIONS.md` |

## Tests exécutés (session 1, 14/10/2026)

Environnement : Node 22.22, PostgreSQL 16.15 local.

| Suite | Commande | Résultat |
| --- | --- | --- |
| Unitaires API | `npm run test:unit` | 19 / 19 réussis |
| Bout en bout API (base vierge, migrations réelles) | `npm run test:e2e` | 37 / 37 réussis (dont 10 tests de non-régression issus de la relecture de sécurité) |
| Compilation TypeScript stricte | `npm run lint` | sans erreur |
| Build de production + migrations compilées | `npm run build` puis `node dist/database/migrate.js` | réussi |
| Mobile | `flutter analyze`, `flutter test` | **Non exécutés** (SDK indisponible) ; 2 fichiers de test écrits |

## Relectures indépendantes (session 1)

- **Sécurité de l'API** : 2 problèmes graves, 5 moyens, 8 mineurs signalés ; tous les graves et moyens sont corrigés et couverts par un test (suppression simultanée de coordonnées, IP falsifiable derrière un proxy, énumération de comptes par « mot de passe oublié », force brute des codes, rafraîchissement concurrent d'une réinitialisation, bombardement de SMS, configuration permissive). Mineurs corrigés : identifiants mal formés (500 → 400), paramètres SQL dans les journaux, comptage des essais par compte et en HMAC, autorisation step-up liée à la session, TRUNCATE de l'audit, audits manquants. Risques acceptés : `DECISIONS.md`, T-015.
- **Code Flutter (lecture statique, sans compilateur)** : aucune erreur de compilation certaine trouvée ; corrigés : dépendance `intl` incompatible avec les Flutter récents, requêtes pouvant rester bloquées et déconnexion intempestive dans l'intercepteur réseau, démarrage pouvant rester bloqué, appels après fermeture d'écran, double envoi du code, quelques avertissements de l'analyseur.

## Vérification de l'app mobile : bloquée dans l'environnement de travail (14/10/2026, 18 h 30)

Tentatives faites, toutes refusées par le filtre réseau de l'environnement (réponse 403 ou absence de réponse) :
- SDK Flutter et Dart officiels (`storage.googleapis.com`), miroirs (`storage.flutter-io.cn`, `mirrors.tuna.tsinghua.edu.cn`) ;
- dépôt `github.com/flutter/flutter` et `codeload.github.com` ;
- paquets Dart (`pub.dev`, `pub.flutter-io.cn`) et Android SDK (`dl.google.com`) ;
- Docker Hub (image Flutter).
Seuls les registres npm et PyPI sont accessibles : aucun ne fournit Flutter. Un analyseur de syntaxe Dart disponible sur npm (tree-sitter) a été essayé : il ne se charge pas et ne connaît pas la syntaxe Dart 3, son verdict n'aurait pas été fiable.

Moyens de vérification possibles :
1. **GitHub Actions** (recommandé) : la CI du dépôt (`.github/workflows/ci.yml`) installe Flutter et lance `flutter analyze` et `flutter test` à chaque envoi. Il suffit d'un dépôt GitHub (privé) auquel cette session peut envoyer le code.
2. **Un ordinateur avec Flutter** : suivre `docs/INSTALLATION.md`, section 3, et envoyer le résultat de `flutter analyze` et `flutter test`.
3. Pour vérifier les écrans eux-mêmes : lancer l'app sur un émulateur Android et un simulateur iOS (option 2), ou ajouter des tests de capture d'écran (« golden tests ») exécutés par la CI (option 1) pour comparer avec les maquettes 01 à 06.

## Erreurs et limites connues

- Application mobile non compilée : à faire en priorité dès qu'un poste avec Flutter est disponible (`docs/INSTALLATION.md`, section 3). Des erreurs de compilation mineures restent possibles malgré une relecture.
- Dossiers `android/` et `ios/` non générés (`flutter create` à lancer une fois).
- Envoi réel des SMS et e-mails absent : en développement, les codes s'affichent dans la console de l'API. Le démarrage en staging ou en production est refusé tant qu'un vrai fournisseur n'est pas configuré.
- Photo de profil (écran 05) : non disponible (module médias, lot 4).
- Police de marque non choisie (police du système en attendant).
- Pas encore de tâche planifiée pour purger les comptes jamais vérifiés et les anciennes tentatives de connexion (lot 2) ; un compte non vérifié libère son nom d'utilisateur après 24 h.
- Docker indisponible dans l'environnement de la session 1 : `infra/docker-compose.yml` et le `Dockerfile` n'ont pas été exécutés ici (le build TypeScript et les migrations compilées l'ont été).

## Décisions

- Prises : voir `DECISIONS.md` (F15 provisoire, F16, corrections du 14/10, T-001 à T-013, D-UI-01 à 03).
- Réponses F1 à F17 reçues le 14/10/2026 et enregistrées (orientations retenues ou validations requises). **Aucun changement de code** : rien de ce qui est programmé n'était concerné ; aucune fonction financière n'a été programmée.
- En attente du fondateur : points à clarifier C1 à C5 (`DECISIONS.md`) ; validation des écarts de maquettes D-UI-03 ; police D-UI-02 ; décision sur la simulation des frais (`docs/SIMULATION_FRAIS.md`).

## Commandes

```bash
docker compose -f infra/docker-compose.yml up -d     # ou scripts/local-postgres.sh start
cd apps/api && set -a && . ./.env && set +a
npm run db:migrate && npm run start:dev               # API sur :3000, documentation sur /docs
npm test                                              # unitaires + e2e
npm run openapi:export                                # met à jour packages/api-contract/openapi.json
cd ../mobile && flutter pub get && flutter run --dart-define=BIM_API_URL=http://10.0.2.2:3000
```

## Prochaines tâches prioritaires (note de reprise)

1. **Compiler l'app mobile** : `flutter create` (plateformes), `flutter analyze`, `flutter test`, corriger, puis parcours complet inscription → code → accueil sur émulateur Android et simulateur iOS.
2. Lot 0, partie 2 : écran 53 (changer de profil), écrans de gestion des coordonnées et des appareils, connexion administrateur avec TOTP et écran des réglages `age.*`.
3. Choisir et brancher le fournisseur SMS et Amazon SES (lot 2), Firebase pour les notifications.
4. Lot 1 (projets BIM) : catégories administrables, création en 5 étapes, carte et journée du projet ; rédiger les programmes types avec le fondateur.
5. Avant les lots 7 à 9 : réponses C1 à C5, vérifications juridiques (F3, F7, F8, F10, F11, F14, F15, ARTCI, BCEAO) et validation de la simulation F13. Écrans 24 et 38 à redessiner selon F4 (lot 1 / lot 7).
