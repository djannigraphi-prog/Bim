# Administration BIM (web)

Application web réservée aux personnes autorisées : React + TypeScript (Vite), même API sous `/admin/v1`.

## Fonctions (lot 0)
- **Connexion** : e-mail + mot de passe, puis **double authentification obligatoire** (code TOTP d'une application d'authentification ; QR code à la première connexion). Verrouillage temporaire après 5 échecs, réponses identiques que le compte existe ou non.
- **Réglages** (`app_settings`) : âges (F15), règles des projets… Valeurs contrôlées, statut de décision, historique dans le journal d'audit.
- **Programmes types** (C7) : brouillon → publication avec le nom de la personne compétente qui a validé → archivage. Un programme publié est figé.
- **Utilisateurs** : recherche (journalisée), fiche avec coordonnées masquées, suspension / réactivation avec motif.
- **Journal d'audit** : consultation, filtre par action.
- **Administrateurs** : création de comptes, rôles, désactivation, réinitialisation de la double authentification.

Ce que chaque rôle peut faire : `apps/api/src/modules/admin/permissions.ts` (proposition T-019, `DECISIONS.md`).

## Démarrer en local
```bash
# 1. API (voir docs/INSTALLATION.md) avec CORS_ORIGINS=http://localhost:5173
# 2. Premier administrateur principal (mot de passe par variable, jamais en argument) :
cd apps/api && ADMIN_PASSWORD='…' npm run admin:create -- --email toi@bim.ci --name "Ton nom" --roles super_admin
# 3. Application
cd apps/admin && npm ci && VITE_API_URL=http://localhost:3000 npm run dev   # http://localhost:5173
```

## Tests
- `npm test` : tests unitaires (Vitest).
- `.github/scripts/run-admin-e2e.sh` : parcours complet dans Chromium contre l'API réelle (base de test dédiée). Lancé par la CI (job `admin`).
