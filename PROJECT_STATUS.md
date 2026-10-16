# PROJECT_STATUS.md — État réel du projet BIM

Dernière mise à jour : 15/10/2026, session 1 — lots 0 et 1 terminés et vérifiés (CI complète, émulateur Android, navigateur) ; décisions C8 appliquées, coffres compris ; lot 2 : étapes A à K développées et testées sans dépense (préférences, notifications programmées et leurs actions, centre de notifications, envoi serveur prêt mais inactif) ; rien d'activé ; activation en attente de l'accord du fondateur.

## Résumé

L'analyse est validée avec corrections (`docs/ANALYSE.md`). Les fondations de l'API sont en place et testées : comptes, vérification du contact, sessions, récupération, opérations sensibles, âges (F15), récupération vérifiée (F16), espaces. L'application mobile (écrans 01 à 06 et écrans de code) est **analysée, testée et compilée en APK Android (debug)** par la CI GitHub (Flutter 3.47.7 stable) ; ses écrans ont été comparés aux maquettes. iOS n'est pas encore compilé (machine macOS nécessaire). Aucune règle financière n'est programmée.

## Légende des états

Conception · Interface · Backend · Intégration · Tests exécutés · Tests réussis · Dépendance externe · En attente de configuration · En attente de validation.

## Modules

| Module | Conception | Backend | Interface mobile | Intégration | Tests | Bloqué par |
| --- | --- | --- | --- | --- | --- | --- |
| Socle API (config, journaux, santé, erreurs, OpenAPI, limitation) | Terminée | Fait | — | Image Docker de production démarrée en CI | Exécutés, réussis | — |
| Environnements staging et production (AWS) | Plan écrit (`docs/DEPLOYMENT.md`) | — | — | **Non déployés** | Image testée en CI | Validation des dépenses AWS, autorisation ARTCI, nom de domaine |
| Base + migrations (19 migrations, 0000 à 0018, garde-fous dont F16 garanti par la base) | Terminée | Fait | — | — | Exécutés (e2e sur base vierge) | — |
| Authentification (inscription, code, connexion, sessions, mot de passe oublié) | Terminée | Fait | Fait | **Testée sur émulateur Android contre l'API** | API + Android : réussis | Fournisseur SMS réel : **prérequis du lancement public** (décision du 15/10, T-030), dépense à autoriser |
| F15 — âges par capacité | Terminée | Fait (réglages `age.*`) | — | — | Exécutés, réussis | Vérifications légales (DECISIONS.md) |
| F16 — récupération vérifiée, step-up | Terminée | Fait | Coordonnées, mot de passe, appareils | **Testée sur Android** (ajout d'un e-mail vérifié, nouveau mot de passe) | API + Android : réussis | — |
| Espaces (utilisateur / boutique / livreur) | Terminée | Contrôle d'accès et bascule faits ; création de boutique faite (lot 5-A, ouverture fermée tant que l'âge minimum des marchands n'est pas décidé) ; compte livreur : lot 7 | Écran 53 fait | Bascule vers l'espace utilisateur seulement (aucune boutique ni compte livreur avant les lots 5 et 7) | API : réussis ; capture | KYC (lot 5), `age.min_merchant` / `age.min_courier` |
| Connexions Google / Apple / Facebook | Terminée | Préparées, **désactivées** (`NOT_CONFIGURED`) | Boutons affichés, « Bientôt disponible » | — | Exécutés (indisponibilité honnête) | Comptes développeur + clés |
| Thème clair / sombre | Terminée | Préférence enregistrée | Compilé, capture sombre vérifiée | Écrit | — | — |
| Administration (API `/admin/v1` + application web React) | Terminée | Fait : connexion + TOTP, rôles, réglages, audit, utilisateurs, programmes types, comptes admin | Web : fait | **Testée dans Chromium contre l'API** | API : 8 unitaires + 13 e2e ; web : unitaires + 5 scénarios navigateur | Rôles à valider (T-019) ; hébergement AWS |
| Lot 1 — Projets BIM (écrans 18-24, 26, 27, 29-31) | Terminée | Fait : référentiels et catégories administrables, création en 5 étapes, mode Éco / Premium gratuit (C6), programmes types validés (mode, conseils), carte et journée, tâche suivante, tâches ajoutées / retirées, pause, signalement de projet ou général avec image jointe (+ traitement admin), avertissement de pause, coffres symboliques (70 %), mesures chiffrées, photos avant / après privées (S3), fin, suppression | Fait | **Testé sur émulateur Android contre l'API** (création, séance, photos, signalements avec image, captures réelles de l'écran) ; **admin testée dans Chromium** (image jointe chargée) ; **photos testées sur un vrai serveur S3** en CI | API, admin, Android : réussis (voir bilan du lot 1) | Contenu des programmes types (C7) ; Peni (lot 3) ; rappels (lot 2) ; profil public (lot 4) ; recommandations marchands (lot 5) ; stockage S3 de production (dépenses AWS, ARTCI) |
| Lot 2 — Rappels et notifications (écrans 17, 28 ; préférences) | Terminée | Fait : préférences, rappels désactivés par défaut, calcul des rappels (heures calmes option B), textes de Peni v3 (provisoires), worker (inactif), envoi FCM prêt (inactif), rappels à venir, centre de notifications, purge des comptes jamais vérifiés (désactivée, en simulation) | Fait : écran Rappels, notifications programmées et actions, écran Notifications, pastille | **Testé sur émulateur Android contre l'API** (vraies notifications, écran verrouillé, actions) | API, Flutter, Android : réussis | **Pas encore clôturé** : tests sur téléphones physiques, décisions et autorisations listées dans `docs/CLOTURE_LOT2.md` |
| Lot 3 — Peni (écrans 19, 20, 21, 24, 25, 26, 27) | **En cours** (commencé le 15/10, en parallèle du lot 2, T-031) | Fait : discussion guidée sans IA (moteur `guided-v1`), brouillon de projet, « Pas sûr ? » de l'objectif, encouragements (heures calmes respectées), cadrage santé, limites, conservation configurable (sans durée fixée), interface IA désactivée | Fait : écran 25, entrées 19, 20 et 21, encouragements de la journée et de la carte | Parcours Android de bout en bout (capture `a25_peni`) | API (13 unitaires, 8 e2e), Flutter (5) | Fournisseur d'IA (accord du fondateur), durée de conservation des discussions, encouragements et messages personnalisés (étapes suivantes) |
| Lots 4 à 12 (social, boutique, commandes, paiements, pièces, Lives…) | Analyse faite | Non commencés | Non commencés | — | — | Voir `DECISIONS.md` |

## Bilan du lot 1 — Projets BIM (15/10/2026)

État : **terminé** (15/10/2026) : toutes les exigences propres au lot 1 sont développées et vérifiées, coffres compris (règle validée par le fondateur le 15/10). Restent hors du lot 1 : contenus et validations listés ci-dessous.

### Exigences prévues (ANALYSE.md, section 11)
Catégories administrables ; création en 5 étapes ; modèles de programmes ; carte et journée ; tâches ; pause ; signalement ; suppression ; célébration ; avant / après. Ajouts décidés pendant le lot : modes Éco / Premium gratuits et indépendants de l'abonnement (C6), mesures chiffrées (bilan « d'après tes mesures »), décisions C8 du 15/10 (« Résoudre un problème » avec image, avertissement de pause, coffre symbolique).

### Fonctions développées et vérifiées
| Fonction | Écrans | Vérification réelle |
| --- | --- | --- |
| Catégories et objectifs administrables | 20, 21 ; admin | API e2e ; Playwright (création catégorie + objectif chiffré) |
| Création en 5 étapes, titre généré, limite de 5 projets | 19-23 | API e2e ; Android (création réelle) |
| Mode Éco / Premium gratuit, modifiable, sans paiement ni abonnement (C6) | 19 | 4 tests API dédiés + test mobile |
| Programmes types par mode, publiés avec le nom du validateur ; conseil du jour seulement s'il est validé | 24, 27 ; admin | API e2e ; Playwright (brouillon → publication) |
| Programme issu des réponses (en attendant C7), tâches ajoutées / retirées | 24 | API e2e ; Android |
| Carte des jours, tâche suivante, série | 18, 26 | API e2e ; captures |
| Journée : cocher, rattraper un jour passé, pas de case future | 27 | API e2e ; Android (séance cochée) |
| Pause (fin décalée, reprise anticipée ou automatique) | 29 | API e2e ; captures |
| Signalement d'une tâche, réponse du support, orientation santé (185 / 180) | 27 ; admin | API e2e ; Android (envoi avec image + suivi) ; Playwright (réponse + clôture) |
| « Résoudre un problème » (C8) : problème général, description, image ou capture jointe (privée, sans métadonnées), statut et réponse ; erreurs d'envoi (image refusée, stockage indisponible, réseau, trop d'envois) | 21 ; compte ; admin | API e2e (5 tests) ; Android (envoi depuis le compte + « Mes signalements », image réellement affichée) ; Playwright (image jointe chargée dans l'administration) |
| Avertissement avant une pause (C8) : texte validé, « Continuer mon programme » / « Mettre en pause » | 29 | captures |
| Mesures chiffrées et variation | 26, 30 | API e2e (pas encore dans le test Android) |
| Photos avant / après privées : réencodage, EXIF et GPS supprimés, lien temporaire, purge à la suppression | 22, 31 | API e2e (stockage local) ; **serveur S3 réel en CI** (lien signé, lecture anonyme refusée, effacement) ; Android (envoi, puis photos **réellement téléchargées et affichées**, capture réelle) |
| Journal des événements du projet (source prévue des rappels et de Peni) | — | API e2e (contrat) |
| Coffres (C8) : un par semaine complète + final, ouverts à 70 % des tâches prévues réellement cochées, badge et message de Peni, aucune valeur financière ; événement `chest_opened` ; badges dans le bilan | 26, 30 | 15 tests unitaires (durées 5 à 90 jours, pauses, tâches ajoutées / retirées, seuil exact, coffre final) ; API e2e (rattrapage, ouverture, refermeture, tâche ajoutée sans effet sur le passé) ; captures |
| Période active des tâches (T-024) : une tâche ajoutée ne compte pas pour les jours passés, une tâche retirée garde son historique | 24, 26, 27 | tests unitaires et e2e ; migration 0010 vérifiée sur une base existante (reprise de l'historique) |
| Fin du programme, suppression logique, renommer, projet public (réglage seul) | 30, 24 | API e2e |

### Comparaison avec les maquettes 18 à 31
Maquettes : `BIM_Maquettes_PNG_1-31.zip` (15 écrans de 18 à 31). Captures : branche `ci-captures`, 13 écrans (25 et 28 absents : lots 3 et 2 ; l'écran des préférences de rappel, sans maquette, est capturé sous `x15_rappels`, et sur émulateur sous `a28_rappels`).
Écarts corrigés le 15/10 : « par semaine » faux sur l'écran 24 (affichait 7 au lieu des 3 séances choisies) ; chemin en pointillés absent puis trop clairsemé (26) ; tâche en cours non mise en avant et heures futures en rouge (27) ; icônes de catégorie non colorées (20) ; sélections en noir, niveau en sélecteur segmenté, séances en cases (23) ; avertissement de pause (29) ; lien « Résoudre un problème » (21).
Défauts trouvés grâce aux captures réelles de l'émulateur (320 dp) et corrigés : message de confirmation avec bouton qui restait affiché et masquait l'écran ; libellé « Publier « J'ai fait mon BIM » » coupé ; puce « Problème avec un produit ou un service » qui débordait de 24 px ; « Intermédiaire » coupé (23).
Écarts voulus (décisions) : paiement et prix retirés de l'écran 24 (F4, C6) ; « Projet économique / Premium » et mention « choix gratuit » (C6) ; « Recommandé pour toi » sans marchands (lot 5) ; offres des marchands désactivées (21, lot 5) ; pas d'aperçu caméra intégré (22 : appareil photo du système) ; étape « durée du programme » ajoutée (23) ; boutons « Publier » en « bientôt disponible » (30, 31 : lot 4) ; Peni pensif au lieu de triste sur l'écran 29 (ne pas culpabiliser) ; textes de démonstration marqués comme tels.
Coffre (26) : implémenté (règle validée le 15/10), placé à côté du jour qui clôt sa période. En attente : avertissement d'un marchand avant une pause (29) — avec les marchands (lot 5).
Écarts mineurs restants, acceptés provisoirement : bulle de Peni remplacée par un bandeau en haut de la carte (26, bulle définitive avec Peni au lot 3) ; rappel « 14:45 » et icône calendrier absents (rappels : lot 2) ; barre d'onglets absente de la capture 18 (capture de l'écran seul) ; unités « cm / kg » dans le libellé plutôt que dans le champ (23).
Vérification dans un environnement adapté : **captures réelles de l'émulateur Android 14** (branche `ci-captures-android`) : photos avant / après et images jointes réellement affichées, émoji 🏆 rendu en couleur. Les captures de la branche `ci-captures` restent des rendus de test (sans émojis ni images réseau). Pas encore vérifié sur un vrai téléphone.

### Incomplet ou dépendant d'autres lots
Contenu des programmes types et habitudes du jour réelles (**C7, action du fondateur**) ; durée de conservation des images jointes aux signalements (T-022 : 12 mois **proposés, en attente de validation juridique et réglementaire**) ; écran 25 Peni (lot 3) ; écran 28 rappels (lot 2 : préférences faites ; notifications elles-mêmes après Firebase) ; écran 52 profil public et publication « J'ai fait mon BIM » (lot 4) ; recommandations de marchands (lot 5) ; stockage S3 de production (validation des dépenses AWS, autorisation ARTCI) ; pas de test sur un vrai téléphone ; iOS non compilé.

### Préparation des lots 2 et 3
Analyse : `docs/DEPENDANCES_LOTS_2_3.md` (aucun blocage d'architecture ; journal des événements complété, T-023). Décidé le 15/10 (T-025) : lancement en Côte d'Ivoire, architecture prête pour d'autres pays ; rappels par **notifications d'abord**. Étude selon R-01 et R-01 bis (meilleur équilibre qualité, fiabilité, sécurité, évolutivité et coût) : `docs/LOT2_RAPPELS_ETUDE.md` — 5 architectures et 8 composants comparés (gratuit / payant, sécurité, migration) ; **recommandé : service worker séparé (seul poste payant), FCM / APNs, file pg-boss, Parameter Store, Crashlytics, CloudWatch (gratuits car suffisants), évolution prévue vers SQS** ; budget estimé des rappels ≈ 16 à 21 USD/mois au lancement, ≈ 42 à 52 à 100 000 actifs, ≈ 170 à 370 à 1 million (prix de Paris à confirmer). **Lot 2 commencé sans dépense** (accord du 15/10, 07 h 40) : voir la section « Lot 2 — avancement » ; 4 décisions attendent l'accord du fondateur avant activation (étude, section 9).

### Vérification finale
- CI complète **réussie** sur `2c2a24c` (exécution 38691542705) : API (lint, compilation, 66 tests unitaires, 81 de bout en bout dont S3 réel, contrat OpenAPI, image Docker de production), mobile (analyse sans remarque, tests, captures, APK), Android sur émulateur contre l'API (parcours complet des lots 0 et 1, captures réelles), administration (7 scénarios Chromium).
- En local (15/10) : API 66 unitaires + 80 e2e réussis (S3 réel seulement en CI) ; administration 7 scénarios Chromium réussis ; migration 0010 appliquée sur une base existante.
- Non vérifié : vrai téléphone, iOS (compilation non lancée, décision du fondateur).

## Lot 3 — avancement (Peni, commencé le 15/10/2026)

| Étape | Contenu | Tests | CI |
| --- | --- | --- | --- |
| 3-A | **Discussion guidée avec Peni (écran 25)** : objectif, quantité, séances, moment, mode, budget, durée ; phrases libres comprises (« perdre du ventre avant mon mariage en décembre », « le samedi et le dimanche matin »), réponses rapides ; modèle de programme validé prioritaire ; brouillon au format de `POST /v1/projects`, repris à la dernière étape du nouveau projet et confirmé par la personne ; cadrage santé et urgences (185, 180) ; limites par 24 h et par discussion ; interface IA désactivée (`PENI_LLM_PROVIDER=none`, `peni.llm_enabled`=false) ; tables `peni_conversations`, `peni_messages` (migration 0017) | API : 13 unitaires (moteur), 8 e2e (brouillon accepté par la création de projet, isolation, limites, concurrence, IA jamais appelée) ; Flutter : 5 ; captures `25_peni` ; Android réel : projet créé par la discussion (capture `a25_peni`) | verte (run 38771178589, commit 43f1a91) |
| 3-B | **Conservation des discussions** : mécanisme configurable (`peni.conversation_retention_days`, null par défaut : aucune suppression), suppression nocturne par lots des discussions expirées et de leurs messages, verrou, journal, audit, page Maintenance ; contrôle des valeurs des réglages de Peni et de la purge (migration 0018) | 6 e2e (défaut, non validé, durée trop courte, suppression ciblée vérifiée, lots, passages simultanés, droits) ; règles des réglages ; navigateur | verte (run 38784816525, commit f1d0440) |
| 3-C | **Encouragements de Peni** dans la journée (27) et sur la carte (26) : catalogue versionné, 20 situations, heures calmes respectées (aucune incitation), aucune notification ; message habituel conservé si l'API ne répond pas | 8 unitaires (situations, heures calmes, mots interdits sur tout le catalogue, stabilité), 3 e2e ; Flutter 2 ; Android réel (capture `a27_encouragement`) | verte (run 38784816525) |
| 3-D | **« Pas sûr ? Demande à Peni » (écran 21)** : discussion courte sur l'objectif seulement, reprise à l'étape 3 | 5 unitaires, 1 e2e ; Flutter 1 | verte (run 38784816525) |
| 3-E | **Peni explique les tâches du programme (écran 24)** : « Demander à Peni » sur chaque tâche ; cinq questions courtes (c'est quoi, quand, comment m'y prendre, et si je ne peux pas, rappels) ; aucun exercice inventé (C7) ; pause, heures calmes et préférences de rappel pris en compte ; « Revenir à mon programme » | 9 unitaires, 4 e2e ; Flutter 3 ; capture `24_peni_explication` ; Android réel (capture `a24_peni_explication`, retour au programme vérifié) | verte (run 38789282044, commit e30467c) |
| IA-1 | **Peni IA, étape 1 : traitement des messages en deux temps** (autorisé le 15/10, sans fournisseur, sans appel externe) : la réponse est calculée sans transaction ni verrou, puis écrite brièvement sous verrou si la discussion n'a pas bougé (même dernier numéro d'ordre) ; sinon recalculée sur l'état à jour ; dernier essai entièrement sous verrou, comme avant. Comportement de Peni inchangé ; aucune route, colonne ni migration modifiée ; IA toujours désactivée | 5 e2e (aucun verrou ni transaction pendant une réponse lente, message passé entre-temps, discussion qui bouge à chaque essai, discussion supprimée, cinq envois simultanés) ; contre-épreuve : 4 échouent avec l'ancien traitement ; suite API 259 réussis | verte (run 38799588790, commit 97299b4, parcours Android au 2e essai : cause corrigée par 4f707c1, ci-dessous) |
| IA-2 | **Peni IA, étape 2 : architecture d'intégration et faux fournisseur** (autorisée le 15/10, sans fournisseur réel, sans appel externe, sans migration) : dossier `peni/llm/` (consignes versionnées `peni-ai-v1`, contexte minimal sans identifiant ni prénom, e-mails, liens et numéros masqués, vérificateur tout ou rien, délai maximal 8 s) ; l'IA ne peut que **reformuler les textes** du moteur guidé (boutons, état, brouillon inchangés) ; santé, urgence et récapitulatif jamais confiés à l'IA ; jamais d'appel sous verrou ; tout refus, erreur ou délai dépassé → réponse guidée intacte ; faux fournisseur local réservé aux tests (`*.testing.ts`, exclu de la compilation de production) ; `PENI_LLM_PROVIDER` n'accepte toujours que « none », `peni.llm_enabled` à false (en attente). Hors étape (migration ou décision nécessaire) : suivi de consommation, plafonds, budget global, marquage IA des messages, compréhension des réponses libres par l'IA | 32 unitaires, 10 e2e (désactivée par défaut, seuls les textes changent, 6 réponses non conformes refusées, santé et urgence, coupure par le réglage, aucun appel sous verrou, aucune donnée personnelle envoyée) ; contre-épreuve : 3 défauts introduits, détectés ; suite API 301 réussis | verte du premier coup (run 38817047103, commit a2c37d6) |

Prochaines étapes possibles du lot 3 (sans dépense) : reprise d'une discussion interrompue ; messages de Peni à l'ouverture d'un coffre et à la fin du programme depuis le catalogue commun. Avec ton accord seulement : fournisseur d'IA ; durée de conservation des discussions (T-032).

## Lot 4 — Social (commencé le 15/10/2026)

| Étape | Contenu | Tests | CI |
| --- | --- | --- | --- |
| 4-A | **Cœur du social** : publications (texte, 4 photos ré-encodées sans métadonnées) ; **« J'ai fait mon BIM »** depuis les écrans 30 et 31 (photos avant / après copiées dans la publication, projet et photos privés intacts, résumé du parcours sans donnée privée) ; visibilité tout le monde / abonnés / moi seul ; fils « Pour toi » et « Abonnés » (écran 10, avec mes projets en tête) ; publication (11, curseur avant / après) ; commentaires et réponses (12) ; nouveau Bim (16) ; profil et photo de profil (05, 52 ; nombre de projets visible seulement par soi, ville selon la confidentialité) ; recherche de personnes ; abonnements ; **blocage** dans les deux sens ; **signalement** et page **Modération** de l'administration (masquer, rétablir, audit) ; limites anti-spam administrables (migration 0019, additive) | API : 9 e2e (visibilité, pagination, compteurs, blocage, modération, comptes suspendus, limites) ; admin : 1 test navigateur ; Flutter : 7 ; Android réel : BIM publié contre l'API puis vu dans le fil (captures `a16_publication`, `a10_fil`) ; captures 10, 11, 12, 16, 52, 63 | verte (branche lot4-wip, run 38828939190) |
| 4-B | **Stories** (photo visible 24 h par soi et ses abonnés, anneau « vue », signalement et masquage, fichiers effacés par la maintenance 24 h après l'expiration sauf signalement ouvert) ; **fil des visiteurs** sans compte (écran 06, publications « Tout le monde » en lecture, toute action ouvre l'invitation à créer un compte) ; **notifications sociales** dans le centre de notifications (j'aime, commentaire, nouvel abonné, contenu masqué par la modération ; lues dans leurs sources, sans copie ; ni ses propres actions ni les personnes bloquées) ; migration 0020 (additive) | API : 4 e2e (suite : 314 réussis) ; Flutter : 2 (fil des visiteurs, lecteur de stories : défaut de toucher détecté et corrigé) ; Android réel : fil avec bandeau des stories | verte (branche lot4-wip, run 38834277238) |

Hors du lot 4 : pièces, « Encourager », donateurs et médailles (lot 9) ; Reels et vidéo (lot 11) ; « Produits et services utilisés » (lot 5) ; identifier des personnes et ajouter un lieu (non prévus tant qu'aucune règle de confidentialité ne les couvre). Décision à prendre : visibilité par défaut des publications des 16-17 ans (aujourd'hui « Tout le monde » pour tous, comme les maquettes).

## Lot 5 — Boutiques et BimShop (commencé le 16/10/2026)

Aucun paiement en ligne, aucune transaction réelle, aucun service payant ni fournisseur externe dans ce lot.

| Étape | Contenu | Tests | CI |
| --- | --- | --- | --- |
| 5-A | **Ouvrir une boutique** (écrans 07 à 09) : présentation de la boutique, puis « Sécurise ta boutique » (pièce d'identité recto / verso selon le type, selfie à l'appareil avant, numéro Mobile Money **confirmé par code SMS**, adresse facultative), envoi pour vérification, refus motivé puis correction, validation. **Pièces chiffrées dans l'application** (AES-256-GCM, clé `KYC_ENCRYPTION_KEY` hors Git ; sans clé, le service est fermé) et ré-encodées sans métadonnées ; **consultation réservée** à la permission `merchants.review` ; **chaque consultation d'une pièce est journalisée** (`admin.kyc_document_viewed`). Page **Boutiques** de l'administration (photos chargées par l'API, jamais par lien public). Notifications « boutique ouverte » / « à corriger ». Ouverture **fermée tant que `age.min_merchant` n'est pas décidé**. Migration 0021 (additive) | API : 3 e2e (suite : 317 réussis) ; admin : 1 test navigateur (10 réussis) ; Flutter : 4 + capture 07 ; défaut d'affichage sur petit écran (écran 09) détecté en CI et corrigé | verte (branche lot5-wip, run 38840943665) |
| 5-B | **Espace marchand** (écran 55) : présentation de la boutique, compteurs réels (en ligne, brouillons, abonnés ; ventes et commandes annoncées pour le lot 7, sans chiffre inventé), « + » = ajouter un article (E15) ; **articles et prestations** en brouillon puis publiés (une photo et une rubrique obligatoires, boutique ouverte), photos ré-encodées sans métadonnées (6 au plus), prix barré, durée des prestations, **variantes** (tailles, couleurs) et **stock par mouvements** (jamais négatif, garanti par la base), retrait ; **rubriques** de l'écran 33 ; l'espace actif (utilisateur ou boutique) décide de l'accueil (`/v1/me`). Migration 0022 (additive) | API : 4 e2e ; Flutter : 4 + captures 55, x17, x18 ; défauts détectés en CI et corrigés (analyse, bouton hors écran dans un test) | verte (branche lot5b-wip, run 38842997276) |
| 5-C | **BimShop** (écrans 32, 33, 34, 54), visiteurs compris en lecture : articles en ligne des boutiques ouvertes seulement, rubrique ou sous-rubrique, recherche texte, tri date / prix, pagination ; fiche article (disponible / épuisé, **jamais le stock exact**, autres articles de la boutique ; « Commander » annoncé pour le lot 7, **aucun paiement**) ; profil public de boutique avec « Suivre » ; articles mis de côté (cœur) | API : 3 e2e ; Flutter : 4 + captures 32, 33, 34, 54 | verte (branche lot5c-wip, run 38844042774) |
| 5-D | **Demandes et offres de projet** : la boutique voit une demande **anonymisée** (catégorie, titre, objectif, mode, durée ; ville seulement si publique ; ni nom, ni profil, ni description, ni mesures, ni photos), uniquement dans les rubriques où elle a des articles, **jamais pour les moins de 18 ans** ni entre personnes qui se sont bloquées ; une offre par boutique et par projet (message, 3 articles au plus, limite quotidienne réglable) ; écran 49 : offres reçues, refus définitif, « ne plus recevoir » ; notification dans le centre ; **« Recommandé pour toi »** des projets Premium (écran 24). Migration 0023 (additive) | API : 4 e2e (suite : 328 réussis) ; Flutter : 2 + captures 49, x19 | verte (branche lot5d-wip, run 38844044944) |

Décisions en attente (lot 5) : âge minimum des marchands (`age.min_merchant`, ouverture fermée d'ici là) ; durée de conservation des pièces (`kyc.document_retention_days`, non fixée : rien n'est effacé automatiquement) ; rôles autorisés à vérifier les boutiques (`merchants.review` : super_admin et support **proposés**).

Décisions à prendre (lot 5, suite) : correspondance catégories de projet → rubriques (**proposée**, table `project_category_rubriques`) ; exclusion des projets des moins de 18 ans des demandes vues par les marchands (**proposée**, par prudence) ; `offers.max_per_shop_per_day` = 20 (**provisoire**). « Discuter » avec une boutique : avec la messagerie (lot 6). Commande, réservation et paiement : lots 7 et 8.

## Lot 6 — Messagerie (commencé le 16/10/2026)

Aucune notification sur le téléphone (Firebase non activé) : la pastille de l'onglet Messages se met à jour toutes les 30 s et la conversation ouverte toutes les 5 s. Aucun service payant ni fournisseur externe.

| Étape | Contenu | Tests | CI |
| --- | --- | --- | --- |
| 6-A | **Conversations à deux** (écran 47, onglet Messages) : texte et photo (ré-encodée sans métadonnées, stockée en privé, lien signé), « Vu », non-lus et pastille, messages précédents (curseur), supprimer pour tout le monde. **Demandes** (E10) : si la personne ne me suit pas, mon message arrive dans ses demandes ; lire une demande ne prévient pas son auteur ; répondre ou « Accepter » l'accepte ; « Refuser » la masque sans prévenir. **Jamais de message d'une personne non suivie vers un moins de 18 ans** ; blocage, comptes suspendus et espace boutique refusés. **Signalement** d'un message ; l'administration ne voit que les messages signalés, **chaque consultation est journalisée** (`admin.reported_message_viewed`), masquer / rétablir. Limites quotidiennes sous verrou. Bouton « Message » sur le profil. Migration 0025 (additive) | API : 6 e2e (suite : 359 réussis) ; Flutter : 3 + captures 47, x20 ; défaut détecté en CI et corrigé (contrôleur de saisie du dialogue « Nouveau message » libéré trop tôt) | verte (branche lot6a-wip, run 38882891779) |
| 6-B | **Messagerie des boutiques** (écrans 48, 49, 51) : « Discuter » depuis une fiche article (bandeau de l'article : prix, en stock ou épuisé, **jamais le stock exact**), « Écrire » depuis le profil de la boutique, « Discuter » depuis une offre de projet (après accord : la boutique saura qui écrit). Les boutiques reçoivent les messages de tous, **sans démarcher personne** (seule la cliente ouvre la conversation). **Boîte partagée par l'équipe** de la boutique (propriétaire et employés, appartenance revérifiée à chaque requête) : Tous, Non lus, Marqués, Archivés (une conversation archivée revient au message suivant de la cliente), réponses rapides (10 au plus). Chaque message de la boutique garde la personne de l'équipe qui l'a écrit (limite quotidienne et journal d'audit) ; suppression par son auteur ou le propriétaire. Blocage avec le propriétaire, cliente suspendue ou boutique fermée : la conversation disparaît. Signalement dans les deux sens. **Point d'intégration des commandes** : onglet « Commandes » annoncé, « Commander » annoncé dans la conversation, tout type de message à venir s'affiche avec un texte neutre (jamais de bulle vide). Migration 0026 (additive) | API : 6 e2e (suite : 365 réussis) ; Flutter : 6 + captures 48, 51, x21 | verte (branche lot6b-wip, run 38893334432) |

Décisions en attente (lot 6) : durée de conservation des messages (`messages.retention_days`, non fixée : rien n'est effacé automatiquement) ; `messages.daily_limit` = 500 et `messages.new_conversations_daily_limit` = 20 (**provisoires**) ; règle E10 et protection des mineurs ci-dessus (**proposées**). Décision à valider (6-B) : une personne de 16-17 ans peut écrire à une boutique (c'est elle qui ouvre la conversation ; la boutique ne démarche personne). Lot 7 : règles proposées le 16/10/2026 (paiement de l'article, frais de livraison, délais d'attribution, commandes sans livreur, droits des employés, annulations et litiges, code de remise, âges), en attente de validation ; F3 bis décidée (espèces réservées aux livreurs employés de la boutique, `DECISIONS.md`). À venir : 6-C (réactions ; messages vocaux et groupes soumis à accord).

## Lot 2 — avancement (15/10/2026, partie sans dépense)

Cadre : développement autorisé s'il n'engage aucune dépense et ne dépend d'aucune décision en attente. **Rien n'est activé** : `WORKER_MODE=off`, `PUSH_PROVIDER=none` par défaut, réglage `notifications.reminders_enabled` = false (« en attente »), aucun projet Firebase, aucune ressource AWS.

| Étape | Contenu | Tests | CI |
| --- | --- | --- | --- |
| A | Fuseau horaire par personne ; « aujourd'hui » à l'heure locale (projets, photos, signalements) | unitaires + e2e | verte (run 38701596068) |
| B | Appareils de notification (par session, supprimés à la déconnexion) ; préférences ; réglages des rappels « en attente » | e2e | verte (run 38701596068) |
| C | Calcul des rappels (fonctions pures) | 9 unitaires | verte (run 38702790136) |
| D | Worker : file PostgreSQL, anti-doublon, reprise, péremption, essais, revérification, santé, `/health`, page admin | 7 e2e (workers concurrents, panne, jeton invalide…) ; démarrage réel du worker séparé vérifié en local | verte (run 38702790136) |
| E | Envoi FCM HTTP v1 prêt, inactif | 5 tests contre un faux serveur ; 1 test de configuration | verte (run 38703183336 : API, admin, mobile, Android) |
| F | Écran « Rappels » dans l'app (Paramètres → Rappels) : recevoir ou non les rappels de Peni, heures calmes personnelles ou par défaut ; relié à `GET/PATCH /v1/me/notification-preferences` ; avertissement « pas encore en service » tant que le réglage de la plateforme est coupé | 10 tests Flutter (modèle, requêtes, écran) ; captures `x15_rappels` (normal, petit écran, sombre) ; parcours Android contre l'API réelle (choix enregistré puis relu, capture `a28_rappels`) ; e2e API complété | verte (run 38719370532) |

| G | **Rappels désactivés par défaut** (décision du 15/10) ; préférence distincte de l'autorisation d'Android | e2e API (défaut, heures calmes sans activation, rien sans activation puis envoi après activation) ; Flutter ; Android | verte (run 38723547646) |
| H | Firebase préparé sans projet : source de jeton inactive, inscription de l'appareil prête ; étapes de création (`docs/FIREBASE_PROJET.md`) | Flutter (aucune source simulée, routes d'inscription) | verte (run 38732970768) |
| I | **Notifications programmées classiques** (maquette 28) : rappels des 48 h calculés par l'API, programmés par le téléphone en mode non exact ; actions « J'y vais ! » (ouvre la journée) et « Plus tard » (ferme) ; autorisation d'Android demandée à l'activation ; synchronisation à l'ouverture, au retour, après un changement ; un seul canal par appareil | e2e API ; Flutter (programmation, autorisation accordée ou refusée) ; **Android réel** : vraie fenêtre d'autorisation acceptée, deux vraies notifications affichées par Android avec leurs actions, « Plus tard » les ferme, « J'y vais ! » ouvre la journée du projet (captures `a28_rappels`, `a28_notifications`, `a28_jy_vais`) | verte (run 38732970768) |
| J | **Centre de notifications** (écran 17) : coffres, réponses du support, rappels envoyés par le serveur ; filtres Tout / Projets ; non lues en évidence ; pastille sur la cloche | e2e API (sources, ordre, textes, filtres, pages, « vu », cloisonnement, 30 jours) ; Flutter ; captures `17_notifications` ; Android (réponses réelles du support, pastille, marquées vues, capture `a17_notifications`) | verte (run 38732970768) |
| K | Enquête sur la perte de l'émulateur (sonde à la demande, 12 situations, Android 13 à 15) et évaluation de 6 solutions, aucune appliquée | voir `docs/TESTING.md` | — |
| L | **Maquette 28, écarts** : petite icône « B » monochrome (barre d'état), couleur BIM, avatar de Peni selon la tentative (joyeuse, pensive, triste ; pose choisie par l'API, R1) ; textes v2 plus proches de la maquette (« C'est l'heure ! … 💪 Tu vas tout déchirer. », « Vas-y, ça ne prend qu'une minute… 🥺 ») ; dernier rappel encourageant, sans culpabiliser | unitaires et e2e API ; Flutter (icônes, pose) ; Android : notifications réelles avec les textes v2, capture de l'écran verrouillé (écran réellement verrouillé, icône « B ») | verte (run 38750712525) |
| M | **Préparation des tests sur téléphones physiques** : « rappel d'essai » (versions de test uniquement, sans ouvrir le service), workflow manuel « APK de test (téléphones) », protocole et grille T1 à T15 (`docs/TESTS_TELEPHONES.md`) | Flutter (rappel d'essai : autorisation, programmation, service inchangé) | verte (run 38750712525) ; tests sur téléphones **pas encore réalisés** |
| N | **Décisions du 15/10, 15 h 44 (T-030)** : heures calmes option B (rappel à l'heure choisie envoyé, relances bloquées, jamais reportées) ; textes de Peni v3 (tâche en tête, pose encourageante), provisoires ; bouton « Les 3 textes de Peni » pour les téléphones (T17) | unitaires (7 cas d'heures calmes, nuit minute par minute, textes, copie de l'app identique au serveur) ; e2e (relance bloquée après coup, rappel initial envoyé, aucun doublon) ; Flutter | voir `docs/CLOTURE_LOT2.md` |
| O | **Purge des comptes jamais vérifiés** (30 jours), **désactivée et en simulation par défaut** : verrou, plafond de 500, aucun code récent, audit sans donnée personnelle, page Maintenance de l'administration (simulation à la demande) ; migration 0016 | 9 e2e (dont : comptes actifs, suspendus, supprimés, récents, utilisés jamais touchés ; simulation ; plafond ; passages simultanés ; tables liées classées) ; test navigateur de l'administration | voir `docs/CLOTURE_LOT2.md` |

Suite API locale : 328 tests réussis le 16/10 après le lot 5-D (317 après le lot 5-A) (314 après le lot 4-B) (1 ignoré, 1 à écrire, inchangés). Coût de Paris détaillé, mécanismes de fiabilité et décisions à valider : `docs/LOT2_RAPPELS_ETUDE.md`, sections 9 à 12. Prix exacts de Paris **non confirmés** (inaccessibles depuis l'environnement de travail) : estimation ≈ 16 à 17 USD/mois (NAT partagé) ou ≈ 23 à 24 USD/mois (adresses publiques), à confirmer avec le calculateur AWS avant toute activation.

## Tests exécutés (session 1, 14/10/2026)

Environnement : Node 22.22, PostgreSQL 16.15 local.

| Suite | Commande | Résultat |
| --- | --- | --- |
| Unitaires API | `npm run test:unit` | 19 / 19 réussis |
| Bout en bout API (base vierge, migrations réelles) | `npm run test:e2e` | 37 / 37 réussis (dont 10 tests de non-régression issus de la relecture de sécurité) |
| Compilation TypeScript stricte | `npm run lint` | sans erreur |
| Build de production + migrations compilées | `npm run build` puis `node dist/database/migrate.js` | réussi |
| Mobile (CI GitHub) | `flutter analyze`, `flutter test` (7 tests), 29 captures, `flutter build apk --debug` | réussis (exécution 38636192504) |
| Android ↔ API (émulateur) | `flutter test integration_test` | réussi (exécution 38636192504) |
| API (15/10) | unitaires 66 ; e2e 81 dont le stockage S3 réel (CI) + 1 à écrire au lot 8 (abonné Premium) | réussis (local : 80 + S3 non lancé faute de serveur S3 ; CI : 81) |
| Administration web | Vitest (2) + Playwright/Chromium contre l'API (7 scénarios) | réussis (CI, job `admin`) |
| Image Docker de l'API | build, migrations, démarrage en production, santé | en CI (job `api`) |

## Relectures indépendantes (session 1)

- **Administration (lot 0, partie 2)** : 1 problème grave et 3 moyens trouvés puis corrigés et couverts par des tests : force brute du code TOTP en recommençant la connexion, verrouillage contournable par requêtes parallèles, ancienne étape d'enrôlement pouvant remplacer l'appareil configuré, réponse de verrouillage révélant les comptes admin. Mineur corrigé : jeton d'étape masqué dans les journaux. Risque restant accepté (T-015) : verrouillage déclenchable par qui connaît l'e-mail d'un admin → admin limité aux adresses de l'équipe en production.

- **Sécurité de l'API** : 2 problèmes graves, 5 moyens, 8 mineurs signalés ; tous les graves et moyens sont corrigés et couverts par un test (suppression simultanée de coordonnées, IP falsifiable derrière un proxy, énumération de comptes par « mot de passe oublié », force brute des codes, rafraîchissement concurrent d'une réinitialisation, bombardement de SMS, configuration permissive). Mineurs corrigés : identifiants mal formés (500 → 400), paramètres SQL dans les journaux, comptage des essais par compte et en HMAC, autorisation step-up liée à la session, TRUNCATE de l'audit, audits manquants. Risques acceptés : `DECISIONS.md`, T-015.
- **Code Flutter (lecture statique, sans compilateur)** : aucune erreur de compilation certaine trouvée ; corrigés : dépendance `intl` incompatible avec les Flutter récents, requêtes pouvant rester bloquées et déconnexion intempestive dans l'intercepteur réseau, démarrage pouvant rester bloqué, appels après fermeture d'écran, double envoi du code, quelques avertissements de l'analyseur.

## Communication réelle Android ↔ API (job CI « android-e2e », 14/10/2026)

L'application Android (APK debug) tourne sur un émulateur Android 14 (320 dp de large) et parle à l'API réelle (PostgreSQL neuf, migrations réelles, mode développement). Le code de vérification est lu dans le journal de l'API par un relais propre à la CI, comme une personne lirait son SMS.
Parcours réussi (exécution 38636192504) : bienvenue → inscription en 2 étapes → code → accueil → déconnexion → mauvais mot de passe refusé (401, message affiché) → connexion → création d'un projet en 5 étapes → programme → journée → séance cochée. Requêtes reçues par l'API : interests 200, register 201, register/verify 200, logout 204, login 401 puis 200, projects/catalog 200, projects 201, journée 200, case cochée 200.
Défauts réels trouvés par ce test et corrigés : libellés de champs et pied de l'écran de connexion qui débordaient à 320 dp, tuiles de catégories trop petites, migrations absentes de `npm run build` (l'API compilée ne pouvait pas migrer sans Docker).
Non vérifié : un vrai téléphone, un vrai fournisseur SMS, iOS.

## Vérification en CI GitHub (dépôt privé djannigraphi-prog/Bim, 14/10/2026)

| Exécution | Commit | API | Mobile |
| --- | --- | --- | --- |
| 38618072849 | 23f32db | réussie | **échec** à `flutter analyze` |
| 38618617162 | ee3a4b2 | réussie | échec : 5 erreurs réelles dans `app_theme.dart` (`CupertinoPageTransitionsBuilder` n'est plus exporté par `material.dart` depuis Flutter 3.35) + 1 remarque ; `theme_test` ne compilait pas |
| 38618912551 | 738bacf | réussie | **réussie** : analyse sans remarque, 4 tests réussis |
| 38619469611 | c97e382 | réussie | analyse : 4 remarques de style dans le nouveau fichier de captures ; tests, captures et **APK Android debug** réussis |
| 38620641623 | 286efad | réussie | **réussie** : analyse, tests, captures, APK Android debug |

Captures des écrans : branche `ci-captures` (mise à jour par la CI à chaque envoi sur main ; main n'est jamais modifiée par la CI).
Écarts corrigés après comparaison avec les maquettes : police des boutons (héritée du thème), espacement des lettres, hauteur des boutons, champs et puces, taille des logos 01 et 03, pose de Peni sur l'écran 06.
Écarts restants (connus) : photos de l'écran 02 remplacées par des cartes (droits des photos, D-UI-03) ; champ mot de passe et textes d'aide en plus sur l'écran 04 (D-UI-03) ; logo Google simplifié (« G ») ; « Pas encore de compte ? » sous les boutons sociaux au lieu du bas de l'écran 03 ; fond de l'écran 06 vide (fil d'actualité : lot 3) ; police du système (D-UI-02).
Limites : captures rendues avec la police Roboto (Android) ; l'app n'a pas encore tourné sur un vrai téléphone ni contre l'API ; pas de compilation iOS (runner macOS, consomme 10 fois plus le quota gratuit GitHub) ; dossiers `android/` et `ios/` générés uniquement dans la CI avec un identifiant provisoire (l'identifiant définitif de l'app est à choisir).

## Vérification de l'app mobile dans l'environnement de travail (historique, 14/10/2026, 18 h 30)

Tentatives faites, toutes refusées par le filtre réseau de l'environnement (réponse 403 ou absence de réponse) :
- SDK Flutter et Dart officiels (`storage.googleapis.com`), miroirs (`storage.flutter-io.cn`, `mirrors.tuna.tsinghua.edu.cn`) ;
- dépôt `github.com/flutter/flutter` et `codeload.github.com` ;
- paquets Dart (`pub.dev`, `pub.flutter-io.cn`) et Android SDK (`dl.google.com`) ;
- Docker Hub (image Flutter).
Seuls les registres npm et PyPI sont accessibles : aucun ne fournit Flutter. Un analyseur de syntaxe Dart disponible sur npm (tree-sitter) a été essayé : il ne se charge pas et ne connaît pas la syntaxe Dart 3, son verdict n'aurait pas été fiable.

Moyens de vérification possibles :
1. **GitHub Actions** (recommandé) : la CI du dépôt (`.github/workflows/ci.yml`) installe Flutter et lance `flutter analyze` et `flutter test` à chaque envoi. Il suffit d'un dépôt GitHub (privé) auquel cette session peut envoyer le code.
2. **Un ordinateur avec Flutter** : suivre `docs/INSTALLATION.md`, section 3, et envoyer le résultat de `flutter analyze` et `flutter test`.
3. Pour vérifier les écrans eux-mêmes : lancer l'app sur un émulateur Android et un simulateur iOS (option 2), ou ajouter des tests de capture d'écran (« golden tests ») exécutés par la CI (option 1) pour comparer avec les maquettes 01 à 06.

## Erreurs et limites connues

- Application mobile : compilée pour Android en CI ; iOS non compilé ; pas encore testée sur un téléphone contre l'API.
- Émulateur Android de la CI : un glissement au-delà du haut d'une liste fait perdre l'émulateur entier **quand trois éléments sont réunis** : un dessin SVG à l'écran (Peni), l'effet d'étirement d'Android et le moteur de rendu Impeller. Retirer l'un des trois suffit (sonde, 8 situations, `docs/TESTING.md`). Origine probable : le rendu graphique simulé de l'émulateur, déclenché par un contenu de BIM. **À vérifier sur de vrais téléphones** ; si le problème s'y produit, deux corrections possibles (Peni en image PNG, ou effet d'étirement remplacé), à décider. Le parcours de bout en bout évite ce geste ; aucun test supprimé.
- Maquette 28, écarts restants (la maquette n'est **pas** considérée comme terminée) : pas de notification « ALARME » encadrée (pas d'alarme exacte en version 1, décision du 15/10) ; texte du dernier rappel volontairement plus doux que « Je t'en supplie 😭 … » (décision C8, à confirmer par le fondateur) ; « Il ne reste plus que 2 h » non calculé ; lieu de la tâche (« au Fitness Club ») non géré (les tâches n'ont pas de lieu) ; rendu propre à Android (la maquette montre un iPhone) ; iOS non compilé ; envoi par le serveur (Firebase) en attente ; pas encore vérifié sur de vrais téléphones.
- Android regroupe automatiquement plusieurs notifications de BIM (« BIM · 2 ») et les affiche repliées : texte coupé, sans l'avatar de Peni ni les boutons, qui apparaissent quand on déplie (comportement du système, vérifié : les boutons sont touchés après dépliage dans le parcours ; capture `a28_notification_seule` avec l'avatar). Le rendu des téléphones physiques reste à vérifier (T3, T4).
- CI : l'image `ubuntu-latest` de GitHub passe à Ubuntu 26 à partir du 19/10/2026 (annonce de GitHub) ; surveiller les premiers passages.
- Notifications programmées par le téléphone : couvrent les 48 h suivant la dernière ouverture de l'app ; une tâche cochée sur un autre appareil ne retire le rappel qu'à la synchronisation suivante ; Android peut décaler l'affichage de quelques minutes (mode non exact).
- CI Android, échecs intermittents (résolu le 15/10) : 3 échecs rapides du parcours Android en 22 exécutions (avant le premier test) et 1 échec de la compilation Android. Cause : le NDK 28.2.13676358 imposé par Flutter et l'image système de l'émulateur étaient téléchargés chez Google à chaque exécution ; une archive tronquée (« Error on ZipFile unknown archive ») faisait échouer l'étape. Correction : ces paquets sont repris du cache GitHub (commit 4f707c1) ; 6 exécutions de vérification sur 6 vertes, cache repris dans chacune. Les deux échecs survenus avant le démarrage de notre script (17 s et 70 s) n'ont pas laissé de journal lisible : leur attribution à la même cause est probable mais non prouvée ; une étape de diagnostic (seulement en cas d'échec) le dira si cela se reproduit.
- Dépôt GitHub : **public** d'après l'API GitHub le 15/10/2026 (la section « Vérification en CI » ci-dessus le décrivait comme privé). Visibilité à décider par le fondateur ; en privé, les minutes de GitHub Actions sont décomptées.
- Diagnostic CI : les tests Flutter en échec et le journal système Android (en cas d'arrêt de l'app) sont publiés en annotations, lisibles même quand les journaux bruts ne sont pas téléchargeables.
- Dossier `ios/` non versionné (le dossier `android/` l'est, avec l'identifiant provisoire `ci.bim.app`, D-APP-01).
- Envoi réel des SMS et e-mails absent : en développement, les codes s'affichent dans la console de l'API. Le démarrage en staging ou en production est refusé tant qu'un vrai fournisseur n'est pas configuré.
- Photo de profil (écran 05) : non disponible (module médias, lot 4).
- Police de marque non choisie (police du système en attendant).
- Purge des comptes jamais vérifiés : développée, **désactivée et en simulation** (suppression réelle sur validation du fondateur) ; conservation des tentatives de connexion et des codes non décidée, non développée. Un compte non vérifié libère toujours son nom d'utilisateur après 24 h.
- Docker indisponible dans l'environnement de la session 1 : `infra/docker-compose.yml` et le `Dockerfile` n'ont pas été exécutés ici (le build TypeScript et les migrations compilées l'ont été).

## Décisions

- Prises : voir `DECISIONS.md` (règles permanentes **R-01 et R-01 bis** sur les choix techniques et les dépenses, F15 provisoire, F16, corrections du 14/10, T-001 à T-025, D-UI-01 à 03).
- Réponses F1 à F17 reçues le 14/10/2026 et enregistrées (orientations retenues ou validations requises). **Aucun changement de code** : rien de ce qui est programmé n'était concerné ; aucune fonction financière n'a été programmée.
- C6 décidé le 14/10 : mode de projet gratuit et indépendant de l'abonnement (tests ajoutés). En attente du fondateur : C7 (programmes types) ; points à clarifier C1 à C5 (`DECISIONS.md`) ; validation des écarts de maquettes D-UI-03 ; police D-UI-02 ; décision sur la simulation des frais (`docs/SIMULATION_FRAIS.md`).

## Commandes

```bash
docker compose -f infra/docker-compose.yml up -d     # ou scripts/local-postgres.sh start
cd apps/api && set -a && . ./.env && set +a
npm run db:migrate && npm run start:dev               # API sur :3000, documentation sur /docs
npm test                                              # unitaires + e2e
npm run openapi:export                                # met à jour packages/api-contract/openapi.json
cd ../mobile && flutter pub get && flutter run --dart-define=BIM_API_URL=http://10.0.2.2:3000
```

## Prochaines tâches prioritaires (note de reprise)

1. Lot 2 : **tests T1 à T17 sur au moins trois vrais téléphones** (à réaliser par le fondateur ou un testeur, `docs/TESTS_TELEPHONES.md`), puis report des résultats, corrections et décision sur le plantage avec Peni (D5) et le retard des notifications du téléphone (P1 à P3). Restent soumis à son accord : service séparé payant, projet Firebase, ouverture du service, suppression réelle de la purge. Aucune dépense sans accord.
1. Lot 1 (contenus) : programmes types (C7) ; validation juridique de la conservation des images jointes (T-022). Profil public (écran 52) → lot 4 ; écran 25 (Peni) → lot 3 ; écran 28 : notifications programmées faites ; envoi par le serveur après Firebase.
2. **Nécessitent les programmes types validés (C7)** : contenu des tâches par catégorie, « habitude du jour » de l'écran 27, durées propres à chaque programme. La saisie se fait dans l'administration (Programmes types).
3. Compilation iOS : pas lancée (décision du fondateur du 14/10).
4. Fournisseur SMS et Amazon SES (prérequis du lancement public, T-030 ; dépense à autoriser), Firebase pour les notifications : voir `docs/CLOTURE_LOT2.md`.
5. Avant les lots 7 à 9 : réponses C1 à C5, vérifications juridiques (F3, F7, F8, F10, F11, F14, F15, ARTCI, BCEAO) et validation de la simulation F13. Écrans 24 et 38 à redessiner selon F4 (lot 1 / lot 7).
