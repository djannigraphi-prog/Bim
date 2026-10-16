# Lot 7 — Commandes, paiements et livraisons : conception

Version du 16/10/2026 (après le « complément final » du fondateur, 12 h 31). **Document de conception : aucun
développement fonctionnel du lot 7 n'est autorisé à ce stade.** Aucun prestataire activé, aucune dépense, aucune
transaction réelle.

Légende utilisée dans tout le document :

- **[APPROUVÉ]** : règle décidée par le fondateur (source indiquée).
- **[PROPOSÉ]** : proposition technique ou métier, en attente de validation.
- **[ARBITRAGE]** : décision du fondateur nécessaire (numérotée A1, A2… en section 10).
- **[NON VÉRIFIÉ]** : dépendance technique qui n'existe pas encore dans le dépôt ou n'a pas été éprouvée.

Sources : `DECISIONS.md` (F1-F4, F3 bis, F17, C1, C2), `docs/ANALYSE.md` §5, §6.1 et §8, étude de faisabilité et de
fiabilité du 16/10/2026, règles proposées le 16/10/2026 (matin), complément final du 16/10/2026 (12 h 31).

---

## 0. Principes et architecture

**[APPROUVÉ]** (16/10/2026)

- Un module **Commandes** unique pour le BimShop (« Commander ») et la messagerie (proposition dans une conversation de
  boutique, lot 6-B). Jamais deux systèmes de commandes.
- Un module **Livraisons** distinct, relié à la commande.
- Un module **Paiements** séparé : l'article et les frais de livraison sont deux paiements distincts (Q39, F2).
- États contrôlés côté serveur ; historique horodaté de chaque transition ; autorisation vérifiée à chaque action.
- Séparation stricte entre **paiement déclaré**, **paiement confirmé par le bénéficiaire** et **paiement confirmé
  techniquement par un prestataire**. Ce dernier niveau n'existe pas tant qu'aucun prestataire n'est intégré
  (lot 8, soumis à accord) ; l'app ne l'affiche jamais avant.
- **F3 bis** : seuls les livreurs **employés de la boutique concernée** encaissent des espèces, pour les commandes de
  cette boutique. Les freelances (partenaires ou indépendants) **jamais**, même si le client et le livreur sont
  d'accord. Vérifié côté serveur, testé spécifiquement.
- BIM n'encaisse aucun paiement commercial (F4) : il enregistre.

**Ce qui existe dans le dépôt (constaté)** : catalogue, variantes et stock calculé à partir des mouvements, avec un
déclencheur qui refuse tout stock négatif sous verrou (`migrations/0022_catalog.sql`) ; boutiques et membres
(`owner`, `staff`) ; tables `courier_accounts` et `courier_shop_partnerships` (lot 0, aucun code) ; espace livreur
revérifié à chaque requête (`spaces.service.ts`, `auth.guard.ts`) ; messagerie des boutiques (6-B) ; worker
minute par minute (`reminder-runner.ts`) ; centre de notifications lu dans les sources (T-028).
**N'existent pas** : commandes, paiements, livraisons, adresses, tarifs de livraison, statut « Premium certifié »,
abonnements, notifications sur le téléphone actives (Firebase non activé), envoi réel de SMS, prestataire Mobile Money,
positions et distances.

---

## 1. Fonctionnement côté client

1. **Choisir** : depuis le BimShop (« Commander ») ou en acceptant une proposition du marchand dans la conversation.
2. **Choisir le mode de livraison** [APPROUVÉ, complément §1] parmi les modes **réellement disponibles** :
   - livraison **rapide** (si une disponibilité a été confirmée, §4) ;
   - livraison **économique**, délai maximal annoncé de **2 jours** (seulement si une promesse tenable existe, §4) ;
   - **retrait en boutique**, si le marchand le propose.
3. **Voir avant de confirmer** [APPROUVÉ] : prix des articles, frais de livraison du mode choisi, délai estimé,
   moyen et moment du paiement (scénario A ou B, §5), statut de la boutique et modalités de contestation (§6 du
   complément). Les montants article et livraison sont **toujours affichés séparément**.
4. **Confirmer** explicitement la commande. Le client **ne choisit jamais le livreur** [APPROUVÉ].
5. Le **code de remise à 4 chiffres** est créé à la confirmation et visible **seulement** par le client
   [APPROUVÉ] ; il ne le communique qu'après avoir examiné le colis.
6. **Suivre** la commande dans l'app (l'état reste consultable même si une notification n'arrive pas).
7. **Accepter ou refuser** toute modification (prix, délai, mode) présentée **avant** son application [APPROUVÉ] ;
   sans accord, la modification n'a pas lieu.
8. **À l'arrivée du livreur** : notification, examen du colis, puis communication du code ; paiement selon le
   scénario (§5).
9. **« J'ai reçu mon article »** : confirmation indépendante de celle du livreur. **Satisfaction** après réception
   [PROPOSÉ : note de 1 à 5 et commentaire facultatif pour la boutique ; note du livreur interne, E11].
10. **Contester** : refus du colis à la remise, ou contestation après remise dans le délai fixé (§7).

## 2. Fonctionnement côté marchand

1. **Confirmer la commande** (scénario A, étape 2) [APPROUVÉ]. Pour une proposition faite dans la messagerie, la
   proposition du marchand vaut déjà son accord sur le contenu et le prix [PROPOSÉ] ; il lui reste à organiser la
   livraison.
2. **Préparer** puis **demander la livraison** dans le mode choisi par le client.
3. **Sélectionner le livreur** [APPROUVÉ, complément §1] parmi la liste des livreurs **admissibles** calculée par le
   serveur (§4) : mode, disponibilité, délai, prix applicable, autorisations et conditions de sécurité. Le serveur
   enregistre **le livreur retenu, l'auteur de l'attribution et l'heure**.
4. **Proposer une solution alternative** si aucun partenaire n'est disponible ; tout changement de prix plus élevé ou
   de délai est soumis à l'accord du client [APPROUVÉ].
5. **Confirmer ou contester la réception du paiement** (notification à la remise) [APPROUVÉ, scénario A étape 11].
6. **Droits de l'équipe** [PROPOSÉ, règles du 16/10 matin] : le propriétaire fait tout et **seul** : change le numéro
   Mobile Money, gère l'équipe et les livreurs employés, confirme la remise d'espèces par un livreur employé, annule
   une commande déjà payée, demande la certification Premium. L'employé (vendeur) répond, propose, prépare, demande
   la livraison et **sélectionne le livreur** [ARBITRAGE A9]. Chaque action enregistre son auteur.

## 3. Fonctionnement côté livreur

Catégories [APPROUVÉ] : **employé** de la boutique · **freelance partenaire** de la boutique · **freelance
indépendant**. Elles se déduisent côté serveur d'une **relation avec la boutique de la commande** (emploi actif,
partenariat actif, aucune), jamais du seul type du compte ni d'une option cochée par le marchand.
[PROPOSÉ] Une table des relations livreur-boutique (`employment` ou `partnership`, au plus un emploi actif par
livreur, acceptation par le livreur, journalisation) ; la colonne `can_collect_article_payment` (lot 0, inutilisée)
n'est **jamais** utilisée pour les espèces.

1. **Disponibilité et capacité** : le livreur se déclare disponible, avec une zone (commune) et une capacité
   (missions simultanées, [PROPOSÉ] 3 par défaut, réglable).
2. **Recevoir une mission** sélectionnée par le marchand ; l'**accepter** ou la **refuser** (une attribution n'est
   effective qu'après acceptation [PROPOSÉ] ; délai d'acceptation réglable).
3. **Prendre le colis** (« colis pris en charge »).
4. **« Je suis arrivé »** [APPROUVÉ] : heure d'arrivée, début du temps d'attente, notification au client.
5. **Code** : le client le communique après examen ; le livreur le saisit, le serveur le valide (une seule fois).
6. **Paiement** [APPROUVÉ] — libellé et action selon la catégorie et le moyen :
   - **employé, espèces** : « Espèces reçues : X F » (déclaration du montant, trace, rapprochement) ;
   - **freelance** : aucune action d'encaissement de l'article ; il voit le **statut** du paiement Mobile Money
     (déclaré par le client, confirmé par la boutique) — jamais « vérifié » ;
   - **frais de livraison d'un freelance** : payés au livreur en Mobile Money [PROPOSÉ, A3] ; il déclare la réception.
7. **« Article remis au client »** [APPROUVÉ] : déclaration du livreur, qui ne remplace pas la confirmation du client.
8. **Incidents** (§7) : client absent, refus, colis endommagé, impossibilité de terminer, abandon.

## 4. Livraison rapide et livraison économique

| | Rapide | Économique |
| --- | --- | --- |
| Priorité | La rapidité | Le coût ; délai **maximal annoncé de 2 jours** |
| Livreurs | Employé de la boutique, partenaire disponible ou **freelance indépendant** si nécessaire [APPROUVÉ] | **Partenaires prioritaires** [APPROUVÉ] ; employé de la boutique [ARBITRAGE A4] ; indépendant seulement en solution alternative acceptée par le client |
| Tarif | Selon la course et les règles de tarification applicables [APPROUVÉ] | Réduit, selon les accords commerciaux et offres de livraison valides ; **jamais un montant fixé en dur dans le code** [APPROUVÉ] |
| Promesse | **Disponibilité confirmée avant de promettre** [APPROUVÉ] | Proposée **seulement** si un mécanisme tenable existe [APPROUVÉ] |
| Organisation | Course immédiate | Planification : un partenaire peut regrouper des livraisons compatibles sans dépasser le délai de chacune |

**Prix connu avant confirmation** [APPROUVÉ] alors que **le livreur est choisi après** : le prix affiché doit donc
venir d'une **règle de tarification ou d'une offre de livraison valide au moment de la confirmation**, et non d'un devis
demandé après coup. [PROPOSÉ] :

- **Grilles de tarifs** par boutique, mode et zone (commune de départ → commune d'arrivée), alimentées par les accords
  de partenariat (économique) et par une grille des courses rapides ; chaque grille a une période de validité.
- Le prix affiché au client est **figé à la confirmation** (copie dans la commande).
- Un livreur n'est **admissible** que s'il accepte ce prix (ou moins) pour ce mode et cette zone ; le client ne paie
  jamais plus que le prix accepté sans nouvel accord. Ce que perçoit le livreur quand son tarif est inférieur :
  [ARBITRAGE A2].
- **Économique proposé seulement si** au moins un partenaire admissible a une capacité déclarée dans les 2 jours ; sinon
  le mode n'apparaît pas (aucune fausse promesse).
- **Rapide proposé seulement si** au moins un livreur admissible est disponible maintenant dans la zone ; la
  disponibilité est revérifiée à la sélection. [NON VÉRIFIÉ] Sans notifications sur le téléphone ni position, la
  « disponibilité confirmée » repose sur la déclaration du livreur et l'actualisation régulière de l'app.

**Priorité des partenaires sans obligation absurde** [APPROUVÉ] : la liste présentée au marchand est ordonnée
(partenaires admissibles d'abord pour l'économique) ; le serveur refuse un indépendant en économique tant qu'un
partenaire admissible existe, sauf **motif enregistré** (délai, indisponibilité constatée) [PROPOSÉ, ARBITRAGE A5].
Un partenaire indisponible ou incapable de tenir le délai n'est **pas admissible**, donc jamais imposé.

**Priorité Premium des livreurs (F17)** : uniquement à l'intérieur d'une même catégorie admissible [PROPOSÉ].

## 5. Règles de paiement

**Statuts d'un paiement** (article et frais de livraison, chacun le sien) [APPROUVÉ dans le principe] :
`non dû` → `dû` → `déclaré` (par le client, ou par le livreur employé pour des espèces) → `confirmé par le
bénéficiaire` (boutique pour l'article, livreur pour ses frais) → *(lot 8, si un prestataire est intégré)* `confirmé
par le prestataire` ; et `contesté`, `échoué`, `annulé`, `remboursement déclaré`, `remboursement confirmé`.
Un paiement est rattaché à **une seule commande** (contrainte de la base) ; une preuve affichée sur le téléphone du
client n'est **jamais** une confirmation technique [APPROUVÉ].

### Scénario A — boutique ordinaire : paiement à la réception [APPROUVÉ]

Commande confirmée par le client → confirmée par la boutique → livreur sélectionné → course → arrivée → notification
au client → examen du colis → **code** (accepte la remise) → **paiement** → événements de remise → notification à la
boutique, qui **confirme ou conteste** le paiement.

| Livreur | Article | Frais de livraison |
| --- | --- | --- |
| Employé de la boutique | Espèces (déclarées par l'employé, montant comparé à celui déclaré par le client, puis remise d'argent confirmée par le propriétaire) **ou** Mobile Money au numéro confirmé de la boutique | Selon A3 (tarif de la boutique, revenant à la boutique si C2 est tranché ainsi) |
| Freelance partenaire ou indépendant | **Mobile Money uniquement**, au numéro confirmé de la boutique ; **jamais d'espèces** | Mobile Money au livreur [PROPOSÉ, A3] |
| Retrait en boutique | Sur place, déclaré par la boutique | Sans objet |

**Point de vigilance majeur** [ARBITRAGE A1] : dans l'ordre approuvé, le code (acceptation) précède le paiement. Avec un
freelance, si le colis est laissé au client avant que le paiement Mobile Money soit **au moins déclaré**, la boutique
supporte seule le risque de non-paiement. [PROPOSÉ] : le livreur ne déclare « Article remis » qu'après validation du
code **et** déclaration du paiement par le client ; il attend la confirmation de la boutique pendant un délai court
réglable (ex. 10 min) ; sans réponse de la boutique, il remet le colis et la commande passe « paiement à confirmer »
(jamais « réussie ») — ou bien la boutique peut exiger d'attendre sa confirmation.

### Scénario B — boutique Premium certifiée : paiement avant livraison [APPROUVÉ]

Proposé **uniquement** si le serveur reconnaît la boutique comme Premium certifiée (§6) et si l'option est activée.
Le client accepte conditions et montant total → paie par le parcours externe autorisé (Mobile Money au numéro confirmé
de la boutique ; BIM ne reçoit rien, F4) → le paiement est enregistré au niveau réellement disponible (`déclaré`, puis
`confirmé par la boutique`) → livraison → examen → code. **Aucun second paiement** n'est demandé à la livraison.
[NON VÉRIFIÉ] « Confirmé par le prestataire » exige une intégration (lot 8) ; avant cela, l'app affiche « confirmé par
la boutique » au mieux. **Livraison échouée après paiement anticipé** : modalités à définir avant la mise en
production [ARBITRAGE A7] ; aucun remboursement automatique.

## 6. Cycles de vie distincts

Chaque objet a son propre statut et son propre historique ; aucune transition de l'un ne modifie silencieusement un
autre. Les transitions sont listées dans le code et vérifiées par des mises à jour conditionnelles
(`… WHERE statut = attendu RETURNING`), ce qui rend toute requête tardive ou répétée sans effet.

**Commande** [PROPOSÉ] : `proposée` (messagerie) ou `en attente de la boutique` (BimShop) → `confirmée` (les deux
accords ; code créé) → `en préparation` → `livraison demandée` → `en livraison` → `remise` → `terminée`.
Sorties : `refusée`, `expirée`, `annulée` (avant remise seulement), `incident`, `litige`. Une commande `annulée` ou
`terminée` n'accepte plus aucune action de livraison ou de paiement (hors remboursement déclaré).
`terminée` exige : remise déclarée ou confirmée par le client **et** paiement de l'article au moins `confirmé par le
bénéficiaire` (ou litige clos) — sinon `incident` ou `à vérifier`, jamais `terminée`.

**Paiement** : voir §5.

**Livraison** [PROPOSÉ] : `demandée` → `attribuée` (livreur, auteur, heure) → `acceptée` → `colis pris` → `en route`
(si disponible) → `arrivée` → `remise déclarée` → `close`. Sorties : `réattribution`, `client absent`, `refusée par le
client`, `abandonnée`, `retour en boutique`, `annulée`. Une seule attribution active (index unique de la base).

**Code de remise** [APPROUVÉ pour la création à la confirmation] : `créé` → `validé` (une seule fois) ; `bloqué` après
5 essais faux [PROPOSÉ] ; `annulé` si la commande l'est ; `recréé` par le support seulement (journalisé). Le code
n'est **jamais** une preuve de paiement. [PROPOSÉ, technique] Le serveur ne garde pas le code en clair dans les
journaux ; il est affiché au client seul (copie chiffrée ou valeur dérivée d'un secret serveur), comparé en temps
constant, tentatives limitées.

## 7. Incidents

Aucun remboursement automatique ni pénalité financière sans règle commerciale explicite [APPROUVÉ]. Chaque incident
crée un événement horodaté (auteur, motif, pièces éventuelles) ; les anciens événements ne sont jamais remplacés.
Le support agit avec une permission dédiée, chaque consultation est journalisée. [PROPOSÉ] pour chaque cas :

| Incident | Déclaré par | Statut appliqué | Notifiés | Reste possible | Bloqué |
| --- | --- | --- | --- | --- | --- |
| Client absent | Livreur, après « Je suis arrivé » + délai d'attente (15 min proposé) | Livraison `client absent` ; commande `incident` | Client, boutique | Nouvelle tentative convenue, retour en boutique | Validation du code, déclaration de remise |
| Colis non conforme, refusé | Client (ou livreur pour lui) avant le code | Livraison `refusée par le client` ; commande `incident` | Boutique, livreur | Retour en boutique, nouvelle proposition (accord du client) | Code, paiement à la réception |
| Colis endommagé | Client ou livreur | Commande `incident` | Boutique, livreur, client | Refus ou acceptation avec réserve enregistrée | Clôture automatique |
| Client a payé, boutique ne retrouve pas la transaction | Boutique (contestation) | Paiement `contesté` ; commande `à vérifier` | Client, livreur, support | Pièces des deux parties, nouvelle confirmation de la boutique | Passage à `terminée` |
| Preuve que le livreur ne peut pas vérifier | Livreur | Paiement `déclaré` seulement | Boutique | Confirmation de la boutique, attente bornée (A1) | Statut « confirmé » par le livreur freelance |
| Paiement échoué | Client ou boutique | Paiement `échoué` | Les trois | Nouveau paiement, annulation avant remise | Remise déclarée « payée » |
| Livreur ne peut pas terminer | Livreur | Livraison `abandonnée` → `réattribution` ou `retour` | Boutique, client | Réattribution par le marchand | Clôture |
| Boutique ne répond pas à une confirmation | Système (délai réglable) | Paiement reste `déclaré` ; commande `à vérifier` | Boutique (rappel), support | Confirmation tardive de la boutique, support | Aucune confirmation implicite |
| Livreur abandonne une course | Livreur ou système (délai dépassé) | Attribution close ; livraison `réattribution` | Marchand, client | Nouvelle sélection (le mode et le prix acceptés restent) | Toute hausse sans accord du client |
| Annulation avec livreur en route | Client ou boutique selon les règles | Commande `annulée` ; livraison `retour en boutique` | Livreur, autre partie | Retour du colis ; frais engagés [ARBITRAGE A8] | Code, remise, paiement de l'article |
| Code incorrect ou refusé par le client | Système (essais) ou livreur | Code `bloqué` après 5 essais ; commande `incident` | Client, support | Recréation par le support, nouvelle tentative | Remise déclarée sans code |
| Contestation après remise | Client ou boutique, dans le délai (7 jours proposé) | Commande `litige` | L'autre partie, support | Pièces, échanges, décision du support enregistrée | Effacement de l'historique |

## 8. Notifications

[APPROUVÉ] Confirmation de commande, attribution du livreur, départ et progression (si disponibles), arrivée, rappel
du paiement, déclaration du paiement, confirmation ou contestation par la boutique, remise, incidents et annulations.

- Chaque notification est **liée à une commande identifiable** et n'est qu'une **information** : aucune action
  financière ou de livraison n'est déclenchée par sa réception ; toute action passe par une requête authentifiée,
  idempotente (clé anti-doublon, mise à jour conditionnelle) [PROPOSÉ].
- L'état reste consultable dans l'app ; le centre de notifications lit les commandes à la source (T-028).
- [NON VÉRIFIÉ] **Notifications sur le téléphone : Firebase n'est pas activé** (`PUSH_PROVIDER=none`). Sans elles,
  l'arrivée du livreur et les attributions ne sont vues qu'en ouvrant l'app : **condition du lancement**, activation
  soumise à l'accord du fondateur.

## 9. Historique et données

- Événements horodatés et **non modifiables** pour la commande, chaque paiement, la livraison et le code : auteur
  (personne, rôle, espace), action, valeurs, motif. Les corrections sont de nouveaux événements [APPROUVÉ].
- Copie figée de ce qui a été accepté : articles, prix, mode, délai, frais, conditions de paiement.
- Coordonnées de livraison visibles de la boutique et du livreur **attribué**, pendant la mission seulement [PROPOSÉ].
- Comptes : un compte ayant des commandes, paiements ou livraisons ne peut pas être purgé ; suspension = plus
  d'action, historique conservé.
- Durées de conservation (commandes, adresses, déclarations d'espèces, pièces de litige) : **à définir** [ARBITRAGE
  A11], minimisation des données.

## 10. Tests prévus avant toute mise en production

Tous les tests existants sont conservés ; aucun n'est affaibli. Tous les tests ci-dessous sont réalisables **sans
paiement réel ni prestataire** (BIM enregistre, les livreurs sont un module interne).

**Demandés par le fondateur** : client qui tente de choisir un livreur (refusé) ; marchand qui sélectionne un livreur
admissible ; priorité des partenaires ; économique jamais plus cher sans accord ; boutique ordinaire qui tente le
paiement anticipé (refusé) ; boutique Premium qui tente de contourner les conditions ; **freelance (partenaire et
indépendant) qui tente de déclarer des espèces (refusé)** ; employé d'une autre boutique (refusé) ; code utilisable une
seule fois ; paiement rattaché à une autre commande (refusé) ; confirmation de paiement inventée (refusée : seul le
bénéficiaire confirme, jamais le client ni un freelance pour l'article) ; commande annulée puis requête tardive de
remise (sans effet) ; notifications répétées sans double opération ; historique des incidents conservé.

**Ajoutés** : doubles commandes (même clé anti-doublon, envois simultanés) ; doubles attributions (deux acceptations
simultanées) ; survente (confirmations simultanées sur la dernière unité) ; confirmation d'une version de commande
dépassée ; prix du catalogue modifié après la commande (sans effet) ; employé révoqué entre attribution et
encaissement ; écart entre montants déclarés (espèces) ; code faux ou épuisé ; remise déclarée sans paiement déclaré
(freelance) ; aucun statut « confirmé par le prestataire » sans prestataire ; accès croisés (client, boutique,
employé, livreur non attribué, support journalisé) ; suspension pendant une livraison ; reprise après arrêt du worker ;
non-régression complète (API, administration, Flutter, Android réel).

## 11. Contradictions restantes

1. **Prix connu avant confirmation, livreur choisi après** (complément §1) **contre** devis du livreur choisi par le
   client (règle du 16/10 matin, §7 de la demande initiale). → Proposition : grilles de tarifs valides (§4) ;
   le devis libre du livreur est abandonné. A2.
2. **Code avant paiement** (scénario A) **contre** protection de la boutique avec un freelance. → A1.
3. **Livreur employé** : absent de la description des deux modes alors qu'il était premier dans l'ordre de priorité
   initial. → A4.
4. **« Premium certifié »** : le dépôt n'a ni abonnement Premium (lot 8) ni certification ; F17 et Q50 parlent d'un
   Premium payant. Certification administrative seule, ou abonnement + certification ? → A6.
5. **Frais de livraison d'un freelance** : F2 « payés au livreur à la livraison » sans moyen précisé ; F3 bis interdit
   les espèces aux freelances « pour une commande BIM ». → A3 (Mobile Money au livreur proposé).
6. **Frais d'un livreur employé** : C2 toujours ouvert.
7. **Moment de la confirmation par la boutique** : pour une proposition faite dans la messagerie, la boutique a déjà
   donné son accord ; double confirmation inutile. → proposé : la proposition vaut confirmation de la boutique.
8. **Règles proposées le 16/10 matin** remplacées par ce complément : priorité des livreurs par paliers horaires
   automatiques (remplacée par la sélection par le marchand), options « maintenant / plus tard » proposées par le
   livreur (remplacées par les modes rapide / économique), « paiement avant expédition » au choix de toute boutique
   (réservé aux boutiques Premium certifiées), code créé à l'attribution (créé à la confirmation).

## 12. Arbitrages nécessaires

| N° | Question | Proposition |
| --- | --- | --- |
| A1 | Avec un freelance, le livreur laisse-t-il le colis avant la confirmation du paiement par la boutique ? | Remise seulement après code + paiement déclaré ; attente bornée (10 min) de la confirmation, puis « paiement à confirmer » ; option boutique « attendre ma confirmation » |
| A2 | Qui fixe les grilles de tarifs (boutique, livreurs partenaires dans leur accord, BIM) et que touche le livreur si son tarif est inférieur au prix affiché ? | Grille par accord de partenariat (économique) et grille de la boutique ou du réseau (rapide) ; le livreur reçoit le prix affiché accepté |
| A3 | Frais de livraison d'un freelance : Mobile Money au livreur ? Et pour un employé (C2) : à la boutique ? | Oui / oui |
| A4 | Place du livreur employé : prioritaire dans les deux modes ? | Sélectionnable dans les deux modes, avant les partenaires |
| A5 | Économique : le serveur bloque-t-il un indépendant tant qu'un partenaire admissible existe, ou un motif suffit-il ? | Motif enregistré obligatoire |
| A6 | Définition de « Premium certifié » : certification administrative (critères, durée, retrait) et lien avec l'abonnement Premium | Certification administrative distincte, attribuée et retirée par l'administration avec journal, critères publiés |
| A7 | Livraison échouée après paiement anticipé : remboursement, nouvelle tentative, délais, preuve | À définir avant la production ; aucun automatisme |
| A8 | Frais engagés quand une commande est annulée avec un livreur en route | Aucun frais facturé dans un premier temps ; incident enregistré |
| A9 | L'employé (vendeur) peut-il sélectionner le livreur ? | Oui ; confirmation de remise d'espèces réservée au propriétaire |
| A10 | Délais : acceptation d'une mission, attente du client, contestation après remise, expiration d'une proposition | 5 min, 15 min, 7 jours, 24 h (réglables) |
| A11 | Durées de conservation | À fixer avec un avis juridique |
| A12 | Âges : commander, être livreur, ouvrir une boutique (`age.min_merchant`, ouverture fermée d'ici là) | 18 ans pour les trois, après avis juridique |

## 13. Dépendances non vérifiées ou absentes

| Dépendance | État | Conséquence |
| --- | --- | --- |
| Notifications sur le téléphone (Firebase) | Code présent, **désactivé** | Arrivée, attributions et rappels invisibles hors de l'app ; condition du lancement ; accord requis |
| SMS réels | Fournisseurs `console`, `test`, `none` seulement | Numéros Mobile Money des boutiques et des livreurs non confirmables en production ; accord requis |
| Prestataire Mobile Money | Absent (lot 8) | Aucun statut « confirmé par le prestataire » ; interface prévue pour l'ajouter sans refonte |
| Position, distance, zones | Absentes | Disponibilité « rapide » déclarative ; zones par commune |
| Abonnement Premium et certification | Absents | Scénario B impossible avant A6 et sa réalisation |
| Espace livreur, vérification des livreurs | Espace prévu, aucun écran ni service | Étape 7-C ; réutilise le chiffrement des pièces du lot 5-A |
| Version minimale de l'app | Non imposée | À ajouter avant 7-A (les anciennes versions affichent déjà un texte neutre pour les messages inconnus, 6-B) |

## 14. Découpage proposé (inchangé dans son principe)

7-A Commandes (BimShop et messagerie, modes et prix figés, confirmation, code, stock) · 7-B Paiements déclaratifs ·
7-C Espace livreur et relations emploi / partenariat · 7-D Livraisons (sélection par le marchand, admissibilité,
grilles, incidents) · 7-E Espèces des employés et rapprochement · 7-F Satisfaction. Scénario B après A6.
Lot 8 : prestataire Mobile Money et abonnements, sur accord.
