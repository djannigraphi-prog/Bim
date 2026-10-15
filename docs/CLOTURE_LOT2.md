# Clôture du lot 2 — Rappels et notifications : checklist

État au 15/10/2026, après les décisions de 15 h 44 (T-030). **Le lot 2 n'est pas clôturé.** Un point n'est « terminé » que s'il a une preuve vérifiable : test automatique exécuté, exécution de CI ou capture. Les tests sur vrais téléphones n'ont **pas** été réalisés.

## Preuves de référence

| Preuve | Où la voir |
| --- | --- |
| CI complète verte (API, admin, mobile, Android de bout en bout sur émulateur) | GitHub Actions, run 38759310442 (commit e522f64, après le retrait du fichier compilé) ; également run 38754528932 |
| Suite API : 195 tests réussis (1 ignoré : S3, exécuté en CI ; 1 à écrire : lot 8, sans rapport) | `cd apps/api && npm test`, relancé le 15/10 après C1 à C3 |
| Tests Flutter : 39 réussis ; analyse sans remarque | Job « mobile » de la CI |
| Captures réelles de l'émulateur Android 14 | Branche `ci-captures-android` : `a28_rappels`, `a28_ecran_verrouille`, `a28_notifications`, `a28_notification_seule`, `a28_jy_vais`, `a17_notifications` |
| Rendus des écrans (tests) | Branche `ci-captures` : `x15_rappels` (normal, petit, sombre), `17_notifications`, `62_parametres` |
| APK de test pour téléphones (workflow manuel) | Run 38759453834 : réussi, APK arm64 de 57 Mo (adresse d’exemple), conservé jusqu’au 18/10 |
| Rythme et heures calmes (option B) | Tests `reminders.spec.ts` et `reminders.e2e-spec.ts` ; tableau dans `docs/RYTHME_ET_TEXTES_RAPPELS.md`, section 2 |
| CI des corrections C1 à C3, complète et verte (API, admin avec la page Maintenance, mobile, Android) | GitHub Actions, run 38763949317 (commit 86c6626 : C1, C2) et run 38765040587 (commit 7e0cd4e : C3) |
| Enquête sur la perte de l'émulateur | `docs/TESTING.md`, « Perte de l'émulateur » (3 séries, 12 situations, Android 13 à 15) |

## 1. Éléments terminés et prouvés

| Élément | Preuve |
| --- | --- |
| Préférences de rappel (écran Rappels), rappels **désactivés par défaut**, choix distinct de l'autorisation d'Android | e2e `lot2.e2e-spec.ts` (5), `reminders.e2e-spec.ts` (rien sans activation) ; Flutter `reminder_preferences_test.dart` (13) ; capture `a28_rappels` |
| Calcul des rappels : fuseau, pauses, tâches cochées, période active, heures calmes **option B**, clés anti-doublon | `reminders.spec.ts` (10), `timezone.spec.ts` ; e2e `reminders.e2e-spec.ts` |
| Notifications programmées sur le téléphone, non exactes, un seul canal par appareil | e2e « rappels à venir » ; Flutter `reminder_scheduler_test.dart` (9) ; émulateur : vraies notifications lues dans le rapport d'Android |
| « J'y vais ! » ouvre la journée du projet ; « Plus tard » ferme la notification | Émulateur : boutons touchés dans le volet, captures `a28_jy_vais` |
| Maquette 28 : icône « B », avatar de Peni selon la tentative, écran verrouillé | Flutter (icônes, pose) ; captures `a28_ecran_verrouille`, `a28_notification_seule` |
| Centre de notifications (écran 17), filtres Tout / Projets, pastille de la cloche | e2e `inbox.e2e-spec.ts` (2) ; Flutter `notifications_screen_test.dart` (5) ; capture `a17_notifications` |
| Worker des rappels serveur (anti-doublon, reprise, surveillance, `/health`, revérification des heures calmes avant l'envoi) — **inactif** | `reminders.e2e-spec.ts` (9) ; démarrage réel du worker séparé vérifié en local |
| Envoi Firebase (FCM HTTP v1) — **inactif** | `fcm-push-sender.spec.ts` (5) contre un faux serveur ; `config.spec.ts` |
| Rappel d'essai pour les tests sur téléphones (versions de test seulement) | Flutter (autorisation, programmation, service inchangé) |
| Documentation cohérente avec le code | `PROJECT_STATUS.md` (modules corrigés), `DECISIONS.md` T-025 à T-029, études et protocoles listés ci-dessous |
| Fichier compilé Python retiré du dépôt ; `.gitignore` complété (`__pycache__/`, `*.py[cod]`) | Commit e522f64 ; CI relancée (run 38759310442, verte) |

## 2. Corrections

| N° | Correction | État | Preuve |
| --- | --- | --- | --- |
| C1 | Heures calmes, option B : rappel à l'heure choisie envoyé même la nuit, relances bloquées, jamais reportées | **Faite** | 7 cas, nuit minute par minute, e2e (relance bloquée après coup, rappel initial, aucun doublon) |
| C2 | Textes de Peni v3, tâche en tête, pose encourageante | **Faite, provisoire** jusqu'au test T17 | Unitaires, e2e, copie de l'app contrôlée par l'API, Flutter |
| C3 | Purge des comptes jamais vérifiés (30 jours), **désactivée et en simulation** | **Faite** ; suppression réelle **non activée** | 9 e2e, test navigateur de l'administration ; `docs/PURGE_COMPTES_NON_VERIFIES.md` |
| C4 | Solution au plantage avec Peni | En attente des tests T12 et T13 sur téléphones, puis décision D5 | — |
| C5 | Retard des notifications du téléphone près des heures calmes (options P1 à P3) | En attente de ta décision (D8) et des mesures T6, T7 | `docs/RYTHME_ET_TEXTES_RAPPELS.md`, section 2 |

## 3. Tests physiques à réaliser (obligatoires avant la clôture)

| Point | Statut | Préparation disponible |
| --- | --- | --- |
| T1 à T17 sur 3 à 5 téléphones (Tecno, Infinix, itel, Samsung, Xiaomi facultatif) : autorisation, notifications app ouverte / fermée / écran verrouillé, veille, économiseur, redémarrage, « Ne pas déranger », boutons, centre de notifications, réglages des marques | ⬜ **non réalisés** — à faire par toi ou un testeur (je n'ai pas accès à de vrais téléphones) | `docs/TESTS_TELEPHONES.md` (grille et tableau de résultats), APK de test (workflow manuel, vérifié), `scripts/test-telephones.sh`, rappel d'essai, « Les 3 textes de Peni » |
| T12, T13 : glissement au-delà du haut sur un écran avec Peni | ⬜ **non réalisés** | Même protocole ; seuls ces tests diront si le plantage existe hors de l'émulateur |
| Rappels réels (calculés à partir des tâches) | ⬜ hors du périmètre actuel | Le service reste fermé ; les tester demanderait de l'ouvrir dans une base de test locale, **seulement avec ton accord** |

## 4. Décisions

| N° | Décision | État |
| --- | --- | --- |
| D1 | Rythme : à l'heure, +1 h, +2 h si la tâche n'est pas cochée | **Décidé** le 15/10 (T-030) |
| D2 | Heures calmes 22 h – 6 h, option B | **Décidé** et appliqué (C1) |
| D3 | Textes de Peni et poses | **Principe décidé** ; validation définitive après T17 |
| D4 | Purge : 30 jours, dans le lot 2, désactivée et en simulation | **Décidé** et appliqué (C3) ; suppression réelle : **ta validation explicite** ; conservation des tentatives et des codes : non décidée |
| D5 | Solution au plantage avec Peni | Après les tests T12 et T13 |
| D6 | Reports proposés (section 6) | À confirmer |
| D7 | Fournisseur SMS et e-mails | **Décidé** : prérequis du lancement public (L4) |
| D8 | Retard des notifications du téléphone près des heures calmes : P1 (recommandée), P2 ou P3 | À choisir |

## 5. Prérequis du lancement public (pas nécessaires pour clôturer le développement)

| N° | Prérequis | Coût / service externe | Autorisation |
| --- | --- | --- | --- |
| L1 | Projet Firebase au nom de l'entreprise (`docs/FIREBASE_PROJET.md`), puis branchement dans l'app et tests sur téléphones | Gratuit ; création de compte | **Oui** |
| L2 | Hébergement du service des rappels (worker séparé, Paris) ; prix de Paris à confirmer avec le calculateur AWS | ≈ 16 à 24 USD/mois (estimation) | **Oui** |
| L3 | Ouverture du service des rappels (`notifications.reminders_enabled`) | Aucun en soi | **Oui** |
| L4 | Fournisseur SMS et e-mails réels (décidé : prérequis du lancement, T-030) | Payant à l'usage (à chiffrer selon R-01) | **Oui** |
| L9 | Suppression réelle de la purge des comptes jamais vérifiés (après une période en simulation) | Aucun | **Oui** |
| L5 | Politique de confidentialité et déclaration ARTCI (Google comme sous-traitant, durées de conservation) | Avis juridique | **Oui** |
| L6 | Alarmes de surveillance CloudWatch (worker arrêté, rappels en retard, échecs) | Dans l'offre gratuite au lancement | Avec L2 |
| L7 | iOS : compilation, notifications Apple | Compte Apple Developer 99 USD/an (déjà prévu pour publier) | **Oui** |
| L8 | Suivi des plantages (Crashlytics) | Gratuit, avec L1 | Avec L1 |

## 6. Reports proposés (sans effet sur la première version)

| Fonction | Pourquoi reportable |
| --- | --- |
| Alarme exacte (« ALARME » encadrée) | Décidé le 15/10 (T-027) : notifications classiques en v1 ; architecture prête |
| « Il ne reste plus que X h » dans le dernier rappel | Confort ; non nécessaire |
| Lieu de la tâche dans le texte (« au Fitness Club ») | Les tâches n'ont pas de lieu ; lié aux lots 5 et 7 |
| Rappel « rendez-vous la veille » | Concerne les réservations auprès des marchands (lots 5 et 7) |
| Filtres Pièces, Commandes, Live du centre de notifications | Fonctions des lots suivants |
| Notifications « réponse du support » et « coffre » sur le téléphone | Déjà visibles dans le centre de notifications ; demande Firebase |

## Conditions de clôture proposées

Le lot 2 « développement » pourra être clôturé quand :
1. les tests T1 à T17 sont réalisés sur au moins 3 téléphones et leurs résultats reportés ;
2. les décisions D3 (définitive), D5 et D8 sont prises ;
3. les corrections C4 et C5, et celles issues des tests, sont faites et testées (ou reportées par décision) ;
4. la CI complète est verte sur le dernier commit.

La section 5 devient alors la liste des prérequis du lancement public.
