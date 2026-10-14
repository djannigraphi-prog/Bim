# Déploiement (plan — rien n'est encore déployé)

## Cible de lancement sur AWS (région Paris, eu-west-3, sous réserve de l'autorisation de transfert de l'ARTCI)

| Élément | Service | Taille de départ |
| --- | --- | --- |
| API + worker | ECS Fargate derrière un Application Load Balancer (HTTPS, ACM) | 2 tâches API (0,5 vCPU / 1 Go), 1 worker |
| Base | RDS PostgreSQL 16 | db.t4g.small, 50 Go gp3, sauvegardes 14 jours, Multi-AZ en production |
| Fichiers | S3 (privé) + CloudFront | lot 4 |
| Secrets | Secrets Manager | une entrée par environnement |
| Journaux, métriques, alertes | CloudWatch | alarmes 5xx, latence, CPU, connexions base |
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

La publication sur Google Play et l'App Store est une étape distincte, avec les comptes du fondateur ; elle n'est jamais automatique.
