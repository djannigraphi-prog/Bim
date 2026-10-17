# DECISIONS.md — Registre des décisions BIM

Chaque décision indique sa **nature** et son **statut** :

- **Fondateur** : règle produit ou commerciale décidée par le fondateur (Doho Yannick).
- **Technique** : choix de l'équipe technique, modifiable sur justification.
- **Statut** : `décidé` · `provisoire` (sous réserve d'une vérification, par exemple légale) · `en attente` (personne n'a encore décidé : rien n'est programmé).

Ne jamais présenter une hypothèse comme une décision. Une décision modifiée garde son historique : on ajoute une ligne « Remplacée par … », on ne l'efface pas.

Référence de l'analyse complète : document « BIM — Analyse et plan de développement (Phase 1) » (section 6 pour les questions F1 à F17), copie de travail dans `docs/ANALYSE.md`.

---

## Règles permanentes (tous les lots)

### R-01 — Choix techniques et dépenses (15/10/2026) · Fondateur · **décidé**

- **Ne jamais choisir automatiquement une solution gratuite uniquement pour économiser.** BIM a vocation à devenir une application importante : priorité à une solution **fiable, performante, sécurisée et capable d'évoluer** avec le nombre d'utilisateurs.
- Avant de recommander une solution technique ou un service externe, présenter :
  - les solutions gratuites et leurs limites ;
  - les solutions payantes et leurs avantages ;
  - les coûts de démarrage et les coûts mensuels ou annuels ;
  - les coûts variables (utilisateurs, stockage, trafic, notifications…) ;
  - les limites qui pourraient réduire les performances ou la fiabilité.
- Si une solution payante est plus adaptée, la **recommander même si elle coûte plus cher**, en expliquant pourquoi et en donnant son coût estimé. Le fondateur décide ensuite de payer maintenant ou de reporter.
- En cas de report : préciser les conséquences techniques et les risques, **sans affaiblir inutilement l'architecture** (le code doit permettre de passer à la solution recommandée sans réécriture).
- **Aucune dépense sans autorisation explicite du fondateur** : abonnements, changements de formule, activation de services facturables, ressources cloud payantes.
- Le développement et les tests sans dépense supplémentaire peuvent continuer, s'ils ne compromettent pas l'architecture future.

Application : `docs/LOT2_RAPPELS_ETUDE.md` (rappels, 15/10/2026). La recommandation précédente « worker dans l'API au lancement pour 0 en plus » est retirée : elle privilégiait le coût sur la fiabilité.

### R-01 bis — Stratégie technique et financière permanente : précision du 15/10/2026 · Fondateur · **décidé**

Précise R-01 (qui reste valable) : le critère est **le meilleur équilibre entre qualité, fiabilité, sécurité, performances, évolutivité et coût** — ni « gratuit d'abord », ni « payant d'abord ».

1. **Choisir la meilleure solution pour BIM.**
   - Une solution gratuite peut être choisie si elle répond correctement au besoin avec une qualité satisfaisante.
   - Une solution payante peut être choisie si elle apporte un avantage technique important et nécessaire.
   - Jamais de solution gratuite uniquement pour économiser si elle compromet la qualité, la sécurité, la fiabilité ou les performances.
   - **Pas de solution payante recommandée si elle n'apporte aucun avantage significatif** par rapport à une solution gratuite adaptée.
2. **Anticiper la croissance** : architecture prévue du lancement jusqu'à une grande échelle ; quand c'est pertinent, prévoir de pouvoir remplacer un service par un plus performant sans reconstruire l'application (interfaces, adaptateurs).
3. **Présenter les coûts clairement** pour chaque décision importante : solutions gratuites et payantes pertinentes, avantages et inconvénients, coûts de départ et récurrents, limites techniques, conséquences sur la sécurité, la fiabilité et les performances, **coûts et difficultés d'une migration**.
4. **Autorisation financière** : une solution payante peut être recommandée et son intégration technique préparée ; **aucun service payant activé, aucun abonnement, aucune dépense sans autorisation explicite** du fondateur.

S'applique à tous les lots. Première application : `docs/LOT2_RAPPELS_ETUDE.md` (version du 15/10/2026, composant par composant).

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

### F3 bis — Espèces réservées aux livreurs employés de la boutique (16/10/2026) · Fondateur · **décidé** (remplace F3 pour les livreurs partenaires)

- Seuls les livreurs **employés directement par la boutique concernée** peuvent encaisser des espèces, et seulement pour les commandes de cette boutique.
- Les livreurs **freelances partenaires** et les livreurs **freelances indépendants** n'encaissent **jamais** d'espèces pour une commande BIM ; leurs livraisons suivent le parcours Mobile Money.
- La règle est appliquée et vérifiée **côté serveur** (jamais seulement dans l'interface) et fait l'objet de tests dédiés. Le droit d'encaisser se déduit d'une relation d'emploi active avec la boutique de la commande ; il n'est jamais une option cochée par le marchand. Conséquence technique (lot 7) : la colonne `courier_shop_partnerships.can_collect_article_payment` (lot 0, jamais utilisée) ne doit pas servir aux espèces.
- Architecture validée le même jour : un module Commandes unique (BimShop et messagerie), un module Livraisons distinct, un module Paiements séparé. Un paiement Mobile Money n'est jamais présenté comme techniquement vérifié sans intégration réelle avec un prestataire.
- Règles détaillées du lot 7 : complétées et en partie décidées par L7-01 ci-dessous ; arbitrages restants A1 à A12 dans `docs/LOT7_CONCEPTION.md`. Aucun développement des commandes sans accord explicite.

### L8-01 — Intégration Paystack (17/10/2026, 09 h 56) · Fondateur (« développe directement », sans dépense) · **réalisée dans le code, désactivée** ; décisions en attente

- Paystack intégré conformément à sa documentation officielle, testé contre un faux serveur ; aucune clé de production
  (refusée par la configuration), aucun compte ouvert, aucun paiement réel.
- **Choix techniques pris** (réversibles) : canal `mobile_money` seulement ; page de paiement Paystack ouverte dans le
  navigateur ; adresse e-mail transmise = e-mail vérifié du client, sinon une adresse technique sans donnée personnelle ;
  expiration après 30 minutes (provisoire) ; remboursement réservé à `payments.refund` (rôle principal, finance).
- **En attente du fondateur** : (1) F4 en Côte d'Ivoire avec Paystack (sous-comptes non confirmés) ; (2) répartition des
  frais (`payments.fee_bearer` : boutique ou BIM) ; (3) compte Paystack de test et autorisation de dépense.

### L8-00 — Paiements en ligne : étude et socle multi-prestataires désactivé (17/10/2026, 08 h 06) · Fondateur · **étude remise** ; socle **réalisé**, intégration réelle **non autorisée**

- Étude demandée : Paystack (premier candidat) et CinetPay (alternative) — Mobile Money (Orange, Wave, MTN, Moov),
  frais, KYC, test, confirmation technique, remboursements, versement direct aux boutiques, multi-commerçants,
  abonnements récurrents, règles des magasins. Remise dans le document « Étude paiements Mobile Money — Paystack et
  CinetPay » (faits confirmés séparés des points à confirmer auprès des services commerciaux).
- **Aucune dépense autorisée** ; aucun contrat, abonnement, compte ni clé de production ; aucune intégration de
  production sans autorisation explicite du fondateur après examen de l'étude.
- Réalisé : architecture compatible avec plusieurs prestataires, désactivée (`PAYMENT_PROVIDER` = « none » ; simulateur
  pour les tests seulement ; réglage `payments.online_enabled` = false, « en attente »).

### L7-07 — Espèces à la livraison, délais, circuit des fonds (17/10/2026, 07 h 47) · Fondateur · **décidé** ; espèces et délais **réalisés**

- **Espèces à la livraison** : autorisées seulement si la boutique a au moins un livreur **employé** actif ; la course est
  alors réservée à ses employés, qui reçoivent les espèces (F3 bis inchangée : jamais un partenaire ni un indépendant).
  Contrôlé par le serveur à la commande (devis : `cashOnDelivery`), à la sollicitation et à la remise des espèces. La
  contrainte de base « espèces = retrait seulement » (migration 0031) est retirée par la migration 0038.
- **Délais confirmés** : 5 minutes pour qu'un livreur accepte une mission, 15 minutes avant « client absent » (réglages
  passés à « décidé », toujours modifiables dans l'administration).
- **F4 (lot 8)** : pour un paiement en ligne, l'argent va **directement au marchand** ; BIM ne détient pas les fonds.
- **Prestataire de paiement** : aucun choisi, aucune dépense autorisée ; étude Paystack / CinetPay demandée.

### E2 — Aucun bouton d'achat sur l'Accueil ; « Produits et services utilisés » (17/10/2026) · Fondateur · **confirmé** ; **réalisé** (5-E)

- Règle E2 (`docs/ANALYSE.md` §6.7) confirmée : aucun bouton d'achat sur l'Accueil ; seul le lien « Produits et services
  utilisés » du détail d'une publication (écran 11) renvoie vers la fiche du BimShop.
- **Choix de réalisation à confirmer** : réservé aux « J'ai fait mon BIM » ; 5 articles au plus ; tout article visible du
  BimShop est associable (l'achat n'est pas vérifié, les commandes étant fermées) — un marchand peut donc associer ses
  propres articles à son propre BIM ; aucun prix affiché dans la publication ; liens absents des fils.

### M-6C — Messagerie : réactions et réponses citées (17/10/2026) · Fondateur (« poursuivre sans attendre le lot 8 ») · **réalisé** ; choix de réalisation à confirmer

- Sous-lot prévu (« À venir : 6-C ») choisi parce qu'il ne dépend d'aucune décision ouverte, d'aucun paiement ni
  d'aucun service externe. Messages vocaux, groupes et appels restent **soumis à accord**.
- **Choix à confirmer** : six réactions (❤️ 😂 😮 😢 🙏 👍) ; une réaction par personne, ou une seule pour toute
  l'équipe d'une boutique ; pas de réaction ni de réponse sur une demande non acceptée (règle E10 : lire une demande ne
  prévient pas son auteur) ; aucune notification pour une réaction ; la citation affiche l'état actuel du message cité.

### L7-06 — Attribution des livraisons, 7-F, 7-G, évaluation des livraisons (16/10/2026, 22 h 27) · Fondateur · **décidé** ; **réalisé** ; choix de réalisation à confirmer

- **Décision de référence (remplace l'arbitrage annonces / sélection de L7-04, §8 bis)** : la commande prête, le marchand
  déclenche la recherche ; le serveur calcule les livreurs éligibles (mode, disponibilité, communes desservies,
  capacité, relation avec la boutique) et les classe : **employés, puis partenaires, puis indépendants** ; le marchand
  sollicite un livreur parmi eux ; le livreur sollicité **doit accepter** dans le délai ; s'il refuse ou ne répond pas,
  la recherche continue. Un livreur ne voit que les missions qui lui sont proposées, ses courses et son historique.
- **Réalisation (choix à confirmer)** :
  - « Annonces de livraison accessibles » = **missions proposées nommément** au livreur choisi par le marchand (une à
    la fois par livraison, contrainte de la base) ; aucune liste publique d'annonces. Avant acceptation, le livreur ne
    voit ni l'adresse, ni le client, ni le prix des articles.
  - **Rapide** : seuls les livreurs de la meilleure catégorie disponible sont sélectionnables. **Économique** : passer un
    livreur d'une catégorie prioritaire disponible exige un motif (enregistré). L'employé passe avant le partenaire
    (proposition A4-b appliquée). **Éligibilité revérifiée à l'acceptation** : un livreur devenu inéligible ne peut pas
    accepter (la sollicitation est close et la recherche reprend).
  - Délai de réponse du livreur : `deliveries.mission_accept_minutes` = **5 min (provisoire, A10)** ; « client absent »
    possible 15 min après l'arrivée (`deliveries.client_absent_after_minutes`, **provisoire**).
  - Parcours : acceptée → prise en charge (commande « en livraison ») → « je suis arrivé » (heure du serveur) → le client
    examine, accepte et donne son code (5 essais, usage unique, refusé si un incident est ouvert ; **pas une preuve de
    paiement**) → espèces reçues (**employé de la boutique seulement**, vérifié dans la transaction) ou « J'ai payé »
    du client (Mobile Money au numéro de la boutique) → clôture par le livreur (commande « livrée ») → confirmation par la
    boutique (commande « terminée », 7-C). Refus du client après examen : motif obligatoire, incident ouvert, la commande
    n'est jamais « livrée ». Attente enregistrée, non facturée (A2-c inchangé).
  - **Incidents (7-G)** : ouverts par le client, la boutique (permission « préparer les commandes ») ou le livreur
    attribué, après la confirmation de la commande ; motif dans une liste propre à chaque partie, description
    (obligatoire pour « Autre ») ; ouvert → transmis au support → résolu ; historique en écriture seule (base) ;
    consultation et décision du support journalisées (permission d'administration `incidents.review` : rôle principal,
    support). **Aucune pénalité, aucun frais, aucun remboursement automatique** : la décision du support est une note.
  - **Évaluation de la livraison** : client concerné seulement, après la clôture, une fois (contrainte de la base),
    distincte des avis d'article et de boutique, non publique, signalable par le livreur (modération existante) ; aucune
    note moyenne ni conséquence pour le livreur.
- **Décisions restant ouvertes** : (1) **preuves des incidents** (photos) : non réalisées faute de règle de stockage et
  de conservation ; (2) **espèces à la livraison** : la règle de 7-B (espèces seulement au retrait) rend impossible un
  paiement en espèces à la livraison, même par un employé ; proposition : autoriser les espèces en livraison quand la
  boutique a au moins un employé actif, attribution alors limitée aux employés ; rien n'est changé sans accord ;
  (3) **frais de livraison des freelances** (A3-b) : aucun registre de frais de livraison n'est créé.

### L7-05 — Lot 7 : développement de 7-D et 7-B (16/10/2026) · Fondateur (« code sans attendre ») · **réalisé** ; choix de réalisation à confirmer

- **7-D** : propositions A2-b et A2-c appliquées (grilles, communes et durées saisies par BIM dans l'administration ;
  commune ou trajet absent = mode indisponible ; attente enregistrée, non facturée : `delivery.wait_fees_enabled` = false).
- **7-B, choix pris sans arbitrage explicite (à confirmer)** :
  - **Âge pour commander (A12)** : réglage existant `age.min_other_payments` (« autres paiements : BimShop, projets »).
    Il est **non décidé** : selon la règle F15, les commandes restent **fermées** (`RULE_NOT_DECIDED`) tant que le
    fondateur ne l'a pas fixé dans l'administration. Une proposition à une personne qui ne peut pas commander est
    refusée sans en dire le motif à la boutique.
  - **Espèces** : possibles seulement au retrait en boutique (la boutique encaisse) tant que les livreurs employés
    n'existent pas (7-E / 7-F) ; jamais pour une livraison à ce stade.
  - **Retrait en boutique** : toujours proposé (aucun réglage par boutique n'existe encore).
  - **Annulation par le client** : jusqu'à « confirmée » ; ensuite, seule la boutique annule (motif obligatoire).
  - **Délais** (A10, provisoires) : proposition 24 h, confirmation par la boutique 24 h, 5 essais pour le code.
  - A14 (fiche obligatoire, éventuellement non publiée) et A15 (prix négocié à la baisse seulement) appliqués.
- **7-C** : paiement de l'article enregistré (jamais transféré) ; la déclaration du client n'est jamais une confirmation ;
  une commande n'est « terminée » qu'après confirmation par la boutique ; sans décision au bout de 3 jours : rappel et
  file « à vérifier » du support, jamais de confirmation implicite. Espèces au comptoir : montant attendu exigé (un écart
  se conteste). Permission d'administration proposée `payments.review` (rôle principal, support, finance).
- **7-E** : comptes livreurs vérifiés comme les marchands ; âge `age.min_courier` non décidé = comptes fermés (F15) ;
  espace livreur fermé à tout le reste de BIM (fil, profils, messagerie, boutiques) sauf compte et support — choix de
  réalisation de L7-04 ; relation proposée par la boutique et acceptée par le livreur ; un seul emploi actif.
  Permission d'administration proposée `couriers.review` (rôle principal, support).
- **7-H (partie sans livraison)** : avis d'article et de boutique selon la proposition du §13 ; délai d'évaluation
  provisoire 30 jours (`reviews.window_days`) ; aucune moyenne, étoiles de boutique ni statut Gold calculés (A17).
- **Non réalisé, en attente** : livraisons (7-F, arbitrage annonces / sélection L7-04 — tranché par L7-06), paiements réels (lot 8).

### L7-04 — Livreurs, fiches des articles et réputation : corrections (16/10/2026) · Fondateur · **décidé** ; fiches **réalisées**, livreurs **verrouillés** (aucune route livreur encore)

- **Livreurs** : un livreur n'accède **jamais** aux commandes internes d'une boutique. Il peut seulement (1) voir les
  **annonces de livraison publiées** (le marchand valide une commande puis publie une annonce pour trouver un livreur),
  (2) **accepter** une course et voir les informations nécessaires pour l'exécuter, (3) consulter **son propre
  historique** (les livraisons qu'il a lui-même effectuées). Ni commandes générales, ni commandes non publiées, ni
  historique des autres livreurs. L'historique des livraisons est distinct des commandes du marchand ; contrôle par le
  serveur. Aujourd'hui : aucune route n'est ouverte à l'espace livreur ; un test e2e (`courier-access`) énumère toutes
  les routes et le vérifie, ainsi que le refus de toutes les routes de boutique à un livreur actif, même partenaire.
- **Point à arbitrer (contradiction avec A4 / A5)** : le modèle « annonce publiée, acceptée par un livreur » diffère du
  modèle approuvé « le marchand choisit le livreur parmi les éligibles, partenaires prioritaires, motif obligatoire ».
  Proposition (non réalisée) : l'annonce est d'abord proposée aux employés puis aux partenaires, ensuite aux
  indépendants ; l'acceptation attribue la course. Voir `docs/LOT7_CONCEPTION.md` §8 bis.
- **Fiches des articles** : le **prix normal** est fixé à la création. Après la création, **nom, description et prix
  normal** ne se modifient plus (brouillon compris) : il faut une **nouvelle fiche**, avec une nouvelle référence et une
  réputation vierge. Restent modifiables : **photos** (ajout, remplacement, suppression) et **promotion** (activer,
  modifier, supprimer), sans effet sur la réputation ; stock, masquage, republication aussi. Rubrique, durée et
  variantes se règlent jusqu'à la **première publication** (interprétation de Claude, à confirmer). Refus :
  `PRODUCT_CONTENT_LOCKED` (409) ; la base refuse elle-même toute modification du nom, de la description ou du prix
  normal (déclencheur). Le « prix barré » devient le prix normal ; la promotion est un champ distinct
  (`promo_price_fcfa`, migrations 0028 et 0029, données reprises sans perte).
- **Réputation** : conservée pour la photo et la promotion ; une nouvelle fiche a une nouvelle référence et une
  réputation vierge ; la référence existante reste stable ; commandes et historiques (7-B, 7-H) garderont référence et
  version. **Remplace** la règle de L7-03 « modifier le contenu avec avertissement remet la réputation à zéro » :
  l'avertissement, `confirmReputationReset` et `REPUTATION_RESET_REQUIRED` sont retirés ; `content_version`,
  `product_revisions` et `reputation_reset_at` restent en base (aucune suppression, plus alimentés).

### L7-03 — Lot 7-A : références, réputation des articles, permissions (16/10/2026, 16 h 14) · Fondateur · **décidé**, **réalisé** (7-A)

- **A13** : référence attribuée **dès la création** de la fiche (brouillon compris), par le serveur, unique, stable,
  jamais réattribuée ; les articles existants sont numérotés par la migration. Réalisé : séquence de la base, format
  `BIM-000001` (7 chiffres et plus au-delà de 999 999), déclencheur d'immuabilité, référence refusée si l'app en envoie une.
- **Fiches créées pour une commande** (point 6, règle proposée par Claude, à valider) : ce sont des fiches ordinaires —
  référence à la création, « visible par moi uniquement » tant qu'elles ne sont pas publiées, mêmes règles de
  réputation dès qu'elles le sont ; les lignes de commande (7-B) gardent la référence et la **version du contenu**
  commandée ; les avis (7-H) se rattachent à cette référence et à cette version.
- **[Remplacé par L7-04]** **Réputation liée au contenu réellement évalué** : toute modification confirmée du contenu d'une fiche **déjà
  publiée** (nom, prix, prix barré, description, rubrique, durée, variantes ajoutées / retirées / renommées) exige un
  avertissement préalable et une confirmation, puis crée une nouvelle **version du contenu** : la réputation active
  repart de zéro, l'ancienne reste en base (traçabilité) sans être affichée ; trace de la modification (champs, contenu
  précédent, auteur, date). **Exceptions** : photo seule, masquage, republication, stock, ordre des variantes.
  Aujourd'hui, le seul signe de réputation existant est le cœur « mettre de côté » ; les j'aime, commentaires et
  recommandations d'articles n'existent pas encore et utiliseront la même version.
- **Masquer / republier** : « Visible publiquement » ↔ « Visible par moi uniquement » (statut `hidden`), référence et
  réputation conservées.
- **A16** : permissions séparées accordées et retirées par le propriétaire seul (consulter / préparer les commandes,
  créer et modifier, publier, masquer ou republier, répondre aux messages, sélectionner un livreur, paramètres de
  livraison, confirmer ou contester un paiement) ; aucune par défaut ; contrôlées par le serveur à chaque requête ;
  journalisées ; aucune ne donne le droit d'encaisser des espèces. Un employé est invité et **accepte** l'invitation.
  Demandes et offres de projet : propriétaire seul (non listées parmi les permissions).

### L7-02 — Lot 7 : arbitrages A1 à A12 et références des articles (16/10/2026, 13 h 25) · Fondateur · **décidé** (développement non autorisé)

Détail, propositions restantes et arbitrages encore ouverts (A2-b à A19) : `docs/LOT7_CONCEPTION.md`, version 2.

- **A1** : code de remise à 4 chiffres créé à la confirmation, visible du seul client, propre à la commande, essais
  limités, jamais preuve de paiement ; « Je suis arrivé » ; examen de l'article ; acceptation par le code (le bouton de
  paiement n'apparaît qu'ensuite) ou **refus avec motif obligatoire** (incident, jamais « livrée », aucune pénalité
  automatique, clôture normale impossible) ; espèces seulement avec un livreur **employé** de la boutique (constat
  visuel enregistré) ; **clôture obligatoire par le livreur** (identité et heure), notification au marchand qui
  confirme ou conteste. Distincts dans les données : clôture du livreur, paiement déclaré par le client, constat visuel
  du livreur, confirmation technique d'un prestataire, décision du marchand. Le silence du marchand ne vaut jamais
  confirmation.
- **A2** : frais de livraison calculés par une grille configurable **inspirée** de la tarification au temps (durée du
  trajet, attente, mode), sans prétendre reproduire l'algorithme de Yango ; prix visible avant confirmation, figé à la
  confirmation, hausse seulement avec consentement explicite.
- **A3** : livreur employé : frais attribués à la boutique (**C2 tranché**), la boutique rémunère son employé ;
  freelances : rémunération selon leur partenariat, règlement défini et traçable, jamais d'espèces pour l'article,
  aucun Mobile Money présenté comme automatisé sans intégration.
- **A4 / A5** : partenaires prioritaires sur les indépendants (rapide et économique), selon disponibilité et
  éligibilité ; en économique, choisir un autre livreur qu'un partenaire éligible disponible exige un **motif
  enregistré** ; le marchand choisit parmi les livreurs éligibles contrôlés par le serveur.
- **A6 / A7** : pas de certification administrative des comptes utilisateurs Premium ; Gold et étoiles des marchands
  distincts de l'abonnement, Gold jamais automatique par abonnement ; **paiement avant livraison ni développé ni
  activé** tant que remboursement, annulation, litige, responsabilité et mécanisme réel ne sont pas en place.
- **A8** : aucun frais d'annulation automatique ; auteur, heure et état de la livraison enregistrés ; politique
  financière à finaliser.
- **A9** : permissions séparées accordées par le propriétaire (consulter, préparer, sélectionner un livreur, paramètres
  de livraison, confirmer ou contester un paiement) ; rien par défaut.
- **A10** : 5 min, 15 min, 7 jours, 24 h conservés comme **valeurs initiales à vérifier**.
- **A11** : conservation par catégorie de données, durées à vérifier juridiquement.
- **A12** : 18 ans proposé pour commander, livrer et ouvrir une boutique, **sous réserve de vérification juridique**
  (reste une proposition).
- **Références** : chaque article ou prestation reçoit une référence publique unique, générée par le serveur, stable,
  jamais réattribuée ni modifiée, distincte de l'identifiant interne, utilisée dans les commandes, l'historique et les
  évaluations.

### L7-01 — Lot 7 : complément final (16/10/2026, 12 h 31) · Fondateur · **décidé** (développement non autorisé)

Conception détaillée, contradictions et arbitrages : `docs/LOT7_CONCEPTION.md`. Règles décidées :

- **Trois décisions séparées** : le client choisit le mode (rapide, économique en 2 jours au plus, retrait si proposé)
  en connaissant prix des articles, frais et délai **avant** de confirmer ; le **marchand sélectionne le livreur**
  (le client jamais) ; le serveur enregistre le livreur retenu, l'auteur et l'heure de l'attribution.
- **Aucune modification imposée silencieusement** après confirmation : prix, délai ou mode présentés avant
  application et soumis à l'accord du client.
- **Économique** : partenaires prioritaires, sans obliger à choisir un partenaire indisponible ; tarif issu d'une règle
  ou d'une offre valide, jamais d'un montant fixé dans le code ; jamais de promesse « 2 jours » sans mécanisme tenable.
  **Rapide** : indépendant possible ; disponibilité confirmée avant la promesse.
- **Paiement** : scénario A (boutique ordinaire) à la réception ; scénario B (boutique **Premium certifiée**, statut
  attribué par un processus administratif, jamais par une donnée envoyée par l'app) avant livraison, sans second
  paiement. *(Scénario B et « Premium certifié » : remplacés par L7-02 — paiement avant livraison suspendu, notion retirée.)* Trois niveaux distincts : déclaré, confirmé par la boutique, confirmé techniquement par un prestataire.
- **Code à 4 chiffres** créé à la confirmation, confidentiel, communiqué après examen du colis ; il n'est **jamais**
  une preuve de paiement. Arrivée, code, paiement, remise déclarée, confirmation du client et confirmation ou
  contestation de la boutique sont des événements distincts.
- **Incidents** : état d'incident plutôt que réussite automatique ; aucun remboursement automatique ni pénalité sans
  règle commerciale explicite. Notifications liées à une commande, sans effet financier en cas de répétition.
- Historique horodaté non réécrit ; données limitées au nécessaire ; durées de conservation à définir.
- Remplace dans les règles proposées le 16/10 au matin : paliers d'attribution automatiques, options « maintenant /
  plus tard » choisies par le client, paiement avant expédition ouvert à toute boutique, code créé à l'attribution.

### C6 — Mode d'un projet et abonnement Premium : deux notions indépendantes · Fondateur · décidé (14/10/2026)
- **Projet économique** : atteindre l'objectif avec des solutions gratuites ou économiques (exercices à la maison, astuces, conseils, méthodes pratiques, solutions à fabriquer soi-même). Exemple, prise de muscle : 10 pompes chaque matin et exercices à domicile.
- **Projet Premium** : la personne accepte d'envisager des achats ; BIM peut lui recommander des accessoires, produits ou services adaptés, vendus par des marchands. Exemple, prise de muscle : haltères, bandes élastiques, tapis de sport.
- **Choisir le mode Premium d'un projet est gratuit** : aucun paiement à BIM. La personne ne paie que les produits ou services qu'elle décide d'acheter, dans le parcours commercial normal (BimShop, commandes).
- **L'abonnement Premium de BIM** est une offre commerciale distincte (avantages sur la plateforme, écran 61, lot 8). Il ne doit jamais être confondu avec le mode Premium d'un projet.
- **Règle fondamentale** : toute personne, gratuite ou abonnée, peut choisir un projet économique ou un projet Premium, et changer de mode plus tard.

Effet sur le code (vérifié le 14/10/2026) : le module Projets ne lisait déjà aucun abonnement et ne créait aucun paiement ; rien n'a dû être retiré. Ajouts : changement de mode après création (écran 19 : « Tu pourras changer de mode plus tard »), libellés « Projet économique » / « Projet Premium », mention « choix gratuit, avec ou sans abonnement » sur l'écran 19, et tests qui empêchent tout couplage futur (voir `docs/TESTING.md`).

### C7 — Programmes types à rédiger · Action du fondateur
Pour chaque catégorie (et objectif), un programme type : durée, tâches, heures, jours, conseils, validé par une personne compétente (coach, esthéticienne…). Il peut être saisi en base dès maintenant ; l'écran d'administration arrive avec le lot 0 partie 2.

### C8 — Éléments des maquettes sans règle définie · Réponses du fondateur du 15/10/2026
- **Écran 21 — « Résoudre un problème » · décidé, implémenté** : ouvre le formulaire de signalement de BIM (le même système que l'écran 27, voir T-022) : description, image ou capture d'écran jointe, envoi, suivi du statut et de la réponse dans « Mes signalements ». Aussi accessible depuis le compte (rubrique Aide).
- **Écran 29 — avertissement avant une pause · décidé, implémenté** : message général, sans culpabiliser. Texte retenu (proposition du fondateur, légèrement resserrée : la question finale est portée par le titre et les boutons) : titre « Mettre ton programme en pause ? » ; « Attention : faire une pause peut ralentir l'atteinte de ton objectif. Pendant la pause, ton programme est suspendu et sa date de fin est décalée d'autant. Tes progrès et les tâches déjà accomplies sont conservés. » ; boutons « Continuer mon programme » et « Mettre en pause ». Peni pensif au lieu de Peni en larmes (maquette), pour ne pas culpabiliser. L'avertissement d'un marchand (« selon Fitness Club… ») reste prévu avec les marchands (lot 5).
- **Écran 26 — coffre · décidé le 15/10/2026, implémenté** : récompense symbolique uniquement (badge, message de Peni), **jamais financière** (ni pièces, ni argent, ni réduction). Règle de calcul (précisée avec le fondateur le 15/10) :
  - un coffre par **semaine complète de programme** (jours de programme 1-7, 8-14… ; les jours de pause ne comptent pas) et un **coffre final** pour tout le programme ; s'ils tombent le même jour (durée multiple de 7), les deux sont gardés, chacun avec son calcul ;
  - un coffre s'ouvre quand **au moins 70 % des tâches prévues** sur sa période sont réellement cochées (calcul en entiers, sans arrondi : 5 sur 7 ouvre, 4 sur 7 non ; 7 sur 10 ouvre, 6 sur 9 non) ;
  - **seules comptent les tâches qui faisaient partie du programme ce jour-là** : une tâche ajoutée en cours de route compte à partir de son jour d'ajout, une tâche retirée jusqu'à la veille de son retrait ; jours de repos et jours de pause ne comptent pas ; une semaine sans tâche prévue n'a pas de coffre ;
  - le rattrapage d'un jour passé (déjà permis) compte : un coffre « pas encore obtenu » peut s'ouvrir ensuite ; décocher sous le seuil le referme ;
  - le coffre final ne s'ouvre qu'une fois le dernier jour atteint (badge « Programme terminé ») ;
  - chaque ouverture laisse un événement `chest_opened` (source des notifications du lot 2) ; les badges obtenus apparaissent dans le bilan (écran 30).
  Cette règle « période active des tâches » s'applique aussi à la progression, aux jours et à la série (choix du fondateur du 15/10, T-024).

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

### T-022 — Signalements avec image ; problème général (lot 1, C8) · Technique · décidé (conservation à valider)
Un seul système (table `project_reports`) pour deux contextes : « project » (écran 27 : projet, jour, tâche) et « general » (écran 21 et compte : sans projet, description de 10 caractères au moins ; motifs : application, produit ou service, douleur ou malaise, autre). Une image facultative par signalement : contrôlée (JPEG, PNG, WebP ; taille maximale `MEDIA_MAX_UPLOAD_MB`), ré-encodée en JPEG sans métadonnées ni position GPS (même traitement que les photos, `media/private-image.ts`), rangée en privé sous `reports/<personne>/`, lue par lien temporaire par la personne et par le support (permission `reports.read`). L'image est traitée avant tout enregistrement : une image refusée ou un stockage indisponible ne crée rien, et l'app propose d'envoyer sans image. 20 signalements au plus par personne et par 24 h, 10 envois par 10 minutes par adresse. Routes : `POST/GET /v1/reports` ; les routes `/v1/projects/:id/reports` restent valables (même service).
**Conservation des images jointes · en attente de validation juridique et réglementaire** : proposition d'effacement **12 mois après la réponse** du support, et effacement à la suppression du compte (fonction à venir). Cette durée **n'est pas approuvée** : elle doit être validée (avis juridique, déclaration à l'ARTCI, registre des traitements) avant la mise en production. Aucune purge automatique n'est programmée tant qu'elle n'est pas validée ; les images restent privées en attendant.

### T-023 — Journal des événements d'un projet comme source des lots 2 et 3 · Technique · décidé
Chaque changement d'horaire ou de suivi d'un projet écrit un événement dans `project_events`, dans la même transaction (création, pause, reprise, fin, abandon, tâche ajoutée ou retirée, changement de mode, mesure, ouverture d'un coffre). Les rappels (lot 2) et Peni (lot 3) liront ce journal au lieu de modifier le module Projets. Détail : `docs/DEPENDANCES_LOTS_2_3.md`.

### T-024 — Période active des tâches (lot 1, coffres) · Technique · décidé le 15/10/2026
Chaque tâche a une période où elle fait partie du programme (`active_from`, `active_until` : migration 0010, avec reprise de l'historique). Progression, état des jours, série et coffres ne comptent une tâche que pendant cette période : ajouter une tâche ne rend plus « manqués » les jours passés, et retirer une tâche ne fait plus disparaître ce qui a été fait. Calcul unique dans `plan.ts`, testé unitairement (durées de 5 à 90 jours, pauses, tâches ajoutées et retirées, seuil exact).

### T-025 — Lot 2 : pays et rappels · Fondateur · décidé le 15/10/2026 (détails à valider)
Lancement en **Côte d'Ivoire** (heure d'Abidjan), architecture prête pour d'autres pays (fuseau par personne au lot 2). Rappels : **notifications d'abord** (envoi par le serveur via Firebase Cloud Messaging, secours local non exact), alarmes exactes seulement si les mesures sur de vrais téléphones le justifient. Comparaison des architectures, coûts et recommandation (selon R-01) : `docs/LOT2_RAPPELS_ETUDE.md`. Aucune activation en production ni dépense sans accord explicite.

### T-026 — Lot 2 : rappels préparés sans dépense · Technique · décidé (activation et valeurs à valider)
Développé et testé, **inactif** : fuseau horaire par personne (`profiles.timezone`, Abidjan par défaut) ; appareils de notification rattachés à la session (supprimés à la déconnexion) et préférences ; calcul des rappels en fonctions pures (`reminders.ts`) ; worker avec file dans PostgreSQL (`notification_deliveries` : clé unique anti-doublon, prise exclusive `SKIP LOCKED`, reprise après 120 s, 3 essais, péremption, revérification avant envoi) ; battement de cœur et état de santé (`/admin/v1/reminders/health`, permission `system.health` rattachée à la proposition T-019) ; envoi FCM HTTP v1 prêt, testé contre un faux serveur. La file **pg-boss** envisagée dans l'étude est remplacée par cette table : même coût, contrôle exact des doublons et des reprises, une dépendance de moins, SQS toujours possible derrière la même interface. Interrupteurs : `WORKER_MODE=off` par défaut et réglage `notifications.reminders_enabled` = false (« en attente »). Valeurs **non validées** : rythme 0 / +60 / +120 min et heures calmes 22 h – 6 h (« en attente ») ; délai de grâce 30 min (« provisoire »). Restent soumis à l'accord du fondateur : service séparé payant (coût détaillé, section 10 de l'étude), projet Firebase, valeurs des réglages, pas d'alarme exacte en version 1.

### T-027 — Lot 2 : décisions du fondateur du 15/10/2026 (10 h 50) · Fondateur · décidé
1. **Rappels désactivés par défaut** pour chaque personne ; c'est elle qui les active dans ses paramètres. Ce choix est **distinct de l'autorisation système** d'Android (demandée seulement quand la personne active ses rappels). Appliqué : valeur par défaut `false` (migration 0014), worker et liste des rappels à venir n'agissent que pour les personnes qui ont activé.
2. **Firebase** : intégration préparée sans créer de service ni engager de dépense ; étapes de création du projet au nom de l'entreprise dans `docs/FIREBASE_PROJET.md`.
3. **Version 1 : notifications programmées classiques**, pas d'alarme exacte ; architecture ouverte (`ReminderTiming` dans l'app). Appliqué : rappels des 48 h suivantes calculés par l'API (`GET /v1/me/reminders/upcoming`, même calcul et mêmes textes que l'envoi serveur) et programmés par le téléphone en mode non exact ; aucune permission d'alarme exacte déclarée. Un seul canal par appareil : un téléphone inscrit aux notifications du serveur ne programme rien lui-même.
4. **Maquette 28** : l'écran des préférences (F) est distinct des notifications de l'écran verrouillé ; la maquette n'est terminée que lorsque les notifications et leurs actions « J'y vais ! / Plus tard » sont implémentées et testées. État : implémentées et testées sur émulateur pour les notifications programmées par le téléphone ; envoi par le serveur (Firebase) en attente ; écarts restants listés dans `PROJECT_STATUS.md`.
5. **Émulateur** : problème documenté et origine recherchée (voir `docs/TESTING.md`, « Perte de l'émulateur ») ; aucun test supprimé.
6. Finalisation du lot 2 sans dépense ; bilan présenté avant de considérer le lot comme terminé.

### T-032 — Conservation des discussions avec Peni · Produit · mécanisme décidé, durée NON fixée (fondateur, 15/10/2026, 17 h 48)
Mécanisme configurable prêt et testé : une discussion sans activité depuis `peni.conversation_retention_days` jours est supprimée chaque nuit avec ses messages (lots de 1 000, verrou, un passage par jour, journal `maintenance_runs`, audit sans contenu). **Aucune durée n'est fixée** : la valeur est null (« pending ») et rien n'est supprimé tant qu'une durée d'au moins 7 jours n'est pas validée (« decided ») après examen de la confidentialité et de la réglementation. La proposition de 12 mois n'est pas retenue pour l'instant.

### T-034 — Peni explique les tâches (écran 24) · Produit · appliqué (15/10/2026) ; contenu à relire
Explications écrites et versionnées (`task-explanations.ts`, v1), sans IA. Peni n'invente aucun exercice (C7) : il reprend le contenu réel de la tâche (programme validé, séance construite depuis les réponses, tâche ajoutée par la personne). Les « bons réflexes » par catégorie (s'échauffer, aller à son rythme, arrêter en cas de douleur, tester un produit sur une petite zone…) sont des conseils généraux de prudence, **à relire par l'équipe BIM** avec les programmes types (C7). Aucune décision de confidentialité modifiée : rien n'est enregistré (lecture seule).

### T-033 — Encouragements de Peni et « Pas sûr ? » de l'écran 21 · Produit · décidé (15/10/2026, 17 h 48)
1. Encouragements dans la journée (27) et sur la carte (26) : textes écrits et versionnés (`encouragements.ts`, v1), positifs, naturels, jamais culpabilisants ; aucun avis médical ni promesse de résultat ; affichés dans l'app seulement (aucune notification).
2. Heures calmes (22 h – 6 h par défaut, ou celles de la personne) : Peni n'incite jamais à faire une tâche ; il félicite ou souhaite une bonne nuit.
3. « Pas sûr ? Demande à Peni » à l'écran 21 : discussion courte qui ne porte que sur l'objectif ; l'objectif choisi est repris à l'étape 3 et reste modifiable. Une hésitation (« je ne sais pas ») n'est jamais prise pour un objectif.

### T-031 — Lot 3 (Peni) commencé en parallèle du lot 2 · Produit · décidé (fondateur, 15/10/2026, 16 h 26)
1. Le lot 3 avance sans attendre les tests sur téléphones du lot 2 (aucune dépendance technique : les rappels et Peni partagent seulement le catalogue de messages, R1 et R4). La checklist du lot 2 reste tenue à jour (`docs/CLOTURE_LOT2.md`).
2. Première fonctionnalité : **discussion guidée avec Peni (écran 25)** qui prépare un projet, ouverte depuis les écrans 19 et 20. Moteur `guided-v1` : réponses écrites et versionnées dans le dépôt, phrases simples comprises par mots-clés, réponses rapides ; brouillon au format de `POST /v1/projects`, vérifié et confirmé par la personne (R5, R6).
3. **Aucun fournisseur d'IA** : interface `LlmProvider` prête, seul fournisseur « none » (`PENI_LLM_PROVIDER`), réglage `peni.llm_enabled` à false (« pending »). Un fournisseur ne pourra servir que s'il est branché ET si le réglage est validé (« decided ») ; aucune donnée personnelle n'est envoyée à l'extérieur d'ici là.
4. Cadrage santé (R4) : aucun avis médical, renvoi vers un professionnel ; urgence : SAMU 185, pompiers 180, le projet n'avance pas.
5. Limites provisoires (administrables) : 100 messages par 24 heures, 60 par discussion. Durée de conservation des discussions : mécanisme prêt, durée non fixée (T-032).
6. Écarts assumés avec la maquette 25 : pas de micro (dictée vocale : service externe) ; la question « à la maison ou en salle » n'est pas posée, car la réponse ne serait utilisée nulle part (elle le sera avec les programmes types, C7).

### T-030 — Décisions du fondateur du 15/10/2026 (15 h 44) · Produit · décidé
1. **Rythme** conservé : rappel à l'heure, puis +1 h et +2 h seulement si la tâche n'est pas cochée.
2. **Heures calmes 22 h – 6 h, option B** : le rappel initial part à l'heure choisie, même pendant les heures calmes ; les relances +1 h et +2 h n'y sont jamais envoyées (supprimées, jamais reportées). Appliqué (`reminders.ts`, revérification avant l'envoi dans le worker) et testé (report, doublons, envois hors période). Reste ouvert : le retard possible des notifications non exactes du téléphone (options P1 à P3 dans `docs/RYTHME_ET_TEXTES_RAPPELS.md`), à trancher par le fondateur.
3. **Textes de Peni** : principe des trois textes validé, pose triste remplacée par une pose encourageante, tâche au début du texte. Appliqué en v3 (deux textes réordonnés pour placer la tâche en tête). **Provisoires** jusqu'à la vérification sur vrais téléphones (T17).
4. **Purge des comptes jamais vérifiés : 30 jours**, préparée et testée dans le lot 2, **désactivée par défaut et en simulation**. Suppression réelle seulement après validation explicite du fondateur (réglages marqués « decided »). Protections : aucun code récent (24 h), audit sans donnée personnelle, plafond de 500, exécution unique, tests garantissant que les comptes actifs ne sont jamais touchés (`docs/PURGE_COMPTES_NON_VERIFIES.md`). La conservation des tentatives de connexion et des codes n'est pas décidée et n'est pas développée.
5. **Fournisseur SMS** : prérequis du lancement public, pas du lot 2. Aucun service externe activé, aucune dépense.
6. Tests T1 à T16 sur au moins trois téléphones avant la clôture ; le lot 2 n'est pas déclaré terminé avant les tests réels, les corrections et les preuves.

### T-029 — Textes des rappels v2 et pose de Peni · Technique · remplacée par T-030 (textes v3)
Textes rapprochés de la maquette 28 (v2, `reminders.ts`) : « C'est l'heure ! {tâche} 💪 Tu vas tout déchirer. » (Peni joyeuse), « Vas-y, ça ne prend qu'une minute… {tâche} t'attend 🥺 » (Peni pensive), dernier rappel « {tâche} n'est pas encore cochée. Il est encore temps, je crois en toi ! » (Peni triste). Le texte de la maquette « Je t'en supplie 😭 ta séance n'est toujours pas cochée… Il ne reste plus que 2 h ! » n'est pas repris : il accompagne l'« ALARME » (non retenue en version 1) et peut culpabiliser (C8). **À confirmer par le fondateur.** La pose de Peni fait partie de la notification (R1) : l'API la fournit avec le texte ; le téléphone affiche l'image correspondante (copies en PNG produites par `scripts/generate-notification-icons.py`, dessin de Peni inchangé).

### T-028 — Centre de notifications (écran 17) lu dans les sources · Technique · décidé
Le centre de notifications n'enregistre pas de copie : il lit les coffres ouverts (journal des projets), les réponses du support et les rappels réellement envoyés par le serveur, et produit les textes à la lecture (R1). Seul l'état « vu » est stocké (`notification_inbox`, migration 0015). Aucun lien du module Projets vers les Notifications (R2). 30 derniers jours. Filtres « Tout » et « Projets » seulement : « Pièces », « Commandes » et « Live » viendront avec leurs lots. Les rappels programmés par le téléphone (sans serveur) n'y figurent pas : le serveur ne sait pas s'ils ont été affichés.

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
