# Contribuer à BIM

1. Lire `README.md`, puis `DECISIONS.md`, puis `PROJECT_STATUS.md`, puis le module concerné.
2. Créer une branche depuis `main` : `feat/<module>-<sujet>` (voir `docs/CONVENTIONS.md`).
3. Respecter les décisions du fondateur : toute règle produit ou commerciale non décidée reste fermée (`RULE_NOT_DECIDED`) et est signalée dans `DECISIONS.md`.
4. Ajouter ou mettre à jour les tests ; `npm test` (API) et `flutter analyze && flutter test` (mobile) doivent passer.
5. Toute modification de schéma passe par une nouvelle migration relue (`docs/DATABASE.md`).
6. Mettre à jour la documentation et `PROJECT_STATUS.md` dans la même pull request.
7. Ouvrir la pull request avec : objectif, écrans ou routes concernés, captures si interface, tests exécutés et résultat.

## Critères d'acceptation communs
- Les autorisations sont vérifiées par l'API (test d'accès refusé inclus).
- Les erreurs suivent `docs/API_ERRORS.md` ; messages en français, compréhensibles.
- Aucune donnée personnelle dans les journaux ; aucun secret dans le code.
- Les écrans gèrent chargement, vide, erreur réseau, et respectent les jetons de design.
