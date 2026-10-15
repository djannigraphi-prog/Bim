# Lot 2 — Rappels : comparaison des architectures, coûts et recommandation

Version du 15/10/2026, refaite selon la règle **R-01** du fondateur (`DECISIONS.md`) : fiabilité, performance, sécurité et capacité d'évolution d'abord ; solutions gratuites et payantes comparées ; coûts de démarrage, mensuels et variables ; aucune dépense sans accord. **Rien n'est activé ni développé.** Statuts : *recommandé* (à valider) · *décidé*.

## 1. Cadre décidé (15/10/2026)

- Lancement en **Côte d'Ivoire** (heure d'Abidjan), architecture prête pour d'autres pays (fuseau par personne au lot 2).
- Rappels par **notifications d'abord** ; alarmes exactes seulement si des mesures sur de vrais téléphones le justifient.
- Rythme prévu par les maquettes (27, 28) : à l'heure de la tâche, puis +1 h, puis +2 h tant qu'elle n'est pas cochée (réglable dans l'administration).

## 2. Volumes pris pour les estimations

Hypothèse : une personne active reçoit en moyenne **3 notifications par jour** (environ 2 tâches, certaines cochées avant le 2ᵉ rappel). Les rappels se concentrent le soir et **à l'heure pile** (beaucoup de tâches à 18:00, 19:00…).

| Personnes actives | Notifications / mois | Heure de pointe (≈ 25 % du jour) | Pic à la minute pile (≈ 10 % des personnes) |
| --- | --- | --- | --- |
| 10 000 (lancement) | ≈ 0,9 million | ≈ 2 par seconde | ≈ 1 000 en une minute |
| 100 000 | ≈ 9 millions | ≈ 20 par seconde | ≈ 10 000 en une minute |
| 1 000 000 | ≈ 90 millions | ≈ 200 par seconde | ≈ 100 000 en une minute |

Ces hypothèses seront remplacées par des mesures réelles dès les premiers utilisateurs.

## 3. Le canal d'envoi : Firebase Cloud Messaging (FCM) et APNs

- **Sur Android, toute notification push passe par FCM** (services Google) ; les plateformes payantes (OneSignal, Pushwoosh, AWS End User Messaging…) l'utilisent elles-mêmes. Payer une couche supplémentaire n'améliore donc pas la remise sur Android ; cela ajoute des tableaux de bord, de la segmentation et des campagnes marketing.
- **Coût FCM : 0**, quelle que soit la taille (produit « No-cost » de Firebase ; il n'existe pas de formule FCM payante). **Limite : 600 000 messages par minute et par projet**, soit 6 fois le pic estimé à 1 million de personnes ; augmentation possible sur demande.
- Limites d'usage à respecter : 240 messages par minute et 5 000 par heure vers un même appareil ; messages « remplaçables » limités à 20 d'affilée par appareil.
- **iOS : APNs, gratuit** ; compte Apple Developer 99 USD/an, déjà nécessaire pour publier l'app.
- Note : Amazon Pinpoint ferme le **30/10/2026** (ses canaux, dont le push, continuent sous le nom « AWS End User Messaging ») ; à ne pas retenir.

## 4. Où exécuter la planification et l'envoi des rappels

Prix de calcul : AWS Fargate ARM (Graviton). Tarif public us-east-1 : 0,03238 USD par vCPU-heure et 0,00356 USD par Go-heure ; **Paris (eu-west-3) estimé environ 10 % plus cher** (prix exact à confirmer avec le calculateur AWS avant toute dépense). Une tâche de 0,25 vCPU / 0,5 Go tournant en continu ≈ **8 USD/mois** ; 0,5 vCPU / 1 Go ≈ **16 USD/mois** ; 1 vCPU / 2 Go ≈ **32 USD/mois**.

### Option 1 — Dans l'API existante (même processus)

| | |
| --- | --- |
| Coût de démarrage | 0 en plus (l'API est déjà prévue sur 2 tâches 0,5 vCPU / 1 Go, budget d'hébergement à part) |
| À 100 000 / 1 M personnes | + 1 à 2 tâches API aux heures de pointe (≈ 16 à 32 USD/mois), puis davantage : l'API grossit pour les deux usages |
| Avantages | Le plus simple ; un seul service à déployer et surveiller |
| Inconvénients | Le pic des rappels (18:00) tombe **au moment où les personnes ouvrent l'app** après la notification : l'API ralentit quand elle est le plus utilisée. Chaque déploiement de l'API interrompt aussi l'envoi (reprise automatique, mais retard). Une panne de l'API arrête aussi les rappels. |
| Limite | Acceptable pour une bêta fermée ; **déconseillé pour le lancement public** selon R-01 |

### Option 2 — Service « worker » séparé (même code, file de tâches dans PostgreSQL) — **recommandé**

Même image Docker que l'API, autre commande de démarrage ; planification et envois dans une file pg-boss stockée dans PostgreSQL (déjà prévu).

| | |
| --- | --- |
| Coût de démarrage | **2 tâches de 0,25 vCPU / 0,5 Go ≈ 16 USD/mois** (deux tâches pour qu'une panne ou un déploiement n'arrête pas les rappels) |
| À 100 000 personnes | 2 tâches de 0,5 vCPU / 1 Go ≈ 32 USD/mois |
| À 1 million | 4 à 6 tâches de 1 vCPU / 2 Go ≈ 130 à 200 USD/mois, et une base de données plus grande (coût de la base à part) |
| Avantages | Rappels isolés de l'API (la pointe du soir ne ralentit pas l'app) ; déploiements indépendants ; montée en charge automatique selon la file d'attente ; aucune perte : les tâches sont enregistrées en base et reprises après une panne |
| Inconvénients | Un service de plus à surveiller ; la file utilise la base PostgreSQL (charge supplémentaire modérée) |
| Limite | Au-delà d'environ 1 million de personnes actives ou de pics de plusieurs milliers de rappels par seconde, la file dans PostgreSQL devient le point faible → passage à l'option 3 |

### Option 3 — File gérée par AWS (EventBridge Scheduler + SQS) et workers d'envoi

Un minuteur EventBridge déclenche chaque minute la sélection des rappels dus ; ils passent par une file SQS (avec file des messages en échec), lue par les workers de l'option 2.

| | |
| --- | --- |
| Coût de démarrage | Workers comme l'option 2 (≈ 16 USD/mois) + minuteur (≈ 44 000 déclenchements/mois, dans la gratuité de 14 millions, ensuite 1 USD par million) + SQS (0,40 USD par million de requêtes après 1 million gratuit) : **≈ 0 à 1 USD de plus** au lancement |
| À 100 000 personnes | ≈ 32 USD (workers) + ≈ 1 à 10 USD (SQS, selon le regroupement des messages par 10) |
| À 1 million | ≈ 130 à 200 USD (workers) + ≈ 11 à 110 USD (SQS selon regroupement) ; la base n'absorbe plus la file |
| Avantages | La file monte en charge sans limite pratique, sans peser sur la base ; reprises et messages en échec gérés par AWS ; meilleure résistance aux gros pics |
| Inconvénients | Plus de composants AWS à configurer, sécuriser et tester ; dépendance plus forte à AWS ; tests locaux plus lourds |
| Limite | Surdimensionné au lancement ; **prévu comme évolution** de l'option 2 sans réécrire le métier (voir 5) |

### Option 4 — Plateforme de notifications tierce (OneSignal, Pushwoosh…)

| | |
| --- | --- |
| Coût | Facturé selon le nombre d'utilisateurs actifs par mois ; les formules gratuites sont limitées (OneSignal a restreint le push mobile de sa formule gratuite ; détails et prix à vérifier sur devis) ; devient cher à grande échelle |
| Avantages | Tableaux de bord, segmentation, tests A/B, campagnes marketing prêtes |
| Inconvénients | N'améliore pas la remise sur Android (elle passe par FCM) ; **il faut quand même notre propre planification** (heure de chaque tâche, case cochée, pause) ; données personnelles chez un tiers de plus (ARTCI) |
| Avis | Non retenue pour les rappels ; à réexaminer plus tard pour les campagnes marketing si besoin |

### Option 5 — File Redis / Valkey (ElastiCache) avec BullMQ

| | |
| --- | --- |
| Coût | Nœud cache.t4g.small Valkey ≈ 15 USD/mois en us-east-1, ≈ 30 USD avec réplique ; Paris un peu plus cher |
| Avantages | Très haut débit de file |
| Inconvénients | Une base de données de plus à exploiter et sécuriser, sans gain réel tant que PostgreSQL suffit |
| Avis | Non retenue ; l'option 3 répond mieux au besoin de grande échelle |

## 5. Recommandation technique

**Option 2 au lancement public, conçue pour passer à l'option 3 sans réécriture :**

1. Un service **worker** séparé (même code que l'API), **2 tâches** de 0,25 vCPU / 0,5 Go ARM, montée en charge automatique (2 à 6 tâches) selon la longueur de la file.
2. Planification **côté serveur**, recalculée à partir du journal des événements du projet (T-023) ; vérification « tâche déjà cochée ? » au moment d'envoyer ; heures calmes.
3. Envoi par **FCM / APNs** (notifications « système », priorité haute), plus une **notification locale de secours** non exacte dans l'app.
4. Le code passe par deux interfaces : « file de rappels » et « envoi de notification ». Remplacer pg-boss par SQS (option 3), ou FCM par un autre canal, ne touche pas les règles métier.
5. **Surveillance** : tableau de bord et alertes (rappels en retard, échecs FCM, file qui grossit), taux de remise mesuré par modèle de téléphone.

**Pourquoi pas l'option 1, moins chère :** elle place les rappels et l'app sur les mêmes machines au moment exact où les deux sont le plus sollicités, et une panne ou un déploiement de l'API arrêterait les rappels. Pour un produit dont la promesse est « Peni te rappelle à l'heure », la fiabilité des rappels est centrale.

## 6. Estimation budgétaire (rappels uniquement)

Hors API, base de données et autres services, chiffrés dans le budget d'hébergement global (`DEPLOYMENT.md`, à compléter selon R-01). Montants en USD par mois, estimés ; Paris à confirmer.

| Poste | Lancement (≈ 10 000 actifs) | ≈ 100 000 actifs | ≈ 1 000 000 actifs |
| --- | --- | --- | --- |
| Workers de rappels (option 2) | ≈ 16 | ≈ 32 | ≈ 130 – 200 |
| File SQS + minuteur (si option 3) | — | — | ≈ 11 – 110 |
| Surveillance (journaux, alertes, tableau de bord) | ≈ 5 – 10 | ≈ 10 – 20 | ≈ 30 – 60 |
| FCM / APNs | 0 | 0 | 0 |
| **Total estimé** | **≈ 21 – 26** | **≈ 42 – 52** | **≈ 170 – 370** |

Coûts uniques ou annuels : compte Apple Developer 99 USD/an (déjà nécessaire) ; projet Firebase gratuit. Coût humain : tests sur 3 à 5 vrais téléphones courants en Côte d'Ivoire (Tecno, Infinix, itel, Samsung) avant activation.

## 7. Si la dépense est reportée

- **Ce qui ne change pas** : le code est le même ; le worker peut tourner dans l'API (option 1) par simple réglage, puis être déplacé dans son propre service le jour de l'accord, sans réécriture.
- **Conséquences tant que le worker reste dans l'API** : ralentissements possibles de l'app à la pointe du soir ; rappels retardés pendant chaque déploiement de l'API ; montée en charge commune. Acceptable pour des tests internes ou une bêta fermée, pas pour le lancement public.
- **Ce qui ne doit pas être reporté au lancement public** : la surveillance des rappels (sans elle, une panne passe inaperçue).

## 8. Contraintes techniques (rappel, vérifiées)

- Android 13 et plus : autorisation des notifications demandée à la personne (à demander au bon moment, après le premier projet, avec une explication de Peni).
- Android 14 : les alarmes exactes ne sont plus autorisées par défaut ; l'autorisation automatique est réservée par Google Play aux apps de réveil et d'agenda (d'où « notifications d'abord »).
- Téléphones très limitants en arrière-plan (Tecno, Infinix, itel…) : les notifications « système » FCM résistent mieux que tout traitement dans l'app ; à mesurer sur de vrais téléphones.
- Téléphones sans services Google : pas de FCM ; seule la notification locale de secours fonctionne. Part à mesurer.

## 9. Décisions qui demandent ton accord

1. **Architecture** : option 2 (recommandée), conçue pour évoluer vers l'option 3.
2. **Budget** : ≈ 21 à 26 USD/mois pour les rappels au lancement (à ajouter au budget d'hébergement), ou report avec les conséquences du point 7.
3. **Création du projet Firebase** au nom de l'entreprise (gratuit), pour les tests sur de vrais téléphones.
4. **Rythme et heures calmes** : heure de la tâche, +1 h, +2 h ; pas de rappel de 22 h à 6 h (réglable par la personne).
5. **Pas d'alarme exacte en version 1**, décision réexaminée après mesures.

Sources : [Firebase — tarifs (FCM « No-cost »)](https://firebase.google.com/pricing/?hl=fr) · [FCM — limites et quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas) · [Android 14 — alarmes exactes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms) · [Tarifs Fargate (us-east-1)](https://www.vantage.sh/blog/fargate-pricing) · [Région Paris, écart de prix moyen](https://cloudprice.net/aws/region/eu-west-3) · [EventBridge — tarifs](https://aws.amazon.com/eventbridge/pricing/) · [SQS — tarifs](https://hevodata.com/learn/comprehensive-guide-on-aws-sqs-pricing/) · [ElastiCache — tarifs 2026](https://upstash.com/blog/aws-elasticache-pricing-explained-2026-full-cost-breakdown) · [Fin d'Amazon Pinpoint](https://docs.aws.amazon.com/pinpoint/latest/userguide/migrate.html)
