# Contrat d'API

`openapi.json` est généré depuis le code de l'API (`cd apps/api && npm run openapi:export`) et vérifié en CI : il doit toujours correspondre au code.
Il sert à générer les clients (Dart pour le mobile, TypeScript pour l'administration) et à documenter l'API (`/docs` en développement).
