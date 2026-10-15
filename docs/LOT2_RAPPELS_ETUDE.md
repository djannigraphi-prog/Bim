# Lot 2 — Rappels : comparaison des architectures, coûts et recommandation

Version du 15/10/2026, selon les règles **R-01 et R-01 bis** du fondateur (`DECISIONS.md`) : choisir, pour chaque composant, le **meilleur équilibre entre qualité, fiabilité, sécurité, performances, évolutivité et coût** — une solution gratuite si elle suffit vraiment, une solution payante si elle apporte un avantage important ; coûts, limites, sécurité et difficulté de migration présentés ; aucune dépense sans accord. **Mise à jour du 15/10/2026 (après-midi)** : la partie sans dépense est développée et testée (sections 10 à 12) ; **rien n'est activé** (aucun service payant, aucun projet Firebase, interrupteur des rappels coupé). Statuts : *recommandé* (à valider) · *décidé*.

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
| **File d'attente** | File dans la base PostgreSQL déjà prévue (aucun coût en plus ; d'abord pg-boss, finalement une table dédiée, voir 12) : suffisant jusqu'à environ 1 million de personnes actives ; charge modérée sur la base | SQS (≈ 0 à 1 USD au lancement, ≈ 11 à 110 USD à 1 million) : sans limite pratique, ne pèse pas sur la base ; Redis / Valkey (≈ 15 à 30 USD) : très haut débit mais base en plus à exploiter | **Gratuit au lancement : file PostgreSQL** ; **SQS prévu** pour la croissance | À l'échelle du lancement, SQS n'apporte pas d'avantage significatif ; la file garde les rappels en base (aucune perte) | Faible à moyenne : un adaptateur SQS derrière l'interface « file de rappels », quelques jours de travail et de tests ; aucune donnée à migrer (les rappels en attente sont recalculés) |
| **Minuteur** (sélection des rappels dus chaque minute) | Minuterie du worker (chaque minute, sans chevauchement) | EventBridge Scheduler (dans la gratuité de 14 millions de déclenchements/mois, ensuite 1 USD par million) | **Gratuit : minuterie du worker** au lancement ; EventBridge avec SQS | Même fiabilité tant que le worker tourne en deux exemplaires | Faible |
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

Même image Docker que l'API, autre commande de démarrage (`npm run start:worker`) ; planification et envois dans une file stockée dans PostgreSQL (table `notification_deliveries`, déjà développée).

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

**Option 2 au lancement public, conçue pour passer à l'option 3 sans réécriture.** Un seul poste payant est recommandé au lancement — le service séparé — parce qu'il apporte un avantage important et nécessaire (fiabilité des rappels, réactivité de l'app). Les autres composants restent gratuits parce qu'ils répondent pleinement au besoin (voir 3 bis) : FCM / APNs, file PostgreSQL, Parameter Store, Crashlytics, CloudWatch dans son offre gratuite.

1. Un service **worker** séparé (même code que l'API), **2 tâches** de 0,25 vCPU / 0,5 Go ARM, montée en charge automatique (2 à 6 tâches) selon la longueur de la file.
2. Planification **côté serveur**, recalculée à partir du journal des événements du projet (T-023) ; vérification « tâche déjà cochée ? » au moment d'envoyer ; heures calmes.
3. Envoi par **FCM / APNs** (notifications « système », priorité haute), plus une **notification locale de secours** non exacte dans l'app.
4. Le code passe par deux interfaces : « file de rappels » et « envoi de notification ». Remplacer la file PostgreSQL par SQS (option 3), ou FCM par un autre canal, ne touche pas les règles métier.
5. **Surveillance** : tableau de bord et alertes (rappels en retard, échecs FCM, file qui grossit), taux de remise mesuré par modèle de téléphone.

**Pourquoi pas l'option 1, moins chère :** elle place les rappels et l'app sur les mêmes machines au moment exact où les deux sont le plus sollicités, et une panne ou un déploiement de l'API arrêterait les rappels. Pour un produit dont la promesse est « Peni te rappelle à l'heure », la fiabilité des rappels est centrale.

## 6. Estimation budgétaire (rappels uniquement)

Hors API, base de données et autres services, chiffrés dans le budget d'hébergement global (`DEPLOYMENT.md`, à compléter selon R-01). Montants en USD par mois, estimés ; détail des ressources et du coût à Paris en section 10.

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

## 9. Décisions qui demandent réellement ton accord

Rien de ce qui suit n'est considéré comme validé. Elles ne bloquent pas le développement sans dépense (déjà fait, voir 12) ; elles bloquent l'**activation**.

| # | Décision | Ce que je propose | Quand elle devient nécessaire | Si tu refuses ou reportes |
| --- | --- | --- | --- | --- |
| 1 | **Service séparé pour les rappels (dépense)** | 2 tâches Fargate ARM 0,25 vCPU / 0,5 Go à Paris, ≈ **16 à 17 USD/mois** si un NAT est déjà prévu pour l'API, ≈ **23 à 24 USD/mois** sinon (détail en 10) | Avant le lancement public | Le worker tourne dans l'API (`WORKER_MODE=embedded`, 0 USD en plus), avec les inconvénients du point 7 ; bascule plus tard par simple configuration |
| 2 | **Création du projet Firebase** au nom de l'entreprise (gratuit) | Un projet « BIM » (Android puis iOS), compte de service réservé au worker, clé dans Parameter Store | Pour l'inscription des téléphones dans l'app et les tests sur de vrais téléphones | Pas de notification réelle ; le reste fonctionne. Google devient sous-traitant des jetons d'appareil : à mentionner dans la politique de confidentialité (ARTCI) |
| 3 | **Rythme des rappels et heures calmes** (valeurs produit) | Heure de la tâche, +1 h, +2 h ; aucun rappel de 22 h à 6 h, réglable par la personne | Avant l'activation | Toute autre valeur se change dans l'administration, sans développement |
| 4 | **Pas d'alarme exacte en version 1** | Notifications seulement, réexamen après mesures sur de vrais téléphones | Avant la version 1 | Les alarmes exactes demandent une autorisation Android spéciale (refusée par défaut sur Android 14) et un développement mobile en plus |

Points que je ne te soumets pas, parce qu'ils sont techniques, gratuits et réversibles (pour information) : file PostgreSQL native au lieu de pg-boss (12) ; délai de grâce de 30 minutes (réglage « provisoire », modifiable) ; permission d'administration « surveillance technique » (`system.health` : administrateur principal, technique, support), rattachée à la proposition T-019 encore à valider.

## 10. Coût réel du service des rappels à Paris (eu-west-3) — détail

**Ce qui est confirmé et ce qui ne l'est pas.** Les prix officiels de la région Paris n'ont pas pu être lus depuis l'environnement de travail (la page de prix AWS et le calculateur sont inaccessibles, et les sources publiques ne donnent que la Virginie, l'Irlande ou Francfort). Les chiffres ci-dessous sont donc **des estimations encadrées**, pas des prix confirmés. Confirmation exacte, gratuite et sans rien créer : le [calculateur AWS](https://calculator.aws/) (région « Europe (Paris) »), ou, une fois ton compte AWS ouvert, `aws pricing get-products --service-code AmazonECS --region us-east-1 --filters Type=TERM_MATCH,Field=location,Value="EU (Paris)"` (lecture seule, gratuite). Je le ferai avant toute demande d'activation.

Ressources nécessaires (aucune n'est créée) :

| Ressource | Quantité | Prix de référence | Estimation Paris / mois |
| --- | --- | --- | --- |
| Calcul Fargate ARM (Graviton) | 2 tâches × 0,25 vCPU / 0,5 Go, 730 h | us-east-1 : 0,03238 USD/vCPU-h, 0,00356 USD/Go-h → 7,21 USD par tâche | **≈ 15,9 à 16,6 USD** (Paris + 10 à 15 %) |
| Accès sortant vers Firebase | au choix : (a) NAT déjà prévu pour l'API, partagé ; (b) une adresse IPv4 publique par tâche | (a) heure du NAT payée par l'API, + ≈ 0,05 USD par Go traité ; (b) 0,005 USD/h par adresse (toutes régions) | (a) **≈ 0** ; (b) **7,30 USD** |
| Journaux CloudWatch | ≈ 1 ligne de mesure par minute et par tâche, ≈ 0,1 Go/mois | 5 Go/mois gratuits (partagés avec l'API), puis ≈ 0,5 USD/Go | **0** au lancement |
| Alarmes CloudWatch + e-mail d'alerte (SNS) | 4 alarmes (voir 11) | 10 alarmes gratuites (l'API en prévoit 4 : total 8) ; 1 000 e-mails SNS gratuits | **0** au lancement |
| Mesures personnalisées (filtres de journaux) | ≈ 4 | 10 gratuites, puis 0,30 USD | **0** au lancement |
| Secret Firebase | 1 paramètre chiffré (Parameter Store standard) | gratuit (chiffrement par la clé gérée AWS) | **0** |
| Image Docker | la même que l'API (ECR) | déjà comptée | **0** |
| Base de données | la même que l'API (RDS) ; ≈ 3 écritures par rappel | déjà comptée ; charge modérée | **0** en plus au lancement |
| Données sortantes | ≈ 1 million de notifications de ≈ 2 Ko = 2 Go | 100 Go/mois gratuits | **0** |
| **Total estimé** | | | **≈ 16 à 17 USD/mois** avec NAT partagé ; **≈ 23 à 24 USD/mois** avec adresses publiques |

Remarques : (1) le choix NAT / adresses publiques dépend du plan réseau global (`DEPLOYMENT.md`, encore à préciser selon R-01) ; un NAT seul coûte ≈ 35 à 40 USD/mois et n'est pas justifié pour le seul worker. (2) Une seule tâche diviserait le calcul par deux (≈ 8 USD) mais un déploiement ou une panne arrêterait les rappels ; non recommandé. (3) FCM reste gratuit à tout volume.

## 11. Reprise après panne, doublons, surveillance et alertes — prévus et testés

Tout ce tableau est **développé et vérifié par des tests automatiques** (fichiers `reminders.spec.ts`, `reminders.e2e-spec.ts`, `fcm-push-sender.spec.ts`, exécutés en CI sur une vraie base PostgreSQL) ; seule la partie « alarmes CloudWatch » est une configuration d'hébergement, décrite ici et à créer au déploiement.

| Mécanisme | Comment | Test qui le prouve |
| --- | --- | --- |
| **Aucun doublon** | Chaque rappel a une clé unique « projet, tâche, jour, tentative » en base ; la planification ignore les clés existantes ; un envoi n'est pris que par un seul worker (`FOR UPDATE SKIP LOCKED`) | 2 planificateurs et 3 workers en parallèle → 5 rappels, 5 envois exactement ; rejouer le tour n'envoie rien |
| **Dernier rempart anti-doublon** | Si un worker s'arrête entre l'envoi et son enregistrement, le rappel repart, mais avec le même identifiant de regroupement : le téléphone remplace l'affichage au lieu d'en montrer deux | identifiant stable vérifié (faux serveur FCM) |
| **Reprise après panne** | Un rappel « en cours d'envoi » plus de 120 s (worker arrêté, déploiement) est repris par un autre worker | rappel bloqué par un worker « arrêté » → repris une seule fois |
| **Pas de rappel périmé** | Au-delà de 30 min de retard, le rappel n'est pas envoyé (compté « manqué ») ; côté FCM, durée de vie limitée au temps restant (un téléphone éteint ne le reçoit pas des heures après) | rappel à 15:00 traité à 15:31 → « stale » |
| **Erreurs passagères** | Réseau, délai, saturation (429, 5xx) : nouvel essai après 1 puis 2 min, 3 essais au plus, puis « échec » visible | échec simulé → nouvel essai après 1 min → envoyé |
| **Jetons invalides** | Seuls les refus sans ambiguïté (appareil désinscrit, autre projet) retirent l'appareil ; une erreur de notre message ne supprime jamais d'appareil | jeton refusé → appareil retiré ; 400 → pas de suppression |
| **Revérification juste avant l'envoi** | Tâche cochée, projet en pause, rappels coupés par la personne, heures calmes, appareil déconnecté | 5 cas testés, aucun envoi |
| **Interrupteurs** | `WORKER_MODE` (déploiement) et réglage `notifications.reminders_enabled` (administration, coupé tant que non validé) | interrupteur coupé → rien n'est planifié, état « désactivé » |
| **Battement de cœur** | Chaque tour (chaque minute) enregistre l'heure en base | état « arrêté » si plus de 3 min sans battement |
| **État de santé** | `ok` / `dégradé` (rappels en retard, échecs ou manqués dans l'heure) / `arrêté` / `désactivé` ; `/health` du conteneur (503 si arrêté, ECS remplace la tâche) ; page `/admin/v1/reminders/health` | les 4 états testés ; accès refusé au rôle commercial |
| **Mesures** | Une ligne `reminders.metrics` par minute (planifiés, repris, traités, en retard, envoyés, manqués, échecs) | vérifiée au démarrage réel du worker en local |

Alertes à créer au déploiement (CloudWatch, gratuites dans les 10 alarmes) : (1) **worker arrêté** — aucune ligne `reminders.metrics` depuis 3 min, ou moins de 2 tâches en marche ; (2) **rappels en retard** — `overdue > 0` pendant 3 min ; (3) **échecs d'envoi** — `failed > 0` sur 15 min ; (4) **rappels manqués** — `stale > 0` sur 15 min. Destination : e-mail de l'équipe (SNS). Test prévu en préproduction : arrêter volontairement une tâche et vérifier la reprise et l'alerte.

## 12. Avancement du lot 2 (sans dépense)

| Étape | Contenu | État |
| --- | --- | --- |
| A | Fuseau horaire par personne (Abidjan par défaut), « aujourd'hui » calculé à l'heure locale partout | Fait, testé, CI verte |
| B | Appareils de notification (rattachés à la session, supprimés à la déconnexion), préférences (rappels, heures calmes) | Fait, testé, CI verte |
| C | Calcul des rappels en fonctions pures (clés, heures calmes, pauses, période active, fuseaux, textes de Peni) | Fait, testé |
| D | Worker : file PostgreSQL, reprise, anti-doublon, surveillance, point d'entrée séparé | Fait, testé |
| E | Envoi FCM (API HTTP v1) prêt mais inactif ; testé contre un faux serveur | Fait, testé |
| F | Écran « Rappels » dans l'app (Paramètres → Rappels) : recevoir ou non les rappels, heures calmes ; relié à l'API ; avertit tant que le service est fermé ; n'active rien | Fait, testé (Flutter, captures, Android contre l'API réelle) |
| — | Notifications de la maquette 28 (écran verrouillé, boutons « J'y vais ! / Plus tard », « alarme ») et inscription du téléphone | Attendent le projet Firebase (décision 2) et la décision sur l'alarme (4). La maquette 28 montre les notifications elles-mêmes, pas un écran de réglages : l'écran F n'a pas de maquette et reprend le style des Paramètres |

**Changement technique (pour information)** : la file prévue avec pg-boss a été remplacée par une table dédiée (`notification_deliveries`). Même coût (0), même base ; avantages : contrôle exact de la clé anti-doublon, des reprises et des états, une dépendance de moins, et un passage à SQS toujours possible derrière la même interface.

Sources : [Calculateur AWS](https://calculator.aws/) · [Tarifs Fargate us-east-1 (relus le 09/07/2026)](https://www.factualminds.com/tools/aws-fargate-pricing-calculator/) · [Fargate : coûts annexes](https://fortem.dev/blog/aws-fargate-pricing-real-costs/) · [Firebase — tarifs (FCM et Crashlytics « No-cost »)](https://firebase.google.com/pricing/?hl=fr) · [CloudWatch — tarifs et offre gratuite](https://www.cloudzero.com/blog/cloudwatch-pricing) · [Secrets Manager et Parameter Store](https://infisical.com/blog/aws-secrets-manager-vs-parameter-store) · [Grafana Cloud — offre gratuite](https://costbench.com/software/observability/grafana-cloud/free-plan/) · [Sentry — offre gratuite](https://costbench.com/software/developer-tools/sentry/free-plan/) · [FCM — limites et quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas) · [Android 14 — alarmes exactes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms) · [Tarifs Fargate (us-east-1)](https://www.vantage.sh/blog/fargate-pricing) · [Région Paris, écart de prix moyen](https://cloudprice.net/aws/region/eu-west-3) · [EventBridge — tarifs](https://aws.amazon.com/eventbridge/pricing/) · [SQS — tarifs](https://hevodata.com/learn/comprehensive-guide-on-aws-sqs-pricing/) · [ElastiCache — tarifs 2026](https://upstash.com/blog/aws-elasticache-pricing-explained-2026-full-cost-breakdown) · [Fin d'Amazon Pinpoint](https://docs.aws.amazon.com/pinpoint/latest/userguide/migrate.html)
