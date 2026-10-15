# Tests

| Niveau | Où | Outil | Base | Commande |
| --- | --- | --- | --- | --- |
| Unitaires API | `apps/api/src/**/*.spec.ts` | Jest | aucune | `npm run test:unit` |
| Bout en bout API | `apps/api/test/*.e2e-spec.ts` | Jest + Supertest | PostgreSQL réel, base créée puis supprimée | `npm run test:e2e` |
| Unitaires / widgets mobile | `apps/mobile/test/` | flutter_test | — | `flutter test` |
| Parcours mobiles | à venir (`integration_test/`) | integration_test | API de staging | — |
| Charge | à venir (lots 4, 9, 10) | k6 | staging | — |

Les tests e2e démarrent l'API complète (mêmes gardes, filtres et validations qu'en production) contre une base vierge où toutes les migrations sont appliquées. Les SMS et e-mails passent par le fournisseur `test`, qui garde les messages en mémoire pour lire les codes.

## Couverture des 12 parcours du cahier des charges

| N° | Parcours | État |
| --- | --- | --- |
| 1 | Un utilisateur crée un compte | **Testé (API, e2e)** ; écran mobile non exécuté |
| 2 | Crée un projet BIM | Lot 1 |
| 3 | Termine une tâche | Lot 1 |
| 4 | Partage un BIM | Lot 4 |
| 5 | Achète un produit | Lots 5, 7, 8 |
| 6 | Un marchand reçoit et traite une commande | Lot 7 |
| 7 | Un livreur accepte et termine une livraison | Lot 7 |
| 8 | Un créateur reçoit des pièces | Lot 9 (après F8-F14) |
| 9 | Accès à un espace non autorisé | **Testé (API, e2e)** : boutique d'autrui, jeton falsifié, session révoquée, compte suspendu |
| 10 | Un paiement échoue | Lot 8 |
| 11 | Une connexion est interrompue | Mobile : erreurs réseau traitées ; test à écrire avec le SDK |
| 12 | Un utilisateur supprime son compte | Portée step-up prévue ; fonction au lot 4 |

Règle : un test n'est déclaré réussi que s'il a été exécuté. Les résultats de chaque session sont consignés dans `PROJECT_STATUS.md`.

## C6 — mode de projet indépendant de l'abonnement

- `apps/api/src/modules/projects/mode-independence.spec.ts` : le code du module Projets ne mentionne ni abonnement, ni droit payant, ni paiement, et n'importe que les modules autorisés. Un couplage futur fait échouer la CI.
- `apps/api/test/projects.e2e-spec.ts` (bloc « mode indépendant de l'abonnement ») : une personne sans abonnement choisit les deux modes ; le mode Premium ne crée aucune table ni donnée de paiement ; on change de mode dans les deux sens ; le mode Premium n'accorde aucun avantage (même limite de projets).
- Test en attente (`it.todo`) : « une personne abonnée Premium choisit un projet économique ou Premium », à écrire au lot 8, quand l'abonnement existera.
- `apps/mobile/test/project_draft_test.dart` : la requête de création ne contient aucun champ d'abonnement ou de paiement.

## Lot 0, partie 2 — administration et compte

- `apps/api/src/common/totp.spec.ts` : codes TOTP (vecteurs de la RFC 6238), chiffrement des secrets.
- `apps/api/src/modules/admin/setting-rules.spec.ts` : contrôle des valeurs de réglages.
- `apps/api/test/admin.e2e-spec.ts` (13 tests) : connexion + TOTP, enrôlement, réutilisation de code refusée, verrouillage (y compris requêtes parallèles et force brute du code), ancienne étape d'enrôlement sans effet, séparation des jetons app / admin, permissions par rôle, réglages appliqués et journalisés, recherche et suspension d'un compte, programmes types publiés puis utilisés par un nouveau projet, comptes admin.
- `apps/admin/src/api.test.ts` (Vitest) et `apps/admin/e2e/admin.spec.ts` : parcours réel dans Chromium contre l'API (`.github/scripts/run-admin-e2e.sh`, job CI `admin`).
- `apps/mobile/integration_test/auth_flow_test.dart` : sur émulateur Android contre l'API réelle — inscription, connexion, projet, ajout d'un e-mail vérifié (opération protégée), appareils connectés, nouveau mot de passe, connexion par e-mail.

## Lot 1, suite — programmes, signalements, mesures, photos

- `apps/api/test/projects-lot1b.e2e-spec.ts` : programme type choisi selon le mode (économique / Premium), brouillons jamais utilisés, habitude du jour seulement si validée ; prochaine tâche ; catégories et objectifs administrables ; signalement → réponse du support ; mesures (départ, variation) ; photos (métadonnées et GPS supprimés, lien temporaire, remplacement, suppression, purge avec le projet, accès d'un autre compte refusé).
- `apps/api/test/media-s3.e2e-spec.ts` : même code sur un vrai stockage S3 (en CI : Versity S3 Gateway réglé sur eu-west-3, `.github/scripts/start-s3-test.sh` ; les images MinIO ne sont plus téléchargeables) : lien présigné, lecture refusée sans signature, effacement.
- Android (`auth_flow_test.dart`) : photo « avant » à la création, photo « après », comparaison, signalement et suivi.
- Navigateur (`apps/admin/e2e/admin.spec.ts`) : catégories et objectifs, signalements, mode et habitudes du jour des programmes.

## Lot 1, fin — « Résoudre un problème », image jointe, pause, journal des événements (15/10/2026)

- `apps/api/test/reports.e2e-spec.ts` : problème général avec capture (image privée, sans métadonnées, visible par la personne et le support, réponse) ; contrôles (description obligatoire, motifs par contexte, image illisible ou PDF refusés **sans rien créer**) ; signalement depuis un projet avec image, filtre par projet, projet d'un autre refusé ; 20 signalements au plus par 24 h ; stockage non configuré : image refusée clairement (`NOT_CONFIGURED`), texte accepté.
- `apps/api/test/projects-lot1b.e2e-spec.ts` : contrat du journal des événements (source des lots 2 et 3, `docs/DEPENDANCES_LOTS_2_3.md`).
- Navigateur : signalement général avec image jointe **réellement chargée** dans l'administration (largeur naturelle de l'image vérifiée ; ce test a révélé l'en-tête `Cross-Origin-Resource-Policy` à autoriser sur les liens signés locaux).
- Android : image jointe au signalement d'une journée ; « Résoudre un problème » depuis le compte (description + capture) puis « Mes signalements » ; images réellement téléchargées et affichées (vérifié dans l'arbre de rendu, aucune icône d'image cassée).
- **Captures réelles de l'émulateur** (rendu Android véritable : polices et émojis du système, images chargées par le réseau) : prises par le test via le relais de la CI (`adb screencap`), publiées sur la branche `ci-captures-android` (`a31_avant_apres`, `a27_mes_signalements_projet`, `a30_bilan_emoji`, `a21_mes_signalements`). Les captures de la branche `ci-captures` restent des rendus de test (sans émojis ni images réseau).

## Lot 2 — rappels, notifications, centre de notifications (15/10/2026)

- API : `lot2.e2e-spec.ts` (fuseau, appareils, préférences, désactivés par défaut), `reminders.e2e-spec.ts` (worker : doublons, panne, péremption, jeton, erreurs passagères, revérification, surveillance ; rappels à venir pour le téléphone), `inbox.e2e-spec.ts` (centre de notifications), tests unitaires du calcul et de l'envoi FCM (faux serveur).
- Flutter : `reminder_preferences_test.dart`, `reminder_scheduler_test.dart`, `notifications_screen_test.dart` ; captures `x15_rappels`, `17_notifications`.
- Android réel (job `android-e2e`) : autorisation d'Android acceptée dans sa vraie fenêtre, service ouvert **dans la base de test de la CI uniquement**, deux tâches ajoutées quelques minutes plus tard, deux vraies notifications affichées par Android (titre, texte, actions lus dans le rapport d'Android), « Plus tard » puis « J'y vais ! » touchés dans le volet des notifications, journée du projet ouverte ; centre de notifications avec de vraies réponses du support. Le relais de la CI (`.github/scripts/otp-relay.py`) pilote le système (uiautomator, dumpsys) ; il n'agit que sur l'émulateur et la base jetable de la CI.

Ajouts du 15/10 (après-midi) : capture de l'écran réellement verrouillé (`a28_ecran_verrouille`, relais `/lockscreen-shot` : une seule opération, l'app ne dessine pas pendant le verrouillage), notification seule avec l'avatar de Peni (`a28_notification_seule`), textes v2 vérifiés dans le rapport d'Android ; rappel d'essai testé dans les tests Flutter. Tests sur téléphones physiques : protocole dans `docs/TESTS_TELEPHONES.md`.

## Perte de l'émulateur (enquête du 15/10/2026)

Constat : dans le parcours Android, un glissement du test au-delà du haut de l'écran Rappels faisait perdre l'émulateur entier (« offline »), à chaque essai. Sonde à la demande (workflow « Sonde émulateur », `integration_test/overscroll_probe_test.dart`), même geste, émulateur neuf à chaque fois :

| Situation | Moteur de rendu | Émulateur après le geste |
| --- | --- | --- |
| Témoin, sans geste | Impeller | en ligne |
| Liste Flutter simple | Impeller | en ligne |
| Liste Flutter simple | sans Impeller | en ligne |
| Liste simple + Peni (dessin SVG) | Impeller | **hors ligne** |
| Écran Rappels sans l'avertissement (sans Peni) | Impeller | en ligne |
| Écran Rappels complet | Impeller | **hors ligne** (deux fois) |
| Écran Rappels complet | sans Impeller | en ligne |

Troisième série (autres versions d'Android, Impeller) :

| Situation | Android 13 | Android 15 |
| --- | --- | --- |
| Liste Flutter simple | — | en ligne |
| Liste simple + Peni (SVG) | — | **hors ligne** |
| Écran Rappels complet | **hors ligne** | **hors ligne** |

Conclusion : l'émulateur tombe seulement avec la combinaison dessin SVG + effet d'étirement + Impeller. Le plantage touche l'émulateur entier, pas seulement l'app : l'origine la plus probable est le rendu graphique simulé de l'émulateur, déclenché par un contenu ordinaire de BIM. Ce n'est pas prouvé pour de vrais téléphones : **à vérifier sur 3 à 5 téléphones courants** (geste banal pour une personne). Corrections possibles si le problème s'y produit (à décider) : Peni en image PNG plutôt qu'en SVG, ou effet d'étirement remplacé. Le parcours de bout en bout remonte en haut de l'écran sans ce geste ; la sonde reste disponible.

Même résultat sur Android 13, 14 et 15 : la version d'Android n'y change rien, ce qui renforce la piste du rendu graphique simulé de l'émulateur (le même pour toutes les versions), sans la prouver pour de vrais téléphones.

### Solutions évaluées (aucune appliquée : décision à prendre après les tests sur téléphones, `docs/TESTS_TELEPHONES.md`, T12 et T13)

| Solution | Effet attendu | Avantages | Inconvénients et risques | Recommandation |
| --- | --- | --- | --- | --- |
| 1. Ne rien changer ; vérifier sur 3 à 5 vrais téléphones | Savoir si le problème existe hors de l'émulateur | Aucun changement de l'app ; gratuit | Demande les téléphones de test | **D'abord** |
| 2. Signaler le cas à Flutter et à l'émulateur Android (sonde minimale : liste + un SVG + glissement) | Correction à la source, ou confirmation que c'est connu | Gratuit ; la sonde de 40 lignes suffit | Délai inconnu | **En parallèle** (avec ton accord pour publier l'exemple, qui ne contient pas de code métier) |
| 3. Peni en images PNG dans l'app (comme les icônes de notification, script de génération) | Supprime l'élément déclencheur | Dessin de Peni inchangé (copies) ; affichage un peu plus rapide | Poids de l'app (+ ~0,5 Mo pour 5 poses en 3 densités) ; moins net si très agrandi ; deux formats à tenir à jour | Si les vrais téléphones reproduisent le problème |
| 4. Remplacer l'effet d'étirement d'Android 12+ par l'ancien effet de lueur (réglage global de défilement) | Supprime l'élément déclencheur partout | Une ligne de code | Ressenti moins naturel sur Android récent ; masque le problème sans le comprendre | Non, sauf urgence |
| 5. Désactiver Impeller sur Android (ancien moteur Skia) | Supprime l'élément déclencheur | Une ligne dans le manifeste | Flutter abandonne Skia sur Android ; performances et rendu moins bons ; dette future | Non |
| 6. Précompiler les SVG (vector_graphics) | Incertain : même chemin de dessin | Chargement plus rapide | Peut ne rien corriger ; à vérifier avec la sonde | Seulement si 3 est écartée |

