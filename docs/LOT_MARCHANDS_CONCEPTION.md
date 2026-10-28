# Lot Marchands — modèle économique, vérification et recommandations : conception

**Version 2 du 28/10/2026**, avec le document « Algorithme de recommandation et de promotion » du fondateur (§7). Document de conception à valider par le fondateur. **Aucune migration exécutée, aucun
code fonctionnel écrit, aucun prestataire activé, aucune dépense, aucun paiement réel.** Source : cahier des charges du
fondateur du 28/10/2026 (« modèle économique marchands et système de vérification »), `DECISIONS.md` et le code de
`main` (commit 58a27fd).

Légende : **[EXISTANT]** déjà dans le code · **[PROPOSÉ]** à valider · **[QUESTION]** décision du fondateur
nécessaire avant de coder (liste en §11) · **[JURIDIQUE]** à faire vérifier en Côte d'Ivoire · **[COÛT]** dépense
à autoriser (règle R-01).

---

## 1. Ce que le code contient aujourd'hui (vérifié le 28/10/2026)

| Domaine | Constat | Fichiers |
| --- | --- | --- |
| Pile | API NestJS 11 + Drizzle + PostgreSQL (monolithe modulaire, 65 migrations `0000` à `0064`) ; app Flutter (Riverpod, go_router) ; administration web React avec rôles et TOTP ; worker (`WORKER_MODE`) avec tâches toutes les minutes. | `apps/api`, `apps/mobile`, `apps/admin` |
| Dossier marchand | `merchant_applications` : `draft → submitted → approved / rejected`. Pièce d'identité (CNI, passeport, permis), selfie, numéro Mobile Money confirmé par code. Documents chiffrés (AES-256-GCM), lus par l'équipe avec trace dans l'audit. **Pas de RCCM, pas de photos de la boutique, pas de GPS, pas de visite.** L'approbation met `shops.status = active` et `shops.verified_at`. | `schema/merchants.ts`, `modules/merchants` |
| Boutiques | Statuts `draft, pending_verification, active, suspended, closed`. Ville et commune en texte libre. **Aucune coordonnée GPS. Aucune catégorie de boutique.** Aucun écran d'administration ne suspend une boutique. | `schema/spaces.ts` |
| Badge actuel | **Badge rouge « Compte certifié (Premium) »** : une boutique est « certifiée » si son propriétaire a le **Premium utilisateur** (2 000 FCFA). Calculé à la volée, rien n'est stocké. Les boutiques non certifiées affichent leurs étoiles (dès 3 avis). | `wallet/premium.ts`, `mobile/lib/core/widgets/certified_badge.dart` |
| Catégories BimShop | `shop_categories` sur 2 niveaux (vêtements, accessoires, santé : visage, corps, minceur, compléments, hygiène ; sport ; services). **Aucun niveau de risque, aucune gestion dans l'administration.** | `0022_catalog.sql` |
| Articles | Statuts `draft, published, hidden, archived`. Titre, description et prix figés après création (déclencheur). **Aucune revue avant publication, aucune liste noire.** La « promotion » existante est une baisse de prix décidée par le marchand, pas de la publicité. | `schema/catalog.ts` |
| BimShop | Tri par date ou par prix uniquement. **Aucun score, aucun classement, aucune publicité.** | `catalog/bimshop.service.ts` |
| « Pour toi » | Publications seulement, score SQL simple (récence, abonnements, catégorie de projet, j'aime). Ni produits, ni boutiques, ni Lives. | `social/posts.service.ts` |
| Centres d'intérêt | 10 intérêts choisis à l'inscription (`user_interests`), **jamais utilisés pour classer, non modifiables ensuite**. Lien catégories de projet → catégories BimShop (`project_category_rubriques`). | `schema/profiles.ts`, `schema/offers.ts` |
| Signaux d'activité | J'aime, favoris, abonnements, commandes, avis, spectateurs de Live. **Recherches et vues d'articles ou de boutiques non enregistrées.** | `schema/*` |
| Lives | Utilisables seulement en mode démonstration. Démarrage annoncé dans le centre de notifications aux abonnés, **sans notification sur le téléphone**. | `modules/lives` |
| Notifications | FCM prêt mais **inactif** (`PUSH_PROVIDER=none`, pas de projet Firebase). Heures calmes 22 h–6 h pour les rappels. **Pas de préférences par catégorie, pas de plafond quotidien.** | `modules/notifications` |
| Confidentialité | **Aucun réglage de personnalisation, aucun consentement enregistré** ; mesures et notes de santé des projets privées mais sans consentement explicite. | `schema/profiles.ts`, `projects.ts` |
| Signalements | `content_reports` : publications, commentaires, personnes, stories, messages, avis, reels, boutiques. **Pas d'articles ni de Lives.** | `schema/social.ts` |
| Paiements | Interface `PaymentProvider` (simulateur + Paystack en clés de test seulement), fermée par défaut (`PAYMENT_PROVIDER=none`). Conçue pour l'article d'une commande, payé **directement à la boutique**. Opérateurs : Orange, MTN, Wave (**Moov non pris en charge par Paystack**). Aucune commission (L8-02). | `orders/online/*` |
| Premium | Seul abonnement : `user_premium` (30 jours, canal démo / Google / Apple, simulateur). **Pas de délai de grâce, pas de tâche d'expiration, pas d'abonnement marchand.** | `wallet/*` |
| Pièces | Achetées (packs) ou reçues en cadeau, 1 pièce = 1 FCFA, retrait possible. Circuit en mode démonstration seulement. | `wallet/*` |
| Réglages | `app_settings` (clé, valeur JSON, statut de décision), modifiable dans l'administration avec trace avant / après, règles de validation par clé. | `modules/settings`, `admin/setting-rules.ts` |
| Journal d'audit | Écriture seule, garantie par des déclencheurs de la base. | `modules/audit` |
| Données de démonstration | Une seule boutique (« Maison Aminata », Marcory, 3 articles). | `src/demo/seed.ts` |

**Conséquence :** le cahier des charges s'appuie bien sur l'existant (dossier marchand, documents chiffrés, réglages,
audit, interface de paiement, worker), mais le classement, l'enregistrement des signaux, les positions, la
publicité, la revue des articles et les notifications de Lives sont entièrement à construire.

---

## 2. Principes appliqués partout [PROPOSÉ]

1. **Aucun montant, durée, seuil ou coefficient codé en dur** : tout passe par `app_settings` (table existante,
   modifiable dans l'administration, journalisée). Une clé `null` = fonction fermée, comme aujourd'hui.
2. **Rien d'existant n'est cassé** : les nouvelles colonnes sont facultatives, les nouveaux statuts s'ajoutent aux
   anciens, les écrans actuels continuent de fonctionner pendant chaque phase. Chaque phase passe la CI complète
   (tests API, Flutter, administration) avant fusion.
3. **Payer donne une priorité, jamais un passe-droit** : les filtres éliminatoires (§7) s'appliquent avant tout boost
   ou sponsoring ; une note, un avis ou une place ne se vend jamais.
4. **Étiquetage obligatoire** : « Partenaire vérifié » sur toute position obtenue grâce au boost Premium,
   « Sponsorisé » sur toute publicité ; impossible de les masquer côté marchand.
5. **Vocabulaire interdit** : un test automatique refuse « garanti », « efficace », « sans risque » (et variantes)
   dans les textes de l'app et des messages du serveur. **[QUESTION Q7]** l'appliquer aussi aux titres et
   descriptions écrits par les marchands ?
6. **Paiements** : nouvelle table pour les paiements reçus **par BIM** (vérification, abonnement, publicité), séparée
   des paiements de commandes (qui restent versés directement à la boutique, règle F4). Même interface
   `PaymentProvider`, simulateur en développement, **aucune clé de production, aucun paiement réel** sans accord.

---

## 3. Les deux signes de confiance (ajout du fondateur) [PROPOSÉ]

Le fondateur demande de **dissocier le badge et la mention** :

| | **Badge** « ★ Boutique vérifiée BIM » | **Mention** sous chaque article **[QUESTION Q1 : texte exact]** |
| --- | --- | --- |
| Forme | Étoile en or **devant le nom** de la boutique, avec la date de vérification | Ligne sous chaque article, par exemple « Boutique visitée par BIM le 12/11/2026 » |
| Condition | Abonnement Premium marchand actif **et** dossier de documents approuvé (pièce d'identité du gérant, RCCM ou équivalent, photos, catégories) | **Audit fait** : visite de vérification effectuée et contre-validée |
| Dans nos données | Niveau `documents` | Niveau `audited` (inscription « totale ») |
| Fin | Retiré si la vérification expire ou est suspendue ; **conservé pendant un impayé** tant que la vérification est valide | Retirée à l'expiration de l'audit (12 mois, 6 mois pour les catégories sensibles) |

- Le badge actuel (rouge, lié au Premium **utilisateur** du propriétaire) **ne s'applique plus aux boutiques** ;
  il reste pour les personnes. **[QUESTION Q2]**
- **[QUESTION Q3]** Pour une boutique **SENSIBLE** : le cahier des charges dit « visite obligatoire » et
  « Premium accessible uniquement après validation ». L'ajout dit « badge après documents, mention après audit ».
  Proposition : badge possible après documents ; **mais tant que l'audit n'est pas fait, ses articles SENSIBLES ne
  sont ni recommandés, ni sponsorisés, ni boostés**.

---

## 4. Plan par phases [PROPOSÉ]

Chaque phase = une branche, ses migrations (validées avant exécution), son code, ses tests, ses données de
démonstration, puis la CI verte. Ordre demandé par le fondateur.

| Phase | Contenu | Dépend de |
| --- | --- | --- |
| **P1 — Configuration et niveaux marchands** | Réglages `merchant.*`, `reco.*`, `lives.*`, `ads.*` ; niveau de risque des catégories (gestion dans l'administration) ; catégories d'une boutique ; abonnement Premium marchand (5 000 FCFA/mois), frais de vérification (10 000 FCFA), offre « Membres fondateurs » (50 premiers, vérification offerte + 3 mois), délai de grâce de 7 jours, tâche d'expiration ; table des paiements reçus par BIM (simulateur) ; commission sur les ventes (réglage, **désactivée**) ; badge en or et dissociation de l'ancien badge ; suspension d'une boutique depuis l'administration. | — |
| **P2 — Vérification** | Dossier de vérification (statuts complets), documents (RCCM, pièce d'identité, façade, intérieur, position, étiquettes), interface agent, visites attribuées au hasard, photos prises en direct avec heure et GPS (refus au-delà de 200 m), checklist, contre-validation par une autre personne, validité 12 / 6 mois, rappel 30 jours avant, contrôles surprises (~10 % par trimestre), revue des articles SENSIBLES, liste noire (détection sur nom et composition), signalements d'articles et de Lives, règle des 3 signalements validés, journal d'audit. | P1 |
| **P3 — Recommandations v1** | Enregistrement des signaux (recherches, vues, favoris, achats, Lives suivis) avec décroissance de 7 jours ; profil d'intérêts ; commune de l'utilisateur et des boutiques pour la proximité ; moteur de score par règles (filtres, score, composition de la liste de 10, « Pourquoi je vois ça ? ») ; tests unitaires ; écran de confidentialité (personnalisation désactivable, accord explicite pour la santé, le poids et le corps) ; campagnes « Sponsorisé » vendues en packs. | P1, P2 (filtres) |
| **P4 — Lives** | Audience d'un Live (intérêt au-dessus du seuil, rayon, actifs depuis 30 jours) ; notification sur le téléphone pour les boutiques Premium ; push sponsorisé ; plafond de 2 par jour, aucune entre 22 h et 7 h ; désactivation par catégorie. | P3 ; **activation réelle : projet Firebase [COÛT]** |
| **P5 — Tableau de bord marchand** | Vues, visites, clics, messages, participants aux Lives, ventes, résultats des campagnes, comparaison mois par mois ; statistiques agrégées seulement (au moins 20 personnes par chiffre pour les sujets sensibles). | P3, P4 |

Back-office : chaque phase ajoute ses écrans d'administration (dossiers, agents, liste noire, catégories, signalements,
abonnements et paiements, campagnes, réglages, audit).

---

## 5. Schéma proposé (à valider avant toute migration)

Les noms suivent les conventions du dépôt (`snake_case`, `uuid` v7, `timestamptz`, enums PostgreSQL). Toutes les
modifications de tables existantes sont **additives** (colonnes facultatives ou nouvelles valeurs d'enum).

### P1

| Table / modification | Colonnes principales | Rôle |
| --- | --- | --- |
| `shop_categories` + `risk_level` | enum `category_risk` (`sensitive, medium, low`), défaut `low` puis valeurs initiales : sensible = santé (visage, corps, minceur, compléments, hygiène) et `sport_nutrition` ; moyen = sport, services ; faible = vêtements, accessoires. Catégories « alimentaire » et « décoration » à créer (absentes aujourd'hui) | Niveau de risque, modifiable dans l'administration |
| `shop_category_links` (nouvelle) | `shop_id, category_code, created_at` | Catégories vendues par une boutique |
| `shops` + colonnes | `commune_code` (lien vers `communes`), `latitude`, `longitude`, `location_verified_at`, `boost_suspended_until`, `suspended_reason` | Position déclarée puis confirmée par la visite ; suspensions |
| `communes` + colonnes | `latitude`, `longitude` (centre de la commune) | Proximité sans suivre la position des personnes |
| `shop_subscriptions` (nouvelle) | `shop_id, status` (`active, grace, suspended, cancelled, expired`), `price_fcfa, period_start, period_end, grace_until, founder_offer, auto_renew` | Premium marchand, séparé du Premium utilisateur |
| `platform_payments` (nouvelle) | `shop_id, purpose` (`verification_fee, subscription, ad_campaign`), `amount_fcfa, provider, provider_ref, status, idempotency_key, paid_at` + événements prestataire | Paiements reçus par BIM (jamais l'argent des clients) |
| `merchant_founder_slots` (nouvelle) | `shop_id, slot_number, granted_at` (unique, plafond lu dans les réglages) | Offre « Membres fondateurs » sans dépassement possible |
| `app_settings` (lignes) | `merchant.premium_price_fcfa` 5000, `merchant.verification_fee_fcfa` 10000, `merchant.grace_days` 7, `merchant.founders_quota` 50, `merchant.founders_free_months` 3, `shop.commission_percent` 0 (désactivé), etc. | Tout est modifiable |

### P2

| Table | Colonnes principales | Rôle |
| --- | --- | --- |
| `shop_verifications` | `shop_id, level` (`documents, audited`), `status` (`draft, submitted, documents_review, visit_scheduled, visit_done, counter_validation, approved, needs_changes, rejected`), `lifecycle` (`active, suspended, expired`), `risk_level` au moment du dossier, `method` (`visit, remote`), `valid_from, valid_until, fee_payment_id` | Dossier et cycle de vie |
| `shop_verification_documents` | `verification_id, kind` (`rccm, id_front, id_back, facade, interior, product_label`), `storage_key` chiffré | Réutilise le chiffrement des documents KYC |
| `verification_visits` | `verification_id, agent_admin_id, assigned_at, scheduled_at, done_at, surprise, recommendation` (`approve, fix, refuse`), `comment` | Visites ; un agent ne visite pas deux fois de suite la même boutique (contrôle à l'attribution) |
| `visit_photos` | `visit_id, storage_key, taken_at, latitude, longitude, accuracy_m, distance_m, accepted` | Refusée si la distance dépasse `merchant.visit_max_distance_m` (200) |
| `visit_checklist_answers` | `visit_id, item_code, answer, note` ; items dans un réglage | Checklist terrain |
| `verification_decisions` | `verification_id, admin_id, decision, comment` ; **contrainte** : la contre-validation ne peut pas venir de l'agent de la visite | Double validation |
| `product_reviews` | `product_id, content_version, status` (`pending, approved, rejected`), `label_key, origin, composition, reviewer_id` | Revue des articles SENSIBLES avant recommandation ou sponsoring |
| `blacklist_terms` | `term, kind` (`product, ingredient`), `active, reason, created_by` | Liste noire gérée dans l'administration |
| `products` + `moderation_status` | `none, pending_review, approved, blocked` | Article suspect bloqué en attente de revue |
| `content_reports` + valeurs | `target_type` + `product`, `live` | Bouton « Signaler » partout |
| Rôles d'administration | `verification_agent`, `verification_lead` | Agents et contre-validation |

### P3

| Table | Colonnes principales | Rôle |
| --- | --- | --- |
| `user_activity_events` | `user_id, kind` (`search, view_product, view_shop, favorite, purchase, live_join`), `target_type, target_id, category_code, created_at` ; conservation limitée (réglage), purge nocturne | Signaux de pertinence (rien si la personnalisation est désactivée) |
| `user_privacy_choices` | `personalization_enabled, sensitive_interests_consent, consent_version, consented_at` | Consentements explicites et retirables |
| `users` + `commune_code` | Commune déclarée (facultative) | Proximité, sans GPS de la personne |
| `ad_campaigns` | `shop_id, objective` (`views, shop_visits, messages, live_participants`), `pack_code, budget_fcfa, starts_at, ends_at, communes[], interests[], status, payment_id` | Pub à la carte en packs à prix fixe (`ads.packs`) |
| `ad_campaign_stats_daily` | `campaign_id, day, impressions, clicks, visits, messages, live_participants` | Résultats sans données personnelles |
| `reco_exposure_weekly` | `shop_id, category_code, commune_code, week, impressions` | Facteur d'équité |

### P4 et P5

| Table | Rôle |
| --- | --- |
| `notification_category_optouts` (`user_id, category_code`) | Désactivation des notifications de Lives par catégorie |
| `live_notifications` (`live_id, user_id, sent_at, sponsored`) | Plafond de 2 par jour et par personne, traçabilité |
| `shop_stats_daily` (`shop_id, day, views, visits, clicks, messages, live_participants, sales_fcfa`) | Tableau de bord, agrégé |

---

## 6. Vérification : précisions [PROPOSÉ]

- **Interface agent** : pages mobiles de l'**administration web** (connexion avec TOTP déjà en place), plutôt qu'une
  nouvelle application à publier. Photos prises par l'appareil photo de la page (pas de choix dans la galerie), heure
  et position envoyées avec la photo, contrôle de distance par le serveur.
- **Limite honnête** : un téléphone modifié peut fausser une position. Le serveur recoupe donc la position, l'heure
  du serveur et la contre-validation par une autre personne ; aucune règle ne repose sur une seule preuve.
- **Attribution aléatoire** des visites parmi les agents disponibles, jamais le même agent deux fois de suite pour
  une boutique, tout est journalisé.
- **Vérification à distance** (catégories FAIBLES) : appel vidéo + documents + photos. **[QUESTION Q4]** outil
  d'appel vidéo (hors de l'app au début ?).

---

## 7. Moteur de recommandation BimShop [PROPOSÉ]

**Référence : document du fondateur « BIM Shop – Algorithme de recommandation et de promotion » (28/10/2026).** Il
remplace le §5 du cahier des charges pour BimShop. L'accueil aura son propre algorithme, plus tard.

Module à part (`modules/recommendations`) en **fonctions pures** testées sans base de données, une par facteur et par
règle, appelées par un service qui lit les données. Toutes les valeurs du tableau « Paramètres par défaut » du document
deviennent des réglages `reco.*` (demi-vie 3 jours, poids des actions, m = 10, seuil 3,5, rayons, V, boost 1,4,
plancher d'équité 0,5, plafond de 15 Premium par catégorie et commune, modèle de bloc, 3 Premium par bloc, pertinence
minimale d'une pub 0,3, 3 notifications de Live par jour, 3 affichages sans clic en 3 jours).

**Vérification de l'exemple du document** (salles de sport à Cocody) : avec les formules du document, le calcul donne
bien B = 0,71, A = 0,42, C = 0,32. Ce cas devient un test unitaire.

### 7.1 Ce que l'algorithme demande et que le code n'a pas

| Besoin de l'algorithme | État actuel | Proposition |
| --- | --- | --- |
| **Tags** sur les articles (« tresses », « soins du visage »…) | Une seule catégorie par article | Table `product_tags` + liste de tags gérée dans l'administration ; lien objectifs d'inscription → tags |
| **Objectifs déclarés** (s'aimer davantage, perdre du poids, prendre soin de sa peau…) | 10 « intérêts » de style (mode, coiffure…) | Nouvelle liste d'objectifs à l'inscription, modifiable dans le profil **[QUESTION Q9]** |
| **Type d'offre** : livrable, retrait en boutique, service sur place | `kind` = `product` ou `service` seulement | Colonne `offer_mode` sur l'article |
| **Zone de livraison** du marchand | Communes desservies par les livreurs, pas par boutique | Table `shop_delivery_zones` (communes ou ville entière) |
| **Position de l'utilisateur** à 1 km près (rayon de 3 km pour les services) | Ville en texte libre, aucune position | Position du téléphone **avec autorisation**, arrondie, jamais conservée en historique ; à défaut, centre de la commune déclarée **[QUESTION Q10]** |
| **Position exacte de la boutique** | Aucune | Saisie par le marchand, confirmée par la visite |
| **Note visuelle V** (résolution, flou, éclairage, propreté, esthétique) | Rien | Résolution, flou et exposition calculés par le serveur à l'ajout de la photo (bibliothèque déjà installée) ; propreté et esthétique « type NIMA » : **modèle d'IA à héberger ou service payant [COÛT] [QUESTION Q11]** ; réaction réelle après 200 affichages ; « Coup de cœur BIM » choisi dans l'administration |
| **Affichages, clics, « Pas intéressé »** | Rien n'est enregistré | Journal des affichages (agrégé), bouton « Pas intéressé » |
| **Taux de réponse, litiges** (fiabilité) | Messages et incidents existent | Calcul nocturne par boutique |
| **Popularité** (j'aime + 3 × recommandations, 30 jours) | Données présentes | Rang calculé chaque nuit par catégorie |
| **Utilisateurs en ligne** (Lives) | Aucune présence | Dernière activité de la session (mise à jour légère) |
| **Plafond de 15 Premium par catégorie et commune, liste d'attente** | Rien | Contrôle à la souscription, table `premium_waitlist` |
| **Test sur la moitié des utilisateurs pendant 2 semaines** | Rien | Groupe A / B stable par personne, réglage par groupe |
| **Indicateurs** (clics, « pas intéressé », Premium vs standard, équité, renouvellements) | Rien | Écran d'indicateurs dans l'administration (P5) |

### 7.2 Différences avec le premier cahier des charges, à confirmer **[QUESTION Q12]**

| Point | Cahier des charges | Algorithme | Proposition |
| --- | --- | --- | --- |
| Demi-vie des actions | 7 jours | 3 jours | 3 jours (document le plus récent) |
| Notifications de Live | Push à l'audience intéressée pour les Premium ; 2 par jour | Push **aux abonnés hors ligne** seulement (tout marchand) ; le Premium passe en priorité dans la carte du haut ; 3 par jour ; coupure par boutique | Algorithme |
| Catégorie sensible | « Visite obligatoire » pour être recommandé | Badge « Boutique vérifiée BIM » + article revu suffisent | Algorithme ; la mention d'audit reste distincte (§3) |
| Liste de 10 | 3 Premium max, 1–2 pubs, 1 découverte | Bloc fixe : 5 perso, 2 tendances, 1 pub, 1 nouveauté, 1 découverte, + 2 « Nouveautés à la une » | Algorithme |
| Campagne pas atteinte | — | « Prolongée ou remboursée en crédit » | Prolongation d'abord ; un crédit publicitaire n'est pas un remboursement en argent, mais à confirmer avec la règle « aucun remboursement dans BIM » (V1-1810-R) |

### 7.3 Tests unitaires prévus

Chaque facteur (P, Q avec note bayésienne, D selon le type d'offre, F, V, Pop, B, E avec plancher), chaque filtre
éliminatoire (dont « visible en recherche mais jamais recommandé »), la composition d'un bloc (positions, étiquettes,
3 Premium, 2 par boutique, pas de doublon, sous-catégories non collées, 6 premières cartes avec V ≥ 1,0), les
« Nouveautés à la une », le démarrage à froid (moins de 20 actions : 40 / 30 / 20 / 10 %), le choix de la publicité
(pertinence ≥ 0,3, rythme, 3 affichages par personne), les publics d'un Live, et l'exemple des salles de sport.

---

## 8. Ce qui ne peut pas être activé sans le fondateur

| Point | Pourquoi |
| --- | --- |
| Encaissement réel des 5 000 / 10 000 FCFA et des packs publicitaires | Règle R-01 et règles de paiement : simulateur seulement ; activation = décision, clés de production, contrat prestataire **[COÛT]** |
| Notifications sur le téléphone | Projet Firebase non créé **[COÛT éventuel]** |
| Visites réelles | Agents, déplacements **[COÛT]** |
| Moov Money | Non pris en charge par Paystack |

---

## 9. Risques et points juridiques

- **[JURIDIQUE]** Règles d'Apple et de Google : vendre l'abonnement marchand ou de la publicité **dans l'app** peut
  imposer leurs achats intégrés (commission de 15 à 30 %). À vérifier avant de choisir le canal ; option à étudier :
  paiement en dehors de l'app (Mobile Money depuis un espace web marchand).
- **[JURIDIQUE]** Données de santé et du corps : consentement explicite, finalité, durée de conservation, déclaration
  ARTCI.
- **[JURIDIQUE]** Un badge ne doit pas laisser croire que BIM garantit les produits : textes du badge et de la
  mention à valider.

---

## 10. Données de démonstration [PROPOSÉ]

Une douzaine de boutiques fictives à Abidjan (Cocody, Marcory, Plateau, Yopougon, Treichville, Koumassi, Abobo,
Port-Bouët), de toutes les catégories et de tous les niveaux : standard, Premium avec documents, Premium audité,
membre fondateur, impayé en délai de grâce, suspendue, article sensible en revue, article bloqué par la liste
noire, campagne sponsorisée active. Noms et contenus inventés, chargés seulement en mode démonstration.

---

## 11. Questions au fondateur avant de coder

| N° | Question |
| --- | --- |
| Q1 | Texte exact de la **mention** sous les articles après l'audit (ex. « Boutique visitée par BIM le … ») ? |
| Q2 | Le badge rouge « certifié » des **personnes** Premium reste-t-il ? Pour les boutiques, il est remplacé par l'étoile en or. |
| Q3 | Boutique SENSIBLE : badge possible après documents seulement, et articles sensibles non recommandés tant que l'audit n'est pas fait (proposition §3) ? |
| Q4 | Vérification à distance : par quel moyen se fait l'appel vidéo ? |
| Q5 | **Pièces** : « totalement gratuites, activées après vérification d'identité ». Aujourd'hui elles s'achètent en packs et se retirent en FCFA. Faut-il supprimer l'achat de pièces ? Et que signifie « activer » (pouvoir en recevoir, en envoyer, les retirer) ? |
| Q6 | « Application 100 % gratuite » : le **Premium utilisateur** (2 000 FCFA : Peni IA, gadgets des Lives) est-il maintenu ? |
| Q7 | Vocabulaire interdit (« garanti », « efficace », « sans risque ») : aussi dans les textes écrits par les marchands ? |
| Q8 | Canal de paiement des abonnements marchands : Mobile Money hors de l'app, ou achats intégrés des stores (voir §9) ? |
| Q9 | Liste exacte des **objectifs** proposés à l'inscription (remplace-t-elle les 10 intérêts actuels ?) et des **tags** de départ ? |
| Q10 | Position de l'utilisateur : position du téléphone (avec autorisation) ou commune déclarée ? Le rayon de 3 km des services n'est fiable qu'avec la position du téléphone. |
| Q11 | Note esthétique « type NIMA » : héberger un modèle (coût de serveur) ou commencer sans, avec seulement résolution, flou, éclairage et réactions des utilisateurs ? |
| Q12 | Confirmer que le document « Algorithme » l'emporte sur le cahier des charges pour les différences du §7.2. |

Une fois ces réponses données et le schéma du §5 validé, la phase P1 commence par sa migration, présentée avant
exécution.
