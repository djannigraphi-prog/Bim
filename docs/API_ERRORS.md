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
| `INTERNAL_ERROR` | 500 | erreur inattendue (détail uniquement dans les journaux) |
