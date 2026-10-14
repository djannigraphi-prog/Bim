# Administration BIM (web) — non commencée

Application web réservée aux personnes autorisées (React + TypeScript, Vite), utilisant la même API sous `/admin/*`, avec double authentification obligatoire et rôles distincts (principal, support, modérateur, commercial, financier, technique).

Déjà en place côté API (lot 0) : tables `admin_users`, `admin_roles`, `admin_user_roles` et les six rôles ; journal d'audit en écriture seule.
À faire : connexion administrateur + TOTP, gestion des réglages `app_settings` (dont les âges F15), consultation de l'audit, puis revue des vérifications d'identité (lot 5).
