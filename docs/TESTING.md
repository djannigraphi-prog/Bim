# Tests

| Niveau | Où | Outil | Base | Commande |
| --- | --- | --- | --- | --- |
| Unitaires API | `apps/api/src/**/*.spec.ts` | Jest | aucune | `npm run test:unit` |
| Bout en bout API | `apps/api/test/*.e2e-spec.ts` | Jest + Supertest | PostgreSQL réel, base créée puis supprimée | `npm run test:e2e` |
| Unitaires / widgets mobile | `apps/mobile/test/` | flutter_test | — | `flutter test` |
| Parcours mobiles | à venir (`integration_test/`) | integration_test | API de staging | — |
| Charge | à venir (lots 4, 9, 10) | k6 | staging | — |

Les tests e2e démarrent l'API complète (mêmes gardes, filtres et validations qu'en production) contre une base vierge où toutes les migrations sont appliquées. Les SMS et e-mails passent par le fournisseur `test`, qui garde les messages en mémoire pour lire les codes.

## Couverture des 12 parcours du cahier des charges

| N° | Parcours | État |
| --- | --- | --- |
| 1 | Un utilisateur crée un compte | **Testé (API, e2e)** ; écran mobile non exécuté |
| 2 | Crée un projet BIM | Lot 1 |
| 3 | Termine une tâche | Lot 1 |
| 4 | Partage un BIM | Lot 4 |
| 5 | Achète un produit | Lots 5, 7, 8 |
| 6 | Un marchand reçoit et traite une commande | Lot 7 |
| 7 | Un livreur accepte et termine une livraison | Lot 7 |
| 8 | Un créateur reçoit des pièces | Lot 9 (après F8-F14) |
| 9 | Accès à un espace non autorisé | **Testé (API, e2e)** : boutique d'autrui, jeton falsifié, session révoquée, compte suspendu |
| 10 | Un paiement échoue | Lot 8 |
| 11 | Une connexion est interrompue | Mobile : erreurs réseau traitées ; test à écrire avec le SDK |
| 12 | Un utilisateur supprime son compte | Portée step-up prévue ; fonction au lot 4 |

Règle : un test n'est déclaré réussi que s'il a été exécuté. Les résultats de chaque session sont consignés dans `PROJECT_STATUS.md`.
