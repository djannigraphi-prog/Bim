# DECISIONS.md — Registre des décisions BIM

Chaque décision indique sa **nature** et son **statut** :

- **Fondateur** : règle produit ou commerciale décidée par le fondateur (Doho Yannick).
- **Technique** : choix de l'équipe technique, modifiable sur justification.
- **Statut** : `décidé` · `provisoire` (sous réserve d'une vérification, par exemple légale) · `en attente` (personne n'a encore décidé : rien n'est programmé).

Ne jamais présenter une hypothèse comme une décision. Une décision modifiée garde son historique : on ajoute une ligne « Remplacée par … », on ne l'efface pas.

Référence de l'analyse complète : document « BIM — Analyse et plan de développement (Phase 1) » (section 6 pour les questions F1 à F17), copie de travail dans `docs/ANALYSE.md`.

---

## Décisions du fondateur

### F15 — Âge minimum (14/10/2026) · Fondateur · **provisoire**

- Inscription : **16 ans** minimum, provisoire, sous réserve des obligations légales.
- Achat et retrait de pièces convertibles en argent : **18 ans** minimum.
- Abonnements et autres paiements : doivent respecter les règles applicables aux mineurs → **seuil non fixé** tant que la vérification légale n'est pas faite.
- Ouverture d'une boutique ou d'un compte livreur : **non décidé** (non abordé dans F15).

Mise en œuvre : réglages `age.*` de la table `app_settings` (migration `0001`), appliqués séparément par capacité par `AgePolicyService`. Une valeur `null` ferme la capacité (`RULE_NOT_DECIDED`). Les seuils se changent sans modifier le code.

| Réglage | Valeur | Statut |
| --- | --- | --- |
| `age.min_registration` | 16 | provisoire |
| `age.min_coins_purchase` | 18 | provisoire |
| `age.min_coins_withdrawal` | 18 | provisoire |
| `age.min_paid_subscription` | null | en attente (vérification légale) |
| `age.min_other_payments` | null | en attente (vérification légale) |
| `age.min_merchant` | null | en attente (non décidé) |
| `age.min_courier` | null | en attente (non décidé) |

**Obligations légales à vérifier avant de rendre ces règles définitives** (par un juriste ivoirien ; rien ci-dessous n'est un avis juridique) :

1. **Majorité civile à 18 ans** — Loi n° 2019-572 du 26 juin 2019 relative à la minorité. D'après le texte du projet de loi consulté, le mineur ne peut accomplir seul les actes de la vie civile ; un abonnement ou un achat payé par une personne de 16 ou 17 ans pourrait donc nécessiter l'accord de son représentant légal. Les numéros d'articles sont à confirmer sur le texte promulgué.
2. **Données personnelles des mineurs** — Loi n° 2013-450 du 19 juin 2013 et doctrine de l'ARTCI : vérifier si le consentement du représentant légal est exigé pour traiter les données d'une personne de 16 ou 17 ans (le texte n'a pas pu être consulté directement pendant la session).
3. **Conditions générales d'utilisation** : valeur de l'acceptation par une personne de 16 ou 17 ans.
4. **Mobile Money et agrégateurs** : conditions d'âge imposées par les opérateurs pour payer ou recevoir de l'argent.
5. **Classification d'âge Apple et Google** : une app avec contenus publiés par les utilisateurs, messagerie et achats intégrés peut recevoir une classification élevée ; vérifier qu'elle reste compatible avec une inscription à 16 ans.
6. **Lutte contre le blanchiment** (retraits) : Instruction BCEAO n° 001-03-2025 et obligations de vérification d'identité.

### F16 — Récupération de compte (14/10/2026) · Fondateur · **décidé**

- Tout compte actif dispose d'**au moins un moyen de récupération vérifié** : téléphone ou e-mail.
- Le **téléphone est privilégié** ; l'e-mail est accepté. Les deux ne sont pas obligatoires à l'inscription.
- **Contrôles renforcés** pour les opérations sensibles (retraits, changement de coordonnées, changement de mot de passe).

Mise en œuvre :
- Inscription : téléphone ou e-mail requis ; le code part sur le téléphone s'il est fourni. Le compte reste `pending_verification` tant que le code n'est pas confirmé, et n'ouvre aucune session.
- Une coordonnée vérifiée n'appartient qu'à un seul compte (index unique partiel en base).
- La règle « au moins une coordonnée vérifiée » est aussi garantie par la base (déclencheur différé, migration 0003) : même une erreur de programmation ne peut pas laisser un compte actif irrécupérable.
- Opérations sensibles : mot de passe + code envoyé sur une coordonnée vérifiée → autorisation à usage unique, limitée à une portée, à la session (l'appareil) qui l'a obtenue et à 5 minutes (`X-Step-Up-Token`). Elle est annulée par une réinitialisation ou un changement de mot de passe. Portées prévues : `contact_change`, `password_change`, `account_deletion`, `withdrawal` (cette dernière sera branchée au lot 9).
- Impossible de retirer la dernière coordonnée vérifiée (`LAST_RECOVERY_CONTACT`).
- Alerte envoyée sur les coordonnées existantes à chaque ajout ou retrait de coordonnée et à chaque changement de mot de passe.

### Corrections du 14/10/2026 (paiements, pièces, commission) · Fondateur · **décidé**

- Le paiement de l'article et celui de la livraison sont **séparés** (Q39). Seuls les **livreurs partenaires** d'un marchand, dans le programme de partenariat BIM, encaissent le paiement des articles. Aucune autre organisation ne doit être programmée sans accord.
- Principe **0 % de commission BIM** sur les pièces reçues : conservé. Les frais d'opérateur sont étudiés séparément (question F13).
- **Aucune règle de conversion, de retrait ou d'utilisation des pièces** n'est programmée avant les réponses F8 à F14.
- La limite de **5 millions FCFA** n'est pas programmée tant que F14 n'est pas tranchée (minimum ou plafond).

Prise en compte dans le lot 0 : la table `courier_shop_partnerships` porte le droit `can_collect_article_payment` (faux par défaut, accordé par le marchand) et un encours maximal facultatif. Aucune logique de paiement n'existe encore.

### Questions en attente du fondateur

F1 à F14 et F17 : voir la section 6.6 de l'analyse. Lot bloqué par chacune : F1-F3 → lot 7 ; F4-F6, F17 → lot 8 ; F7-F14 → lot 9 ; F10 → lot 10.

---

## Décisions techniques

### T-001 — Dépôt unique (monorepo) · Technique · décidé
`apps/api` (NestJS), `apps/mobile` (Flutter), `apps/admin` (à venir), `packages/api-contract` (OpenAPI), `infra/`, `docs/`. Un seul historique, un contrat d'API partagé.

### T-002 — Monolithe modulaire NestJS 11 · Technique · décidé
Un module par domaine, modules transverses globaux (configuration, base, réglages, audit, envoi, âge, espaces). NestJS 11 plutôt que 12 (publié récemment) : version éprouvée ; montée de version à planifier quand l'écosystème (Swagger, Throttler, JWT) sera aligné.

### T-003 — Drizzle ORM au lieu de Prisma · Technique · décidé (remplace la recommandation « Prisma » de l'analyse, section 7)
- Prisma télécharge des moteurs binaires depuis `binaries.prisma.sh` : bloqué dans l'environnement de la session 1, et c'est une dépendance native de plus à gérer en CI et en production.
- Drizzle est entièrement en TypeScript, génère des migrations **SQL lisibles** (relues avant fusion), et laisse écrire du SQL brut pour le grand livre (`SELECT … FOR UPDATE`).
- Coût de retour arrière : moyen (schéma à réécrire, SQL des migrations réutilisable).

### T-004 — Migrations · Technique · décidé
Générées par `drizzle-kit generate` depuis `src/database/schema`, ou écrites à la main (`--custom`) pour les données de référence et les garde-fous (déclencheurs, contraintes CHECK). Une migration fusionnée n'est **jamais** modifiée.

### T-005 — Sessions · Technique · décidé
JWT HS256 de 15 min (émetteur `bim-api`, audience `bim-app`) + jeton de rafraîchissement opaque de 30 jours, stocké haché (SHA-256), **changé à chaque usage**. Réutilisation d'un ancien jeton → toute la famille de sessions est révoquée et l'événement est audité. Le rafraîchissement prend un verrou partagé sur le compte, la réinitialisation et le changement de mot de passe un verrou exclusif : un rafraîchissement simultané ne peut pas survivre à une réinitialisation. Chaque requête vérifie que la session n'est pas révoquée et que le compte est actif (révocation immédiate). L'app mobile sérialise les rafraîchissements (`QueuedInterceptor`).

### T-006 — Mots de passe · Technique · décidé
Argon2id (19 Mio, 2 itérations, 1 fil — minimum OWASP), via `@node-rs/argon2`. 8 à 128 caractères, refus des mots de passe courants ou contenant le nom d'utilisateur. Vérification factice si le compte n'existe pas (durée de réponse constante).

### T-007 — Codes de vérification · Technique · décidé
6 chiffres, HMAC-SHA256 avec secret serveur, 10 min de validité, 5 essais cumulés même après renvoi, 60 s entre deux envois, 5 envois par défi, 6 envois par heure vers une même coordonnée, un seul défi ouvert par compte et par usage, renvoi et consommation atomiques. Les SMS partent après validation de la transaction. « Mot de passe oublié » renvoie la même réponse que le compte existe ou non (canal masqué pour un @nom d'utilisateur, défi leurre au même cycle de vie, envoi non bloquant).

### T-008 — Limitation des tentatives · Technique · décidé
Connexion : 5 échecs par compte (quel que soit l'identifiant utilisé : @nom, téléphone, e-mail) ou 30 par adresse IP sur 15 minutes ; clés de comptage en HMAC. L'adresse IP n'est lue derrière un proxy que sur un nombre explicite de sauts (`TRUST_PROXY=1`), jamais sur la valeur fournie par le client. Limitation HTTP globale (120 requêtes/min/IP) et renforcée sur l'authentification (10/min). Désactivable uniquement en test ; refusé au démarrage en staging et en production.

### T-009 — Envoi des SMS et e-mails · Technique · décidé
Interface unique `DeliveryService`. Fournisseurs actuels : `console` (développement), `test` (tests), `none`. Les fournisseurs `console` et `test` sont **refusés au démarrage** en staging et en production. Le choix du fournisseur SMS ivoirien et d'Amazon SES est à faire au lot 2.

### T-010 — Journal d'audit · Technique · décidé
Table `audit_logs` en écriture seule, garantie par un déclencheur PostgreSQL. Jamais de mot de passe, de code, de jeton ni de coordonnée complète dans les métadonnées.

### T-011 — Identifiants · Technique · décidé
UUID v7 générés par l'API (triables par date). Montants futurs en entiers (FCFA, pièces).

### T-012 — Espaces · Technique · décidé
L'espace actif (utilisateur, boutique, livreur) est porté par le jeton d'accès **et** revérifié en base à chaque requête qui l'exige. Le rafraîchissement remet l'espace « utilisateur » : l'app redemande l'espace voulu.

### T-013 — Tests e2e sur vraie base · Technique · décidé
Chaque exécution crée une base PostgreSQL vierge, applique toutes les migrations, puis la supprime. Pas de base simulée.

### T-014 — Configuration qui échoue fermée · Technique · décidé
`NODE_ENV` est obligatoire ; les envois SMS et e-mail sont désactivés par défaut (`none`) ; « console », « test » et la désactivation de la limitation sont refusés hors développement et test.

### T-015 — Risques acceptés (à réévaluer) · Technique · provisoire
- L'inscription indique qu'un téléphone ou un e-mail est déjà utilisé (`CONTACT_TAKEN`), comme la plupart des services : risque d'énumération limité par la limitation de débit.
- Une autorisation step-up est consommée par la garde avant le traitement : si la requête échoue ensuite (coordonnée invalide), il faut en redemander une.
- La création d'une boutique ou d'un compte livreur (lots 5 et 7) devra appliquer `age.min_merchant` et `age.min_courier` ; tant qu'ils valent null, la création restera fermée.

### D-UI-01 — Flutter : Riverpod 2, go_router 14, Dio 5 · Technique · décidé
Un seul style de gestion d'état (Notifier / FutureProvider). Découpage `features/<nom>/{data,application,presentation}`.

### D-UI-02 — Police · Technique · provisoire
Police sans empattement du système (SF Pro sur iOS, Roboto sur Android) en attendant le choix d'une police de marque embarquée (ex. Inter), à valider par le fondateur.

### D-UI-03 — Écarts assumés avec les maquettes (lot 0) · Technique · à valider par le fondateur
- Écran 04 : ajout du champ **Mot de passe**, absent de la maquette mais nécessaire à la connexion (écran 03).
- Écran 04 : téléphone et e-mail marqués « Facultatif » comme dans Q13, avec la mention « au moins l'un des deux » (F16).
- Écrans ajoutés dans le style BIM : **saisie du code**, **mot de passe oublié**, **paramètres minimaux** (thème, déconnexion).
- Écran 02 : les photos de personnes de la maquette sont remplacées par des cartes aux couleurs de la marque, en attendant des visuels dont BIM détient les droits.
- Écran 05 : le texte de Peni dit « Ils serviront à personnaliser ton fil » au lieu de « Je prépare ton fil », le fil n'existant pas encore.
- Écran 03 : Google, Apple et Facebook sont affichés mais annoncent « Bientôt disponible » ; aucune connexion sociale n'est simulée.
