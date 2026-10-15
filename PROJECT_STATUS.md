# PROJECT_STATUS.md — État réel du projet BIM

Dernière mise à jour : 15/10/2026, session 1 — lots 0 et 1 terminés et vérifiés (CI complète, émulateur Android, navigateur) ; décisions C8 appliquées, coffres compris ; lot 2 commencé pour la partie sans dépense (rappels : étapes A à F développées et testées, dont l'écran « Rappels » de l'app ; rien d'activé) ; activation en attente de l'accord du fondateur.

## Résumé

L'analyse est validée avec corrections (`docs/ANALYSE.md`). Les fondations de l'API sont en place et testées : comptes, vérification du contact, sessions, récupération, opérations sensibles, âges (F15), récupération vérifiée (F16), espaces. L'application mobile (écrans 01 à 06 et écrans de code) est **analysée, testée et compilée en APK Android (debug)** par la CI GitHub (Flutter 3.47.7 stable) ; ses écrans ont été comparés aux maquettes. iOS n'est pas encore compilé (machine macOS nécessaire). Aucune règle financière n'est programmée.

## Légende des états

Conception · Interface · Backend · Intégration · Tests exécutés · Tests réussis · Dépendance externe · En attente de configuration · En attente de validation.

## Modules

| Module | Conception | Backend | Interface mobile | Intégration | Tests | Bloqué par |
| --- | --- | --- | --- | --- | --- | --- |
| Socle API (config, journaux, santé, erreurs, OpenAPI, limitation) | Terminée | Fait | — | Image Docker de production démarrée en CI | Exécutés, réussis | — |
| Environnements staging et production (AWS) | Plan écrit (`docs/DEPLOYMENT.md`) | — | — | **Non déployés** | Image testée en CI | Validation des dépenses AWS, autorisation ARTCI, nom de domaine |
| Base + migrations (11 migrations, garde-fous dont F16 garanti par la base) | Terminée | Fait | — | — | Exécutés (e2e sur base vierge) | — |
| Authentification (inscription, code, connexion, sessions, mot de passe oublié) | Terminée | Fait | Fait | **Testée sur émulateur Android contre l'API** | API + Android : réussis | Fournisseur SMS réel (lot 2) |
| F15 — âges par capacité | Terminée | Fait (réglages `age.*`) | — | — | Exécutés, réussis | Vérifications légales (DECISIONS.md) |
| F16 — récupération vérifiée, step-up | Terminée | Fait | Coordonnées, mot de passe, appareils | **Testée sur Android** (ajout d'un e-mail vérifié, nouveau mot de passe) | API + Android : réussis | — |
| Espaces (utilisateur / boutique / livreur) | Terminée | Contrôle d'accès et bascule faits ; création de boutique et de compte livreur : lots 5 et 7 | Écran 53 fait | Bascule vers l'espace utilisateur seulement (aucune boutique ni compte livreur avant les lots 5 et 7) | API : réussis ; capture | KYC (lot 5), `age.min_merchant` / `age.min_courier` |
| Connexions Google / Apple / Facebook | Terminée | Préparées, **désactivées** (`NOT_CONFIGURED`) | Boutons affichés, « Bientôt disponible » | — | Exécutés (indisponibilité honnête) | Comptes développeur + clés |
| Thème clair / sombre | Terminée | Préférence enregistrée | Compilé, capture sombre vérifiée | Écrit | — | — |
| Administration (API `/admin/v1` + application web React) | Terminée | Fait : connexion + TOTP, rôles, réglages, audit, utilisateurs, programmes types, comptes admin | Web : fait | **Testée dans Chromium contre l'API** | API : 8 unitaires + 13 e2e ; web : unitaires + 5 scénarios navigateur | Rôles à valider (T-019) ; hébergement AWS |
| Lot 1 — Projets BIM (écrans 18-24, 26, 27, 29-31) | Terminée | Fait : référentiels et catégories administrables, création en 5 étapes, mode Éco / Premium gratuit (C6), programmes types validés (mode, conseils), carte et journée, tâche suivante, tâches ajoutées / retirées, pause, signalement de projet ou général avec image jointe (+ traitement admin), avertissement de pause, coffres symboliques (70 %), mesures chiffrées, photos avant / après privées (S3), fin, suppression | Fait | **Testé sur émulateur Android contre l'API** (création, séance, photos, signalements avec image, captures réelles de l'écran) ; **admin testée dans Chromium** (image jointe chargée) ; **photos testées sur un vrai serveur S3** en CI | API, admin, Android : réussis (voir bilan du lot 1) | Contenu des programmes types (C7) ; Peni (lot 3) ; rappels (lot 2) ; profil public (lot 4) ; recommandations marchands (lot 5) ; stockage S3 de production (dépenses AWS, ARTCI) |
| Lots 2 à 12 (rappels, Peni, social, boutique, commandes, paiements, pièces, Lives…) | Analyse faite | Non commencés | Non commencés | — | — | Voir `DECISIONS.md` |

## Bilan du lot 1 — Projets BIM (15/10/2026)

État : **terminé** (15/10/2026) : toutes les exigences propres au lot 1 sont développées et vérifiées, coffres compris (règle validée par le fondateur le 15/10). Restent hors du lot 1 : contenus et validations listés ci-dessous.

### Exigences prévues (ANALYSE.md, section 11)
Catégories administrables ; création en 5 étapes ; modèles de programmes ; carte et journée ; tâches ; pause ; signalement ; suppression ; célébration ; avant / après. Ajouts décidés pendant le lot : modes Éco / Premium gratuits et indépendants de l'abonnement (C6), mesures chiffrées (bilan « d'après tes mesures »), décisions C8 du 15/10 (« Résoudre un problème » avec image, avertissement de pause, coffre symbolique).

### Fonctions développées et vérifiées
| Fonction | Écrans | Vérification réelle |
| --- | --- | --- |
| Catégories et objectifs administrables | 20, 21 ; admin | API e2e ; Playwright (création catégorie + objectif chiffré) |
| Création en 5 étapes, titre généré, limite de 5 projets | 19-23 | API e2e ; Android (création réelle) |
| Mode Éco / Premium gratuit, modifiable, sans paiement ni abonnement (C6) | 19 | 4 tests API dédiés + test mobile |
| Programmes types par mode, publiés avec le nom du validateur ; conseil du jour seulement s'il est validé | 24, 27 ; admin | API e2e ; Playwright (brouillon → publication) |
| Programme issu des réponses (en attendant C7), tâches ajoutées / retirées | 24 | API e2e ; Android |
| Carte des jours, tâche suivante, série | 18, 26 | API e2e ; captures |
| Journée : cocher, rattraper un jour passé, pas de case future | 27 | API e2e ; Android (séance cochée) |
| Pause (fin décalée, reprise anticipée ou automatique) | 29 | API e2e ; captures |
| Signalement d'une tâche, réponse du support, orientation santé (185 / 180) | 27 ; admin | API e2e ; Android (envoi avec image + suivi) ; Playwright (réponse + clôture) |
| « Résoudre un problème » (C8) : problème général, description, image ou capture jointe (privée, sans métadonnées), statut et réponse ; erreurs d'envoi (image refusée, stockage indisponible, réseau, trop d'envois) | 21 ; compte ; admin | API e2e (5 tests) ; Android (envoi depuis le compte + « Mes signalements », image réellement affichée) ; Playwright (image jointe chargée dans l'administration) |
| Avertissement avant une pause (C8) : texte validé, « Continuer mon programme » / « Mettre en pause » | 29 | captures |
| Mesures chiffrées et variation | 26, 30 | API e2e (pas encore dans le test Android) |
| Photos avant / après privées : réencodage, EXIF et GPS supprimés, lien temporaire, purge à la suppression | 22, 31 | API e2e (stockage local) ; **serveur S3 réel en CI** (lien signé, lecture anonyme refusée, effacement) ; Android (envoi, puis photos **réellement téléchargées et affichées**, capture réelle) |
| Journal des événements du projet (source prévue des rappels et de Peni) | — | API e2e (contrat) |
| Coffres (C8) : un par semaine complète + final, ouverts à 70 % des tâches prévues réellement cochées, badge et message de Peni, aucune valeur financière ; événement `chest_opened` ; badges dans le bilan | 26, 30 | 15 tests unitaires (durées 5 à 90 jours, pauses, tâches ajoutées / retirées, seuil exact, coffre final) ; API e2e (rattrapage, ouverture, refermeture, tâche ajoutée sans effet sur le passé) ; captures |
| Période active des tâches (T-024) : une tâche ajoutée ne compte pas pour les jours passés, une tâche retirée garde son historique | 24, 26, 27 | tests unitaires et e2e ; migration 0010 vérifiée sur une base existante (reprise de l'historique) |
| Fin du programme, suppression logique, renommer, projet public (réglage seul) | 30, 24 | API e2e |

### Comparaison avec les maquettes 18 à 31
Maquettes : `BIM_Maquettes_PNG_1-31.zip` (15 écrans de 18 à 31). Captures : branche `ci-captures`, 13 écrans (25 et 28 absents : lots 3 et 2 ; l'écran des préférences de rappel, sans maquette, est capturé sous `x15_rappels`, et sur émulateur sous `a28_rappels`).
Écarts corrigés le 15/10 : « par semaine » faux sur l'écran 24 (affichait 7 au lieu des 3 séances choisies) ; chemin en pointillés absent puis trop clairsemé (26) ; tâche en cours non mise en avant et heures futures en rouge (27) ; icônes de catégorie non colorées (20) ; sélections en noir, niveau en sélecteur segmenté, séances en cases (23) ; avertissement de pause (29) ; lien « Résoudre un problème » (21).
Défauts trouvés grâce aux captures réelles de l'émulateur (320 dp) et corrigés : message de confirmation avec bouton qui restait affiché et masquait l'écran ; libellé « Publier « J'ai fait mon BIM » » coupé ; puce « Problème avec un produit ou un service » qui débordait de 24 px ; « Intermédiaire » coupé (23).
Écarts voulus (décisions) : paiement et prix retirés de l'écran 24 (F4, C6) ; « Projet économique / Premium » et mention « choix gratuit » (C6) ; « Recommandé pour toi » sans marchands (lot 5) ; offres des marchands désactivées (21, lot 5) ; pas d'aperçu caméra intégré (22 : appareil photo du système) ; étape « durée du programme » ajoutée (23) ; boutons « Publier » en « bientôt disponible » (30, 31 : lot 4) ; Peni pensif au lieu de triste sur l'écran 29 (ne pas culpabiliser) ; textes de démonstration marqués comme tels.
Coffre (26) : implémenté (règle validée le 15/10), placé à côté du jour qui clôt sa période. En attente : avertissement d'un marchand avant une pause (29) — avec les marchands (lot 5).
Écarts mineurs restants, acceptés provisoirement : bulle de Peni remplacée par un bandeau en haut de la carte (26, bulle définitive avec Peni au lot 3) ; rappel « 14:45 » et icône calendrier absents (rappels : lot 2) ; barre d'onglets absente de la capture 18 (capture de l'écran seul) ; unités « cm / kg » dans le libellé plutôt que dans le champ (23).
Vérification dans un environnement adapté : **captures réelles de l'émulateur Android 14** (branche `ci-captures-android`) : photos avant / après et images jointes réellement affichées, émoji 🏆 rendu en couleur. Les captures de la branche `ci-captures` restent des rendus de test (sans émojis ni images réseau). Pas encore vérifié sur un vrai téléphone.

### Incomplet ou dépendant d'autres lots
Contenu des programmes types et habitudes du jour réelles (**C7, action du fondateur**) ; durée de conservation des images jointes aux signalements (T-022 : 12 mois **proposés, en attente de validation juridique et réglementaire**) ; écran 25 Peni (lot 3) ; écran 28 rappels (lot 2 : préférences faites ; notifications elles-mêmes après Firebase) ; écran 52 profil public et publication « J'ai fait mon BIM » (lot 4) ; recommandations de marchands (lot 5) ; stockage S3 de production (validation des dépenses AWS, autorisation ARTCI) ; pas de test sur un vrai téléphone ; iOS non compilé.

### Préparation des lots 2 et 3
Analyse : `docs/DEPENDANCES_LOTS_2_3.md` (aucun blocage d'architecture ; journal des événements complété, T-023). Décidé le 15/10 (T-025) : lancement en Côte d'Ivoire, architecture prête pour d'autres pays ; rappels par **notifications d'abord**. Étude selon R-01 et R-01 bis (meilleur équilibre qualité, fiabilité, sécurité, évolutivité et coût) : `docs/LOT2_RAPPELS_ETUDE.md` — 5 architectures et 8 composants comparés (gratuit / payant, sécurité, migration) ; **recommandé : service worker séparé (seul poste payant), FCM / APNs, file pg-boss, Parameter Store, Crashlytics, CloudWatch (gratuits car suffisants), évolution prévue vers SQS** ; budget estimé des rappels ≈ 16 à 21 USD/mois au lancement, ≈ 42 à 52 à 100 000 actifs, ≈ 170 à 370 à 1 million (prix de Paris à confirmer). **Lot 2 commencé sans dépense** (accord du 15/10, 07 h 40) : voir la section « Lot 2 — avancement » ; 4 décisions attendent l'accord du fondateur avant activation (étude, section 9).

### Vérification finale
- CI complète **réussie** sur `2c2a24c` (exécution 38691542705) : API (lint, compilation, 66 tests unitaires, 81 de bout en bout dont S3 réel, contrat OpenAPI, image Docker de production), mobile (analyse sans remarque, tests, captures, APK), Android sur émulateur contre l'API (parcours complet des lots 0 et 1, captures réelles), administration (7 scénarios Chromium).
- En local (15/10) : API 66 unitaires + 80 e2e réussis (S3 réel seulement en CI) ; administration 7 scénarios Chromium réussis ; migration 0010 appliquée sur une base existante.
- Non vérifié : vrai téléphone, iOS (compilation non lancée, décision du fondateur).

## Lot 2 — avancement (15/10/2026, partie sans dépense)

Cadre : développement autorisé s'il n'engage aucune dépense et ne dépend d'aucune décision en attente. **Rien n'est activé** : `WORKER_MODE=off`, `PUSH_PROVIDER=none` par défaut, réglage `notifications.reminders_enabled` = false (« en attente »), aucun projet Firebase, aucune ressource AWS.

| Étape | Contenu | Tests | CI |
| --- | --- | --- | --- |
| A | Fuseau horaire par personne ; « aujourd'hui » à l'heure locale (projets, photos, signalements) | unitaires + e2e | verte (run 38701596068) |
| B | Appareils de notification (par session, supprimés à la déconnexion) ; préférences ; réglages des rappels « en attente » | e2e | verte (run 38701596068) |
| C | Calcul des rappels (fonctions pures) | 9 unitaires | verte (run 38702790136) |
| D | Worker : file PostgreSQL, anti-doublon, reprise, péremption, essais, revérification, santé, `/health`, page admin | 7 e2e (workers concurrents, panne, jeton invalide…) ; démarrage réel du worker séparé vérifié en local | verte (run 38702790136) |
| E | Envoi FCM HTTP v1 prêt, inactif | 5 tests contre un faux serveur ; 1 test de configuration | verte (run 38703183336 : API, admin, mobile, Android) |
| F | Écran « Rappels » dans l'app (Paramètres → Rappels) : recevoir ou non les rappels de Peni, heures calmes personnelles ou par défaut ; relié à `GET/PATCH /v1/me/notification-preferences` ; avertissement « pas encore en service » tant que le réglage de la plateforme est coupé | 10 tests Flutter (modèle, requêtes, écran) ; captures `x15_rappels` (normal, petit écran, sombre) ; parcours Android contre l'API réelle (choix enregistré puis relu, capture `a28_rappels`) ; e2e API complété | verte (run 38719370532) |

Suite API locale : 180 tests réussis (1 ignoré, 1 à écrire, inchangés). Coût de Paris détaillé, mécanismes de fiabilité et décisions à valider : `docs/LOT2_RAPPELS_ETUDE.md`, sections 9 à 12. Prix exacts de Paris **non confirmés** (inaccessibles depuis l'environnement de travail) : estimation ≈ 16 à 17 USD/mois (NAT partagé) ou ≈ 23 à 24 USD/mois (adresses publiques), à confirmer avec le calculateur AWS avant toute activation.

## Tests exécutés (session 1, 14/10/2026)

Environnement : Node 22.22, PostgreSQL 16.15 local.

| Suite | Commande | Résultat |
| --- | --- | --- |
| Unitaires API | `npm run test:unit` | 19 / 19 réussis |
| Bout en bout API (base vierge, migrations réelles) | `npm run test:e2e` | 37 / 37 réussis (dont 10 tests de non-régression issus de la relecture de sécurité) |
| Compilation TypeScript stricte | `npm run lint` | sans erreur |
| Build de production + migrations compilées | `npm run build` puis `node dist/database/migrate.js` | réussi |
| Mobile (CI GitHub) | `flutter analyze`, `flutter test` (7 tests), 29 captures, `flutter build apk --debug` | réussis (exécution 38636192504) |
| Android ↔ API (émulateur) | `flutter test integration_test` | réussi (exécution 38636192504) |
| API (15/10) | unitaires 66 ; e2e 81 dont le stockage S3 réel (CI) + 1 à écrire au lot 8 (abonné Premium) | réussis (local : 80 + S3 non lancé faute de serveur S3 ; CI : 81) |
| Administration web | Vitest (2) + Playwright/Chromium contre l'API (7 scénarios) | réussis (CI, job `admin`) |
| Image Docker de l'API | build, migrations, démarrage en production, santé | en CI (job `api`) |

## Relectures indépendantes (session 1)

- **Administration (lot 0, partie 2)** : 1 problème grave et 3 moyens trouvés puis corrigés et couverts par des tests : force brute du code TOTP en recommençant la connexion, verrouillage contournable par requêtes parallèles, ancienne étape d'enrôlement pouvant remplacer l'appareil configuré, réponse de verrouillage révélant les comptes admin. Mineur corrigé : jeton d'étape masqué dans les journaux. Risque restant accepté (T-015) : verrouillage déclenchable par qui connaît l'e-mail d'un admin → admin limité aux adresses de l'équipe en production.

- **Sécurité de l'API** : 2 problèmes graves, 5 moyens, 8 mineurs signalés ; tous les graves et moyens sont corrigés et couverts par un test (suppression simultanée de coordonnées, IP falsifiable derrière un proxy, énumération de comptes par « mot de passe oublié », force brute des codes, rafraîchissement concurrent d'une réinitialisation, bombardement de SMS, configuration permissive). Mineurs corrigés : identifiants mal formés (500 → 400), paramètres SQL dans les journaux, comptage des essais par compte et en HMAC, autorisation step-up liée à la session, TRUNCATE de l'audit, audits manquants. Risques acceptés : `DECISIONS.md`, T-015.
- **Code Flutter (lecture statique, sans compilateur)** : aucune erreur de compilation certaine trouvée ; corrigés : dépendance `intl` incompatible avec les Flutter récents, requêtes pouvant rester bloquées et déconnexion intempestive dans l'intercepteur réseau, démarrage pouvant rester bloqué, appels après fermeture d'écran, double envoi du code, quelques avertissements de l'analyseur.

## Communication réelle Android ↔ API (job CI « android-e2e », 14/10/2026)

L'application Android (APK debug) tourne sur un émulateur Android 14 (320 dp de large) et parle à l'API réelle (PostgreSQL neuf, migrations réelles, mode développement). Le code de vérification est lu dans le journal de l'API par un relais propre à la CI, comme une personne lirait son SMS.
Parcours réussi (exécution 38636192504) : bienvenue → inscription en 2 étapes → code → accueil → déconnexion → mauvais mot de passe refusé (401, message affiché) → connexion → création d'un projet en 5 étapes → programme → journée → séance cochée. Requêtes reçues par l'API : interests 200, register 201, register/verify 200, logout 204, login 401 puis 200, projects/catalog 200, projects 201, journée 200, case cochée 200.
Défauts réels trouvés par ce test et corrigés : libellés de champs et pied de l'écran de connexion qui débordaient à 320 dp, tuiles de catégories trop petites, migrations absentes de `npm run build` (l'API compilée ne pouvait pas migrer sans Docker).
Non vérifié : un vrai téléphone, un vrai fournisseur SMS, iOS.

## Vérification en CI GitHub (dépôt privé djannigraphi-prog/Bim, 14/10/2026)

| Exécution | Commit | API | Mobile |
| --- | --- | --- | --- |
| 38618072849 | 23f32db | réussie | **échec** à `flutter analyze` |
| 38618617162 | ee3a4b2 | réussie | échec : 5 erreurs réelles dans `app_theme.dart` (`CupertinoPageTransitionsBuilder` n'est plus exporté par `material.dart` depuis Flutter 3.35) + 1 remarque ; `theme_test` ne compilait pas |
| 38618912551 | 738bacf | réussie | **réussie** : analyse sans remarque, 4 tests réussis |
| 38619469611 | c97e382 | réussie | analyse : 4 remarques de style dans le nouveau fichier de captures ; tests, captures et **APK Android debug** réussis |
| 38620641623 | 286efad | réussie | **réussie** : analyse, tests, captures, APK Android debug |

Captures des écrans : branche `ci-captures` (mise à jour par la CI à chaque envoi sur main ; main n'est jamais modifiée par la CI).
Écarts corrigés après comparaison avec les maquettes : police des boutons (héritée du thème), espacement des lettres, hauteur des boutons, champs et puces, taille des logos 01 et 03, pose de Peni sur l'écran 06.
Écarts restants (connus) : photos de l'écran 02 remplacées par des cartes (droits des photos, D-UI-03) ; champ mot de passe et textes d'aide en plus sur l'écran 04 (D-UI-03) ; logo Google simplifié (« G ») ; « Pas encore de compte ? » sous les boutons sociaux au lieu du bas de l'écran 03 ; fond de l'écran 06 vide (fil d'actualité : lot 3) ; police du système (D-UI-02).
Limites : captures rendues avec la police Roboto (Android) ; l'app n'a pas encore tourné sur un vrai téléphone ni contre l'API ; pas de compilation iOS (runner macOS, consomme 10 fois plus le quota gratuit GitHub) ; dossiers `android/` et `ios/` générés uniquement dans la CI avec un identifiant provisoire (l'identifiant définitif de l'app est à choisir).

## Vérification de l'app mobile dans l'environnement de travail (historique, 14/10/2026, 18 h 30)

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

- Application mobile : compilée pour Android en CI ; iOS non compilé ; pas encore testée sur un téléphone contre l'API.
- Émulateur Android de la CI (15/10, écran Rappels) : un glissement du test au-delà du haut d'une liste (effet d'étirement d'Android) a été suivi, à chaque essai, de la perte de l'émulateur entier (« offline »). Le test fait maintenant un retour exact en haut, sans glissement. Cause non prouvée ; à vérifier sur un vrai téléphone (simple geste de l'utilisateur).
- Diagnostic CI : les tests Flutter en échec et le journal système Android (en cas d'arrêt de l'app) sont publiés en annotations, lisibles même quand les journaux bruts ne sont pas téléchargeables.
- Dossiers `android/` et `ios/` non versionnés : à générer une fois l'identifiant de l'app (ex. `ci.bim.app`) choisi par le fondateur.
- Envoi réel des SMS et e-mails absent : en développement, les codes s'affichent dans la console de l'API. Le démarrage en staging ou en production est refusé tant qu'un vrai fournisseur n'est pas configuré.
- Photo de profil (écran 05) : non disponible (module médias, lot 4).
- Police de marque non choisie (police du système en attendant).
- Pas encore de tâche planifiée pour purger les comptes jamais vérifiés et les anciennes tentatives de connexion (lot 2) ; un compte non vérifié libère son nom d'utilisateur après 24 h.
- Docker indisponible dans l'environnement de la session 1 : `infra/docker-compose.yml` et le `Dockerfile` n'ont pas été exécutés ici (le build TypeScript et les migrations compilées l'ont été).

## Décisions

- Prises : voir `DECISIONS.md` (règles permanentes **R-01 et R-01 bis** sur les choix techniques et les dépenses, F15 provisoire, F16, corrections du 14/10, T-001 à T-025, D-UI-01 à 03).
- Réponses F1 à F17 reçues le 14/10/2026 et enregistrées (orientations retenues ou validations requises). **Aucun changement de code** : rien de ce qui est programmé n'était concerné ; aucune fonction financière n'a été programmée.
- C6 décidé le 14/10 : mode de projet gratuit et indépendant de l'abonnement (tests ajoutés). En attente du fondateur : C7 (programmes types) ; points à clarifier C1 à C5 (`DECISIONS.md`) ; validation des écarts de maquettes D-UI-03 ; police D-UI-02 ; décision sur la simulation des frais (`docs/SIMULATION_FRAIS.md`).

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

1. Lot 2 : réponses du fondateur aux 4 décisions de `docs/LOT2_RAPPELS_ETUDE.md` (section 9) avant toute activation ; aucune dépense sans accord. L'écran des préférences de rappel est fait (étape F) ; la maquette 28 (notifications sur l'écran verrouillé, « alarme ») attend Firebase (décision 2) et la décision sur l'alarme (4).
1. Lot 1 (contenus) : programmes types (C7) ; validation juridique de la conservation des images jointes (T-022). Profil public (écran 52) → lot 4 ; écran 25 (Peni) → lot 3 ; écran 28 (notifications de rappel) → lot 2, après Firebase.
2. **Nécessitent les programmes types validés (C7)** : contenu des tâches par catégorie, « habitude du jour » de l'écran 27, durées propres à chaque programme. La saisie se fait dans l'administration (Programmes types).
3. Compilation iOS : pas lancée (décision du fondateur du 14/10).
4. Choisir et brancher le fournisseur SMS et Amazon SES (lot 2), Firebase pour les notifications.
5. Avant les lots 7 à 9 : réponses C1 à C5, vérifications juridiques (F3, F7, F8, F10, F11, F14, F15, ARTCI, BCEAO) et validation de la simulation F13. Écrans 24 et 38 à redessiner selon F4 (lot 1 / lot 7).
