# Lancer la version 1 sans dépense, puis passer aux services payants

Décision du fondateur (18/10/2026, 15 h 10) : la version 1 se lance **sans aucune dépense**, à part les comptes des
magasins (Google Play, App Store) et l'hébergement. Chaque service payant est remplacé par une solution gratuite,
**derrière une « prise »** : le code ne change pas le jour où on passe au service payant, on change seulement un
réglage. Rien n'est activé ni créé sans l'accord du fondateur. Les comptes sont toujours ouverts **à son nom**.

Les prix et les quotas ci-dessous ont été relevés le 18/10/2026 sur des pages publiques. Ils changent souvent : il faut
les revérifier le jour où on ouvre le compte.

## Tableau de bord

| Besoin | Version 1 (gratuite) | Prise prête dans le code | Plus tard (payant) | À faire par le fondateur |
| --- | --- | --- | --- | --- |
| Hébergement de l'API, de la base et des fichiers | Une machine **Oracle Cloud « Always Free »** (processeur ARM, Linux), qui fait tourner le kit Docker de la démo (API, PostgreSQL). Les photos et vidéos vont dans le stockage objet d'Oracle, compatible S3 : le stockage « local » est refusé hors développement. Le quota gratuit est à vérifier | `MEDIA_STORAGE=s3`, `S3_ENDPOINT`, `DATABASE_URL` | AWS à Paris (étude du lot 2) | Ouvrir le compte Oracle : une carte est demandée pour vérifier l'identité, sans débit sur le niveau gratuit |
| Codes de connexion | **Code par e-mail** (gratuit). Le SMS reste prévu, mais coupé. La **connexion Google** (gratuite) viendra ensuite : il faut un projet Google Cloud pour la tester | `EMAIL_PROVIDER=smtp` (fait, testé avec un serveur SMTP local), `SMS_PROVIDER`, `GOOGLE_CLIENT_IDS` | SMS (Firebase ou un agrégateur local), au prix par SMS du pays | Choisir le fournisseur d'e-mail ; plus tard, créer l'identifiant OAuth Google (gratuit) |
| Notifications sur le téléphone | **Firebase Cloud Messaging**, gratuit | `PUSH_PROVIDER=fcm`, service d'envoi prêt (lot 2) | — | Créer le projet Firebase (procédure dans `docs/FIREBASE_PROJET.md`) |
| Vidéo en direct (Lives) et appels | **LiveKit** auto-hébergé sur la même machine (logiciel libre, Apache 2.0) | Le Live fonctionne déjà sans vidéo (commentaires, cœurs, cadeaux, gadgets) | LiveKit Cloud ou une machine dédiée quand le public grandit | Accord pour l'installer sur la machine |
| Reels | Fichier MP4 vérifié et nettoyé (déjà fait), lu directement | `MEDIA_MAX_VIDEO_MB` | Encodage adaptatif (plusieurs qualités) | — |
| Paiement Mobile Money des commandes | **Déclaré par le client, confirmé par la boutique** (déjà fait, aucun prestataire) | `PAYMENT_PROVIDER` (simulateur ou Paystack en clé de test) | CinetPay ou Paystack, après le contrat et l'avis juridique | Clé de **test** CinetPay ou Paystack quand tu le décides |
| Premium et pièces | Circuit **simulé** (démo) ; vérification des achats dans l'app prête côté serveur | `STORE_PROVIDER` (simulateur) ; catalogue `store.products` | Achats Google Play et App Store (obligatoires pour vendre dans l'app) | Créer les produits dans les consoles des magasins |
| Vérification d'identité (boutiques, livreurs) | **Revue manuelle** par l'équipe dans l'administration (déjà faite) | Module KYC | Prestataire de vérification automatique | — |
| Peni | **Sans IA** : parcours guidé (déjà fait) | `PENI_LLM_PROVIDER` (faux fournisseur testé) | Fournisseur d'IA, après l'étude des coûts et des données | — |
| Version iPhone | Compilation dans un service en ligne : **Codemagic**, 500 minutes macOS par mois dans l'offre gratuite personnelle | — | — | Compte Apple Developer (99 $ par an, frais de magasin) |
| Version Android | Compilation par GitHub Actions (déjà faite) | — | — | Compte Google Play Console (25 $, une seule fois) |
| Nom de domaine et HTTPS | Sous-domaine gratuit et certificat Let's Encrypt | `DEMO_PUBLIC_URL` / adresse de l'API | Nom de domaine à toi (environ 10 à 15 € par an) | Choisir le nom |

## Points d'attention

- **Oracle « Always Free »** : la taille de la machine gratuite ARM a été réduite en 2026. InfoQ indique
  2 cœurs et 12 Go de mémoire au lieu de 4 cœurs et 24 Go. C'est suffisant pour lancer BIM avec quelques centaines de
  personnes actives, pas pour une forte audience vidéo. Une machine gratuite peut aussi être récupérée par Oracle si
  elle reste inactive : il faut une sauvegarde régulière (`docs/BACKUP_RESTORE.md`).
- **SMS** : il n'existe pas de SMS gratuit à l'échelle d'un lancement. Firebase n'offre que 10 SMS par jour sur le plan
  payant à l'usage, utile seulement pour les essais. D'où l'e-mail et Google en version 1.
- **Achats dans l'app** : Apple et Google exigent leur propre système de paiement pour Premium et les pièces vendus
  dans l'app. Ils prélèvent une commission sur chaque vente. Cette commission n'est pas une dépense de lancement, mais
  elle réduit la recette.
- **Fournisseur d'e-mail** : les offres gratuites (Brevo, Resend, etc.) changent souvent de quota et de conditions.
  À vérifier au moment de choisir. Les e-mails partent par le module d'envoi déjà prévu : changer de fournisseur ne
  touche pas l'app.

## Ordre conseillé le jour du lancement

1. Compte Google Play Console, puis fiche de l'app (textes et captures prêts dans le dépôt).
2. Machine Oracle gratuite : installation du kit Docker, nom de domaine, HTTPS, sauvegardes.
3. Projet Firebase (notifications), identifiant OAuth Google, fournisseur d'e-mail.
4. Coupure du mode démonstration (`DEMO_MODE=false`) : Premium et pièces restent fermés tant que les achats dans l'app
   ne sont pas branchés.
5. Plus tard, à chaque palier d'audience : SMS, vidéo hébergée, achats dans l'app, paiement Mobile Money, IA.

## Sources

- [InfoQ — Oracle Cloud Free Tier limits (juillet 2026)](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
- [Logto — Firebase Authentication pricing 2026](https://blog.logto.io/it/firebase-authentication-pricing)
- [Codemagic — Pricing](https://codemagic.io/pricing)
- [Costbench — Brevo free plan](https://costbench.com/software/marketing-automation/brevo/free-plan)
