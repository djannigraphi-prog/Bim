# Clôture du lot 2 — Rappels et notifications : checklist

État au 15/10/2026, 16 h. **Le lot 2 n'est pas clôturé.** Un point n'est « terminé » que s'il a une preuve vérifiable : test automatique exécuté, exécution de CI ou capture. Les tests sur vrais téléphones n'ont **pas** été réalisés.

## Preuves de référence

| Preuve | Où la voir |
| --- | --- |
| CI complète verte (API, admin, mobile, Android de bout en bout sur émulateur) | GitHub Actions, run 38759310442 (commit e522f64, après le retrait du fichier compilé) ; également run 38754528932 |
| Suite API : 184 tests réussis (1 ignoré : S3, exécuté en CI ; 1 à écrire : lot 8, sans rapport) | `cd apps/api && npm test`, relancé le 15/10 à 15 h 20 |
| Tests Flutter : 39 réussis ; analyse sans remarque | Job « mobile » de la CI |
| Captures réelles de l'émulateur Android 14 | Branche `ci-captures-android` : `a28_rappels`, `a28_ecran_verrouille`, `a28_notifications`, `a28_notification_seule`, `a28_jy_vais`, `a17_notifications` |
| Rendus des écrans (tests) | Branche `ci-captures` : `x15_rappels` (normal, petit, sombre), `17_notifications`, `62_parametres` |
| APK de test pour téléphones (workflow manuel) | Run 38759453834 : réussi, APK arm64 de 57 Mo (adresse d’exemple), conservé jusqu’au 18/10 |
| Comportement du rythme et des heures calmes | Calcul exécuté sur le code actuel : `docs/RYTHME_ET_TEXTES_RAPPELS.md`, section 2 |
| Enquête sur la perte de l'émulateur | `docs/TESTING.md`, « Perte de l'émulateur » (3 séries, 12 situations, Android 13 à 15) |

## 1. Éléments terminés et prouvés

| Élément | Preuve |
| --- | --- |
| Préférences de rappel (écran Rappels), rappels **désactivés par défaut**, choix distinct de l'autorisation d'Android | e2e `lot2.e2e-spec.ts` (5), `reminders.e2e-spec.ts` (rien sans activation) ; Flutter `reminder_preferences_test.dart` (13) ; capture `a28_rappels` |
| Calcul des rappels : fuseau, pauses, tâches cochées, période active, heures calmes, clés anti-doublon | `reminders.spec.ts` (9), `timezone.spec.ts` |
| Notifications programmées sur le téléphone, non exactes, un seul canal par appareil | e2e « rappels à venir » ; Flutter `reminder_scheduler_test.dart` (9) ; émulateur : vraies notifications lues dans le rapport d'Android |
| « J'y vais ! » ouvre la journée du projet ; « Plus tard » ferme la notification | Émulateur : boutons touchés dans le volet, captures `a28_jy_vais` |
| Maquette 28 : icône « B », avatar de Peni selon la tentative, écran verrouillé | Flutter (icônes, pose) ; captures `a28_ecran_verrouille`, `a28_notification_seule` |
| Centre de notifications (écran 17), filtres Tout / Projets, pastille de la cloche | e2e `inbox.e2e-spec.ts` (2) ; Flutter `notifications_screen_test.dart` (5) ; capture `a17_notifications` |
| Worker des rappels serveur (anti-doublon, reprise, surveillance, `/health`, page admin) — **inactif** | `reminders.e2e-spec.ts` (9) ; démarrage réel du worker séparé vérifié en local |
| Envoi Firebase (FCM HTTP v1) — **inactif** | `fcm-push-sender.spec.ts` (5) contre un faux serveur ; `config.spec.ts` |
| Rappel d'essai pour les tests sur téléphones (versions de test seulement) | Flutter (autorisation, programmation, service inchangé) |
| Documentation cohérente avec le code | `PROJECT_STATUS.md` (modules corrigés), `DECISIONS.md` T-025 à T-029, études et protocoles listés ci-dessous |
| Fichier compilé Python retiré du dépôt ; `.gitignore` complété (`__pycache__/`, `*.py[cod]`) | Commit e522f64 ; CI relancée (run 38759310442, verte) |

## 2. Corrections encore nécessaires (après tes décisions)

| N° | Correction | Dépend de | Effort | Coût |
| --- | --- | --- | --- | --- |
| C1 | Heures calmes, option B : rappel à l'heure choisie envoyé même la nuit, relances bloquées | Décision D2 | Petit (calcul + tests) | Aucun |
| C2 | Textes de Peni v3 et poses | Décision D3 | Petit (modèles + tests) | Aucun |
| C3 | Purge des comptes jamais vérifiés, désactivée et en simulation par défaut | Décision D4 (ou report) | Moyen (service, tests, affichage admin) | Aucun |
| C4 | Solution au plantage avec Peni (par exemple Peni en PNG) | Tests T12 et T13 sur téléphones, puis décision D5 | Petit à moyen | Aucun |

## 3. Tests physiques à réaliser (obligatoires avant la clôture)

| Point | Statut | Préparation disponible |
| --- | --- | --- |
| T1 à T16 sur 3 à 5 téléphones (Tecno, Infinix, itel, Samsung, Xiaomi facultatif) : autorisation, notifications app ouverte / fermée / écran verrouillé, veille, économiseur, redémarrage, « Ne pas déranger », boutons, centre de notifications, réglages des marques | ⬜ **non réalisés** | `docs/TESTS_TELEPHONES.md` (grille et tableau de résultats), APK de test (workflow manuel, vérifié), `scripts/test-telephones.sh`, rappel d'essai |
| T12, T13 : glissement au-delà du haut sur un écran avec Peni | ⬜ **non réalisés** | Même protocole ; seuls ces tests diront si le plantage existe hors de l'émulateur |
| Rappels réels (calculés à partir des tâches) | ⬜ hors du périmètre actuel | Le service reste fermé ; les tester demanderait de l'ouvrir dans une base de test locale, **seulement avec ton accord** |

## 4. Décisions restant à valider

| N° | Décision | Proposition | Document |
| --- | --- | --- | --- |
| D1 | Rythme : à l'heure, +1 h, +2 h si la tâche n'est pas cochée | Garder (déjà appliqué par le code) | `docs/RYTHME_ET_TEXTES_RAPPELS.md` §1 |
| D2 | Heures calmes 22 h – 6 h ; tâches placées pendant ces heures | Option B | §2 |
| D3 | Textes de Peni et poses | Textes proposés en §3 | §3 |
| D4 | Purge : délai (7 jours proposés), conservation des tentatives (90 jours) et des codes (30 jours) ; dans le lot 2 ou au lancement | À choisir | `docs/PURGE_COMPTES_NON_VERIFIES.md` |
| D5 | Solution au plantage avec Peni | Après les tests T12 et T13 | `docs/TESTING.md` |
| D6 | Reports proposés (section 6) | À confirmer | ci-dessous |
| D7 | Fournisseur SMS et e-mails : lot 2 ou prérequis du lancement | Prérequis du lancement (l'analyse ne le place pas dans le lot 2) | section 5 |

## 5. Prérequis du lancement public (pas nécessaires pour clôturer le développement)

| N° | Prérequis | Coût / service externe | Autorisation |
| --- | --- | --- | --- |
| L1 | Projet Firebase au nom de l'entreprise (`docs/FIREBASE_PROJET.md`), puis branchement dans l'app et tests sur téléphones | Gratuit ; création de compte | **Oui** |
| L2 | Hébergement du service des rappels (worker séparé, Paris) ; prix de Paris à confirmer avec le calculateur AWS | ≈ 16 à 24 USD/mois (estimation) | **Oui** |
| L3 | Ouverture du service des rappels (`notifications.reminders_enabled`) | Aucun en soi | **Oui** |
| L4 | Fournisseur SMS et e-mails réels | Payant à l'usage (à chiffrer selon R-01) | **Oui** |
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
1. les tests T1 à T16 sont réalisés sur au moins 3 téléphones et leurs résultats reportés ;
2. les décisions D1 à D5 et D7 sont prises ;
3. les corrections C1 à C4 qui en découlent sont faites et testées (ou reportées par décision) ;
4. la CI complète est verte sur le dernier commit.

La section 5 devient alors la liste des prérequis du lancement public.
