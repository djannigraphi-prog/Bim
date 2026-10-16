# Erreurs de l'API

Format unique : `{ "error": { "code": "…", "message": "…", "details": { … } } }`.
Le `message` est en français et peut être affiché tel quel. Le `code` est stable : l'app mobile se base dessus. Ne jamais renommer un code sans adapter l'app.

| Code | HTTP | Signification |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | champs invalides ; `details.fields` = { champ: [messages] } |
| `INVALID_CODE` | 400 | code de vérification faux ; `details.attemptsLeft` |
| `CODE_EXPIRED` | 400 | code expiré |
| `INVALID_CHALLENGE` | 400 | demande de code inconnue, déjà utilisée ou d'un autre type |
| `UNAUTHENTICATED` | 401 | jeton absent, invalide, session révoquée ou compte inactif |
| `INVALID_CREDENTIALS` | 401 | identifiant ou mot de passe incorrect |
| `SESSION_INVALID` | 401 | rafraîchissement impossible ; `details.reason` = invalid · revoked · reuse · expired |
| `FORBIDDEN` | 403 | action ou espace non autorisé |
| `SHOP_PERMISSION_REQUIRED` | 403 | 7-A : permission de boutique manquante (propriétaire seul, ou permission non accordée à l'employé) ; `details.permission` |
| `PRODUCT_UNAVAILABLE` | 409 | 7-B : article retiré, variante inactive, ou non publié (commande du BimShop) ; `details.index`, `details.productId` |
| `OUT_OF_STOCK` | 409 | 7-B : stock insuffisant à la commande ou à la confirmation (la base refuse tout stock négatif) ; rien n'est confirmé |
| `DELIVERY_UNAVAILABLE` | 409 | 7-B : mode indisponible pour cette adresse ; `details.reason` = NO_TARIFF · NO_DURATION · COMMUNE_UNKNOWN |
| `SHOP_UNAVAILABLE` | 409 | 7-B : boutique fermée ou propriétaire inactif |
| `PRICE_CHANGED` | 409 | 7-B : le montant affiché diffère du calcul du serveur ; `details.itemsTotalFcfa`, `deliveryFeeFcfa`, `totalFcfa` ; rien n'est créé |
| `ORDER_STATE_CHANGED` | 409 | 7-B : la commande n'est plus dans un état qui permet l'action (requête tardive ou répétée, expiration) ; `details.status` |
| `CUSTOMER_CANNOT_ORDER` | 403 | 7-B : proposition impossible pour cette personne (motif non communiqué à la boutique) |
| `NOT_PICKUP` | 409 | 7-B : commande livrée ; le code se saisit à la livraison (7-F) |
| `HANDOVER_CODE_INVALID` | 400 | 7-B : code de remise incorrect ; `details.remaining` |
| `HANDOVER_CODE_BLOCKED` | 409 | 7-B : code bloqué après trop d'essais (`orders.handover_code_max_attempts`) |
| `PAYMENT_ACTION_NOT_ALLOWED` | 409 | 7-C : action de paiement impossible maintenant (avant la remise, déjà décidé, espèces non constatées, mauvais moyen) |
| `CASH_AMOUNT_MISMATCH` | 400 | 7-C : espèces enregistrées pour un autre montant que celui attendu (`details.expectedFcfa`) ; en cas d'écart, contester |
| `COURIER_ACCOUNT_EXISTS` | 409 | 7-E : compte livreur ou demande déjà existant |
| `APPLICATION_NOT_SUBMITTED` | 409 | 7-E : décision sur une demande de livreur qui n'est pas en attente de vérification |
| `COURIER_NOT_FOUND` | 404 | 7-E : aucun livreur vérifié avec ce nom d'utilisateur |
| `RELATION_EXISTS` | 409 | 7-E : relation (ou proposition) déjà en cours entre ce livreur et la boutique |
| `ALREADY_EMPLOYED` | 409 | 7-E : le livreur a déjà un emploi actif (au plus un, contrainte de la base) |
| `TARIFF_ALREADY_PUBLISHED` | 409 | 7-D : une grille de livraison publiée est immuable ; enregistrer un nouveau brouillon puis le publier |
| `PRODUCT_CONTENT_LOCKED` | 409 | L7-04 : nom, description et prix normal ne se modifient plus après la création ; rubrique, durée et variantes plus après la première publication ; créer une nouvelle fiche ; `details.fields` (liste des champs refusés) |
| `REPUTATION_RESET_REQUIRED` | 409 | **Retiré (L7-04)** : n'est plus renvoyé ; `confirmReputationReset` est refusé (400) |
| `STEP_UP_REQUIRED` | 403 | opération sensible : obtenir une autorisation via `/v1/auth/step-up` ; `details.scope` |
| `CONTACT_NOT_VERIFIED` | 403 | compte non activé ; `details.verification` = nouveau défi |
| `ACCOUNT_SUSPENDED` | 403 | compte suspendu |
| `AGE_REQUIREMENT_NOT_MET` | 403 | âge insuffisant (F15) ; `details.capability`, `details.minAge` |
| `NOT_FOUND` | 404 | ressource introuvable |
| `USERNAME_TAKEN` | 409 | nom d'utilisateur pris |
| `CONTACT_TAKEN` | 409 | téléphone ou e-mail déjà vérifié sur un autre compte |
| `CONTACT_ALREADY_VERIFIED` | 409 | coordonnée déjà vérifiée sur ce compte |
| `LAST_RECOVERY_CONTACT` | 409 | impossible de retirer la dernière coordonnée vérifiée (F16) |
| `NO_RECOVERY_CONTACT` | 409 | aucune coordonnée utilisable |
| `TOO_MANY_ATTEMPTS` | 429 | trop d'essais (connexion, code, renvoi) ; `details.retryAt` éventuel |
| `RATE_LIMITED` | 429 | limitation de débit HTTP |
| `NOT_CONFIGURED` | 503 | fonction dépendant d'un service externe non configuré (SMS, connexion sociale…) |
| `RULE_NOT_DECIDED` | 503 | règle métier non encore décidée par le fondateur ; `details.rule` |
| `LOGIN_EXPIRED` | 401 | administration : étape de connexion expirée, déjà utilisée ou 5 essais atteints |
| `INVALID_CODE` | 401 | administration : code TOTP incorrect, expiré ou déjà utilisé |
| `PROJECT_LIMIT_REACHED` | 409 | limite de projets en cours atteinte (`projects.max_active`) |
| `DAY_NOT_EDITABLE` · `TASK_NOT_DUE` | 409 | case d'un jour futur, en pause, hors programme ; tâche non prévue ce jour-là |
| `PROJECT_NOT_ACTIVE` · `PROJECT_NOT_PAUSED` · `PROJECT_COMPLETED` · `LAST_TASK` | 409 | action impossible dans l'état du projet |
| `PROGRAM_NOT_DRAFT` | 409 | seul un brouillon de programme type se modifie ou se publie |
| `ADMIN_EXISTS` · `SELF_LOCKOUT` · `LAST_SUPER_ADMIN` · `INVALID_STATUS` | 409 | gestion des comptes d'administration et des statuts de compte |
| `NO_MEASURE` | 409 | l'objectif du projet ne se mesure pas en chiffres |
| `REPORT_NOT_OPEN` · `CODE_TAKEN` | 409 | signalement déjà traité ; code de catégorie ou d'objectif déjà utilisé |
| `INTERNAL_ERROR` | 500 | erreur inattendue (détail uniquement dans les journaux) |
