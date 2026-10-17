# Lot 7 — Commandes, paiements et livraisons : conception

**Version 2 du 16/10/2026 (13 h 25)**, après les arbitrages A1 à A12 du fondateur et la nouvelle exigence sur la
numérotation des articles. Document de conception : **aucun développement fonctionnel du lot 7, aucune migration,
aucun prestataire activé, aucune dépense, aucune transaction réelle.** L'historique des versions est en fin de
document (§19).

Légende utilisée partout :

- **[APPROUVÉ]** décision validée par le fondateur (source entre parenthèses) ;
- **[PROPOSÉ]** proposition à valider ;
- **[ARBITRAGE]** décision encore à prendre (liste en §16) ;
- **[NON VÉRIFIÉ]** élément dont l'état réel n'est pas confirmé ou qui n'existe pas encore ;
- **[JURIDIQUE]** point à faire vérifier juridiquement en Côte d'Ivoire.

Sources : `DECISIONS.md` (F1-F4, F3 bis, F15, F17, C1, C2, T-010, T-028, L7-01, L7-02), `docs/ANALYSE.md` (§5, §6.1,
§6.6, §8), arbitrages du fondateur du 16/10/2026 (13 h 25), et le code de la branche `main` (commit 711f2d3).

---

## 1. Ce que le code contient réellement (vérifié le 16/10/2026)

| Élément | Constat | Fichier |
| --- | --- | --- |
| Articles et prestations | Identifiant interne `uuid` (v7). **Aucune référence publique**, aucun numéro lisible. Statuts `draft`, `published`, `archived`. **Jamais supprimés** par l'application : « Retirer » archive l'article, mais **efface ses photos du stockage**. | `database/schema/catalog.ts` ; `modules/catalog/merchant-catalog.service.ts` (`setStatus`) |
| Variantes | Désactivées (`active = false`), jamais supprimées ; libellé unique par article. | `catalog.ts` ; `setVariants` |
| Stock | Somme des mouvements ; motifs `adjustment`, `sale`, `return` déjà prévus ; déclencheur qui **verrouille la variante** et refuse tout stock négatif. | `migrations/0022_catalog.sql` |
| Commandes, paiements, livraisons, évaluations, adresses, tarifs | **Absents** (aucune table, aucun service). | — |
| Étoiles, avis, Gold | **Absents** du code ; seulement dans les maquettes et `ANALYSE.md`. | — |
| Membres d'une boutique | Rôles `owner` et `staff` seulement, **aucune permission détaillée**. Seul le propriétaire est créé par l'application (ouverture de boutique) ; **aucun écran ni service n'ajoute d'employé** à ce jour. L'appartenance est revérifiée à chaque requête. | `schema/spaces.ts` ; `merchants.service.ts` ; `spaces.service.ts` ; `auth.guard.ts` |
| Livreurs | Tables `courier_accounts` (types `independent`, `freelance`, `employed`) et `courier_shop_partnerships` (dont `can_collect_article_payment`), créées au lot 0, **jamais lues ni écrites** par le code. Espace livreur prévu, utilisable seulement avec un compte `active`. | `schema/spaces.ts` ; `spaces.service.ts` |
| Réglages | `app_settings` avec statut de décision ; modification réservée à la permission `settings.write` (`super_admin`), **journalisée avec valeur avant et après**. | `admin.service.ts` ; `admin/permissions.ts` |
| Journal d'audit | En écriture seule, garanti par un déclencheur de la base (T-010). | `audit` |
| Âges | `age.min_registration` = 16 (provisoire) ; `age.min_coins_purchase` et `age.min_coins_withdrawal` = 18 (provisoires) ; `age.min_other_payments`, `age.min_merchant`, `age.min_courier` = **non fixés** (ouverture de boutique fermée d'ici là). Messagerie : un moins de 18 ans ne reçoit pas de message d'un compte qu'il ne suit pas (6-A). | migration des réglages ; `messaging.service.ts` |
| Messagerie des boutiques | Conversations client ↔ boutique (6-B), types de message extensibles, texte neutre pour un type inconnu. | `schema/messaging.ts` |
| Notifications | Centre de notifications lu dans les sources (T-028). **Notifications sur le téléphone désactivées** (`PUSH_PROVIDER=none`). **SMS réels absents** (`console`, `test`, `none`). | `config.ts` ; `delivery.service.ts` |
| Paiement | **Aucun prestataire**, aucune interface ; numéro Mobile Money des boutiques confirmé par code (preuve de possession du numéro, pas d'une transaction). | `docs/EXTERNAL_SERVICES.md` |
| Positions, distances, durées de trajet, zones | **Absentes**. Les boutiques ont une ville et une commune ; les personnes une ville. | `schema/spaces.ts`, `profiles` |
| Tâches planifiées | Worker chaque minute, sans chevauchement (modèle réutilisable pour délais et expirations). | `reminder-runner.ts` |

---

## 2. Règles de sécurité permanentes (toujours applicables)

- **[APPROUVÉ, F3 bis, L7-02]** Seuls les livreurs **employés de la boutique concernée** peuvent recevoir le paiement de
  l'article en espèces, pour le compte de cette boutique et selon les permissions prévues. Les **freelances
  (partenaires ou indépendants) jamais**, même avec l'accord du client. Contrôle côté serveur. **Le champ
  `can_collect_article_payment` n'est jamais utilisé comme autorisation d'espèces.**
- **[APPROUVÉ]** BIM ne détient ni ne collecte les fonds commerciaux (F4) ; il enregistre.
- **[APPROUVÉ]** Prix de l'article et frais de livraison toujours distincts (Q39, F2).
- **[APPROUVÉ]** Séparation des modules et des statuts : commandes, livraisons, paiements, évaluations, incidents.
- **[APPROUVÉ]** Aucune confirmation de paiement sur la seule base d'une notification, d'une déclaration du client ou
  d'une capture d'écran ; le silence du marchand ne vaut jamais confirmation.
- **[APPROUVÉ]** Le client ne choisit jamais le livreur ; un livreur n'impose jamais un tarif après confirmation.
- **[APPROUVÉ]** Les notifications informent ; la source de vérité est l'état enregistré par le serveur.
- **[APPROUVÉ]** Historique horodaté non réécrit ; actions sensibles attribuées à leur auteur.
- **[PROPOSÉ]** Toute transition passe par un service unique : mise à jour conditionnelle
  (`… WHERE statut = attendu RETURNING`), verrou de la commande, clé anti-doublon pour les créations ; une requête
  tardive ou répétée reste sans effet.

---

## 3. Parcours complet d'une commande [APPROUVÉ, A1, sauf mention]

> **Réalisé en 7-B** (§3.1, §3.2, §3.11, §4 pour la commande) : module unique (`orders`, `order_items` figées,
> `order_events` en écriture seule, `order_handover_codes`), BimShop (la boutique confirme) et proposition dans la
> conversation (carte, vaut confirmation de la boutique, prix négocié à la baisse seulement, fiche non publiée
> possible), récapitulatif calculé par le serveur et montant attendu vérifié (`PRICE_CHANGED`), clé anti-doublon,
> stock retiré à la confirmation (`sale`) et remis à l'annulation (`return`), code de remise à 4 chiffres chiffré,
> empreinte comparée à temps constant, 5 essais, usage unique, retrait en boutique, expiration (worker et à la
> lecture), annulation avec auteur et statut, notifications dans l'app, « Mes commandes », « Commandes reçues ».
> Choix de réalisation (L7-05) : âge = réglage `age.min_other_payments` (non décidé : commandes fermées) ; espèces au
> retrait seulement ; client annule jusqu'à « confirmée » ; retrait en boutique toujours proposé. Livraison (7-F) et
> paiement (7-C) non couverts.

### 3.1 Avant la confirmation

1. **Choix de l'article** : depuis le BimShop (« Commander ») ou dans une proposition du marchand faite dans la
   conversation de boutique (6-B). Chaque ligne désigne un article ou une prestation **par sa référence BIM** (§10).
2. **Mode de livraison** choisi par le client : rapide (si réellement disponible), économique (2 jours au plus, si la
   promesse est tenable), retrait en boutique (si proposé) (L7-01).
3. **Affichage avant confirmation** : prix de chaque ligne, frais de livraison calculés par la grille (§7), règle
   d'attente acceptée (§7.3), délai estimé, moyen de paiement prévu, statut de la boutique, modalités de contestation.
4. **Confirmation par le client.** [PROPOSÉ] Pour une commande du BimShop, la boutique confirme ensuite ; pour une
   proposition faite dans la conversation, la proposition vaut confirmation de la boutique.

### 3.2 Étape 1 — Commande confirmée

- Le serveur **génère un code de remise à 4 chiffres**, **visible uniquement par le client**, **lié à cette commande
  seulement**, **non réutilisable**, tentatives incorrectes **limitées** ; le code **n'est pas une preuve de paiement**.
- [PROPOSÉ, technique] Le code n'apparaît jamais dans les journaux ; il est stocké chiffré (affichage au client) avec
  une empreinte pour la vérification, comparé en temps constant ; **5 essais faux** bloquent le code (support).
- Copie figée des lignes, du mode, des frais, de la grille tarifaire appliquée (version) et des conditions.

### 3.3 Préparation et attribution (§8)

Le marchand (ou un employé autorisé, §11) prépare, puis **sélectionne un livreur éligible** ; le serveur enregistre
le livreur, l'auteur et l'heure. Le livreur accepte la mission (délai §12).

### 3.4 Étape 2 — Arrivée

« **Je suis arrivé** » : heure enregistrée par le serveur, **début du décompte d'attente** (§7.3), notification au
client. Le client **examine l'article** avant d'accepter la réception.

### 3.5 Étape 3 — Acceptation ou refus

- **Acceptation** : le client communique son code ; le livreur le saisit ; le serveur le vérifie. Code correct →
  événement « code validé » (une seule fois) et **le bouton de paiement apparaît chez le client**, selon le mode prévu.
- **Refus** : le client doit **choisir un motif** — article incorrect, article endommagé, article incomplet, autre —
  avec **précision obligatoire pour « autre »** [PROPOSÉ : facultative pour les autres motifs]. Le motif est enregistré
  dans l'historique ; le refus ouvre un **incident** (§9) ; la commande **n'est jamais enregistrée comme livrée** ;
  **aucune pénalité automatique**. Après un refus, la **clôture normale est impossible**.
- [PROPOSÉ] Si le client n'a pas son téléphone, le livreur peut enregistrer le refus **au nom du client**, avec le
  motif ; l'événement indique l'auteur réel (le livreur) et le client peut le contester.

### 3.6 Étape 4 — Paiement électronique

- Le bouton de paiement n'apparaît **qu'après validation du code**.
- [NON VÉRIFIÉ] **Aucun prestataire n'est intégré** : le « paiement » consiste à afficher au client le **montant** et le
  **numéro Mobile Money confirmé de la boutique**, puis à enregistrer sa **déclaration** « J'ai payé » (avec la
  référence de transaction qu'il saisit, facultative). L'app **ne déclenche aucun transfert** et n'affiche jamais
  « confirmé » à ce stade.
- Quand un prestataire sera intégré (lot 8, sur accord), **seul un retour technique fiable du prestataire** permettra
  le statut « confirmé par le prestataire ».
- Le livreur **voit l'état du paiement** dans son application avant de clôturer.

### 3.7 Étape 5 — Paiement en espèces (livreur employé uniquement)

Le client remet l'argent ; le livreur employé **vérifie visuellement** le montant attendu et l'enregistre (« Espèces
reçues : X F ») ; puis il clôture. Le serveur refuse cette action à tout livreur qui n'a pas, **au moment de l'action
et dans la même opération en base**, un emploi actif auprès de la boutique de la commande.

### 3.8 Étape 6 — Clôture de la livraison (obligatoire)

Le livreur appuie sur « **Clôturer la livraison** ». Le serveur vérifie :

- livraison attribuée **à ce livreur**, acceptée, non annulée, sans refus ni incident ouvert ;
- arrivée enregistrée et **code validé** ;
- paiement de l'article : **constaté visuellement** (espèces, livreur employé) **ou déclaré par le client** (Mobile
  Money) **ou** confirmé par le prestataire (futur) ; pour un freelance, jamais d'espèces ;
- frais de livraison : selon §6 (mode de règlement à arbitrer pour les freelances).

Puis il enregistre l'**identité du livreur**, la **date et l'heure**, met la livraison à « clôturée par le livreur » et
la commande à « livrée », et notifie le marchand. La clôture est la **déclaration du livreur** qu'il a remis l'article
et fait ses vérifications ; elle **ne prétend pas** qu'un transfert électronique a été vérifié.

### 3.9 Étape 7 — Marchand

Notification « colis livré » (information seulement ; l'état reste consultable dans l'app). Le marchand **confirme ou
conteste** le paiement ; chaque décision est enregistrée avec son auteur et l'heure. **Sans décision**, le paiement
reste « à confirmer par la boutique » ; [PROPOSÉ] rappel au marchand puis file « à vérifier » du support après
**3 jours** (réglable), **jamais de confirmation implicite**.

### 3.10 Fin de commande

[PROPOSÉ] Commande « **terminée** » quand : livraison clôturée par le livreur **et** paiement de l'article confirmé par
la boutique (ou par le prestataire, plus tard) **et** aucun incident ouvert. Sinon : « livrée — paiement à confirmer »,
« paiement contesté » ou « incident ».

### 3.11 Retrait en boutique

[PROPOSÉ] Même logique sans livreur : le client présente son code au comptoir, la boutique le saisit, le client paie
(espèces reçues par la boutique ou Mobile Money déclaré), la boutique clôture la remise.

---

## 4. Cycles de vie distincts

Chaque objet a son statut et son historique propres ; aucune transition de l'un ne modifie silencieusement un autre.

**Commande** [PROPOSÉ] : `proposée` (conversation) · `en attente de la boutique` (BimShop) → `confirmée` → `en
préparation` → `livraison demandée` → `en livraison` → `livrée` → `terminée`. Sorties : `refusée`, `expirée`,
`annulée`, `incident`, `litige`. Une commande `annulée` ou `terminée` n'accepte plus aucune action de livraison ou de
paiement (hors remboursement déclaré, si une règle le prévoit un jour).

**Livraison** [PROPOSÉ] : `à attribuer` → `attribuée` (livreur, auteur, heure) → `acceptée` → `colis pris en charge` →
`en route` (si disponible) → `livreur arrivé` → `code validé` → `clôturée par le livreur`. Sorties : `refusée par le
client` (motif), `client absent`, `abandonnée`, `réattribution`, `retour en boutique`, `annulée`. **Une seule
attribution active** (index unique).

**Code de remise** [APPROUVÉ pour la création, l'unicité et la limite d'essais] : `créé` → `validé` (une fois) ;
`bloqué` (essais épuisés) ; `annulé` (commande annulée) ; `recréé` par le support seulement (journalisé).

**Paiement** : §5.

---

## 5. États du paiement [APPROUVÉ dans le principe, A1 étapes 4 à 7]

> **Réalisé en 7-C pour le paiement de l'article au retrait en boutique** : registre `order_payments` (cinq
> informations en colonnes distinctes ; « confirmé par le prestataire » impossible par contrainte de la base ; aucune
> suppression), « J'ai payé » après la remise avec le numéro Mobile Money confirmé de la boutique, espèces constatées au
> comptoir au montant attendu, décision de la boutique (permission `payments.decide`), commande « terminée » à la
> confirmation, contestation avec motif, rappel et file « à vérifier » après `payments.shop_decision_reminder_days`
> (3 j, provisoire), page d'administration « Paiements à vérifier » (`payments.review`, consultation journalisée).
> Frais de livraison et espèces reçues par un livreur employé : avec 7-F.

Deux paiements par commande livrée : **l'article** et **les frais de livraison**. Chacun porte **cinq informations
distinctes, jamais fusionnées** (champs et événements séparés, pas un statut unique) :

| Information | Qui la produit | Valeurs | Remarques |
| --- | --- | --- | --- |
| 1. Déclaration du client | Le client (après code validé) | non déclaré · déclaré (heure, référence saisie facultative) | Jamais présentée comme une confirmation |
| 2. Constat visuel du livreur | Livreur **employé** de la boutique, espèces seulement | non constaté · espèces reçues (montant, heure) | Refusé à tout freelance |
| 3. Confirmation technique | Prestataire, par retour vérifié | non disponible · confirmé (référence prestataire) | **Toujours « non disponible » tant qu'aucun prestataire n'est intégré** [NON VÉRIFIÉ] |
| 4. Décision du bénéficiaire | Boutique (article) ; boutique ou livreur selon §6 (frais) | en attente · confirmé · contesté (motif) | Auteur et heure ; le silence n'est jamais une confirmation |
| 5. Échec ou annulation | Client, boutique, support | aucun · échoué · annulé | Ouvre un incident si la livraison est en cours |

Un paiement appartient à **une seule commande** (contrainte de la base). Le statut affiché est **calculé** à partir de
ces cinq informations, avec des libellés honnêtes (« déclaré par le client », « espèces reçues par le livreur »,
« confirmé par la boutique », « contesté par la boutique »).

**Paiement avant livraison** [APPROUVÉ, A7] : **ni développé ni activé** tant que les règles de remboursement,
d'annulation, de litige et de responsabilité ne sont pas définies **et** qu'un mécanisme de paiement n'est pas
réellement opérationnel. Une interface de paiement ne suffit pas.

---

## 6. Rémunération des livreurs et frais de livraison [APPROUVÉ, A3, sauf mention]

| | Livreur employé de la boutique | Livreur indépendant ou partenaire (freelance) |
| --- | --- | --- |
| Frais de livraison | **Attribués à la boutique** (tranche C2) ; la boutique rémunère son employé selon son organisation | Rémunération selon **les règles de son partenariat** ; mode de règlement **défini et traçable** |
| Article | Espèces possibles **pour le compte de la boutique**, selon les permissions | **Jamais d'espèces** ; Mobile Money au numéro de la boutique |
| Automatisation | Aucune | **Aucun paiement Mobile Money automatisé** sans intégration réelle |

**Points ouverts** [ARBITRAGE A3-b] :

- Un **indépendant sans partenariat** n'a pas de « règles de partenariat » : quelle règle de rémunération lui
  appliquer (la grille BIM du §7 ?) ?
- **Qui paie le freelance et comment** : le client directement (Mobile Money au livreur, déclaré par le client,
  confirmé par le livreur) ou la boutique selon l'accord de partenariat ? Dans le second cas, les frais payés par le
  client reviennent-ils à la boutique ?
- Le **prix payé par le client** (grille BIM, §7) peut-il différer de la **rémunération du livreur** (accord de
  partenariat) ? Si oui, qui garde l'écart ? BIM ne détient aucun fonds : l'écart ne peut transiter par BIM.

---

## 7. Tarification des livraisons [APPROUVÉ dans le principe, A2 ; **réalisé en 7-D** selon les propositions A2-b et A2-c]

> Réalisé (7-D) : référentiel des communes (code `ville-commune`), table des durées par mode, grilles versionnées
> (brouillon → publiée, immuable par déclencheur), permission `delivery_tariffs.write` (rôle principal), lecture
> `delivery_tariffs.read`, journal avant / après, devis public `GET /v1/shops/:id/delivery-quote?commune=`, écran
> d'administration « Tarifs de livraison ». La commune de la boutique est déduite de sa ville et de sa commune.
> Attente : réglage `delivery.wait_fees_enabled` = false (A2-c, provisoire).

**Principe** : une grille configurable **inspirée** de la tarification au temps des services de course (durée du
trajet, temps d'attente, mode). **BIM ne connaît pas et ne reproduit pas l'algorithme interne de Yango.**

### 7.1 Formule [PROPOSÉ]

```
frais = arrondi_supérieur( max( minimum_mode ,
          prise_en_charge_mode + prix_minute_mode × durée_estimée_minutes ) , pas_d_arrondi )
      + frais d'attente éventuels (§7.3, selon la règle acceptée à la confirmation)
```

- Paramètres **par mode** (rapide, économique) : prise en charge, prix par minute, minimum, pas d'arrondi
  (ex. 25 F), plafond d'attente. **Aucune valeur fixée dans le code.**
- **Grilles versionnées** : chaque version publiée est **immuable**, datée, attribuée à l'administrateur qui l'a
  publiée (journal d'audit) ; une nouvelle version ne s'applique qu'aux commandes confirmées après sa publication.
- [PROPOSÉ] Permission d'administration dédiée `delivery_tariffs.write` (réservée au rôle principal, comme
  `settings.write`), avec valeurs avant et après dans le journal.
- **À la confirmation** : la version de grille, la durée estimée, le détail du calcul et le montant sont copiés dans la
  commande ; **aucun supplément arbitraire ensuite** ; toute hausse exige le **consentement explicite** du client.

### 7.2 Durée estimée du trajet [NON VÉRIFIÉ]

BIM **ne calcule aujourd'hui ni distance, ni durée, ni position**, et n'a pas d'adresse de livraison. [PROPOSÉ] Sans
service externe : une **table des durées estimées entre communes** (commune de la boutique → commune de livraison, par
mode), saisie et tenue à jour par BIM dans l'administration ; une commune absente de la table rend la livraison
indisponible (pas d'estimation inventée). Un service de calcul d'itinéraire plus précis serait un **service externe**
à autoriser. [ARBITRAGE A2-b] : qui saisit la table, avec quelles valeurs de départ.

### 7.3 Temps d'attente [PROPOSÉ]

- **Début** : heure serveur de « Je suis arrivé ».
- **Attente gratuite** : oui, durée de la grille (ex. 5 min).
- **Au-delà** : prix par minute d'attente de la grille, **plafonné** (le plafond ne dépasse pas le délai de « client
  absent », §12).
- **Fin** : validation du code, refus enregistré, déclaration « client absent », annulation ou ouverture d'un incident.
- Les frais d'attente ne sont **pas un supplément arbitraire** : leur règle est affichée et acceptée **avant** la
  confirmation ; leur montant est calculé par le serveur et affiché au client.
- **Retards du livreur** : aucune incidence sur le client ; l'attente ne court que depuis l'arrivée déclarée.
- **Incidents** : l'attente s'arrête à l'ouverture de l'incident.
- [NON VÉRIFIÉ] L'arrivée est **déclarative** (pas de position) : un livreur pourrait déclarer son arrivée trop tôt.
  [PROPOSÉ] Le client peut signaler « le livreur n'est pas là » ; l'attente facturable est alors suspendue et un
  incident est ouvert. [ARBITRAGE A2-c] : facturer l'attente dès le lancement, ou l'enregistrer seulement (frais nuls)
  tant que l'arrivée n'est pas vérifiable.

### 7.4 Rapide et économique

| | Rapide | Économique |
| --- | --- | --- |
| Promesse | Proposée seulement si un livreur éligible est disponible pour tenir le délai | Délai maximal 2 jours, proposée seulement si un partenaire éligible a une capacité déclarée dans ce délai |
| Tarif | Grille du mode rapide | Grille du mode économique ; tarif réduit selon les accords (A3-b) |
| Organisation | Course immédiate | Un partenaire peut regrouper des livraisons compatibles sans dépasser le délai de chacune |

---

## 8. Priorité et sélection des livreurs [APPROUVÉ, A4 et A5 ; **tranché par L7-06, réalisé en 7-F**]

> **L7-06 (16/10/2026, 22 h 27)** : le marchand déclenche la recherche et sollicite un livreur parmi les éligibles
> calculés par le serveur (employés, puis partenaires, puis indépendants) ; le livreur sollicité accepte ou refuse dans
> le délai ; sinon la recherche continue. Réalisation : tables `deliveries`, `delivery_offers` (une sollicitation en
> cours par livraison), `delivery_events` ; routes livreur `/v1/courier/missions`, `/v1/courier/courses` ; aucune liste
> publique d'annonces.

- Le **marchand choisit** le livreur parmi les **livreurs éligibles calculés par le serveur** (mode, disponibilité,
  capacité, délai, autorisations, sécurité). Le serveur contrôle l'éligibilité et les permissions à la sélection.
- **Rapide** : partenaires **toujours prioritaires** sur les indépendants, compte tenu de la disponibilité et de
  l'éligibilité ; aucun délai annoncé qu'aucun livreur disponible ne peut tenir.
- **Économique** : partenaires prioritaires ; si un partenaire éligible est disponible et que le marchand en choisit un
  autre, **un motif est obligatoire** et enregistré. L'exception ne lève **aucune** règle de sécurité ni restriction
  d'espèces.
- **Livreur employé de la boutique** [ARBITRAGE A4-b] : les arbitrages ne le placent pas. [PROPOSÉ] Sélectionnable dans
  les deux modes, **avant** les partenaires (il travaille pour la boutique) ; sa sélection ne demande pas de motif.
- **Priorité Premium des livreurs (F17)** : seulement à l'intérieur d'une même catégorie [PROPOSÉ].
- **Retirés** : client choisissant un livreur ; devis libre d'un livreur après confirmation ; paliers automatiques.

### 8 bis. Accès des livreurs [APPROUVÉ, L7-04 ; **verrouillé** côté serveur ; comptes réalisés en 7-E]

> **7-E réalisé** : demande de compte livreur (pièces chiffrées, lecture journalisée, âge `age.min_courier` — non
> décidé = fermé), vérification par l'administration (`couriers.review`), espace livreur limité à
> `/v1/courier/*` (profil : disponibilité, capacité, moyen de transport, communes ; relations), toutes les autres
> routes sans espace imposé fermées depuis l'espace livreur sauf compte (`/v1/auth`, `/v1/me`) et support
> (`/v1/reports`) — le constat ci-dessous est corrigé ; relations emploi / partenariat proposées par la boutique
> (permission « paramètres de livraison ») et acceptées par le livreur, au plus un emploi actif (contrainte de la
> base), fin immédiate ; catégorie et droit aux espèces déduits de la relation **active** seulement.

- Le livreur ne voit **jamais** les commandes internes d'une boutique (commandes générales, non publiées, détails
  internes, équipe, messages, catalogue).
- Il voit seulement : (1) les **annonces de livraison publiées** — le marchand valide une commande puis publie une
  annonce ; (2) après **acceptation**, les informations nécessaires à la course (adresses de retrait et de remise,
  contact utile, articles à remettre, code de remise côté client seulement) ; (3) **son historique personnel** — les
  seules livraisons qu'il a effectuées.
- **Séparation des données** [PROPOSÉ pour 7-E / 7-F] : table des annonces (`delivery_announcements`) et table des
  courses (`deliveries`, liée à la commande par identifiant, jamais exposée par les routes des commandes) ; routes
  livreur dédiées (`/v1/courier/announcements`, `/v1/courier/deliveries/:id`, `/v1/courier/history`) sous l'espace
  `courier`, filtrées par le serveur sur `courier_id = livreur courant` ; minimisation (pas de prix des articles, pas
  d'historique client, adresse exacte seulement après acceptation).
- **État actuel** : aucune route n'est ouverte à l'espace livreur ; toutes les routes `/v1/shop…` exigent l'espace
  boutique ; un livreur actif, même partenaire, reçoit 403 (test `courier-access`). Constat : les routes sans espace
  imposé (fil social, profils, notifications) restent accessibles depuis l'espace livreur, contrairement à l'analyse
  (§5 : pas de fil ni de profil pour un livreur) ; à fermer avec 7-E.
- **[ARBITRAGE] Contradiction avec §8 (A4 / A5)** : « le marchand choisit le livreur » contre « le livreur accepte une
  annonce publiée ». Proposition : l'annonce est proposée d'abord aux livreurs employés, puis aux partenaires (en
  économique, passer aux indépendants demande un motif), enfin aux indépendants ; le premier livreur éligible qui
  accepte est attribué ; le marchand peut aussi réserver l'annonce à un livreur précis. Rien ne sera développé avant
  l'arbitrage.

---

## 9. Incidents [APPROUVÉ : principes A1, A8 ; PROPOSÉ : tableau ; **socle réalisé en 7-G**]

> **7-G réalisé** : tables `incidents` et `incident_events` (écriture seule), motifs par partie, description, suivi
> ouvert → au support → résolu, page d'administration journalisée (`incidents.review`). Réalisé du tableau ci-dessous :
> refus de l'article (motif, incident, code et clôture bloqués), client absent (après le délai), code bloqué (7-B).
> **Désistement réalisé (17/10)** : avant la prise en charge, le livreur rend la course avec un motif
> (`POST /v1/courier/courses/:id/release`) ; la livraison revient en recherche, même mode, même prix ; il n'est plus
> proposé pour cette livraison ; aucune pénalité ; historique `released` / `courier_released` et audit. Après la prise
> en charge : refusé (409), il faut signaler un incident.
> Non réalisé : statuts de commande « incident » / « litige », réattribution après prise en charge, retour en boutique, pièces jointes
> (stockage et conservation des preuves à décider) ; aucun effet financier automatique.

Aucun frais d'annulation, remboursement ou pénalité automatique sans règle commerciale explicite (A8). Chaque incident
enregistre : auteur, heure, motif, **état de la livraison au moment de l'incident**, pièces éventuelles. Le support agit
avec une permission dédiée, chaque consultation est journalisée.

| Incident | Déclaré par | Statuts appliqués | Notifiés | Reste possible | Bloqué |
| --- | --- | --- | --- | --- | --- |
| Refus de l'article (motif obligatoire) | Client (ou livreur pour lui, §3.5) | Livraison `refusée par le client` ; commande `incident` | Boutique, livreur | Retour en boutique ; nouvelle proposition avec accord du client | Code, paiement, clôture normale |
| Colis endommagé | Client ou livreur | Commande `incident` | Les trois | Refus motivé ou acceptation avec réserve enregistrée | Clôture automatique |
| Client absent | Livreur, après le délai d'attente (§12) | Livraison `client absent` ; commande `incident` | Client, boutique | Nouvelle tentative convenue ; retour | Code, clôture |
| Livreur pas arrivé malgré « Je suis arrivé » | Client | Attente suspendue ; commande `incident` | Livreur, boutique, support | Reprise après vérification | Frais d'attente |
| Paiement déclaré non retrouvé | Boutique (contestation) | Paiement `contesté` ; commande `paiement contesté` | Client, livreur, support | Pièces des deux parties ; nouvelle décision de la boutique | Passage à `terminée` |
| Preuve non vérifiable par le livreur | Livreur | Paiement reste `déclaré` | Boutique | Clôture si les conditions §3.8 sont remplies ; décision de la boutique | Toute mention « confirmé » |
| Paiement échoué | Client ou boutique | Paiement `échoué` | Les trois | Nouveau paiement ; retour | Clôture « payée » |
| Livreur ne peut pas terminer / abandonne | Livreur ou système (délai) | Livraison `abandonnée` → `réattribution` ou `retour` | Marchand, client | Nouvelle sélection, même mode et même prix | Hausse sans accord du client |
| Boutique sans réponse | Système (délai §12) | Paiement « à confirmer » ; file `à vérifier` | Boutique, support | Décision tardive de la boutique ; support | Confirmation implicite |
| Annulation, livreur en route | Client ou boutique selon les règles | Commande `annulée` (auteur, heure, état de la livraison figé) ; livraison `retour en boutique` | Livreur, autre partie | Retour du colis | Code, clôture, paiement ; frais d'annulation (politique financière **à finaliser**, A8) |
| Code incorrect ou refusé | Système (essais) ou livreur | Code `bloqué` après 5 essais ; commande `incident` | Client, support | Recréation par le support | Clôture sans code |
| Contestation après livraison | Client ou boutique, dans le délai (§12) | Commande `litige` | L'autre partie, support | Échanges, pièces, décision du support enregistrée | Modification de l'historique |

---

## 10. Références des articles et prestations [APPROUVÉ : règles 1 à 7 ; PROPOSÉ : réalisation]

**Constat** : un identifiant interne stable existe (`products.id`, uuid), mais **aucune référence publique**. Les
articles ne sont jamais supprimés (archivage) et les variantes jamais effacées : une référence ne risque donc pas d'être
réattribuée par suppression. **Aucune commande ni évaluation n'existe encore** : la référence peut être introduite sans
reprise de données commerciales.

**Format proposé** : `BIM-000001`, `BIM-000002`… (6 chiffres minimum, 7 et plus au-delà de 999 999, jamais de remise à
zéro). Un seul compteur pour les articles et les prestations (le type reste un champ distinct).

**Réalisation (7-A, migration 0027 appliquée)** :

- séquence PostgreSQL dédiée ; colonne `products.reference` **unique, non nulle**, remplie par la base à la création
  (`'BIM-' || lpad(nextval(...)::text, 6, '0')`) — jamais fournie par l'app ni par le marchand ;
- **reprise des articles existants** dans l'ordre de création (`created_at`, `id`) ;
- **déclencheur interdisant toute modification** de la référence ;
- les numéros consommés par une transaction annulée ne sont pas réutilisés (trous possibles, acceptés).
- **A13 tranché** : référence attribuée **à la création**, brouillons compris (L7-03).

**Usages** : affichée au marchand (liste, fiche), sur la fiche publique, dans le bandeau de conversation, dans les
lignes de commande, l'historique, les évaluations et l'administration ; **recherche exacte** par référence pour le
marchand qui prépare une commande. Ajout dans les contrats API (champ supplémentaire, rétrocompatible).

**Lignes de commande** : une ligne par article ; chaque ligne garde l'identifiant interne, la **référence**, le titre,
le type, la variante (identifiant et libellé), la quantité, le **prix du catalogue au moment** et le **prix appliqué**,
et une **copie de la photo principale** (l'archivage efface les photos du stockage). Une modification ultérieure de la
fiche ne change pas la ligne.

**Contradiction** [ARBITRAGE A14] : l'étude du 16/10 (matin) prévoyait des **articles hors catalogue** dans les
propositions de la messagerie (photo envoyée par le client, article vu dans un live). Ils n'ont **pas de référence**.
[PROPOSÉ] Toute ligne doit avoir une référence : le marchand crée d'abord une fiche (éventuellement non publiée dans le
BimShop) ; cela garde le rattachement des évaluations et la traçabilité.

**Prix négocié** [ARBITRAGE A15] : écart autorisé entre prix du catalogue et prix appliqué (libre, plafonné, interdit
au-dessus du prix catalogue ?).

---

### 10 bis. Fiches figées, promotion, réputation et masquage [APPROUVÉ, L7-04 (remplace la remise à zéro de L7-03) ; **réalisé**]

- **Après la création** : nom, description et **prix normal** ne se modifient plus (brouillon compris ; refus
  `PRODUCT_CONTENT_LOCKED` et déclencheur de la base). Les changer = **nouvelle fiche** : nouvelle référence, réputation
  vierge. Rubrique, durée et variantes (ajout, retrait, renommage) : jusqu'à la première publication [interprétation à
  confirmer] ; l'ordre des variantes et le stock restent libres.
- **Modifiables sans effet sur la réputation** : photos, **promotion** (`promo_price_fcfa`, inférieure au prix normal ;
  activer, modifier, supprimer ; journalisée), stock, masquage, republication.
- **Prix affichés** : `priceFcfa` = prix payé (promotion sinon prix normal), `compareAtFcfa` = prix normal barré si une
  promotion est active ; l'espace boutique reçoit aussi `normalPriceFcfa` et `promoPriceFcfa`.
- Conséquence pour 7-B : la ligne de commande enregistre référence, version et **prix payé** au moment de la commande.

Historique 7-A (remplacé) :

- **Version du contenu** (`products.content_version`) : une modification confirmée du contenu d'une fiche déjà publiée
  l'incrémente ; la réputation active ne compte que ce qui a été donné à la version courante (cœurs aujourd'hui ;
  j'aime, commentaires, recommandations et avis plus tard). Avertissement obligatoire : sans confirmation, le serveur
  refuse (`REPUTATION_RESET_REQUIRED`) et n'enregistre rien. Historique : `product_revisions` (champs, contenu
  précédent, auteur, date) et journal d'audit.
- **Ne changent pas la version** : photo seule, masquage, republication, stock, ordre des variantes. Modifier une photo
  et un autre élément dans la même opération suit la règle générale.
- **Brouillon jamais publié** : modifications libres (aucune réputation possible).
- **Masquer / republier** : statut `hidden` (« Visible par moi uniquement ») ; invisible du BimShop, référence et
  réputation conservées.
- **Fiches créées pour une commande** [PROPOSÉ] : fiches ordinaires (§10, L7-03).
- **Conséquences pour 7-B et 7-H** : chaque ligne de commande enregistre la référence **et** la version du contenu ;
  chaque avis aussi, pour ne jamais présenter l'avis d'une ancienne version comme concernant la nouvelle.
- **Limites connues (7-A)** : le nombre de cœurs de la version qui se termine est conservé dans l'historique ; les
  lignes individuelles restent en base mais changent si la personne remet son cœur (nouvelle version) ou le retire.
  L'historique des modifications empêche de supprimer un article (aucune suppression n'existe ; à prévoir si une
  purge des boutiques est un jour décidée).

## 11. Permissions de l'équipe d'une boutique [APPROUVÉ, A9]

**Réalisé en 7-A** : permissions séparées (table `shop_member_permissions`), invitation acceptée par la personne,
garde serveur `RequireShopPermission` revérifiée à chaque requête, journal avant / après. Catalogue : créer et
modifier (`products.edit`), publier et retirer (`products.publish`), masquer ou republier (`products.visibility`) ;
boîte de la boutique : `messages.reply` ; présentation, logo, équipe, demandes et offres de projet : propriétaire.
Les permissions de commandes, livraisons et paiements existent et seront contrôlées par leurs sous-lots. Republier un article masqué exige « masquer ou republier », y compris par l'ancienne route de
publication. Retirer définitivement un article (photos effacées) relève de « publier et retirer ». **Lecture** : tout
employé ayant accepté l'invitation voit la boutique et son catalogue (brouillons et articles masqués compris), sans
pouvoir rien modifier ; aucune permission de lecture distincte n'a été demandée [à confirmer].

- Un employé ne reçoit **aucun droit du propriétaire par défaut** ; le propriétaire accorde chaque permission ; contrôle
  côté serveur ; actions sensibles attribuées et horodatées.
- **Permissions distinctes** : consulter les commandes · préparer une commande · sélectionner un livreur · modifier les
  paramètres de livraison · confirmer ou contester un paiement.
- [PROPOSÉ] Permissions réservées au propriétaire : gérer l'équipe et ses permissions ; numéro Mobile Money ; relations
  d'emploi et de partenariat avec les livreurs ; confirmer la remise d'espèces par un livreur employé.
- [PROPOSÉ, technique] Table des permissions par membre (une ligne par permission accordée, auteur et date), journal
  d'audit à chaque changement ; écran et service d'ajout d'employés (**inexistants aujourd'hui**).
- **Cohérence avec l'existant** [ARBITRAGE A16] : aujourd'hui un membre `staff` (créé seulement en test, aucun écran
  ne permet d'en ajouter) a accès au catalogue, aux offres et à la boîte de messages (6-B) sans permission détaillée.
  [PROPOSÉ] Étendre le même modèle (gérer le catalogue, répondre aux messages, envoyer des offres) au moment où l'ajout
  d'employés sera ouvert ; aucun lot validé n'est rouvert d'ici là.

---

## 12. Délais [PROPOSÉ, A10 : valeurs initiales à vérifier]

Tous réglables dans `app_settings` (modification réservée à `settings.write`, journalisée avant / après, statut
« provisoire ») ; lus par le worker minute par minute (précision d'une minute).

| Réglage proposé | Valeur initiale | Rôle | Cohérence |
| --- | --- | --- | --- |
| `deliveries.mission_accept_minutes` | 5 min | Délai pour qu'un livreur accepte la mission choisie par le marchand ; sinon le marchand en choisit un autre | [NON VÉRIFIÉ] Sans notifications sur le téléphone, 5 min n'est réaliste que si le livreur a l'app ouverte |
| `deliveries.client_absent_after_minutes` | 15 min | Après « Je suis arrivé », le livreur peut déclarer « client absent » | Doit être ≥ attente gratuite + plafond d'attente facturable |
| `orders.dispute_window_days` | 7 jours | Contestation après livraison | — |
| `orders.proposal_ttl_hours` | 24 h | Expiration d'une **proposition de commande** du marchand (messagerie) | **Pas de système d'offres de livraison** : il n'est pas retenu |
| `payments.shop_decision_reminder_days` | 3 jours (nouveau) | Rappel, puis file « à vérifier » si la boutique ne décide pas | Jamais de confirmation implicite |

---

## 13. Statut Gold, étoiles, évaluations [APPROUVÉ : distinctions A6 ; ARBITRAGE : règles]

- **Abonnement Premium d'un utilisateur** : **aucune certification administrative** (A6).
- **Statut Gold d'un marchand** et **étoiles / évaluations** : notions distinctes ; Gold **jamais attribué
  automatiquement par un abonnement** sauf règle validée plus tard.
- **Contradiction** [ARBITRAGE A17] : `ANALYSE.md` (§5 et §6.6, Q50) indique « l'étoile Gold remplace les 5 étoiles pour
  les marchands Premium » ; cette règle liait Gold à l'abonnement. À confirmer comme **remplacée**.
- **Retiré** : la notion de « boutique Premium certifiée » de la version 1 (scénario B).
- **Évaluations** [PROPOSÉ] : trois objets distincts — **article ou prestation** (rattaché à une ligne de commande, donc
  à sa référence) ; **boutique** (rattachée à la commande) ; **livraison** (rattachée à la livraison, si retenue ; note
  interne du livreur, E11). Éligibilité : commande `terminée` (ou livrée sans contestation en cours) du client lui-même,
  une évaluation par ligne, délai limité ; jamais par un membre de la boutique ni un livreur de la commande ; signalement
  et modération ; une mauvaise livraison ne baisse pas la note de l'article.
- **Réalisé en 7-H (sans livraison)** : évaluation d'un article par ligne de commande (référence et version
  enregistrées) et de la boutique par commande ; client de la commande seulement, après la remise (commande terminée, ou
  remise sans contestation du paiement en cours), dans `reviews.window_days` (30 j, provisoire), une fois, jamais un
  membre de la boutique ; note de 1 à 5 et commentaire, non réécrits (déclencheur), retirables par l'auteur ;
  signalement et modération (masquer, rétablir) ; affichage des avis individuels, **aucune moyenne ni étoiles de
  boutique** (A17). Évaluation de la livraison : avec 7-F.
- **À définir** [ARBITRAGE A17] : critères d'obtention de Gold ; maintien et retrait ; calcul des étoiles (moyenne
  pondérée par le nombre d'avis proposée) ; prévention des avis frauduleux ; prise en compte des commandes contestées.

---

## 14. Données : conservation [PROPOSÉ, A11 ; JURIDIQUE pour toutes les durées]

Principes : accès limité au besoin, traçabilité des consultations sensibles, minimisation, suppression ou anonymisation
quand la durée est atteinte. Cadre à vérifier : loi ivoirienne n° 2013-450 sur la protection des données personnelles
et autorité de régulation (ARTCI) ; obligations de conservation commerciales et comptables (OHADA) applicables aux
marchands et éventuellement à BIM ; règles de preuve en cas de litige.

| Catégorie | Contenu | Proposition (à vérifier) |
| --- | --- | --- |
| Comptes | Identité, coordonnées, préférences | Durée de vie du compte ; à la suppression, anonymisation, sauf éléments rattachés à des commandes ou litiges conservés pour la durée de ces derniers |
| Historique des commandes | Lignes, prix, statuts, événements | Durée longue, liée aux obligations commerciales ; l'hypothèse de 10 ans (documents comptables OHADA) concerne les marchands et **doit être vérifiée** pour BIM |
| Livraison | Adresse et téléphone du client, heures, livreur | Coordonnées visibles du livreur attribué pendant la mission seulement ; **effacées ou anonymisées après le délai de contestation et la clôture des litiges** ; heures et statuts gardés avec la commande |
| Déclarations et preuves de paiement | Déclarations, constats, décisions, références saisies | Avec l'historique de la commande |
| Incidents et contestations | Motifs, pièces, décisions | Jusqu'à la fin du litige, puis délai de prescription à déterminer |
| Journaux de sécurité et d'administration | Audit (T-010), connexions | Durée à fixer ; écriture seule déjà garantie |

Aucune position GPS n'est collectée (fonction inexistante).

---

## 15. Âges [PROPOSÉ, A12 ; JURIDIQUE]

| Fonction | Règle actuelle (code) | Proposition | Contradiction ou conséquence |
| --- | --- | --- | --- |
| Accès à l'application | 16 ans (`age.min_registration`, provisoire) | Inchangé | — |
| Messagerie | Moins de 18 ans : pas de message d'un compte non suivi (6-A) ; 16-17 ans peuvent écrire à une boutique (6-B, à valider) | Inchangé | Une boutique ne doit **jamais envoyer une proposition de commande** à un moins de 18 ans (contrôle serveur) |
| Commande | Non fixé (`age.min_other_payments`) | 18 ans | Les 16-17 ans consultent le BimShop mais ne commandent pas ; bouton « Commander » expliqué |
| Livreur | Non fixé (`age.min_courier`) | 18 ans | — |
| Ouverture de boutique | Non fixé (`age.min_merchant`, ouverture fermée) | 18 ans | Rouvre l'ouverture des boutiques une fois validé |

Les valeurs ne seront modifiées qu'après validation, par l'administration (journalisé), sans migration.

---

## 16. Points ouverts

### 16.1 Arbitrages du fondateur

| N° | Question | Proposition |
| --- | --- | --- |
| A2-b | Table des durées entre communes : qui la saisit, valeurs de départ | Saisie par BIM dans l'administration ; commune absente = livraison indisponible |
| A2-c | Frais d'attente facturés dès le lancement malgré une arrivée déclarative ? | Enregistrer l'attente, frais à 0 F au lancement |
| A3-b | Rémunération et règlement des freelances (indépendants sans partenariat, payeur, écart prix client / rémunération) | Client paie directement le livreur en Mobile Money le montant de la grille ; déclaré par le client, confirmé par le livreur |
| A4-b | Place du livreur employé | Avant les partenaires, sans motif |
| A8 | Politique financière des annulations | À finaliser ; aucun frais au lancement |
| A13 | Référence à la création ou à la publication | À la création |
| A14 | Articles hors catalogue dans les propositions | Fiche obligatoire (éventuellement non publiée) |
| A15 | Prix négocié par rapport au catalogue | Autorisé à la baisse seulement |
| A16 | Permissions des employés pour catalogue, offres et messages | Même modèle, à l'ouverture de l'ajout d'employés |
| A17 | Gold et étoiles : critères, maintien, retrait, calcul, fraude ; Q50 remplacée ? | À rédiger ; Q50 remplacée |
| A18 | « J'ai reçu mon article » : bouton du client encore utile si la validation du code vaut acceptation ? | La validation du code vaut acceptation ; pas de second bouton |
| A19 | Valeurs initiales des délais (§12) | Celles du tableau, provisoires |
| — | 16-17 ans et boutiques (6-B) | Autorisé à écrire, pas à commander |

### 16.2 Vérifications juridiques [JURIDIQUE]

Âges (commande, livreur, boutique) ; durées de conservation ; statut d'intermédiaire de BIM et paiement à la livraison
(BCEAO, déjà prévu) ; encaissement d'espèces par des employés ; valeur probante des déclarations et du code ; règles de
consommation (contestation, remboursement) ; données de livraison (ARTCI).

### 16.3 Dépendances techniques

| Dépendance | État | Effet |
| --- | --- | --- |
| Notifications sur le téléphone | Désactivées, accord requis | Délais d'acceptation et arrivée invisibles hors de l'app ; **condition du lancement** |
| SMS réels | Absents, accord requis | Numéros Mobile Money des boutiques et des livreurs non confirmables en production |
| Prestataire Mobile Money | Absent (lot 8, accord requis) | Pas de « confirmé par le prestataire » ; pas de paiement avant livraison |
| Durée de trajet, position | Absentes | Table des durées par commune ; arrivée déclarative |
| Adresses de livraison | Absentes | À créer (7-B) avec commune obligatoire |
| Ajout d'employés et permissions | Absents | À créer (7-A) |
| Espace livreur, vérification | Espace prévu seulement | À créer (7-E), réutilise le chiffrement des pièces de 5-A |
| Version minimale de l'app | Non imposée | À ajouter avant l'ouverture des commandes |

---

## 17. Découpage du développement (à autoriser)

| Sous-lot | Contenu | Dépend de | Critères d'acceptation |
| --- | --- | --- | --- |
| **7-A Références et équipe** | Référence `BIM-…` (migration additive, reprise, immuabilité) ; ajout d'employés par le propriétaire ; permissions séparées ; version minimale de l'app | A13, A16 | Références uniques sous créations simultanées ; jamais modifiables (déclencheur testé) ; aucun écart après archivage ; affichées partout ; un employé sans permission est refusé sur chaque action (tests par permission) ; journal à chaque changement ; suite existante intacte |
| **7-B Commandes** | Module Commandes unique (BimShop et proposition dans la conversation) ; lignes figées avec référence et photo copiée ; adresses avec commune ; modes et frais affichés avant confirmation ; confirmation, expiration 24 h, annulation (auteur, heure, état) ; code de remise ; stock `sale` / `return` ; carte de commande dans la conversation ; « Mes commandes » / « Commandes reçues » ; retrait en boutique ; notifications dans l'app ; âge 18 si validé | 7-A, 7-D (frais), A14, A15, A12 | Doubles commandes impossibles (clé anti-doublon, envois simultanés) ; survente impossible ; version dépassée refusée ; prix catalogue modifié sans effet ; proposition refusée à un moins de 18 ans ; code visible du seul client, lié à une commande ; requête tardive sur commande annulée sans effet |
| **7-C Paiements** | Registre : article et frais ; cinq informations distinctes ; déclaration du client ; constat visuel par l'employé ; décision de la boutique ; rappels et file « à vérifier » ; interface prestataire « aucun » | 7-B | Freelance refusé pour les espèces (partenaire, indépendant, employé d'une autre boutique, employé révoqué) ; paiement rattaché à une autre commande refusé ; « confirmé par le prestataire » impossible sans prestataire ; silence de la boutique jamais compté comme confirmation ; notification répétée sans double opération |
| **7-D Tarification** | Grilles versionnées par mode ; table des durées par commune ; calcul côté serveur ; attente ; écran d'administration avec permission dédiée | A2-b, A2-c | Aucun montant en dur ; grille publiée immuable ; calcul reproductible et figé dans la commande ; hausse impossible sans consentement ; commune absente = mode indisponible |
| **7-E Livreurs** | Comptes livreurs, vérification (pièces chiffrées), relations emploi / partenariat (acceptées, au plus un emploi actif), disponibilité, capacité, commune ; âge 18 | A12, A3-b, F17 | Catégorie déduite de la relation avec la boutique de la commande, jamais du type du compte ni de `can_collect_article_payment` ; relation révoquée prise en compte immédiatement |
| **7-F Livraisons** | Éligibilité calculée par le serveur ; sélection par le marchand ou employé autorisé ; priorité des partenaires et motif ; acceptation dans le délai ; arrivée ; attente ; code (essais limités, usage unique) ; refus motivé ; paiement ; clôture ; notifications dans l'app | 7-B, 7-C, 7-D, 7-E, A4-b | Client ne peut pas choisir de livreur ; livreur non éligible refusé ; motif exigé en économique ; une seule attribution active sous acceptations simultanées ; clôture refusée sans code, après refus, par un autre livreur ou sans condition de paiement ; code réutilisé refusé |
| **7-G Incidents et support** | Incidents du §9 ; litiges ; file « à vérifier » ; consultation journalisée par le support | 7-F | Chaque incident conserve son historique ; aucune pénalité ni remboursement automatique ; état de la livraison figé à l'annulation |
| **7-H Évaluations** | Avis article (par ligne et référence), boutique, livraison ; éligibilité ; modération | 7-F, A17 | Avis impossible sans expérience réelle ; un avis par ligne ; membres de la boutique exclus ; produit et livraison séparés |

**Avant toute mise en production** (hors développement) : notifications sur le téléphone, SMS, vérifications
juridiques (§16.2), validation des délais et des grilles, essais sur vrais téléphones. Le paiement avant livraison et
tout prestataire Mobile Money relèvent du lot 8, sur accord.

**Tests transverses** (tous réalisables sans paiement réel ni service externe) : ceux du complément du 16/10 (12 h 31),
repris dans les critères ci-dessus ; plus accès croisés (client, boutique, employé selon permissions, livreur non
attribué, support journalisé), suspension pendant une livraison, reprise après arrêt du worker, non-régression complète
(API, administration, Flutter, Android réel). Aucun test existant n'est supprimé ni affaibli.

---

## 18. Vérification de cohérence avec les règles existantes

| Règle existante | Décision du lot 7 | Cohérence |
| --- | --- | --- |
| F3 bis, `can_collect_article_payment` jamais utilisé | Espèces : employé de la boutique seulement | Cohérent, renforcé |
| F4, BIM ne reçoit aucun paiement commercial | Paiement Mobile Money direct à la boutique ; aucun fonds via BIM | Cohérent ; à surveiller pour A3-b (écart prix / rémunération) |
| F2, frais au livreur ; C2 ouvert | Employé : frais à la boutique ; freelance : selon partenariat | C2 **tranché** pour l'employé ; F2 précisé |
| C1, paiement au marchand à la remise | Scénario standard : paiement après code, à la remise | Cohérent |
| E11, note du livreur interne | Évaluation de la livraison distincte | Cohérent |
| F17, priorité des livreurs Premium | Seulement dans une même catégorie | À confirmer |
| Q50, Gold lié au Premium | Gold non lié automatiquement à l'abonnement | **Contradiction**, A17 |
| T-010, journal en écriture seule | Historique non réécrit | Cohérent |
| T-028, centre de notifications lu dans les sources | Notifications non source de vérité | Cohérent |
| 6-A, protection des mineurs | Aucune proposition de commande à un mineur | Cohérent, ajout d'un contrôle |
| Documents d'identité privés et chiffrés (5-A) | Pièces des livreurs | Même mécanisme proposé |

---

## 19. Historique des versions

- **Version 1 (16/10/2026, 12 h 31)** : conception après le complément final (L7-01) ; scénario B « boutique Premium
  certifiée » ; arbitrages A1 à A12 ouverts.
- **Version 2 (16/10/2026, 13 h 25)** : arbitrages A1 à A12 intégrés (L7-02). Changements :
  - **A1** : parcours détaillé ; refus motivé ; clôture obligatoire par le livreur ; cinq informations de paiement
    distinctes. Remplace la proposition « attente bornée de la confirmation de la boutique avant remise ».
  - **A2** : grille au temps (trajet, attente) ; remplace les « grilles par zone » de la version 1.
  - **A3** : frais de l'employé à la boutique (C2 tranché) ; freelances selon leur partenariat ; points restants A3-b.
  - **A4 / A5** : partenaires prioritaires dans les deux modes ; motif obligatoire en économique. La place de l'employé
    reste à confirmer (A4-b).
  - **A6 / A7** : « Premium certifié » **retiré** ; paiement avant livraison **suspendu** (ni développé ni activé) ;
    Gold et étoiles distincts de l'abonnement (A17).
  - **A8** : aucun frais d'annulation au lancement ; politique financière à finaliser.
  - **A9** : permissions séparées accordées par le propriétaire.
  - **A10** : délais conservés comme valeurs initiales ; l'« expiration d'une offre » s'applique aux propositions de
    commande ; pas de système d'offres de livraison.
  - **A11** : politique de conservation par catégorie, durées à vérifier.
  - **A12** : 18 ans proposé pour commander, livrer, ouvrir une boutique.
  - **Nouveau** : références `BIM-…` des articles et prestations, lignes de commande, rattachement des évaluations.
- **Version 4 (16/10/2026, soir)** : L7-06 — attribution (marchand sollicite, livreur accepte) ; 7-F, 7-G et évaluation des
  livraisons réalisés ; §8 et §9 annotés.
- **Version 3 (16/10/2026)** : corrections L7-04 — §8 bis (accès des livreurs ; arbitrage avec A4 / A5) ; §10 bis
  (fiches figées après création, promotion, réputation conservée ; remplace la remise à zéro avec avertissement).
