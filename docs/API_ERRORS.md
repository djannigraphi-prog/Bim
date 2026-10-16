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
| `REPUTATION_RESET_REQUIRED` | 409 | 7-A : la modification du contenu d'un article déjà publié remet sa réputation à zéro ; renvoyer avec `confirmReputationReset: true` après avertissement ; `details.fields`, `details.activeFavorites` |
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
