# Lot 2 — Rappels : comparaison des architectures, coûts et recommandation

Version du 15/10/2026, selon les règles **R-01 et R-01 bis** du fondateur (`DECISIONS.md`) : choisir, pour chaque composant, le **meilleur équilibre entre qualité, fiabilité, sécurité, performances, évolutivité et coût** — une solution gratuite si elle suffit vraiment, une solution payante si elle apporte un avantage important ; coûts, limites, sécurité et difficulté de migration présentés ; aucune dépense sans accord. **Rien n'est activé ni développé.** Statuts : *recommandé* (à valider) · *décidé*.

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

## 3 bis. Gratuit ou payant : choix composant par composant

| Composant | Solutions gratuites (limites) | Solutions payantes (avantages) | Choix recommandé | Pourquoi | Migration ultérieure |
| --- | --- | --- | --- | --- | --- |
| **Canal d'envoi** | FCM (Android) et APNs (iOS) : gratuits, 600 000 messages/min par projet | OneSignal, Pushwoosh, AWS End User Messaging : tableaux de bord, segmentation, campagnes ; **ils passent eux-mêmes par FCM / APNs** | **Gratuit : FCM / APNs** | Même fiabilité de remise ; le payant n'ajoute que des outils marketing, pas nécessaires aux rappels | Faible : l'envoi passe par une interface « envoi de notification » ; ajouter une plateforme marketing plus tard ne touche pas les rappels |
| **Exécution des rappels** | Dans l'API existante (aucun coût en plus) : le pic du soir ralentit l'app ; une panne ou un déploiement de l'API arrête les rappels | Service séparé (2 tâches Fargate, ≈ 16 USD/mois) : isolation, haute disponibilité, montée en charge automatique | **Payant : service séparé** | Avantage important et nécessaire : fiabilité des rappels et réactivité de l'app au même moment | Faible : même code, déplacé par simple configuration |
| **File d'attente** | pg-boss dans la base PostgreSQL déjà prévue (aucun coût en plus) : suffisant jusqu'à environ 1 million de personnes actives ; charge modérée sur la base | SQS (≈ 0 à 1 USD au lancement, ≈ 11 à 110 USD à 1 million) : sans limite pratique, ne pèse pas sur la base ; Redis / Valkey (≈ 15 à 30 USD) : très haut débit mais base en plus à exploiter | **Gratuit au lancement : pg-boss** ; **SQS prévu** pour la croissance | À l'échelle du lancement, SQS n'apporte pas d'avantage significatif ; pg-boss garde les tâches en base (aucune perte) | Faible à moyenne : un adaptateur SQS derrière l'interface « file de rappels », quelques jours de travail et de tests ; aucune donnée à migrer (les rappels en attente sont recalculés) |
| **Minuteur** (sélection des rappels dus chaque minute) | Planification intégrée à pg-boss | EventBridge Scheduler (dans la gratuité de 14 millions de déclenchements/mois, ensuite 1 USD par million) | **Gratuit : pg-boss** au lancement ; EventBridge avec SQS | Même fiabilité tant que le worker tourne en deux exemplaires | Faible |
| **Secret de connexion à Firebase** | Parameter Store (SecureString chiffré par KMS, paramètres standard sans frais) : pas de rotation automatique | Secrets Manager (0,40 USD par secret et par mois) : rotation automatique | **Gratuit : Parameter Store** | Chiffré, accès limité au worker ; la rotation automatique ne s'applique pas à une clé Firebase (rotation manuelle, documentée) | Très faible |
| **Surveillance serveur** | CloudWatch, offre gratuite permanente : 10 alarmes, 3 tableaux de bord, 5 Go de journaux/mois | CloudWatch au-delà (journaux 0,50 USD/Go, alarme 0,10 USD) ; Grafana Cloud Pro (19 USD par utilisateur et par mois) | **CloudWatch** (gratuit au lancement, payant à l'usage ensuite) | Intégré à AWS, sans service de plus ; l'offre gratuite couvre le lancement, le coût suit le volume | Faible (journaux et métriques standard) |
| **Plantages de l'app** | Firebase Crashlytics (gratuit, même projet Firebase) ; Sentry gratuit (5 000 erreurs/mois, 1 utilisateur) | Sentry Team (26 USD/mois) : suivi commun app + serveur | **Gratuit : Crashlytics** | Référence pour les apps mobiles, gratuite, déjà dans l'écosystème Firebase | Faible |
| **Secours hors connexion** | Notification locale programmée par l'app (bibliothèque libre), non exacte | — | **Gratuit** | Aucune alternative payante utile | — |

Sécurité commune à toutes les options : jetons de notification rattachés à l'appareil et supprimés à la déconnexion ; aucun contenu sensible dans le texte d'une notification (pas de santé, pas de mesure de poids sur l'écran verrouillé) ; clé Firebase réservée au worker ; envois journalisés sans contenu personnel.

## 4. Où exécuter la planification et l'envoi des rappels

Prix de calcul : AWS Fargate ARM (Graviton). Tarif public us-east-1 : 0,03238 USD par vCPU-heure et 0,00356 USD par Go-heure ; **Paris (eu-west-3) estimé environ 10 % plus cher** (prix exact à confirmer avec le calculateur AWS avant toute dépense). Une tâche de 0,25 vCPU / 0,5 Go tournant en continu ≈ **8 USD/mois** ; 0,5 vCPU / 1 Go ≈ **16 USD/mois** ; 1 vCPU / 2 Go ≈ **32 USD/mois**.

### Option 1 — Dans l'API existante (même processus)

| | |
| --- | --- |
| Coût de démarrage | 0 en plus (l'API est déjà prévue sur 2 tâches 0,5 vCPU / 1 Go, budget d'hébergement à part) |
| À 100 000 / 1 M personnes | + 1 à 2 tâches API aux heures de pointe (≈ 16 à 32 USD/mois), puis davantage : l'API grossit pour les deux usages |
| Avantages | Le plus simple ; un seul service à déployer et surveiller |
| Inconvénients | Le pic des rappels (18:00) tombe **au moment où les personnes ouvrent l'app** après la notification : l'API ralentit quand elle est le plus utilisée. Chaque déploiement de l'API interrompt aussi l'envoi (reprise automatique, mais retard). Une panne de l'API arrête aussi les rappels. |
| Sécurité | Identique aux autres options ; mais la clé Firebase est alors accessible à tout le processus de l'API |
| Migration vers l'option 2 | Faible : même code, nouvelle configuration de déploiement |
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
| Sécurité | Clé Firebase réservée au worker ; le worker n'est pas exposé à Internet (aucune entrée publique) |
| Migration vers l'option 3 | Faible à moyenne : adaptateur SQS et minuteur EventBridge, sans changer les règles métier ; quelques jours de travail et de tests |
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
| Sécurité | Droits AWS supplémentaires à cadrer (accès à la file limité au worker) ; chiffrement de la file activé |
| Limite | Surdimensionné au lancement : n'apporte pas d'avantage significatif à moins d'environ 1 million de personnes actives ; **prévu comme évolution** de l'option 2 sans réécrire le métier (voir 5) |

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

## 5. Recommandation technique finale

**Option 2 au lancement public, conçue pour passer à l'option 3 sans réécriture.** Un seul poste payant est recommandé au lancement — le service séparé — parce qu'il apporte un avantage important et nécessaire (fiabilité des rappels, réactivité de l'app). Les autres composants restent gratuits parce qu'ils répondent pleinement au besoin (voir 3 bis) : FCM / APNs, file pg-boss, Parameter Store, Crashlytics, CloudWatch dans son offre gratuite.

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
| Surveillance CloudWatch (journaux, alertes, tableau de bord ; offre gratuite d'abord) | ≈ 0 – 5 | ≈ 10 – 20 | ≈ 30 – 60 |
| FCM / APNs, Crashlytics, Parameter Store | 0 | 0 | 0 |
| **Total estimé** | **≈ 16 – 21** | **≈ 42 – 52** | **≈ 170 – 370** |

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

1. **Architecture** : option 2 (recommandée), conçue pour évoluer vers l'option 3 ; composants gratuits retenus là où ils suffisent (tableau 3 bis).
2. **Budget** : ≈ 16 à 21 USD/mois pour les rappels au lancement (à ajouter au budget d'hébergement), ou report avec les conséquences du point 7.
3. **Création du projet Firebase** au nom de l'entreprise (gratuit), pour les tests sur de vrais téléphones.
4. **Rythme et heures calmes** : heure de la tâche, +1 h, +2 h ; pas de rappel de 22 h à 6 h (réglable par la personne).
5. **Pas d'alarme exacte en version 1**, décision réexaminée après mesures.

Sans dépense et sans attendre ces décisions, il est possible de préparer : le fuseau horaire par personne, les interfaces « file de rappels » et « envoi de notification » avec leurs tests, les modèles de messages de Peni et les préférences de notification. L'intégration réelle de Firebase et le déploiement du worker attendent ton accord.

Sources : [Firebase — tarifs (FCM et Crashlytics « No-cost »)](https://firebase.google.com/pricing/?hl=fr) · [CloudWatch — tarifs et offre gratuite](https://www.cloudzero.com/blog/cloudwatch-pricing) · [Secrets Manager et Parameter Store](https://infisical.com/blog/aws-secrets-manager-vs-parameter-store) · [Grafana Cloud — offre gratuite](https://costbench.com/software/observability/grafana-cloud/free-plan/) · [Sentry — offre gratuite](https://costbench.com/software/developer-tools/sentry/free-plan/) · [FCM — limites et quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas) · [Android 14 — alarmes exactes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms) · [Tarifs Fargate (us-east-1)](https://www.vantage.sh/blog/fargate-pricing) · [Région Paris, écart de prix moyen](https://cloudprice.net/aws/region/eu-west-3) · [EventBridge — tarifs](https://aws.amazon.com/eventbridge/pricing/) · [SQS — tarifs](https://hevodata.com/learn/comprehensive-guide-on-aws-sqs-pricing/) · [ElastiCache — tarifs 2026](https://upstash.com/blog/aws-elasticache-pricing-explained-2026-full-cost-breakdown) · [Fin d'Amazon Pinpoint](https://docs.aws.amazon.com/pinpoint/latest/userguide/migrate.html)
