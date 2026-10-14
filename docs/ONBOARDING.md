# Arrivée d'un nouveau développeur

**Jour 1**
1. Accès : dépôt Git, gestionnaire de mots de passe de l'équipe (aucun secret par e-mail ni messagerie), compte AWS en lecture sur staging.
2. Lire dans l'ordre : `README.md` → `docs/ANALYSE.md` (sections 2 à 6) → `DECISIONS.md` → `PROJECT_STATUS.md`.
3. Installer et lancer l'API et ses tests (`docs/INSTALLATION.md`) ; parcourir `http://localhost:3000/docs`.
4. Lancer l'app mobile sur un émulateur et faire une inscription complète (le code s'affiche dans la console de l'API).

**Semaine 1**
- Un premier ticket simple (libellé, test manquant, petit écran) pour pratiquer branche, tests, pull request.
- Relire un module existant de bout en bout : `apps/api/src/modules/auth` (le plus complet).

**Repères**
- Où vit une règle métier : service NestJS du module + éventuel réglage `app_settings` + contrainte en base si elle ne doit jamais être contournée.
- Qui décide quoi : le fondateur pour le produit et le commerce (`DECISIONS.md`, nature « Fondateur ») ; l'équipe pour la technique.
