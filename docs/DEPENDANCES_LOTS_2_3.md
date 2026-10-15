# Dépendances entre les lots 2 (notifications et rappels) et 3 (Peni)

Rédigé le 15/10/2026, avant la clôture du lot 1. But : concevoir le lot 2 de façon à ce que le lot 3 n'oblige pas à reprendre une partie importante du code. Les fonctionnalités des lots 2 et 3 ne sont **pas** développées ici.

Légende : **fait** (corrigé dans le code au lot 1) · **règle** (à respecter en concevant le lot 2) · **décision** (à prendre par le fondateur).

## Rappel du périmètre

| Lot | Contenu prévu (ANALYSE.md, section 11) | Écrans |
| --- | --- | --- |
| 2 | Notifications push, centre de notifications, rappels planifiés par le serveur, alarme, préférences, dédoublonnage | 17, 27 (rappels), 28 |
| 3 | Peni : conversation, aide à la construction du programme, cadrage santé, quotas et coûts du modèle de langage | 19 (« en parler avec Peni »), 20 (« Demande à Peni »), 24, 25 |

Points communs : les rappels et l'alarme sont des **messages de Peni** (écrans 17, 27, 28) ; Peni doit connaître la **vie du projet** (tâches, pauses, mesures, signalements) ; les deux s'appuient sur les mêmes horaires et le même fuseau.

## Vérification de l'architecture actuelle

| Élément existant | Utile pour | État |
| --- | --- | --- |
| `project_events` (journal par projet, UUID v7 ordonnés) | recalcul des rappels (2), contexte de Peni (3) | **Fait** : complété le 15/10 (tâche ajoutée / retirée, changement de mode, mesure, ouverture d'un coffre), écrit dans la même transaction que le changement ; test de contrat ajouté (`projects-lot1b.e2e-spec.ts`). |
| `task_completions` | ne pas envoyer un rappel pour une tâche déjà cochée ; encouragements de Peni | Suffisant : le rappel vérifie l'état **au moment de l'envoi** (pas d'annulation à synchroniser). |
| Horloge injectable (`CLOCK`) et calcul du jour centralisé (`plan.ts`, `today()`) | tests des rappels, fuseau | Suffisant, un seul endroit à changer si le fuseau devient propre à chaque personne. |
| `sessions` avec `family_id` (un appareil = une famille, une ligne par rotation) | jetons push par appareil | Suffisant, avec la règle R3. |
| `app_settings` + administration (réglages contrôlés et audités) | délais des rappels, quotas de Peni | Suffisant. |
| `user_preferences` | préférences de notification | Suffisant (une table `notification_preferences` s'ajoutera sans conflit). |
| `ProjectsService` (méthodes prenant `userId`) | Peni qui propose ou modifie un programme | Utilisable, avec la règle R5. |
| Signalements (`project_reports`, statut, réponse) | notification « le support t'a répondu » (2) | Point d'accroche identifié : `AdminService.resolveReport`. |

Aucun blocage d'architecture trouvé. Une seule correction était utile dès maintenant : compléter le journal des événements (fait).

## Règles à respecter au lot 2 (pour ne rien reprendre au lot 3)

- **R1 — Le texte d'une notification n'est pas figé en base.** Une notification enregistre un type (`task_reminder`, `task_alarm`, `report_answered`…), ses paramètres (projet, tâche, heure), l'expéditeur (`peni`, `bim`, plus tard une boutique) et la pose de Peni. Le texte est produit à l'envoi à partir de **modèles de messages versionnés dans le dépôt**, dans la voix de Peni. Au lot 3, un rédacteur « Peni personnalisé » (modèle de langage) pourra remplacer le modèle pour certains messages, derrière la même interface, **avec retour automatique au modèle écrit** si le service est lent, coûteux ou indisponible : un rappel ne dépend jamais du modèle de langage.
- **R2 — Les horaires des rappels se recalculent à partir du journal des événements** (`project_events`) : création, tâche ajoutée ou retirée, pause, reprise, fin, abandon, changement de mode. Le module Projets n'appelle pas le module Notifications.
- **R3 — Un jeton push est rattaché à l'appareil (`family_id` des sessions), pas à une ligne de session** : chaque rafraîchissement crée une nouvelle ligne ; rattacher le jeton à la ligne le ferait perdre. Le jeton est supprimé à la déconnexion ou à la révocation de l'appareil.
- **R4 — Un seul catalogue de messages de Peni** (rappels, alarme, encouragements, coffre) partagé par les lots 2 et 3, avec les limites communes : pas d'avis médical, pas de promesse de résultat, renvoi vers un professionnel pour la santé (urgences 185, pompiers 180), pas de culpabilisation (décision C8 du 15/10).
- **R5 — Peni passe par les mêmes contrôles que l'app.** Quand Peni proposera ou modifiera un programme (lot 3), il appellera `ProjectsService` avec les mêmes objets de validation que les routes (`CreateProjectDto`, `AddTaskDto`…, validés avant l'appel), car le service suppose des données déjà contrôlées. Peni propose ; la personne confirme.
- **R6 — Les entrées vers Peni restent des points d'accroche** : « Je préfère en parler avec Peni » (19) et « Pas sûr ? Demande à Peni » (20) affichent aujourd'hui « bientôt disponible ». Au lot 3, Peni rendra un **brouillon de projet au même format que `POST /v1/projects`**, que l'app pré-remplit : rien à changer dans l'API des projets.

## Dépendances qui demandent une décision

| N° | Sujet | Pourquoi c'est important | Proposition |
| --- | --- | --- | --- |
| D-L2-01 | **Fuseau horaire** — *décidé le 15/10 : Côte d'Ivoire au lancement, architecture multi-pays (T-025)* | Tous les jours et heures sont aujourd'hui ceux d'Abidjan (UTC+0, sans heure d'été). Un rappel « 15:00 » pour une personne au Cameroun (UTC+1) partirait à 16:00 locale, et le changement de jour serait décalé. | Si BIM reste en Côte d'Ivoire au lancement : garder Abidjan. Sinon, enregistrer le fuseau de chaque personne au lot 2 et rendre `today()` propre à chaque personne (un seul endroit à modifier). **À confirmer : pays visés au lancement.** |
| D-L2-02 | **Alarme de l'écran 28** — *décidé le 15/10 : notifications d'abord, étude dans `LOT2_RAPPELS_ETUDE.md`* | Android 14 n'autorise plus les alarmes exactes par défaut ; la règle de Google Play réserve la permission automatique aux applications de réveil ou d'agenda (BIM n'en est probablement pas une). iOS limite aussi les vraies alarmes (possibilités récentes à vérifier). | Rappel par notification push « haute priorité » envoyée par le serveur, plus une notification locale ; alarme exacte seulement si la personne l'autorise dans les réglages du téléphone. Test sur de vrais téléphones courants en Côte d'Ivoire (déjà prévu : « validation technique des alarmes »). |
| D-L2-03 | **Processus de tâches de fond** — *options et coûts dans `LOT2_RAPPELS_ETUDE.md`, à valider* | Les rappels exigent un processus « worker » (pg-boss, décidé dans l'analyse) en plus de l'API. | À ajouter au plan de déploiement AWS (coût faible, mais c'est une dépense à valider avec le reste de l'hébergement). |
| D-L3-01 | **Fournisseur du modèle de langage de Peni** | Coût par message, quotas, données envoyées à un tiers (ARTCI). | Déjà listé comme bloquant du lot 3 ; à décider avant le lot 3, sans effet sur le lot 2 grâce à R1. |

## Ce qui n'est volontairement pas fait maintenant

Pas de table de notifications, pas de jetons push, pas de worker, pas de modèles de messages, pas de conversation Peni : ce sont les lots 2 et 3. Le coffre (C8) est implémenté : son ouverture produit déjà un événement `chest_opened` ; la notification correspondante (lot 2) et le message personnalisé de Peni (lot 3) suivront R1 et R4.
