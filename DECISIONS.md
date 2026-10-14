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

### Corrections du 14/10/2026 (paiements, pièces, commission) · Fondateur · **décidé** (complétées par les réponses F1-F17 ci-dessous)

- Le paiement de l'article et celui de la livraison sont **séparés** (Q39). Seuls les **livreurs partenaires** d'un marchand, dans le programme de partenariat BIM, encaissent le paiement des articles. Aucune autre organisation ne doit être programmée sans accord.
- Principe **0 % de commission BIM** sur les pièces reçues : conservé. Les frais d'opérateur sont étudiés séparément (question F13).
- **Aucune règle de conversion, de retrait ou d'utilisation des pièces** n'est programmée avant les réponses F8 à F14.
- La limite de **5 millions FCFA** n'est pas programmée tant que F14 n'est pas tranchée (minimum ou plafond).

Prise en compte dans le lot 0 : la table `courier_shop_partnerships` porte le droit `can_collect_article_payment` (faux par défaut, accordé par le marchand) et un encours maximal facultatif. Aucune logique de paiement n'existe encore.

### Réponses du fondateur du 14/10/2026 (F1 à F14, F17) · Fondateur

Statuts utilisés ci-dessous :
- **orientation retenue** : la règle guide la conception technique ;
- **validation requise** : la règle ne sera pas activée en production avant la vérification indiquée (juridique, financière ou prestataire) ;
- **à clarifier** : contradiction avec un document BIM, présentée au fondateur avant toute modification.

Aucune fonctionnalité financière n'est programmée de façon définitive : l'architecture est préparée, les fonctions restent fermées.

#### A. Commandes et livraisons

| N° | Règle retenue | Statut | Ce qui doit encore être validé |
| --- | --- | --- | --- |
| F1 | Livreur indépendant (non partenaire) : l'article est payé **directement au marchand** en Mobile Money, de préférence **avant l'expédition** ; le livreur indépendant n'encaisse jamais l'article. Article et livraison restent deux paiements distincts. | Orientation retenue | C1 : paiement au marchand à la livraison également permis ? (Q38 prévoyait le paiement à la livraison) |
| F2 | Les frais de livraison **appartiennent au livreur** ; le client les lui paie à la livraison. BIM enregistre séparément montant de l'article, frais de livraison, statut et confirmation de chaque paiement. | Orientation retenue | C2 : cas du livreur salarié d'une boutique (Q52) |
| F3 | Les livreurs **partenaires** peuvent encaisser l'article **en espèces ou en Mobile Money**. BIM enregistre montant encaissé, boutique bénéficiaire et reversement dû. Aucun paiement déclaré sans confirmation ou preuve. | Validation requise : procédures de contrôle des espèces | Précision de Q39 (« sur un opérateur mobile ») : les espèces sont désormais ajoutées |

#### B. Paiements et abonnements

| N° | Règle retenue | Statut | Ce qui doit encore être validé |
| --- | --- | --- | --- |
| F4 | Un projet **recommande** des articles ou services et **met en relation** avec le marchand ; **aucun paiement dans le projet**. Les achats se font comme sur BimShop. **BIM ne reçoit aucun paiement commercial** ; il est intermédiaire. | Orientation retenue (remplace Q38 « paiement en ligne dans le projet » et l'écran 24 « Payer et lancer ») | C3 : abonnements Premium et publicité sont aussi des revenus de BIM ; C4 : l'écran 24 doit être redessiné |
| F5 | Carte bancaire (Visa) **prévue mais pas en première version**, après validation du Mobile Money. L'architecture permet de l'ajouter sans reconstruction. | Orientation retenue | — |
| F6 | Pièces et abonnements Premium achetés **dans l'app** : **achat intégré Apple / Google**. Biens physiques et livraisons : **Mobile Money**. | Orientation retenue | Confirmation des règles avant implémentation (lot 8), devise et paliers de prix des magasins en Côte d'Ivoire |
| F7 | Site web BIM pour acheter pièces et abonnements en Mobile Money, avec son propre circuit sécurisé. **Aucun lien, bouton ni message de l'app vers ce site** (règles Apple et Google vérifiées le 14/10/2026). | Validation requise : juridique et magasins | Communication autorisée uniquement hors de l'app |

#### C. Pièces et retraits

| N° | Règle retenue | Statut | Ce qui doit encore être validé |
| --- | --- | --- | --- |
| F8 | **Pièces achetées** : servent aux cadeaux, **jamais retirables ni convertibles**. **Pièces reçues** (interactions éligibles) : solde **retirable** selon les règles BIM. Le système garde séparément pièces achetées, reçues, envoyées, retirées et opérations annulées. | Validation requise : juridique (pièces convertibles en argent) | — |
| F9 | Recevoir des pièces **monétisables** est réservé aux **utilisateurs Premium**. Le système distingue pièces reçues et pièces effectivement retirables ; la condition est expliquée clairement. | Orientation retenue | Texte d'explication à valider |
| F10 | Les **marchands** pourront recevoir des pièces **pendant leurs Lives**, distinctes du paiement des articles ; jamais utilisées pour payer un article physique. **Prévu dans l'architecture, désactivé.** | Validation requise : règles financières et juridiques | Conditions par type de compte à définir |
| F11 | Fin du Premium : les pièces **valablement acquises restent sur le compte**, aucune suppression automatique. | Validation requise : juridique (accès aux retraits et aux nouvelles pièces après la fin) | — |
| F12 | **Vérification d'identité obligatoire avant le premier retrait**, adaptée à la taille du projet (revue manuelle d'abord, prestataire spécialisé ensuite), données minimales, accès strictement contrôlés. | Orientation retenue | Choix du prestataire (dépense : validation explicite du fondateur) |
| F13 | Frais d'opérateur : **S2** (frais affichés à part à l'achat Mobile Money), **S3** (frais de retrait affichés à part, payés par le créateur), **S4** (meilleurs tarifs, pas de prestataire unique imposé), **S6** (minimum de retrait si nécessaire). **S1** étudiée après simulation ; **S5** écartée pour l'instant. **BIM ne prélève aucune commission sur les pièces reçues** ; les frais d'opérateur ne sont jamais présentés comme une commission BIM. | Validation requise : financière (simulation `docs/SIMULATION_FRAIS.md`) | S2 ne s'applique pas aux achats intégrés (le prix est fixé par le magasin) |
| F14 | **5 000 000 FCFA = plafond de retrait par jour**. Minimum et maximum sont deux paramètres distincts ; le minimum sera fixé après examen des frais réels. Retraits rapides mais **pas automatiquement instantanés** : un retrait à risque peut être suspendu pour contrôle. | Validation requise : prestataires et réglementation | — |

#### D. Comptes et sécurité

F15 et F16 : inchangés (sections ci-dessus), reconfirmés le 14/10/2026. Pour F15, « autres paiements et abonnements » suivent les règles légales et les exigences des prestataires (seuils toujours `null` en base).

#### E. Livreurs Premium

| N° | Règle retenue | Statut |
| --- | --- | --- |
| F17 | Le Livreur Premium obtient une **priorité de présentation** des commandes éligibles, **jamais une garantie** : disponibilité, zone, distance, statut et capacité sont vérifiés d'abord. Critères transparents, cohérents et administrables ; aucun livreur ne reçoit une commande qu'il ne peut pas assurer. | Orientation retenue |

#### Points à clarifier par le fondateur (contradictions avec les documents)

- **C1 (F1 / Q38)** — Q38 dit « le paiement du produit se fait à la livraison ». F1 privilégie le paiement au marchand avant l'expédition. Avec un livreur indépendant, le client peut-il aussi payer le marchand **au moment de la remise** (le marchand confirme alors la réception dans l'app avant que le livreur ne remette le colis) ?
- **C2 (F2 / Q52)** — F2 : les frais de livraison appartiennent au livreur. Q52 : le livreur **employé** d'une boutique travaille « sous une base salariale ». Pour un livreur salarié, les frais de livraison reviennent-ils au livreur ou à la boutique ?
- **C3 (F4 / Présentation p. 13, Q58)** — F4 : « les seuls paiements que BIM reçoit sont l'achat des cadeaux ». Mais BIM reçoit aussi les **abonnements Premium** (2 000 / 5 000 / 1 000 FCFA, Présentation p. 13) et la **publicité** (Q58). Lecture retenue en attendant : BIM ne reçoit **aucun paiement commercial** (articles, services, livraisons) ; il reçoit les achats de pièces, les abonnements et la publicité.
- **C4 (F4 / écrans 24 et 38)** — L'écran 24 affiche « Payer et lancer · 33 500 FCFA » et l'écran 38 « payé en ligne » pour un projet. Avec F4, ces écrans doivent devenir « Voir l'offre / Contacter le marchand », et le paiement se fait comme un achat BimShop.
- **C5 (F8 / F4 — fonds détenus par BIM)** — Quand un utilisateur achète des pièces, BIM encaisse l'argent puis, plus tard, paie les créateurs qui retirent leurs pièces reçues. Entre les deux, BIM **détient des fonds** destinés à des tiers. C'est précisément le point que l'avis juridique (BCEAO, monnaie électronique) doit trancher avant toute mise en production des pièces.

---

---

### C6 — Mode d'un projet et abonnement Premium : deux notions indépendantes · Fondateur · décidé (14/10/2026)
- **Projet économique** : atteindre l'objectif avec des solutions gratuites ou économiques (exercices à la maison, astuces, conseils, méthodes pratiques, solutions à fabriquer soi-même). Exemple, prise de muscle : 10 pompes chaque matin et exercices à domicile.
- **Projet Premium** : la personne accepte d'envisager des achats ; BIM peut lui recommander des accessoires, produits ou services adaptés, vendus par des marchands. Exemple, prise de muscle : haltères, bandes élastiques, tapis de sport.
- **Choisir le mode Premium d'un projet est gratuit** : aucun paiement à BIM. La personne ne paie que les produits ou services qu'elle décide d'acheter, dans le parcours commercial normal (BimShop, commandes).
- **L'abonnement Premium de BIM** est une offre commerciale distincte (avantages sur la plateforme, écran 61, lot 8). Il ne doit jamais être confondu avec le mode Premium d'un projet.
- **Règle fondamentale** : toute personne, gratuite ou abonnée, peut choisir un projet économique ou un projet Premium, et changer de mode plus tard.

Effet sur le code (vérifié le 14/10/2026) : le module Projets ne lisait déjà aucun abonnement et ne créait aucun paiement ; rien n'a dû être retiré. Ajouts : changement de mode après création (écran 19 : « Tu pourras changer de mode plus tard »), libellés « Projet économique » / « Projet Premium », mention « choix gratuit, avec ou sans abonnement » sur l'écran 19, et tests qui empêchent tout couplage futur (voir `docs/TESTING.md`).

### C7 — Programmes types à rédiger · Action du fondateur
Pour chaque catégorie (et objectif), un programme type : durée, tâches, heures, jours, conseils, validé par une personne compétente (coach, esthéticienne…). Il peut être saisi en base dès maintenant ; l'écran d'administration arrive avec le lot 0 partie 2.

### C8 — Éléments des maquettes sans règle définie · Questions au fondateur
- Écran 26 : le **coffre** sur le chemin des jours (récompense ? laquelle, à quel moment ?) — non affiché tant qu'il n'est pas défini.
- Écran 21 : le lien **« Résoudre un problème »** (objectif de type problème à résoudre, ex. acné ? ou aide ?) — non affiché.
- Écran 29 : l'avertissement « selon Fitness Club, une pause de plus de 5 jours peut ralentir tes résultats » vient d'un marchand ou d'un programme validé : affiché quand ces contenus existeront (lots 5 et C7).

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
- Administration : le verrouillage après 5 échecs (réponses identiques, sans révéler si le compte existe) peut être déclenché par une personne qui connaît l'e-mail d'un administrateur (blocage de 15 min). Mesure prévue en production : n'ouvrir `/admin/*` et le site d'administration qu'aux adresses de l'équipe (WAF ou VPN).
- La création d'une boutique ou d'un compte livreur (lots 5 et 7) devra appliquer `age.min_merchant` et `age.min_courier` ; tant qu'ils valent null, la création restera fermée.

### T-019 — Administration : double authentification et rôles (lot 0, partie 2) · Technique · proposition à valider
- Application web séparée (React + Vite), mêmes données via `/admin/v1`, jetons d'administration distincts de ceux de l'app.
- Connexion : mot de passe (Argon2id) puis code TOTP obligatoire (application d'authentification) ; secret chiffré (AES-256-GCM) ; code à usage unique ; verrouillage après 5 échecs ; sessions de 8 h révocables ; toute action journalisée.
- Permissions proposées (`apps/api/src/modules/admin/permissions.ts`) : réglages en lecture pour tous, en écriture pour l'administrateur principal seul ; journal d'audit : principal, support, technique ; comptes utilisateurs (recherche, suspension) : principal, support, modération ; programmes types : rédaction par principal et commercial, **publication par l'administrateur principal seul**, avec le nom de la personne compétente qui a validé ; comptes d'administration : principal seul. Les rôles financier et modération n'ont pas encore d'écran propre (lots 5 à 9).
- Le support voit les coordonnées masquées (ex. `+22507••••12`) ; chaque recherche et chaque fiche consultée sont journalisées.

### T-016 — Projets : programmes types et programme « construit depuis les réponses » (lot 1) · Technique · provisoire
Les programmes types (contenu de coaching) doivent être rédigés et validés par l'équipe BIM : la base refuse de publier un modèle sans validateur, et **aucun modèle n'est livré**. Tant qu'il n'existe pas de modèle publié pour une catégorie, le programme contient une seule routine construite à partir des réponses de l'écran 23 (séances par semaine, disponibilité), que la personne complète avec ses propres tâches. Aucun conseil de santé, d'alimentation ou de sport n'est inventé par l'app.

### T-017 — Projets : calendrier, pause, fin · Technique · provisoire
Jours calculés à l'heure d'Abidjan (UTC+0). On peut cocher le jour même et rattraper un jour passé, jamais un jour futur. Une pause commence le jour même, aucune tâche n'est due pendant la pause et la fin prévue est décalée d'autant ; une reprise anticipée rend les jours non utilisés. Le projet passe « terminé » le lendemain de la fin prévue. Le bilan (écran 30) affiche les étapes faites, la progression et la meilleure série, sans affirmer un résultat que BIM ne mesure pas (ex. kilos perdus). Réglages : `projects.max_active` (5), `projects.durations_days` (30/60/90), `projects.budget_tiers`, `projects.availability_times`, `projects.pause_max_days` (non décidé).

### T-018 — Projets : écran 24 sans paiement (F4, C4) · Technique · décidé
Le bouton « Payer et lancer » devient « Lancer mon programme ». En mode Premium, la zone « Recommandé pour toi » annonce les recommandations des marchands vérifiés (lot 5) ; les achats se feront sur le BimShop, jamais dans le projet.

### T-020 — Photos avant / après (lot 1) · Technique · décidé (stockage AWS à valider)
Photos strictement privées : ré-encodées en JPEG (1600 px max), métadonnées et position GPS supprimées, rangées dans un stockage privé, servies seulement par des liens de 5 minutes ; une nouvelle photo remplace l'ancienne (effacée) ; tout est effacé avec le projet. En production : compartiment S3 privé (dépense AWS et autorisation ARTCI à valider, données sensibles). Tant que le stockage n'est pas configuré, l'app l'indique (« pas encore disponible »).

### T-021 — Signalements et mesures (lot 1) · Technique · décidé
« Signaler » (écran 27) : raison (lieu ou intervenant indisponible, trop difficile, douleur ou malaise, tâche inadaptée, autre), tâche, message ; traité par le support dans l'administration ; la réponse est visible dans « Mes signalements ». Douleur ou malaise : l'app conseille d'arrêter et de consulter un professionnel (urgences : 185, pompiers : 180), sans avis médical. Les signalements liés à un marchand (salle, coach) lui seront transmis au lot 5.
Mesures (poids) : déclarées par la personne, privées ; le bilan (écran 30) affiche « d'après tes mesures », jamais un résultat inventé.

### D-UI-01 — Flutter : Riverpod 2, go_router 14, Dio 5 · Technique · décidé
Un seul style de gestion d'état (Notifier / FutureProvider). Découpage `features/<nom>/{data,application,presentation}`.

### D-UI-02 — Police · Technique · provisoire (confirmé par le fondateur le 14/10/2026)
Le fondateur conserve provisoirement la police actuelle.
Police sans empattement du système (SF Pro sur iOS, Roboto sur Android) en attendant le choix d'une police de marque embarquée (ex. Inter), à valider par le fondateur.

### D-UI-03 — Écarts assumés avec les maquettes (lot 0) · Technique · validé le 14/10/2026
Le fondateur conserve les écrans et champs ajoutés pour la sécurité et l'expérience ; les autres différences sont documentées sans bloquer la suite.
- Écran 04 : ajout du champ **Mot de passe**, absent de la maquette mais nécessaire à la connexion (écran 03).
- Écran 04 : téléphone et e-mail marqués « Facultatif » comme dans Q13, avec la mention « au moins l'un des deux » (F16).
- Écrans ajoutés dans le style BIM : **saisie du code**, **mot de passe oublié**, **paramètres minimaux** (thème, déconnexion).
- Écran 02 : les photos de personnes de la maquette sont remplacées par des cartes aux couleurs de la marque, en attendant des visuels dont BIM détient les droits.
- Écran 05 : le texte de Peni dit « Ils serviront à personnaliser ton fil » au lieu de « Je prépare ton fil », le fil n'existant pas encore.
- Écran 03 : Google, Apple et Facebook sont affichés mais annoncent « Bientôt disponible » ; aucune connexion sociale n'est simulée.
- Différences mineures relevées par les captures de la CI (non bloquantes) : logo Google simplifié (« G ») ; « Pas encore de compte ? » placé sous les boutons sociaux au lieu du bas de l'écran 03 ; fond de l'écran 06 vide tant que le fil d'actualité n'existe pas (lot 3).

### D-APP-01 — Identifiant de l'application · provisoire (fondateur, 14/10/2026)
Identifiant Android `ci.bim.app` (et futur identifiant iOS identique), utilisé provisoirement. **Non définitif avant la publication** : une fois l'app publiée, il ne pourra plus changer. Nom affiché : « BIM ». Signature de production non configurée (clé à conserver hors du dépôt).
