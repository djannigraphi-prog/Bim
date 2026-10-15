# Déploiement (plan — rien n'est encore déployé)

## Cible de lancement sur AWS (région Paris, eu-west-3, sous réserve de l'autorisation de transfert de l'ARTCI)

| Élément | Service | Taille de départ |
| --- | --- | --- |
| API | ECS Fargate derrière un Application Load Balancer (HTTPS, ACM) | 2 tâches (0,5 vCPU / 1 Go) |
| Worker des rappels (lot 2, **activation soumise à l'accord du fondateur**) | ECS Fargate, même image que l'API, commande `node dist/worker.js`, `WORKER_MODE=standalone`, `PUSH_PROVIDER=fcm` ; **aucune entrée publique** ; contrôle de santé du conteneur : `GET http://localhost:3100/health` (503 = arrêté) ; sortie Internet vers Firebase par le NAT de l'API ou une adresse publique par tâche (à choisir avec le plan réseau) | 2 tâches ARM (0,25 vCPU / 0,5 Go), montée en charge 2 à 6 ; coût détaillé : `docs/LOT2_RAPPELS_ETUDE.md`, section 10 |
| Base | RDS PostgreSQL 16 | db.t4g.small, 50 Go gp3, sauvegardes 14 jours, Multi-AZ en production |
| Photos privées (avant / après) | S3 privé, chiffrement au repos, accès bloqué au public, liens présignés de 5 min ; rôle IAM de l'API limité au compartiment | lot 1 (code prêt et testé avec MinIO) |
| Fichiers publics (publications) | S3 + CloudFront | lot 4 |
| Secrets | Secrets Manager (secrets de l'API) ; Parameter Store chiffré pour la clé Firebase `FCM_SERVICE_ACCOUNT_JSON`, lisible par le seul rôle du worker | une entrée par environnement |
| Journaux, métriques, alertes | CloudWatch | alarmes 5xx, latence, CPU, connexions base ; rappels : worker arrêté, rappels en retard, échecs, manqués (filtres sur `reminders.metrics`, voir l'étude, section 11) |
| E-mails | SES | lot 2 |
| Images Docker | ECR | balayage de vulnérabilités activé |
| Administration web | S3 (privé) + CloudFront, accès limité par AWS WAF (adresses IP de l'équipe ou VPN) | fichiers statiques (`apps/admin/dist`) |

L'infrastructure sera décrite en Terraform dans `infra/terraform/` (à écrire), un état par environnement (`staging`, `production`).

## Chaîne de livraison

1. Pull request → CI (`.github/workflows/ci.yml`) : compilation, tests unitaires et e2e sur PostgreSQL, analyse Flutter.
2. Fusion sur `main` → image Docker de l'API publiée dans ECR, déploiement automatique en **staging**.
3. Migrations : tâche ECS ponctuelle `npm run db:migrate` **avant** le démarrage de la nouvelle version (les migrations doivent rester compatibles avec la version précédente).
4. Production : déclenchement manuel sur une version étiquetée (`v0.x.y`), après validation en staging.

## Avant toute mise en production

- Fournisseurs SMS et e-mail réels configurés (`SMS_PROVIDER`, `EMAIL_PROVIDER` ≠ console/test : le démarrage échoue sinon).
- Secrets générés aléatoirement, différents par environnement, jamais dans Git.
- `TRUST_PROXY=1` derrière l'ALB (un nombre, jamais `true`) ; documentation `/docs` désactivée (automatique en production).
- Deux rôles PostgreSQL : un rôle « migrations » propriétaire des tables, et un rôle « application » sans droit UPDATE, DELETE ni TRUNCATE sur `audit_logs`.
- Restauration de sauvegarde testée (`docs/BACKUP_RESTORE.md`).
- Administration : `ADMIN_TOTP_ENCRYPTION_KEY` dans Secrets Manager ; routes `/admin/*` de l'API et site d'administration limités aux adresses de l'équipe (WAF) ; premier administrateur principal créé par une tâche ECS ponctuelle : `ADMIN_PASSWORD=… node dist/admin-cli.js --email … --name … --roles super_admin` (mot de passe transmis hors de tout dépôt, double authentification configurée à la première connexion).
- Vérifications légales de `DECISIONS.md` (F15) et autorisations ARTCI obtenues.
- Rappels : coût de Paris confirmé avec le calculateur AWS, accord du fondateur sur la dépense et sur les valeurs des réglages `notifications.*` ; projet Firebase créé ; arrêt volontaire d'une tâche du worker en préproduction pour vérifier la reprise et l'alerte.

La publication sur Google Play et l'App Store est une étape distincte, avec les comptes du fondateur ; elle n'est jamais automatique.
