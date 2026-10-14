# Base de données

PostgreSQL 16. Schéma en TypeScript (`apps/api/src/database/schema/`), migrations SQL versionnées (`apps/api/src/database/migrations/`), appliquées par `npm run db:migrate`.

## Principes

- Une table appartient à un seul module, qui est le seul à y écrire.
- Identifiants UUID v7 générés par l'API ; dates `timestamptz` ; montants futurs en entiers (FCFA, pièces).
- Aucun secret en clair : mots de passe Argon2id, jetons SHA-256, codes HMAC.
- Les règles qui ne doivent jamais être contournées sont aussi en base : index uniques (y compris partiels), contraintes CHECK, déclencheur d'écriture seule sur l'audit.
- Les règles métier configurables vivent dans `app_settings`, avec leur statut de décision (`decided` · `provisional` · `pending`).

## Tables (lot 0)

| Module | Table | Contenu | Points clés |
| --- | --- | --- | --- |
| Identité | `users` | compte : nom, @utilisateur, naissance (privée), genre, commune, statut | `username` unique, format contrôlé par CHECK |
| | `user_contacts` | téléphones (E.164) et e-mails, vérifiés ou non | une coordonnée **vérifiée** n'appartient qu'à un compte (index unique partiel) |
| | `auth_identities` | identités Google / Apple / Facebook (préparé) | unique (fournisseur, sujet) |
| | `sessions` | sessions par appareil, rotations, révocations | `refresh_token_hash` unique ; `family_id` pour la révocation en chaîne |
| | `verification_codes` | codes à usage unique | essais ≤ maximum (CHECK) |
| | `step_up_grants` | autorisations d'opération sensible | usage unique, portée, expiration |
| | `login_attempts` | tentatives de connexion | limitation par identifiant et IP |
| Profils | `interests`, `user_interests` | centres d'intérêt (écran 05) | liste administrable |
| | `privacy_settings` | visibilité de la naissance, du genre, de la commune | tout est privé par défaut |
| | `user_preferences` | thème, langue | |
| Espaces | `shops`, `shop_members` | boutiques et membres | plusieurs boutiques par personne |
| | `courier_accounts` | compte livreur (indépendant, freelance, employé) | **un seul par personne** (index unique) |
| | `courier_shop_partnerships` | partenariats livreur ↔ boutique | droit d'encaisser l'article, encours maximal |
| Plateforme | `app_settings` | réglages métier | statut de décision et référence (F15, F16…) |
| | `audit_logs` | journal des opérations sensibles | écriture seule (déclencheur) |
| | `admin_users`, `admin_roles`, `admin_user_roles` | administration (préparé) | rôles : principal, support, modérateur, commercial, financier, technique |

Le modèle complet prévu pour les lots suivants est décrit dans `docs/ANALYSE.md`, section 8.

## Créer une migration

```bash
cd apps/api
# 1. modifier src/database/schema/*.ts
npx drizzle-kit generate --name courte_description      # produit un fichier SQL
# 2. RELIRE le SQL généré ; 3. npm run db:migrate ; 4. npm test ; 5. commiter schéma + SQL ensemble
npx drizzle-kit generate --custom --name donnees_reference   # migration écrite à la main
```

Ne jamais modifier une migration déjà fusionnée : en créer une nouvelle.
