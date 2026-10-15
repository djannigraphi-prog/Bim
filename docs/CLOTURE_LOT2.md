# Clôture du lot 2 — Rappels et notifications : checklist

État au 15/10/2026, 15 h 30. **Le lot 2 n'est pas clôturé.** Chaque point « fait » renvoie à une preuve vérifiable (test automatique exécuté, exécution de CI, capture). Rien n'est considéré comme fait sans preuve.

Légende : ✅ fait et vérifié · 🟡 fait, vérification incomplète · ⬜ à faire · 🔶 décision du fondateur · 💰 dépense ou service externe à autoriser.

## Preuves de référence

| Preuve | Où la voir |
| --- | --- |
| CI complète verte sur le code actuel (API, admin, mobile, Android de bout en bout) | GitHub Actions, run 38754528932 (commit 2d4a014) ; capture de l'écran verrouillé : run 38750712525 |
| Suite API locale : 184 tests réussis, 1 ignoré (S3, exécuté en CI), 1 à écrire (lot 8, sans rapport) | `cd apps/api && npm test` (relancé le 15/10 à 15 h 20) |
| Tests Flutter : 39 réussis ; analyse sans remarque | Job « mobile » du run 38754528932 |
| Captures réelles de l'émulateur Android 14 | Branche `ci-captures-android` : `a28_rappels`, `a28_ecran_verrouille`, `a28_notifications`, `a28_notification_seule`, `a28_jy_vais`, `a17_notifications` |
| Rendus des écrans (tests) | Branche `ci-captures` : `x15_rappels` (normal, petit, sombre), `17_notifications`, `62_parametres` |
| Enquête sur la perte de l'émulateur | `docs/TESTING.md`, « Perte de l'émulateur » (3 séries, 12 situations, Android 13 à 15) |

## Priorité 1 — bloquant pour la clôture

| N° | Point | Statut | Preuve | Reste à faire | Téléphones réels | Décision | Coût / service externe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | Tests sur téléphones physiques (autorisation, notifications app ouverte / fermée / écran verrouillé, veille, économiseur, redémarrage, actions) | ⬜ | Protocole prêt : `docs/TESTS_TELEPHONES.md` (T1 à T15), APK de test à la demande, rappel d'essai (test Flutter) | Réaliser les tests sur 3 à 5 téléphones (Tecno, Infinix, itel, Samsung) et reporter les résultats | **Oui, tout** | Choisir les téléphones et la personne qui teste | Aucun (téléphones existants, ordinateur, Wi-Fi local). Minutes de CI pour l'APK : quota inclus |
| 1.2 | Perte de l'émulateur (Peni en SVG + effet d'étirement + Impeller) | 🟡 | Reproduit et isolé sur l'émulateur seulement (Android 13, 14, 15) ; aucune donnée sur un vrai téléphone | Vérifier sur téléphones (T12, T13). Si reproduit : appliquer la solution choisie (6 évaluées, aucune appliquée) | **Oui** (T12, T13) | Choisir la solution **après** les tests (recommandation : Peni en PNG si le problème existe sur téléphone ; sinon rien) | Aucun |
| 1.3 | Valeurs du rythme et des heures calmes (heure de la tâche, +1 h, +2 h ; pas de rappel de 22 h à 6 h) | 🔶 | Réglages enregistrés « en attente » (`app_settings`, test e2e « réglages des rappels… non validés ») | Rien à développer (modifiables dans l'administration) | Non | **Valider ou changer** | Aucun |
| 1.4 | Texte du dernier rappel (maquette : « Je t'en supplie 😭… Il ne reste plus que 2 h ! ») | 🔶 | Textes v2 testés (`reminders.spec.ts`) ; proposition plus douce, sans culpabiliser (T-029) | Appliquer le texte retenu (une ligne + tests) | Non | **Choisir le texte** | Aucun |
| 1.5 | Documentation à jour et cohérente | ✅ | `PROJECT_STATUS.md` (tableau des modules corrigé le 15/10 : 16 migrations, ligne lot 2), `DECISIONS.md` T-025 à T-029, `docs/LOT2_RAPPELS_ETUDE.md`, `docs/TESTING.md`, `docs/TESTS_TELEPHONES.md`, `docs/FIREBASE_PROJET.md`, `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`, `apps/mobile/README.md` | Reporter les résultats des tests sur téléphones | Non | — | Aucun |

## Priorité 2 — fonctionnel et vérifié (à confirmer sur téléphone pour la partie Android)

| N° | Point | Statut | Preuve | Reste à faire | Téléphones réels | Décision | Coût |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | Préférences de rappel (écran Rappels), rappels **désactivés par défaut**, distincts de l'autorisation d'Android | ✅ | e2e API `lot2.e2e-spec.ts`, `reminders.e2e-spec.ts` (rien sans activation) ; Flutter `reminder_preferences_test.dart` (13) ; Android : `a28_rappels` | — | T1, T2 | — | Aucun |
| 2.2 | Calcul des rappels (fuseau, pauses, tâches cochées, période active, heures calmes, clés anti-doublon) | ✅ | `reminders.spec.ts` (9), `timezone.spec.ts` | — | Non | — | Aucun |
| 2.3 | Notifications programmées sur le téléphone, non exactes, un seul canal par appareil | ✅ (émulateur) | e2e « rappels à venir » ; Flutter `reminder_scheduler_test.dart` ; Android : 2 vraies notifications affichées et lues dans le rapport d'Android | Mesurer le retard réel et le comportement des marques | **Oui** (T3 à T7, T10) | — | Aucun |
| 2.4 | Actions « J'y vais ! » (ouvre la journée) et « Plus tard » (ferme) | ✅ (émulateur) | Android : boutons touchés dans le volet, journée ouverte (`a28_jy_vais`), notification fermée | — | **Oui** (T8, T9) | — | Aucun |
| 2.5 | Maquette 28 : icône « B », avatar de Peni selon la tentative, textes v2, écran verrouillé | 🟡 | Flutter (icônes, pose) ; captures `a28_ecran_verrouille`, `a28_notification_seule` | Voir écarts restants (2.6) ; rendu sur téléphones | **Oui** (T3, T4) | 1.4 | Aucun |
| 2.6 | Maquette 28, écarts restants : « ALARME » encadrée, « Il ne reste plus que 2 h », lieu de la tâche, notifications regroupées par Android (avatar et boutons visibles une fois dépliées), rendu iPhone | ⬜ / 🔶 | Écarts documentés (`PROJECT_STATUS.md`) | Selon décisions : voir 3.1, 3.2, 3.3 | En partie | Reporter ou non (voir priorité 3) | Aucun |
| 2.7 | Centre de notifications (écran 17) : coffres, réponses du support, rappels envoyés ; filtres Tout / Projets ; pastille | ✅ | e2e `inbox.e2e-spec.ts` (2) ; Flutter `notifications_screen_test.dart` (5) ; Android : `a17_notifications`, pastille effacée | — | T14 | — | Aucun |
| 2.8 | Worker des rappels serveur (file PostgreSQL, anti-doublon, reprise, surveillance, `/health`, page admin) — **inactif** | ✅ | `reminders.e2e-spec.ts` (9) ; démarrage réel du worker séparé vérifié en local | Déploiement (voir 4.2) | Non | — | 💰 si service séparé |
| 2.9 | Envoi Firebase (FCM HTTP v1) — **inactif** | ✅ (faux serveur) | `fcm-push-sender.spec.ts` (5), `config.spec.ts` | Brancher la vraie source de jeton dans l'app après création du projet (4.1) | **Oui**, après 4.1 | 4.1 | Gratuit, mais compte à créer |
| 2.10 | Tests API et Flutter | ✅ | 184 API, 39 Flutter, admin et Android de bout en bout (run 38754528932) | — | — | — | Aucun |

## Priorité 3 — peut être reporté sans compromettre la première version (proposition, à confirmer)

| N° | Point | Statut | Pourquoi reportable | Décision | Coût |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Alarme exacte (« ALARME » encadrée, plein écran) | Reporté (décidé le 15/10, T-027) | Notifications classiques retenues en v1 ; architecture prête (`ReminderTiming`) | Confirmé | Aucun |
| 3.2 | « Il ne reste plus que X h » dans le dernier rappel | ⬜ | Petit calcul (fin de journée locale) ; pas indispensable | Garder pour v1 ou reporter | Aucun |
| 3.3 | Lieu de la tâche dans le texte (« au Fitness Club ») | ⬜ | Les tâches n'ont pas de lieu ; lié aux salles et marchands (lots 5 et 7) | Reporter | Aucun |
| 3.4 | Rappel « rendez-vous la veille » (ANALYSE, section 11) | ⬜ | Concerne les rendez-vous avec des marchands (réservations, lots 5 et 7) | Reporter au lot des réservations | Aucun |
| 3.5 | Filtres Pièces, Commandes, Live du centre de notifications | ⬜ | Fonctions des lots 4 à 10 | Reporter avec leurs lots | Aucun |
| 3.6 | iOS (notifications Apple, compilation) | ⬜ | iOS non compilé par décision du 14/10 | Reporter | 💰 compte Apple Developer 99 USD/an (déjà prévu pour publier) |
| 3.7 | Purge planifiée des comptes jamais vérifiés et des anciennes tentatives de connexion (classée « lot 2 » dans PROJECT_STATUS) | ⬜ | Hygiène des données ; aucun effet visible ; le worker peut la porter sans coût | Faire avant la clôture, ou reporter au lancement | Aucun |
| 3.8 | Suivi des plantages de l'app (Crashlytics, prévu dans l'étude) | ⬜ | Utile au lancement public ; dépend du projet Firebase | Reporter au lancement | Gratuit, compte Firebase |
| 3.9 | Notifications « réponse du support » et « coffre » envoyées sur le téléphone (aujourd'hui : centre de notifications seulement) | ⬜ | Le centre de notifications les montre déjà ; l'envoi demande Firebase | Reporter après 4.1 | Aucun |

## Priorité 4 — autorisations nécessaires avant la mise en service publique (pas pour clôturer le développement)

| N° | Point | Statut | Ce qu'il faut | Coût / service externe |
| --- | --- | --- | --- | --- |
| 4.1 | Projet Firebase au nom de l'entreprise | 🔶 💰 | Ton accord, puis les étapes de `docs/FIREBASE_PROJET.md` (deux projets : test et production) | Gratuit (formule Spark) ; création de compte = service externe |
| 4.2 | Hébergement du service des rappels (worker séparé, Paris) | 🔶 💰 | Ton accord sur la dépense ; prix exacts de Paris à confirmer avec le calculateur AWS | ≈ 16 à 17 USD/mois (NAT partagé) ou ≈ 23 à 24 USD/mois (adresses publiques), estimation non confirmée |
| 4.3 | Ouverture du service des rappels (`notifications.reminders_enabled`) | 🔶 | Après 1.1, 1.3, 4.1 et 4.2 | Aucun en soi |
| 4.4 | Fournisseur SMS et e-mails réels (codes de vérification) | 🔶 💰 | Décider s'il fait partie du lot 2 (l'analyse le place hors du lot 2 ; plusieurs documents le notaient « lot 2 ») ou des prérequis du lancement ; choisir le fournisseur | Payant à l'usage (à chiffrer selon R-01 avant toute décision) |
| 4.5 | Mention de Google (Firebase) dans la politique de confidentialité, déclaration ARTCI | 🔶 | Avis juridique | Selon conseil |

## Points techniques mineurs

| Point | Statut | Action proposée |
| --- | --- | --- |
| Fichier compilé `.github/scripts/__pycache__/otp-relay.cpython-313.pyc` suivi dans le dépôt | ⬜ | Le retirer du suivi et l'ignorer (sur ton autorisation : c'est une suppression de fichier) |
| Passage des machines de CI à Ubuntu 26 (à partir du 19/10/2026) | ⬜ | Surveiller les premières exécutions |
| Sonde de l'émulateur (workflow manuel) | ✅ | Conserver jusqu'à la résolution de 1.2 |

## Peut-on clôturer maintenant ?

Non. Clôturer sans risque supposerait les tests sur téléphones réels (1.1, 1.2) et tes décisions 1.3 et 1.4. Sans eux, on déclarerait terminé un lot dont le comportement réel sur les téléphones visés et la stabilité de l'écran Rappels avec Peni ne sont pas prouvés. Le développement qui ne dépend ni de décisions ni de dépenses est fait et vérifié (priorité 2). La priorité 4 concerne la mise en service publique, pas la clôture du développement.

**Proposition de clôture** : clôturer le lot 2 « développement » quand 1.1 à 1.4 sont faits et 3.7 est fait ou reporté ; la priorité 4 devient une liste de prérequis du lancement public.
