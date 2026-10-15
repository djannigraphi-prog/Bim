# Tests sur téléphones Android physiques (lot 2)

Statut : **préparé, pas encore réalisé** (aucun résultat n'est enregistré ci-dessous). Rien de payant : un ordinateur, quelques téléphones et le réseau Wi-Fi local suffisent. Le service général des rappels reste **désactivé** ; les notifications se testent avec le « rappel d'essai » des versions de test.

## Pourquoi

L'émulateur de la CI ne remplace pas de vrais téléphones :
- les marques courantes en Côte d'Ivoire (Tecno, Infinix, itel, Xiaomi, Samsung) limitent fortement les applications en arrière-plan pour économiser la batterie ;
- l'émulateur a révélé une perte complète lors d'un glissement sur un écran contenant Peni (voir `docs/TESTING.md`), et il faut savoir si cela arrive sur un vrai téléphone.

## Téléphones conseillés (3 à 5)

| N° | Marque, modèle | Android | Interface | Pourquoi |
| --- | --- | --- | --- | --- |
| 1 | Tecno (Spark ou Camon) | 13 ou 14 | HiOS | très répandu, économies d'énergie agressives |
| 2 | Infinix (Hot ou Note) | 13 ou 14 | XOS | idem |
| 3 | itel (A ou P) | 12 ou 13 (Go) | itel OS | petit budget, peu de mémoire |
| 4 | Samsung Galaxy A | 14 | One UI | référence, autorisation des notifications d'Android 13+ |
| 5 | Xiaomi Redmi (facultatif) | 13 ou 14 | HyperOS / MIUI | démarrage automatique désactivé par défaut |

## Installation (environ 20 minutes)

1. **Ordinateur** : base de données et API en local (`docs/INSTALLATION.md`), avec `SMS_PROVIDER=console` : les codes de vérification s'affichent dans la console de l'API. Lancer l'API : `cd apps/api && npm run start:dev`.
2. **Adresse de l'ordinateur sur le Wi-Fi** : `scripts/test-telephones.sh` l'affiche et vérifie que l'API répond (sinon : `ipconfig` sous Windows, `ip addr` sous Linux, Réglages Réseau sous macOS ; par exemple `192.168.1.20`). Le téléphone et l'ordinateur doivent être sur le **même Wi-Fi**. Vérifier depuis le navigateur du téléphone : `http://192.168.1.20:3000/health` doit répondre.
3. **APK de test** : GitHub → Actions → « APK de test (téléphones) » → « Run workflow », adresse `http://192.168.1.20:3000`. Télécharger l'artefact `bim-test-arm64` (conservé 3 jours). Sans GitHub : `flutter build apk --debug --dart-define=BIM_API_URL=http://192.168.1.20:3000 --dart-define=BIM_ENV=test`.
4. **Installer** sur le téléphone : copier le fichier `.apk` et l'ouvrir (autoriser l'installation depuis cette source), ou `adb install app-arm64-v8a-debug.apk`.
5. Créer un compte de test dans l'app (code lu dans la console de l'API), créer un projet.

La version de test accepte une API en `http` sur le réseau local ; la version publiée n'accepte que `https`.

## Grille de tests (par téléphone)

Noter pour chaque ligne : ✅ conforme, ❌ non conforme (avec une capture d'écran), et le délai observé quand il y en a un.

| N° | Test | Comment | Résultat attendu |
| --- | --- | --- | --- |
| T1 | Autorisation des notifications | Paramètres → Rappels → activer « Recevoir les rappels de Peni » | Android 13 et plus : fenêtre d'autorisation ; après « Autoriser », « Notifications du téléphone : autorisées pour BIM ». Android 12 et moins : pas de fenêtre |
| T2 | Refus puis rattrapage | Refuser, puis « Autoriser » sur l'écran Rappels | L'écran indique « Non autorisées » ; le choix BIM reste enregistré ; le bouton mène à l'autorisation (ou aux réglages du téléphone si Android ne repose plus la question) |
| T3 | Rappel d'essai, app ouverte | « Tests sur téléphone » → « Dans 1 minute », garder l'app ouverte | Notification « Peni » avec l'avatar de Peni, la petite icône B, « J'y vais ! » et « Plus tard » ; noter le retard réel |
| T4 | Rappel d'essai, écran verrouillé | « Dans 1 minute », verrouiller aussitôt | Notification visible sur l'écran verrouillé (selon le réglage « contenu des notifications » du téléphone) ; noter le retard |
| T5 | Rappel d'essai, app fermée | « Dans 1 minute », puis retirer l'app des applications récentes | Notification reçue ; si elle n'arrive pas, noter la marque (fermeture forcée par l'interface du fabricant) |
| T6 | Mise en veille longue | « Dans 15 minutes », écran éteint, téléphone posé, sans le toucher | Notification reçue ; noter le retard (Android regroupe les alarmes non exactes en veille) |
| T7 | Économiseur de batterie | Activer l'économiseur, refaire T6 | Noter si la notification arrive et son retard |
| T8 | « J'y vais ! » | Toucher « J'y vais ! » sur un rappel d'essai | L'app s'ouvre (le rappel d'essai n'est lié à aucun projet : elle reste sur l'écran où elle était) |
| T9 | « Plus tard » | Toucher « Plus tard » | La notification se ferme ; l'app ne s'ouvre pas |
| T10 | Redémarrage | « Dans 15 minutes », redémarrer le téléphone, ne pas ouvrir BIM | Notification reçue après le redémarrage |
| T11 | Ne pas déranger | Activer « Ne pas déranger », « Dans 1 minute » | Comportement du téléphone (en principe : notification silencieuse ou retenue) ; à noter |
| T12 | Glissement sur l'écran Rappels | Ouvrir Paramètres → Rappels, descendre un peu, puis tirer fortement vers le bas au-delà du haut, 5 fois | **L'app et le téléphone continuent de répondre** (question laissée ouverte par l'émulateur) |
| T13 | Même geste ailleurs avec Peni | Même geste sur l'écran d'un projet (Peni en haut) et sur Notifications vide | Idem T12 |
| T14 | Centre de notifications | Cloche de l'accueil | Écran « Notifications » ; vide ou avec les éléments réels (coffres, réponses du support) |
| T15 | Réglages propres à la marque | Noter les réglages qui ont changé quelque chose : démarrage automatique (Tecno, Infinix, Xiaomi), « optimisation de la batterie » pour BIM, gestion des applications en arrière-plan | Liste à joindre aux résultats, pour préparer l'aide de Peni aux personnes concernées |
| T16 | « J'y vais ! » app entièrement fermée | « Dans 1 minute », fermer l'app (retirer des récentes), toucher « J'y vais ! » quand la notification arrive | L'app démarre normalement (rappel d'essai sans projet : écran d'accueil) |
| T17 | Textes et poses de Peni (v3, provisoires) | « Les 3 textes de Peni », verrouiller ; regarder les 3 notifications repliées puis dépliées, et sur l'écran verrouillé | Le nom de la tâche (« Séance d'essai ») est visible en notification repliée ; avatars : joyeux, pensif, joyeux ; aucun texte coupé de façon gênante ; capture de chacune |

Les rappels réels (calculés par l'API à partir des tâches) ne se testent qu'avec le service des rappels ouvert. Le service reste fermé par décision du fondateur ; l'ouvrir, même dans la base de test locale, se fera seulement avec son accord.

## Qui réalise ces tests

Ces tests demandent de vrais téléphones dans les mains : ils ne peuvent pas être faits par Claude, qui n'a accès qu'à l'émulateur de la CI. Ils sont réalisés par le fondateur ou un testeur ; Claude reporte ici **uniquement** les résultats transmis (avec les captures), puis corrige les anomalies, avec une CI verte. Points prioritaires demandés par le fondateur : T16 (« J'y vais ! » app fermée), T12 et T13 (plantage avec Peni), T17 (textes et poses), et le retard réel en veille (T6, T7), qui décide de l'option P1 des heures calmes (`docs/RYTHME_ET_TEXTES_RAPPELS.md`).

## Résultats

À reporter dans le tableau ci-dessous, puis dans `PROJECT_STATUS.md`.

| Téléphone | Android | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | Remarques |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | | | | | | | | | | |
