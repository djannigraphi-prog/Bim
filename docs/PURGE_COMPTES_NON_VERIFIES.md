# Purge des comptes jamais vérifiés — analyse (lot 2)

Statut : **analyse uniquement, rien n'est développé ni exécuté.** Aucune donnée n'est supprimée tant que le fondateur n'a pas validé cette proposition.

## Situation actuelle (vérifiée dans le code, `apps/api/src/modules/auth/auth.service.ts`)

- À l'inscription, le compte est créé avec le statut `pending_verification`. Il devient `active` seulement quand la personne saisit le code reçu par SMS ou par e-mail.
- Un compte non vérifié **n'a jamais eu de session** : il ne peut créer ni projet, ni photo, ni signalement, ni boutique.
- Son nom d'utilisateur est réservé **24 heures**. Passé ce délai, si quelqu'un s'inscrit avec le même nom, l'ancien compte non vérifié est déjà supprimé, dans la même transaction (`PENDING_ACCOUNT_TTL_MS`). Une « purge à la demande » existe donc déjà, limitée à ce cas.
- La personne peut revenir après 24 h : la connexion lui renvoie un code et la vérification reprend.
- Aucun nettoyage n'est programmé : les comptes jamais vérifiés, les codes expirés et les tentatives de connexion s'accumulent.

Données rattachées à un compte non vérifié, toutes supprimées en cascade avec lui (clés étrangères `ON DELETE CASCADE`) : coordonnées non vérifiées (`user_contacts`), codes de vérification, centres d'intérêt, préférences, confidentialité. Les tables `shops` et `courier_accounts` n'ont pas de suppression en cascade : la base refuserait de supprimer un compte qui en posséderait (protection supplémentaire, impossible pour un compte non vérifié).

## Proposition

| Élément | Proposition | Pourquoi |
| --- | --- | --- |
| Comptes concernés | Statut `pending_verification` **et** aucune coordonnée vérifiée **et** aucune session ouverte un jour **et** aucun projet, signalement, photo, boutique ou compte livreur | Plusieurs conditions indépendantes : un compte utilisé ne peut pas correspondre, même en cas d'erreur sur l'une d'elles |
| Délai | **7 jours** après la création, et aucun code envoyé dans les dernières 24 h | Laisse le temps d'un SMS en retard ou d'un retour quelques jours plus tard ; ne coupe jamais une vérification en cours. Proposition : 7 jours (alternative : 30 jours, plus prudente mais garde plus longtemps des données inutiles) |
| Tentatives de connexion (`login_attempts`) | Effacées après **90 jours** | Servent à limiter les essais (fenêtres de quelques minutes à quelques heures) ; aucune donnée en clair (empreintes non réversibles), seulement l'adresse IP |
| Codes de vérification utilisés ou expirés | Effacés après **30 jours** | Aucune utilité passé leur expiration (10 minutes) ; 30 jours laissent le temps d'une enquête du support |
| Journal d'audit | **Conservé** ; une ligne `user.purged` est ajoutée (identifiant du compte, sans nom, téléphone ni e-mail) | Traçabilité de chaque suppression |
| Fréquence | Une fois par jour, la nuit (heure d'Abidjan) | Charge négligeable |

## Risques et protections

| Risque | Protection |
| --- | --- |
| Supprimer un compte actif par erreur | Condition `status = 'pending_verification'` doublée des autres conditions ; requête unique, sans boucle côté code ; tests qui vérifient que les comptes actifs, suspendus, supprimés, récents ou en cours de vérification ne sont **jamais** touchés |
| Couper une vérification en cours | Aucun code envoyé dans les 24 dernières heures |
| Suppression massive (bogue, horloge fausse) | Plafond de 500 comptes par passage ; au-delà, arrêt et alerte (journal + état visible dans l'administration) ; heure de la base de données, pas celle du serveur |
| Mise en route involontaire | Réglage administrable `maintenance.purge_enabled` **désactivé par défaut** (« en attente »), et mode **simulation** par défaut (compte ce qui serait supprimé, ne supprime rien) |
| Deux serveurs qui purgent en même temps | Verrou PostgreSQL (`pg_try_advisory_lock`) : un seul passage à la fois |
| Données encore présentes dans les sauvegardes | Les sauvegardes expirent après 14 jours (`docs/BACKUP_RESTORE.md`) : à mentionner dans la politique de confidentialité |
| Obligation légale | La minimisation des données va dans le sens de l'ARTCI ; la durée choisie est à indiquer dans la politique de confidentialité (avis juridique) |

## Mise en œuvre prévue (après validation)

1. Service de maintenance dans l'API (même code que le worker des rappels, sans lien avec les rappels), lancé une fois par jour. Il est désactivé par défaut et démarre en simulation.
2. Tests automatiques sur une base réelle de test :
   - seuls les comptes remplissant toutes les conditions sont supprimés ;
   - rien d'autre n'est touché ;
   - la cascade nettoie bien les coordonnées ;
   - la simulation ne supprime rien ;
   - le plafond est respecté ;
   - deux passages simultanés ne se gênent pas.
3. Affichage dans l'administration : dernier passage, nombre de comptes concernés ou supprimés, mode simulation ou réel.
4. Activation en production : seulement sur décision du fondateur, après une période en simulation.

## Décisions à prendre

1. Délai : **7 jours** (proposé) ou 30 jours.
2. Conservation des tentatives de connexion (90 jours) et des codes (30 jours).
3. Faire cette purge **dans le lot 2**, ou la **reporter au lancement public**. Aucun utilisateur réel aujourd'hui : rien ne s'accumule encore.
