# Purge des comptes jamais vérifiés (lot 2)

Statut : **développée et testée, DÉSACTIVÉE et en SIMULATION par défaut** (décision du fondateur du 15/10/2026, 15 h 44). Aucun compte n'est supprimé. La suppression réelle ne sera activée qu'après la validation explicite du fondateur.

## Situation avant la purge (vérifiée dans le code, `apps/api/src/modules/auth/auth.service.ts`)

- À l'inscription, le compte est créé avec le statut `pending_verification`. Il devient `active` seulement quand la personne saisit le code reçu par SMS ou par e-mail.
- Un compte non vérifié **n'a jamais eu de session** : il ne peut créer ni projet, ni photo, ni signalement, ni boutique.
- Son nom d'utilisateur est réservé **24 heures**. Passé ce délai, si quelqu'un s'inscrit avec le même nom, l'ancien compte non vérifié est supprimé dans la même transaction (`PENDING_ACCOUNT_TTL_MS`). Ce comportement existant n'est pas modifié.

## Décisions appliquées

| Élément | Valeur | Où |
| --- | --- | --- |
| Délai | **30 jours** après la création ; un réglage plus court est ignoré (minimum imposé par le code) | réglage `maintenance.account_purge_after_days` (« decided ») ; `PURGE_MIN_DAYS` |
| Interrupteur | **désactivé** | réglage `maintenance.account_purge_enabled` = false (« pending ») |
| Mode | **simulation** : compte les comptes concernés, ne supprime rien | réglage `maintenance.account_purge_mode` = "simulation" (« pending ») |
| Plafond | **500 comptes** par passage ; au-delà, rien n'est supprimé, le passage est arrêté et une alerte est journalisée | `PURGE_MAX_PER_RUN`, non modifiable depuis l'administration |
| Exécution unique | Verrou PostgreSQL (un passage à la fois, tous serveurs confondus) et un seul passage quotidien par jour | `pg_try_advisory_xact_lock` ; journal `maintenance_runs` |
| Heure | 3 h (heure d'Abidjan), dans le processus du worker ; **rien ne tourne avec `WORKER_MODE=off`** (valeur par défaut) | `maintenance-runner.ts` |
| Journal d'audit | `user.purged` par compte supprimé (identifiant seul, sans nom, téléphone ni e-mail) ; `maintenance.account_purge` par passage, simulation comprise | `audit_logs` |
| Conservation des tentatives de connexion et des codes | **Non développée** : non validée par le fondateur | — |

## Comptes concernés : toutes ces conditions, revérifiées dans la requête de suppression

- statut `pending_verification`, non supprimé, **jamais connecté** ;
- créé il y a plus de 30 jours, à l'**heure de la base de données** ;
- **aucune coordonnée vérifiée** ;
- **aucun code envoyé dans les dernières 24 heures** (une vérification en cours n'est jamais coupée) ;
- **aucune ligne** dans les tables d'activité : sessions, comptes Google/Apple/Facebook, projets, photos, signalements, boutiques, membres de boutique, comptes livreur, appareils, rappels envoyés.

Les données d'inscription sont supprimées avec le compte (cascade) : coordonnées non vérifiées, codes, centres d'intérêt, préférences, confidentialité, préférences de notification. Un test compare ces listes aux clés étrangères réelles de la base : **une nouvelle table liée aux comptes (lots suivants) fait échouer les tests** tant qu'elle n'est pas classée « bloquante » ou « supprimée avec le compte ».

## Activer la suppression réelle (seulement sur décision du fondateur)

Trois conditions, toutes nécessaires, dans **Administration → Réglages** (rôle super_admin) :
1. `maintenance.account_purge_enabled` = true, marqué « decided » ;
2. `maintenance.account_purge_mode` = "real", marqué « decided » ;
3. le worker lancé (`WORKER_MODE` ≠ off), ce qui relève de l'hébergement des rappels (prérequis L2, avec ton accord).

Si l'un des deux réglages n'est pas marqué « decided », la purge reste en simulation. Recommandation : laisser d'abord tourner la simulation quelques jours et vérifier les nombres.

## Suivi dans l'administration

Page **Maintenance** (permission « surveillance technique ») : état, mode appliqué, 10 derniers passages, bouton **« Lancer une simulation »**. Cette simulation ne supprime jamais rien, même en mode réel validé, et ne compte pas comme le passage du jour.

## Tests (base PostgreSQL réelle, `test/maintenance.e2e-spec.ts`, 9 tests)

| Test | Vérifie |
| --- | --- |
| Valeurs par défaut | Désactivée, simulation, suppression réelle non permise ; le passage quotidien ne fait rien et n'enregistre rien |
| Simulation | Compte les comptes concernés, ne supprime rien, trace et audit ; mode « real » non validé = simulation |
| Mode réel validé | Seuls les comptes jamais vérifiés de plus de 30 jours sont supprimés, avec la cascade ; **jamais touchés** : actif, suspendu, supprimé, récent (29 jours), code récent, compte avec session et coordonnée vérifiée, coordonnée vérifiée, déjà connecté ; audit sans donnée personnelle ; un seul passage par jour |
| Délai minimal | Un réglage à 7 jours est ignoré (30 jours appliqués) |
| Plafond | 501 comptes : arrêt, rien supprimé ; 500 : tout est traité |
| Exécution unique | Trois passages simultanés : un seul supprime |
| Administration | Simulation à la demande (aucune suppression), état, droits (refus sans la permission) |
| Passage quotidien | Seulement à 3 h ; sans effet tant que la purge est désactivée |
| Tables liées aux comptes | Toute clé étrangère vers les comptes est classée |

Un test navigateur de l'administration ouvre la page Maintenance et lance une simulation.

## Points à mentionner ailleurs

- Les sauvegardes expirent après 14 jours (`docs/BACKUP_RESTORE.md`) : un compte purgé reste au plus 14 jours dans les sauvegardes. À indiquer dans la politique de confidentialité (prérequis L5).
- La minimisation des données va dans le sens de l'ARTCI ; la durée de 30 jours est à indiquer dans la politique de confidentialité (avis juridique).
