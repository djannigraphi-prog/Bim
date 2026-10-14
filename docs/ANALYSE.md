<!-- Copie exportée le 14/10/2026 du document partagé « BIM — Analyse et plan de développement (Phase 1) », version corrigée. Le document partagé fait référence ; mettre à jour cette copie à chaque révision. -->

# BIM — Analyse et plan de développement (Phase 1)

Oct 14, 2026 · @Yannick Doho

Les trois sources ont été lues en entier : 17 pages de Présentation, 19 pages de Questionnaire, 63 écrans PNG et 18 éléments graphiques. Le concept est cohérent. Version corrigée le 14/10 : les règles déjà définies sont reprises telles quelles ; 17 questions restent ouvertes (section 6.6), presque toutes liées à l'argent, et seules deux d'entre elles concernent le démarrage. Aucun code n'a encore été écrit : ce document attend ta validation.

## 1. Inventaire des sources

Tous les fichiers fournis se sont ouverts ; aucun n'est inaccessible ou corrompu.

| Source | Contenu | Examiné | Remarques |
| --- | --- | --- | --- |
| BIM Présentation (PDF) | 17 pages, diapositives illustrées | 17 / 17, visuellement | Accent violet (#4B4775 environ) différent du rouge des maquettes |
| BIM Questionnaire (PDF) | 19 pages, Q1 à Q63, rempli le 14/10/2026 | 19 / 19, cases et annotations | Q43, Q51, Q59 et Q61 sans réponse ; Q3 colonne « à garder » vide (palette conservée) |
| ZIP Maquettes 1-31 | 31 PNG dans `Ecrans/` | 31 / 31 | 1170 × 2532 px (format iPhone), numérotation 01 à 31 continue |
| ZIP Maquettes 32-63 | 32 PNG dans `Ecrans/` + 18 SVG dans `Elements_graphiques/` | 32 / 32 PNG et 18 / 18 SVG | Numérotation 32 à 63 continue, aucun trou |

Les 18 SVG : icône d'application (« B » blanc sur rouge), « B » rouge, logo « Bim » en noir, rouge et blanc, 5 poses de Peni (joie, content, triste, réflexion, salut) et 8 cadeaux (pièce, 5 pièces, porte-monnaie, petit et grand coffre, coffre-fort, banque, bateau pirate).

Points d'attention, sans blocage :

- Les maquettes utilisent des photos de personnes réelles et des noms d'exemple (Edwige Koffi, Boutique Élégance…). Ce sont des données fictives : elles ne seront pas reprises dans l'application, et les droits des photos sont à vérifier avant toute capture pour les magasins d'applications.
- Les maquettes sont des images, pas des fichiers Figma : couleurs, espacements et tailles de police seront relevés à l'œil puis fixés dans un fichier de jetons de design.

## 2. Compréhension du concept

BIM (Beauté, Image, Motivation) est d'abord un outil d'accompagnement : le réseau social, la boutique et les Lives existent pour servir un objectif personnel, pas l'inverse. La boucle centrale est : définir un objectif → recevoir un programme (Peni) → agir avec rappels → suivre sa progression → « faire son BIM » (avant/après) → partager → motiver les autres → recevoir des pièces.

Trois économies se branchent sur cette boucle :

- **Commerce** : un projet génère une demande (catégorie, budget, tailles) que les marchands de la catégorie voient et à laquelle ils répondent par des offres ; le BimShop et les Lives de vente servent ceux qui cherchent directement. La confiance repose sur la vérification d'identité, les étoiles du marchand, les recommandations et les médailles.
- **Livraison** : des livreurs indépendants, freelances ou employés d'une boutique transportent les commandes ; l'article BimShop est payé à la livraison, séparément des frais de livraison, et seuls les livreurs partenaires d'un marchand encaissent l'article ; les achats liés à un projet se paient en ligne.
- **Créateurs** : les pièces (1 pièce = 1 FCFA) s'envoient sur les publications, les commentaires et les Lives, se convertissent en argent via Mobile Money, sans commission BIM. Recevoir des pièces demande l'abonnement Utilisateur Premium.

BIM gagne de l'argent avec trois abonnements (Utilisateur 2 000, Marchand 5 000, Livreur 1 000 FCFA par mois) et la publicité auprès des comptes non Premium. Une identité unique (le compte utilisateur) peut ouvrir plusieurs boutiques et un seul compte livreur, après vérification d'identité et du visage.

Ce qui distingue BIM d'Instagram, TikTok ou Jumia : le projet et Peni (ton bienveillant, parfois triste quand on abandonne, inspiré de Duolingo), le lien entre transformation publiée et produits utilisés, les demandes de projet envoyées aux marchands, et la rémunération des commentaires.

## 3. Interfaces identifiées

Les 63 écrans couvrent les 10 domaines du questionnaire. Barre du bas confirmée partout : Accueil · Messages · « + » central (nouveau projet) · Live · BimShop ; le livreur a sa propre barre (Courses · Trajet · Messages · Historique).

| N° | Écran | Contenu clé |
| --- | --- | --- |
| 01 | Splash | Logo rouge, « Beauté · Image · Motivation » |
| 02 | Bienvenue | Créer un compte, Se connecter, Voir des articles (visiteur), Peni se présente |
| 03 | Connexion | Identifiant + mot de passe, mot de passe oublié, Google / Apple / Facebook |
| 04 | Inscription 1/2 | Nom, @utilisateur, naissance, commune (obligatoires) ; téléphone, e-mail, genre (facultatifs) |
| 05 | Inscription 2/2 | Photo facultative, au moins 3 centres d'intérêt parmi 10 |
| 06 | Visiteur | Feuille « Rejoins BIM pour réagir » dès qu'une action est tentée |
| 07 | Vérification | Onglets Marchand / Livreur, étape 2/4 : pièce recto-verso, selfie, Mobile Money (code SMS), adresse facultative |
| 08 | Selfie en direct | Ovale, consignes de mouvement de tête (détection du vivant) |
| 09 | Validation | Peni + anneau de chargement, contrôles cochés un à un |
| 10 | Accueil | Pour toi / Abonnés, icônes Reels, loupe, cloche, stories, « Partage un Bim », publication « J'ai fait mon BIM » |
| 11 | Détail publication | Curseur avant/après, « Voir le parcours », « Produits et services utilisés » |
| 12 | Commentaires | Pièces reçues par commentaire, bouton Encourager |
| 13 | Encourager | 8 cadeaux de 1 à 100 000 pièces, quantité, solde |
| 14 | Donateurs | Classement des donateurs, total reçu, onglet J'aime |
| 15 | Reels | Vidéo verticale, suivre, j'aime, commentaires, pièces, partager |
| 16 | Nouveau Bim | Texte, photos, lier à un projet terminé, identifier, lieu, visibilité |
| 17 | Notifications | Filtres Tout / Projets / Pièces / Commandes / Live, rappels Peni, offres marchands |
| 18 | Mes projets | 4/5 projets, carte du jour, barres de progression (rouge, orange, jaune, gris) |
| 19 | Nouveau projet 1/5 | Mode Éco (gratuit) ou Premium avec budget Petit / Moyen / Boosté |
| 20 | Nouveau projet 2/5 | 7 catégories + « Pas sûr ? Demande à Peni » |
| 21 | Nouveau projet 3/5 | Sous-objectifs, curseur de kilos, description libre, « Recevoir les offres des marchands », Résoudre un problème |
| 22 | Nouveau projet 4/5 | Photo « avant » privée, facultative |
| 23 | Nouveau projet 5/5 | Taille, poids, niveau, disponibilité, séances, problème de santé |
| 24 | Ton programme | 60 j, 48 étapes, recommandations, projet public, « Payer et lancer » |
| 25 | Chat Peni | Conversation guidée, réponses rapides, résumé du projet |
| 26 | Carte du projet | Chemin type Duolingo, jours, coffre, mascotte, étape du jour |
| 27 | Jour X | Tâches horaires à cocher, rappels 15:00 · 16:00 · alarme 17:00, Pause / Signaler / Supprimer |
| 28 | Rappels | Notifications écran verrouillé, alarme Peni triste |
| 29 | Pause | Avertissement du marchand, durée, réajustement de la date de fin |
| 30 | Célébration | Objectif atteint, statistiques, photo « après » |
| 31 | Avant/après | Publier « J'ai fait mon BIM » ou garder pour soi |
| 32 | BimShop | Recherche texte + photo, filtres, onglets, grille type Pinterest, Gold |
| 33 | Rubriques | 5 rubriques et leurs sous-rubriques |
| 34 | Fiche produit | Photos, vidéo, prix barré, recommandations, tailles, couleurs, marchand, livraison |
| 35 | Réserver | Service : date, heure, lieu (salon ou domicile + 3 000 F) |
| 36 | Commande | Adresse sur carte, contact, opérateur, article et livraison payés à part |
| 37 | Suivi de commande | Carte, livreur, appel / message, code à 4 chiffres, étapes |
| 38 | Mes commandes | En cours, à évaluer, historique |
| 39 | Live : accueil | Pour toi / Live vente / Live simple, catégories, « Touche pour entrer » |
| 40 | Live vente | Produit épinglé, Commander, compte à rebours, habillage, cadeaux |
| 41 | Promo spéciale | Liste de produits remisés, Réserver / panier |
| 42 | Commande rapide | « Je veux… » + téléphone |
| 43 | Cadeau en Live | Animation visible par tous |
| 44 | Live simple | Commentaires, cœurs, pièces, aucun outil de vente |
| 45 | Lancer un Live | Vente ou simple, catégorie, outils (3 Premium), programmation |
| 46 | Spectateurs | Menu ≡ : top donateurs, tous, abonnés |
| 47 | Messages | Stories, onglets Tous / Clients / Marchands / Livreurs / Groupes, offres de projet, demandes |
| 48 | Conversation marchand | Produit en tête, Commander, photo, vocal, réaction, réponse citée, appels |
| 49 | Offres pour ton projet | Offres de marchands, Discuter / Voir l'offre, « je choisis pour toi » |
| 50 | Groupe | Groupe de projet, événement Peni, réactions, appels |
| 51 | Boîte marchand | Tous / Non lus / Commandes / Archivés, marquer, archiver, réponses rapides |
| 52 | Profil utilisateur | Compteurs, médailles, solde, Premium, grille BIM / trophées / Reels |
| 53 | Changer de profil | Utilisateur, boutiques, livreur (1 max), Nouvelle boutique |
| 54 | Profil marchand public | Bannière, Gold, médailles, onglets Boutique / Mur / Lives / Avis / Ventes |
| 55 | Espace marchand | Ventes du jour, commandes à traiter, Article / Live / Promo / Demandes |
| 56 | Livreur : accueil | En ligne, gains, nouvelle course en lot, encaissement, Accepter (minuteur) |
| 57 | Livreur : course | Navigation, client, code de confirmation, montant à encaisser |
| 58 | Portefeuille | Solde, équivalent FCFA, Retirer / Acheter, graphique, meilleures publications |
| 59 | Retirer | Montant, opérateur, commission 0 F, « instantané » |
| 60 | Acheter des pièces | 6 packs de 100 à 50 000, Wave / Orange / MTN / Moov / Visa |
| 61 | BIM Premium | Trois offres et leurs avantages |
| 62 | Paramètres | Thème clair / sombre, langue, compte, confidentialité, notifications, paiement, adresses, aide |
| 63 | Accueil sombre | Variante du thème sombre |

Écrans nécessaires mais absents des maquettes (à concevoir dans le même style) : résultats de recherche et recherche par photo, panier, mot de passe oublié et codes de vérification, variante livreur de la vérification (permis, engin), lecteur et créateur de story, création de Reel, écrans d'appel, modification du profil, confidentialité et blocages, suppression du compte, historique des transactions et des retraits, gestion de l'abonnement, création et modification d'article, stocks, promotions, statistiques et agenda du marchand, détail de commande côté marchand, litiges, rédaction d'avis, onglets Trajet et Historique du livreur, rediffusion de Live, états vides et erreurs réseau, et toute l'administration web.

## 4. Fonctionnalités par module

Vingt-deux modules backend, chacun propriétaire de ses tables et de ses règles. La colonne « Complexité » guide l'ordre de développement.

| Module | Fonctionnalités | Écrans | Complexité |
| --- | --- | --- | --- |
| Authentification | Inscription, connexion par e-mail / téléphone / @utilisateur + mot de passe, Google, Apple, Facebook, codes de vérification, récupération, sessions, appareils | 01-06 | Moyenne |
| Utilisateurs et profils | Profil, intérêts, confidentialité, thème, langue, suppression de compte | 52, 62 | Faible |
| Espaces et autorisations | Utilisateur, boutiques multiples, un compte livreur, changement d'espace contrôlé par le serveur, membres de boutique | 53 | Moyenne |
| Vérification (KYC) | Pièce recto-verso, selfie avec détection du vivant, Mobile Money vérifié, permis et engin, revue manuelle, statuts | 07-09 | Élevée (prestataire) |
| Social | Publications photo / vidéo, format « J'ai fait mon BIM », commentaires, j'aime, partage, abonnements, stories, fils Pour toi / Abonnés | 10-12, 16, 63 | Moyenne |
| Reels et médias | Vidéo verticale, compression, miniatures, streaming adaptatif, CDN | 15 | Élevée |
| Projets BIM | Catégories administrables, modes Éco / Premium, programme, étapes, tâches horaires, pause, signalement, suppression, célébration, avant/après | 18-31 | Élevée (cœur du produit) |
| Rappels | Rappel à l'heure, +1 h, alarme, rendez-vous la veille, planification serveur | 27-28 | Moyenne |
| Peni (IA) | Conversation, construction de programme, encouragements, limites santé | 24-25 | Moyenne (coût à suivre) |
| Demandes de projet | Publication anonymisée de la demande aux marchands de la catégorie, offres, refus de contact direct | 21, 47, 49, 51, 55 | Moyenne |
| Catalogue | Rubriques, produits, variantes, stocks, services, créneaux, promotions, recherche texte puis photo | 32-35 | Moyenne |
| Confiance marchand | Étoiles (max 5), recommandations, avis, Gold, médailles annuelles | 32, 34, 54 | Moyenne |
| Commandes | Panier, commande, réservation, historique de statuts, annulation, litige, idempotence | 36-38, 55 | Élevée |
| Livraisons | Courses en lot, acceptation, trajet, position temporaire, code de confirmation, encaissement | 37, 56-57 | Élevée |
| Paiements | Mobile Money (Wave, Orange, MTN, Moov), carte à trancher, webhooks vérifiés, paiement à la livraison | 24, 36, 60 | Très élevée |
| Pièces et portefeuille | Achat, envoi sur publication / commentaire / Live, grand livre, retrait, statistiques | 13-14, 43, 58-60 | Très élevée |
| Abonnements Premium | 3 offres configurables, droits calculés côté serveur, renouvellement, échecs | 61 | Élevée |
| Lives | Vente et simple, outils activables, gadgets Premium, programmation, cadeaux animés, spectateurs, modération | 39-46 | Très élevée |
| Messagerie et appels | Texte, vocaux, médias, réactions, réponses, statuts, groupes, demandes, outils marchand, appels audio / vidéo | 47-51 | Très élevée |
| Notifications | Centre de notifications, push FCM / APNs, préférences, dédoublonnage | 17 | Moyenne |
| Modération et administration | Signalements, revue KYC, catégories, litiges, transactions, retraits, offres, journaux d'audit, rôles admin | aucun | Élevée |
| Publicité | Emplacements pour non-Premium, sponsoring des marchands Premium | aucun | Moyenne |

## 5. Les quatre espaces et leurs permissions

Une personne = un compte utilisateur ; les espaces marchand et livreur sont des rôles rattachés à ce compte, activés après vérification. Chaque requête API porte l'espace actif, et le serveur vérifie que la personne y a droit.

- **Utilisateur** : projets, Peni, fil social, Reels, stories, BimShop, Lives en spectateur, messages, portefeuille. Premium : recevoir des pièces, pas de publicité.
- **Marchand** (une ou plusieurs boutiques) : garde les fonctions sociales (Lives, commentaires, publications sur son mur), plus un espace privé — commandes, articles, stocks, prix, promotions, statistiques, demandes de projet, réponses rapides, Lives de vente. Premium : Gold, sponsoring, gadgets Live, Lives programmés.
- **Livreur** (un seul par personne) : uniquement courses, trajet, messages liés aux courses, historique et gains ; pas de profil public, pas de fil, pas de boutique. Statut indépendant, freelance (plusieurs boutiques partenaires) ou employé d'une boutique ; seuls les livreurs liés à une boutique par le programme de partenariat encaissent le paiement des articles.
- **Administrateur** : application web séparée, double authentification obligatoire, rôles distincts (principal, support, modérateur, commercial, financier, technique), chaque action sensible journalisée.

Matrice proposée (O = oui, P = si Premium, — = non, ? = décision du fondateur) :

| Action | Visiteur | Utilisateur | Marchand | Livreur | Admin |
| --- | --- | --- | --- | --- | --- |
| Voir Accueil, Lives, BimShop | O | O | O | — | O (lecture) |
| Aimer, commenter, suivre, publier | — | O | O | — | Modérer |
| Envoyer des pièces | — | O | ? | — | — |
| Recevoir des pièces | — | P | ? | — | — |
| Créer un projet BIM | — | O (5 max, configurable) | ? | — | — |
| Commander, réserver | — | O | O (comme client) | — | — |
| Gérer articles, stocks, commandes reçues | — | — | O (sa boutique) | — | Support |
| Voir les demandes de projet de sa catégorie | — | — | O (anonymisées) | — | O |
| Lancer un Live de vente | — | — | O | — | Couper |
| Lancer un Live simple | — | ? | O | — | Couper |
| Promo, compte à rebours, habillage, Live programmé | — | — | P | — | — |
| Message direct sans abonnement préalable | — | Demande de message | O (reçoit de tous) | Client et marchand de la course | — |
| Accepter une course, voir la position du client | — | — | Livreur employé de la boutique | O | Support |
| Voir la position du livreur | — | Pendant sa livraison | Pendant ses livraisons | — | Support (journalisé) |
| Demander un retrait | — | P (conditions : F8 à F14) | ? | Gains si gérés par BIM | Financier valide |
| Valider un dossier KYC, traiter un litige | — | — | — | — | Support / financier |
| Modifier tarifs, cadeaux, seuils | — | — | — | — | Principal (double validation) |

## 6. Écarts entre les sources et décisions à prendre

Version corrigée le 14/10/2026 à ta demande. La première version remplaçait plusieurs règles déjà définies (paiement à la livraison, pièces, commission, 5 millions) par mes propres choix ; c'était une erreur. Pour chaque sujet, cette section sépare désormais : **règle définie** (avec sa source), **contradiction** entre documents, **recommandation technique** (qui ne change pas la règle) et **question** au fondateur. Rien de ce qui est en question n'est programmé avant ta réponse.

### 6.1 Paiement de l'article et paiement de la livraison

Règles définies :

- Q38 : un article acheté sur BimShop est payé à la livraison ; le client confirme le paiement au livreur ; il indique une position ou une adresse et un contact.
- Q39 (annotation) : paiement à la livraison sur un opérateur mobile ; le paiement de l'article et celui de la livraison sont séparés.
- Q38 : les achats recommandés dans un projet sont payés en ligne, dans le projet uniquement ; le programme commence à la livraison, qui doit donc être suivie.
- Q52 : trois statuts de livreur — indépendant (courses instantanées), freelance (livraisons par lots, plusieurs boutiques), employé d'une boutique (salarié) ; le partenariat avec un compte marchand permet d'effectuer plusieurs commandes et de réceptionner les paiements ; les conditions se négocient en privé.
- Précision du 14/10 : seuls les livreurs partenaires d'un marchand, dans le programme de partenariat BIM, encaissent le paiement des articles.
- Écrans 36, 37, 56, 57 : « Article · payé au livreur 45 000 F » et « Livraison · payée à part 1 500 F » ; le livreur voit « Encaisser 91 500 F en Mobile Money pour la boutique ».

Points à clarifier dans les documents : l'écran 57 affiche « À encaisser : 45 000 F + 1 500 F », donc les deux montants par le même livreur ; Q52 parle de « paiements cache » (espèces ?) alors que Q39 précise « sur un opérateur mobile ».

Architecture qui respecte ces règles :

- Chaque commande porte deux paiements distincts, jamais additionnés dans un même statut : `article_payment` (montant des articles, bénéficiaire final : le marchand) et `delivery_payment` (frais de livraison). Chacun a son montant figé par le serveur, son encaisseur, son moyen, son statut et ses preuves.
- Un livreur ne peut encaisser l'article que s'il a un partenariat actif avec la boutique (`courier_shop_partnerships`, statut freelance ou employé, droit « encaisser » accordé par le marchand). Le serveur refuse l'encaissement à tout autre livreur.
- À la remise : le client paie le livreur partenaire en Mobile Money sur son numéro vérifié (Q15), confirme le paiement dans l'app, le livreur confirme la réception, puis le code de livraison clôture la commande. Si une confirmation manque ou si les montants diffèrent, la commande passe en « paiement à vérifier ».
- BIM n'encaisse pas cet argent : il l'enregistre. Un registre par partenariat suit les montants encaissés pour la boutique, les reversements déclarés par le livreur et confirmés par le marchand, et l'encours restant. Le marchand peut fixer un encours maximal ; au-delà, le livreur ne reçoit plus de nouvelles courses à encaisser tant qu'il n'a pas reversé.
- Amélioration possible, seulement avec ton accord : au lieu d'un transfert saisi à la main, BIM peut déclencher une demande de paiement Mobile Money sur le téléphone du client, vers le numéro du livreur ou du marchand, et recevoir la confirmation automatiquement. L'organisation reste la même, il y a moins d'erreurs de saisie.
- Achats liés à un projet : paiement en ligne via un agrégateur Mobile Money, validé uniquement par confirmation serveur du prestataire ; le programme démarre au statut « livré » (ou à la date du premier rendez-vous pour un service).

### 6.2 Règles d'Apple et de Google pour BIM en Côte d'Ivoire

Vérifié le 14/10/2026 sur les règles officielles d'Apple et de Google. Le téléchargement gratuit ne change rien : ce qui compte, c'est la nature de chaque achat fait dans l'app. Aucun programme de paiement alternatif ne couvre la Côte d'Ivoire : chez Google, il existe dans 39 pays, dont l'Afrique du Sud comme seul pays africain ; chez Apple, le lien vers un paiement externe n'est libre que sur la boutique américaine.

| Achat dans BIM | Écrans | Apple | Google | Moyen autorisé dans l'app |
| --- | --- | --- | --- | --- |
| Articles BimShop, livraison | 34, 36, 57 | Biens physiques : paiement hors système Apple obligatoire (3.1.3(e)) | Biens physiques exclus de Google Play Billing | Orange Money, Wave, MTN, Moov |
| Services consommés hors de l'app : salon, massage, salle de sport, coach en personne | 24, 35 | Idem (3.1.3(e)) ; un service en direct entre deux personnes est aussi autorisé (3.1.3(d)) | Services physiques exclus, l'abonnement à une salle de sport est cité en exemple | Mobile Money |
| Pièces BIM | 13, 60 | Monnaie virtuelle : achat intégré Apple obligatoire (3.1.1), qui autorise expressément les « pourboires » aux créateurs | Monnaie virtuelle : Google Play Billing obligatoire | Achat intégré Apple / Google |
| Abonnement Utilisateur Premium | 61 | Déblocage de fonctions : achat intégré (3.1.1, 3.1.2) | Google Play Billing | Achat intégré |
| Abonnement Marchand Premium (Gold, gadgets Live, Lives programmés, sponsoring) | 61 | Achat intégré ; Apple cite les « boosts » de publications comme achat intégré obligatoire (3.1.3(g)) | Google Play Billing | Achat intégré |
| Abonnement Livreur Premium | 61 | Très probablement achat intégré (déblocage de fonctions) | Idem | Achat intégré, à confirmer |
| Retrait des pièces reçues | 59 | Pas un achat ; paiement aux créateurs par BIM | Pas un achat ; règle : la monnaie n'est utilisable que dans l'app, à faire confirmer pour la conversion | Décaissement Mobile Money |

Organisation recommandée, en quatre circuits séparés qui alimentent les mêmes droits côté serveur :

1. **Mobile Money dans l'app** pour tout ce qui est physique : BimShop, livraisons, achats liés aux projets, réservations.
2. **Achat intégré Apple / Google** pour les pièces et les trois abonnements achetés depuis l'app. Commission de la boutique : 15 % pour les petits développeurs et les abonnements selon les programmes en vigueur, 30 % sinon ; à confirmer à l'inscription.
3. **Site web BIM avec Orange Money et Wave** (facultatif) pour les mêmes pièces et abonnements. C'est autorisé si l'app propose aussi l'achat intégré (Apple 3.1.3(b)). En revanche, l'app ne doit contenir ni bouton, ni lien, ni message qui renvoie vers ce site. BIM peut en parler hors de l'app : SMS, e-mail, réseaux sociaux, marchands.
4. **Décaissement Mobile Money** pour les retraits.

Les règles des magasins changent souvent ; une dernière vérification sera faite avant la soumission.

### 6.3 Pièces BIM : ce qui est défini et ce qui manque

Règles définies, appliquées telles quelles :

- 1 pièce = 1 FCFA (Q55).
- Achat de pièces par opérateur mobile (Orange Money, Moov, Wave, MTN) et Visa (Q55, écran 60). Les règles des magasins imposent en plus l'achat intégré dans l'app (6.2).
- Les pièces s'envoient comme des j'aime, sur les publications, les commentaires et les Lives (Présentation p. 10 et 14).
- Envoi de plusieurs pièces : toucher ou maintenir l'icône ; 8 cadeaux de 1 à 100 000 pièces (Q55, Q56).
- Animation visible par tous en Live, pas d'animation sur les publications, liste des donateurs consultable (Q56).
- Recevoir des pièces demande d'être Utilisateur Premium. Sans Premium, une publication n'a que j'aime et partage (Q55, Présentation p. 13).
- Les pièces reçues sont convertibles en argent et retirables via Mobile Money (Présentation p. 10 et 14).
- BIM ne prélève rien sur les pièces reçues (Présentation p. 14).
- Les pièces ne paient pas les achats BimShop : « Solde de pièces » n'est pas coché en Q39.
- Portefeuille : solde, équivalent FCFA, Retirer, Acheter, statistiques (Q57).

Ce qui manque, donc questions F8 à F12 (section 6.6) : les pièces achetées et non dépensées sont-elles retirables ; le Premium est-il exigé pour recevoir des pièces sur un commentaire ; les marchands reçoivent-ils des pièces (l'écran 40 montre un coffre-fort envoyé à une boutique en Live) ; que deviennent les pièces reçues si le Premium s'arrête ; une vérification d'identité est-elle exigée avant un retrait.

Recommandation technique, sans effet sur les règles : le grand livre enregistre séparément les pièces achetées et les pièces reçues, et note par quel circuit chaque pièce a été achetée. Ainsi, toute règle que tu fixeras pourra s'appliquer sans reprendre les données. Les pièces achetées via Apple ne peuvent pas expirer (règle 3.1.1).

### 6.4 Commission de 0 % : frais réellement supportés

Règle définie et conservée : BIM ne prélève aucune commission sur les pièces reçues. Les opérateurs, eux, facturent chaque encaissement et chaque décaissement ; ces frais ne sont pas une commission BIM, mais quelqu'un doit les payer.

Coût pour 10 000 pièces achetées (10 000 F) puis retirées par un créateur. Hypothèses tirées d'un comparatif publié en août 2026, à remplacer par les devis des prestataires ; frais de retrait supposés à 1 %.

| Circuit d'achat | Frais à l'achat | Frais au retrait | Total | Volume retiré couvert par 1 Premium à 2 000 F / mois |
| --- | --- | --- | --- | --- |
| Wave Business en direct (1 %) | 100 F | 100 F | 200 F (2 %) | 100 000 F |
| Orange Money marchand (1,5 à 3,5 %) | 150 à 350 F | 100 F | 250 à 450 F (2,5 à 4,5 %) | 44 000 à 80 000 F |
| Agrégateur type CinetPay (2,5 % + 50 F) | 300 F | 100 F | 400 F (4 %) | 50 000 F |
| Achat intégré Apple / Google à 15 % | 1 500 F | 100 F | 1 600 F (16 %) | 12 500 F |
| Achat intégré Apple / Google à 30 % | 3 000 F | 100 F | 3 100 F (31 %) | 6 450 F |

Il faut y ajouter les coûts par personne : vérification d'identité (0,5 à 2 USD), SMS (15 à 40 F) et hébergement. Les pièces envoyées mais jamais retirées ne coûtent rien au retrait. Le circuit Apple / Google est le seul qui menace vraiment le modèle.

Solutions compatibles avec « 0 % de commission BIM » ; c'est à toi de choisir, une ou plusieurs (question F13) :

- **S1** — BIM absorbe les frais et les finance par les abonnements Premium et la publicité. Un tableau de bord surveille le volume retiré par créateur par rapport à son abonnement.
- **S2** — Les frais de paiement de l'opérateur s'affichent à part au moment de l'achat : 1 000 pièces = 1 000 F + frais. La valeur de la pièce reste 1 FCFA.
- **S3** — Les frais de l'opérateur au retrait sont payés par le créateur, affichés comme « frais opérateur ». La commission BIM affichée reste 0 F.
- **S4** — Négocier un taux selon le volume et privilégier le circuit le moins cher (Wave en direct).
- **S5** — Prix des packs plus élevé dans les magasins Apple et Google (ex. 1 000 pièces à 1 200 F environ), prix normal sur le site web BIM en Mobile Money.
- **S6** — Un montant minimal de retrait pour amortir les frais fixes.

Techniquement, toutes ces options sont des paramètres administrables ; aucune n'est programmée avant ta décision.

### 6.5 Limite de retrait de 5 millions FCFA

Les documents ne permettent pas de trancher : la règle n'est pas programmée tant que tu ne l'as pas confirmée (question F14).

- **Q55, texte original** : ligne « Montant minimum pour un retrait », réponse « 5 millions/jours » ; ligne « Délai de retrait », réponse « Pas de délais ».
- **Écran 58** : « retrait instantané · jusqu'à 5 M FCFA / jour », donc un plafond.
- **Écran 59** : montants proposés de 10 000, 25 000 et 50 000 F, incompatibles avec un minimum de 5 millions.

Le questionnaire annonçait que ses réponses serviraient de base aux maquettes : les écrans 58 et 59 sont donc une interprétation de Q55, pas une décision. La mention « /jours » fait penser à un plafond, l'intitulé de la ligne à un minimum. Pour « Pas de délais », il faut aussi savoir s'il s'agit d'un versement immédiat, sans contrôle manuel, quel que soit le montant.

### 6.6 Questions qui nécessitent ta décision

Classées par lot bloqué. Les lots 0 à 6 (comptes, projets, Peni, social, boutique, messagerie) n'attendent que F15 et F16.

| N° | Question | Pourquoi elle se pose | Bloque |
| --- | --- | --- | --- |
| F1 | Quand la course est faite par un livreur non partenaire (indépendant, course instantanée), comment le client paie-t-il l'article : directement au marchand en Mobile Money à la remise, avant l'expédition, ou autrement ? | Seuls les livreurs partenaires encaissent l'article | Lot 7 |
| F2 | Les frais de livraison sont payés à qui (au livreur, à la boutique ?) et à quel moment ? | Q39 dit « à part » ; l'écran 57 fait tout encaisser par le livreur | Lot 7 |
| F3 | Un livreur partenaire peut-il encaisser en espèces, ou seulement en Mobile Money ? | Q52 « paiements cache », Q39 « opérateur mobile » | Lot 7 |
| F4 | Pour un achat de projet payé en ligne, l'argent arrive-t-il sur un compte BIM qui reverse au marchand, ou directement au marchand ? | Si BIM reçoit l'argent de tiers, un avis juridique (BCEAO) est nécessaire | Lot 8 |
| F5 | La carte Visa est-elle proposée ? | Non cochée en Q39, présente en Q55 et sur l'écran 60 | Lot 8 |
| F6 | Valides-tu l'organisation en quatre circuits de la section 6.2, avec achat intégré Apple / Google pour les pièces et les abonnements dans l'app ? | Obligation des magasins | Lots 8 et 9 |
| F7 | Veux-tu un site web BIM pour acheter pièces et abonnements en Orange Money et Wave ? | Circuit moins cher, autorisé sans lien depuis l'app | Lot 9 |
| F8 | Les pièces achetées et non dépensées peuvent-elles être retirées, ou seulement les pièces reçues ? | Non précisé ; enjeu de fraude | Lot 9 |
| F9 | Faut-il être Premium pour recevoir des pièces sur ses commentaires ? | Q55 parle des publications ; la Présentation p. 10 met en avant les commentaires | Lot 9 |
| F10 | Les boutiques peuvent-elles recevoir des pièces (Lives, publications) ; avec quel abonnement ? | Écran 40 : cadeau envoyé à une boutique | Lots 9 et 10 |
| F11 | Si l'abonnement Premium s'arrête, les pièces déjà reçues restent-elles retirables ? | Non précisé | Lot 9 |
| F12 | Une vérification d'identité est-elle exigée avant le premier retrait ? | Recommandé contre la fraude, non prévu dans les documents | Lot 9 |
| F13 | Quelle(s) solution(s) S1 à S6 pour couvrir les frais d'opérateur ? | Section 6.4 | Lot 9 |
| F14 | 5 millions FCFA : minimum par retrait ou plafond par jour ? Et « pas de délai » veut-il dire versement immédiat sans contrôle, quel que soit le montant ? | Section 6.5 | Lot 9 |
| F15 | Âge minimum pour s'inscrire, et pour acheter ou retirer des pièces ? | Date de naissance obligatoire, âge non fixé | Lot 0 |
| F16 | Téléphone et e-mail sont facultatifs (Q13) : faut-il exiger au moins l'un des deux pour récupérer un compte créé sans Google, Apple ou Facebook ? | Sans eux, un mot de passe oublié = compte perdu | Lot 0 |
| F17 | En quoi consiste exactement « priorité sur les commandes » du Livreur Premium ? | Présentation : « avantages liés aux commandes » ; seul l'écran 61 précise | Lot 8 |

Règle définie conservée, que je retirais à tort : l'étoile Gold remplace les 5 étoiles pour les marchands Premium (Q50). Elle sera appliquée telle quelle ; tu peux la revoir si tu le souhaites, ce n'est pas une décision bloquante.

### 6.7 Autres écarts non financiers, avec la solution proposée

| N° | Sujet | Écart | Solution proposée |
| --- | --- | --- | --- |
| E1 | Couleurs | Présentation en violet, maquettes et questionnaire en rouge #F20D3A / noir #101116 | Rouge et noir retenus (questionnaire plus récent) |
| E2 | Boutons d'une publication | Q19 coche Recommander, Commander, Contacter le marchand, mais la note dit « sur l'accueil on ne peut pas acheter » | Aucun bouton d'achat sur l'Accueil ; seul le lien « Produits et services utilisés » (écran 11, Q20) renvoie au BimShop |
| E3 | Couleur du retard | Q3 : jaune = retard ; Q30 et écran 18 : jaune = objectif atteint | Jaune = atteint ; retard = icône d'alerte et texte rouge sur la tâche |
| E4 | Moment de l'alarme | Q31 : rappel, +1 h, puis alarme (heure non fixée) ; écran 27 : 15:00, 16:00, alarme 17:00 | Heures paramétrables, défaut 0 / +1 h / +2 h |
| E5 | Nom du projet | Q23 sans ordre ; Présentation p.4 a un champ ; maquettes sans étape | Nom généré depuis l'objectif (« Perdre 10 kg »), modifiable |
| E6 | Abandon d'un projet | Q34 : « supprime immédiatement » | Confirmation, puis suppression logique (historique conservé pour les commandes liées) |
| E7 | Ce que voient les spectateurs d'un Live | Q43 sans aucune case cochée | Maquettes 39-46 retenues : nombre de spectateurs, commentaires, cadeaux, boutique, suivre, partager |
| E8 | Rediffusion des Lives | Q44 sans réponse, onglet « Lives » sur le profil marchand (écran 54) | Pas de rediffusion au lancement (coût de stockage) ; onglet = Lives programmés et passés sans vidéo |
| E9 | Profil utilisateur | Q51 sans réponse ; écran 52 affiche « En cours : Perdre 10 kg (42 %) » | Proposition de l'écran 52 retenue, mais le projet en cours n'est public que si l'utilisateur l'a rendu public |
| E10 | Qui reçoit les messages d'un utilisateur | Q45 : « seuls les abonnés » ; brief : les personnes qu'il suit | Retenir « les comptes qu'il suit », les autres en demandes ; les offres de projet vont dans « Offres », pas en messages directs |
| E11 | Note du livreur | Q40 non cochée ; écrans 37 et 56 affichent ★ 4,8 | Note interne visible du client pendant la course seulement, pas de profil public (Q52) |
| E12 | Paiement d'une réservation de service | Q38 ne répond que pour les produits ; écran 35 sans paiement | Paiement sur place au lancement, acompte en option marchand plus tard |
| E13 | Médailles | Présentation : produit, marchand, commentaire de l'année ; Q54 : 5 couleurs dont donateur et publication | 5 médailles de Q54, calculées par année civile et par catégorie, règles publiées |
| E14 | Rubriques du Shop | Écran 33 propose Minceur et Compléments | Rubriques administrables ; Minceur et Compléments soumis à une politique de produits interdits (pas d'allégation médicale) |
| E15 | Bouton « + » en espace marchand | Écran 55 garde le « + » central | Dans l'espace marchand, « + » = ajouter un article ; le projet reste dans l'espace utilisateur |
| E16 | Validation « en 5 secondes » | Q16 | Contrôle automatique du prestataire (de quelques secondes à quelques minutes), sinon statut « en cours d'examen » avec délai annoncé ; jamais de faux succès |
| E17 | Liste des donateurs | Écran 14 public avec montants | Option « don anonyme » pour le donateur |

## 7. Architecture technique recommandée

Un dépôt unique, trois applications (mobile Flutter, API NestJS, administration web) et une seule base PostgreSQL ; le temps réel, la vidéo et les paiements passent par des prestataires spécialisés derrière des interfaces internes remplaçables.

```text
bim/
├─ apps/
│  ├─ mobile/        Flutter (Android + iOS)
│  ├─ api/           NestJS, monolithe modulaire (REST + WebSocket + tâches)
│  └─ admin/         React + TypeScript (Vite), web réservé
├─ packages/
│  └─ api-contract/  OpenAPI généré → clients Dart et TypeScript
├─ infra/            Terraform (AWS), Docker Compose local
├─ docs/             analyse, décisions, guides
├─ PROJECT_STATUS.md
└─ DECISIONS.md
```

| Couche | Choix recommandé | Pourquoi |
| --- | --- | --- |
| Mobile | Flutter 3, Riverpod (état), go\_router (navigation), Dio (HTTP), freezed (modèles), découpage par fonctionnalité : `features/<module>/{data,domain,presentation}` | Riverpod est testable et sans contexte global ; un seul style dans toute l'app |
| API | NestJS + TypeScript, un module par domaine, règles métier dans des services, contrôleurs minces, validation class-validator, OpenAPI généré | Monolithe modulaire : un déploiement, des frontières nettes, découpable plus tard |
| Accès base | Prisma (schéma et migrations versionnées) + SQL brut pour le grand livre (`SELECT … FOR UPDATE`) | Lisible par une équipe, migrations sûres, contrôle fin là où l'argent circule |
| Tâches et rappels | pg-boss (file d'attente dans PostgreSQL), processus « worker » séparé | Pas de Redis au lancement ; rappels planifiés côté serveur, indépendants de l'app ouverte |
| Temps réel | Socket.IO dans l'API (messages, commentaires de Live, suivi de course), chaque événement autorisé côté serveur | Adaptateur Redis ajouté seulement quand il faut plus d'une instance |
| Médias | Envoi direct vers S3 par URL signée, traitement asynchrone (images : sharp ; vidéo : HLS), diffusion CloudFront, fichiers privés par URL temporaire | Le serveur ne transporte jamais les gros fichiers |
| Live et appels | Prestataire WebRTC (voir section 10) derrière une interface `RealtimeMediaProvider` | Un simple serveur ne tient pas la diffusion vidéo |
| Recherche | PostgreSQL plein texte + pg\_trgm au lancement ; recherche par photo plus tard avec pgvector | Un service de plus seulement quand le volume l'exige |
| Fil « Pour toi » | Score SQL documenté : récence, comptes suivis, intérêts, interactions passées, popularité | Règle explicite, pas présentée comme de l'IA |
| Administration | React + TypeScript, même API sous `/admin/*`, double authentification, permissions fines | Séparée de l'app publique |

Hébergement de lancement sur AWS, région Paris (eu-west-3) sous réserve de l'autorisation de transfert de données de l'ARTCI : API et worker sur ECS Fargate (2 petites tâches), RDS PostgreSQL avec sauvegardes automatiques et restauration à la minute, S3 + CloudFront, Secrets Manager, CloudWatch pour journaux et alertes, SES pour les e-mails. Ordre de grandeur : 150 à 400 USD par mois avant trafic réel, hors vidéo, SMS et IA. On ajoute ensuite, sur mesure : Redis, réplique en lecture, base multi-zones, puis découpage d'un module (Live ou messagerie) en service séparé.

Trois environnements : `dev` (Docker Compose sur poste), `staging` (copie réduite d'AWS, données fictives clairement marquées) et `production`, chacun avec ses propres secrets.

## 8. Proposition de base de données

Environ 70 tables PostgreSQL, regroupées par module ; chaque table appartient à un seul module, qui est le seul à y écrire. Identifiants UUID v7 (triables par date), montants en entiers (FCFA et pièces n'ont pas de décimales), dates en `timestamptz`, suppression logique (`deleted_at`) pour les contenus, jamais pour les écritures financières.

| Module | Tables principales | Points de conception |
| --- | --- | --- |
| Identité | `users`, `auth_identities` (mot de passe, Google, Apple, Facebook), `sessions`, `devices`, `verification_codes` | Mot de passe haché Argon2id ; e-mail, téléphone et @utilisateur uniques |
| Profils | `user_profiles`, `user_interests`, `privacy_settings`, `follows`, `blocks` | Date de naissance et commune non publiques par défaut |
| Espaces | `shops`, `shop_members` (propriétaire, employé, livreur employé), `courier_accounts` (unique par utilisateur), `courier_shop_partnerships` | Contrainte d'unicité : un compte livreur par personne |
| Vérification | `kyc_cases`, `kyc_documents`, `kyc_checks` | Fichiers dans un compartiment S3 privé chiffré, seul le statut circule dans l'app |
| Social | `posts` (type : photo, vidéo, reel, bim), `post_media`, `comments`, `reactions`, `stories`, `story_views`, `reports` | Compteurs dénormalisés mis à jour par tâche, pas à chaque lecture |
| Médias | `media_assets` (statut de traitement, variantes, visibilité) | Les fichiers sont sur S3, la base ne garde que les métadonnées |
| Projets | `project_categories`, `project_subcategories`, `program_templates`, `projects`, `project_steps`, `project_tasks`, `task_occurrences`, `project_pauses`, `project_events`, `project_requests`, `merchant_offers` | Catégories administrables ; chaque tâche cochée ou manquée est un événement horodaté |
| Rappels | `reminder_schedules`, `notification_jobs` | Planifiés par pg-boss, annulés dès que la tâche est cochée |
| Catalogue | `shop_categories`, `products`, `product_variants`, `inventory_movements`, `services`, `service_slots`, `promotions`, `reviews`, `recommendations` | Stock = somme des mouvements, contrainte qui interdit le négatif ; `pause_tolerance_days` sur l'article (écran 29) |
| Commandes | `carts`, `cart_items`, `orders`, `order_items` (prix figé à la commande), `order_status_history`, `bookings`, `disputes` | Transitions de statut autorisées listées dans le code ; clé d'idempotence par commande |
| Livraisons | `deliveries`, `delivery_batches`, `delivery_offers`, `delivery_location_pings`, `delivery_confirmations` | Positions purgées après la course (ex. 30 jours) ; code haché, tentatives limitées |
| Paiements | `payment_intents`, `payment_attempts`, `provider_webhooks` (boîte de réception idempotente), `payouts` | Un paiement n'est « réussi » qu'après webhook vérifié ou interrogation du prestataire |
| Grand livre | `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `gift_catalog`, `gifts` | Double entrée : chaque transaction somme à zéro ; solde = somme des écritures ; aucune mise à jour ni suppression |
| Abonnements | `plans` (prix et droits configurables), `subscriptions`, `subscription_events`, `entitlements` | Les droits viennent de `entitlements`, recalculés à chaque événement de paiement |
| Live | `live_sessions`, `live_tools`, `live_pins`, `live_comments`, `live_viewers`, `live_schedules` | Statut piloté par les webhooks du prestataire vidéo |
| Messagerie | `conversations`, `conversation_members`, `messages`, `message_receipts`, `message_reactions`, `message_requests`, `calls` | Index (conversation, date) ; pagination par curseur |
| Notifications | `notifications`, `notification_preferences`, `push_tokens` | Clé de dédoublonnage par événement |
| Peni | `ai_conversations`, `ai_messages`, `ai_usage` | Quota et coût suivis par utilisateur |
| Administration | `admin_users`, `admin_roles`, `admin_permissions`, `audit_logs`, `app_settings`, `feature_flags` | Tarifs, cadeaux, seuils de retrait et limites de projets vivent dans `app_settings`, pas dans le code |

Deux points financiers méritent leurs propres tables. Les paiements d'une commande : `order_payments` garde l'article et la livraison séparés (montant, encaisseur, moyen, statut, confirmations du client et du livreur), et `partner_collections` / `partner_remittances` suivent ce qu'un livreur partenaire a encaissé pour une boutique et ce qu'il lui a reversé. Le grand livre des pièces : comptes « pièces achetées » et « pièces reçues » séparés par utilisateur, avec le circuit d'achat d'origine, pour appliquer les règles F8 à F12 sans reprendre les données. Un envoi de 1 000 pièces = une transaction, deux écritures (−1 000 chez l'envoyeur, +1 000 chez le créateur), une clé d'idempotence fournie par l'app. Un rapprochement quotidien compare le grand livre aux relevés des prestataires.

## 9. Sécurité et confidentialité

Règle de base : l'app mobile n'est jamais crue ; chaque prix, solde, statut et droit est recalculé ou vérifié par l'API.

- **Comptes** : Argon2id, jeton d'accès court (15 min) + jeton de rafraîchissement tournant stocké dans le trousseau sécurisé du téléphone, révocation par appareil, limitation des tentatives par identifiant et par adresse IP, codes de vérification à usage unique et durée courte, alerte à chaque nouvelle connexion.
- **Autorisations** : garde NestJS sur chaque route (rôle + espace actif + propriété de la ressource), tests automatiques qui tentent l'accès à la boutique ou à la commande d'un autre ; les événements WebSocket passent par les mêmes règles.
- **Argent** : transactions SQL, verrous de ligne, clés d'idempotence, webhooks vérifiés par signature et rejoués sans effet, grand livre immuable, règles de retrait (montant, plafond, délai, vérification) appliquées exactement comme tu les fixeras (F8 à F14), avec contrôles antifraude et journal de chaque retrait.
- **Données sensibles** : pièces d'identité, selfies, photos avant/après, poids, taille et problèmes de santé sont des données à protection renforcée : compartiment S3 privé chiffré, URL temporaires de quelques minutes, accès admin journalisé, conservation limitée (selfie supprimé après vérification si le prestataire le permet).
- **Localisation** : position du livreur partagée uniquement pendant une course active, avec le client et le marchand de cette course ; adresse du client masquée au livreur avant acceptation (zone seulement).
- **Confidentialité par défaut** : naissance, coordonnées, projet en cours et photos avant/après privés ; demandes de projet anonymisées pour les marchands ; consentement explicite avant toute publication.
- **Abus** : signalement partout, blocage, limites d'envoi de messages et de demandes, filtrage des pièces jointes (type, taille), modération des Lives en direct, comptes jetables freinés par la vérification du téléphone ou de l'e-mail.
- **Exploitation** : secrets dans AWS Secrets Manager, jamais dans Git ; analyse des dépendances en intégration continue ; sauvegardes quotidiennes + restauration à la minute, test de restauration chaque mois ; journaux structurés sans données personnelles en clair.
- **Droits des personnes** : export de ses données, suppression du compte (anonymisation des contenus, conservation légale des écritures financières), retrait du consentement.

À faire valider par un juriste avant la production : déclaration et autorisations auprès de l'ARTCI (loi ivoirienne n° 2013-450 sur les données personnelles), en particulier pour les données biométriques, les données de santé et l'hébergement hors de Côte d'Ivoire ; statut réglementaire des pièces convertibles en argent au regard des règles BCEAO sur la monnaie électronique ; obligations de lutte contre le blanchiment liées aux retraits ; conditions générales et politique de confidentialité.

## 10. Intégrations externes

Chaque prestataire est appelé à travers une interface interne (`PaymentProvider`, `KycProvider`, `RealtimeMediaProvider`, `LlmProvider`, `SmsProvider`), pour pouvoir en changer sans toucher aux modules métier. Les candidats ci-dessous sont des recommandations à confirmer par des devis : offres et tarifs changent souvent.

| Besoin | Candidats | Coût (ordre de grandeur) | Dépendance et remplacement |
| --- | --- | --- | --- |
| Mobile Money (Wave, Orange, MTN, Moov) et retraits | Agrégateur ivoirien : CinetPay, Hub2, PayDunya ; ou API Wave Business en direct | Commission par transaction, souvent 1 à 3,5 % | Contrat et KYC entreprise requis ; deux agrégateurs possibles derrière la même interface |
| Paiements dans les magasins (pièces et abonnements achetés dans l'app, section 6.2) | Apple In-App Purchase, Google Play Billing | 15 à 30 % | Imposé par les magasins, pas remplaçable |
| Vérification d'identité et du visage | Smile ID (spécialiste Afrique), Sumsub, Onfido | Environ 0,5 à 2 USD par vérification | Revue manuelle admin en solution de secours |
| Lives et appels audio / vidéo | LiveKit (open source, hébergeable par BIM plus tard), Agora, ZEGOCLOUD ; Amazon IVS pour les très grandes audiences | Facturé à la minute-participant ; poste de coût le plus variable | LiveKit limite la dépendance grâce à l'auto-hébergement |
| Vidéos courtes (Reels) | AWS MediaConvert + CloudFront, ou Mux / Cloudflare Stream | Encodage à la minute + bande passante | Format HLS standard, migrable |
| Notifications push | Firebase Cloud Messaging (Android et iOS via APNs) | Gratuit | Faible |
| SMS (codes, Mobile Money) | Orange SMS API, agrégateur local, Twilio | 15 à 40 FCFA par SMS | Plusieurs fournisseurs interchangeables |
| E-mail | Amazon SES | Quasi nul | Faible |
| Cartes et itinéraires | Google Maps Platform ou Mapbox | Gratuit jusqu'à un quota, puis à l'appel | Moyenne |
| Connexion sociale | Google, Apple, Facebook | Gratuit (compte développeur Apple 99 USD/an) | Apple obligatoire si Google ou Facebook sont proposés sur iOS |
| Peni | API d'un modèle de langage (Claude, ou autre) via le backend | Quelques FCFA par message ; plafond par utilisateur et par offre | Interface `LlmProvider`, prompts versionnés dans le dépôt |
| Publicité | Google AdMob et / ou sponsoring interne | Revenu, pas coût | Consentement publicitaire requis |
| Suivi d'erreurs et performances | Sentry, CloudWatch | Gratuit puis 26 USD/mois environ | Faible |

Peni : au lancement, le programme vient de modèles de programmes écrits et validés par catégorie ; le modèle de langage personnalise, explique et encourage dans un cadre fixé (pas de diagnostic médical, pas de promesse de résultat, renvoi vers un professionnel au moindre sujet de santé). Il ne voit que les données du projet concerné, jamais les messages privés ni les documents d'identité.

## 11. Feuille de route par lots

Le cœur du produit (comptes, projets, Peni, social, boutique sans paiement en ligne) peut avancer sans attendre les décisions financières ; paiements, pièces et Lives n'avancent qu'après D1 à D7 et la validation juridique. Chaque lot se termine par des tests exécutés et une mise à jour de `PROJECT_STATUS.md`.

| Lot | Contenu | Dépend de | En parallèle possible | En attente de |
| --- | --- | --- | --- | --- |
| 0. Fondations | Dépôt, CI, 3 environnements, design system Flutter (clair / sombre, jetons, composants), squelette API, base, authentification complète, espaces, admin minimal, journaux d'audit | — | — | F15, F16 |
| 1. Projets BIM | Catégories administrables, création en 5 étapes, modèles de programmes, carte et journée, tâches, pause, signalement, suppression, célébration, avant/après | 0 | 2 | Contenu des programmes types (à rédiger) |
| 2. Notifications et rappels | Push, centre de notifications, rappels serveur, alarme, préférences | 0 | 1 | Validation technique des alarmes iOS / Android |
| 3. Peni | Chat, cadrage santé, quotas, coûts | 1 | 4 | Choix du fournisseur IA |
| 4. Social | Publications, « J'ai fait mon BIM », fil, commentaires, j'aime, abonnements, stories, médias images, signalements, modération | 0 | 3 | — |
| 5. Boutique et marchands | KYC (revue manuelle d'abord, prestataire ensuite), boutiques, catalogue, rubriques, fiches, recherche texte, demandes et offres de projet, espace marchand | 0, 1 | 6 | Contrat KYC |
| 6. Messagerie | Conversations, demandes, texte, photos, vocaux, réactions, statuts, outils marchand, groupes | 0 | 5 | — |
| 7. Commandes et livraisons | Panier, commande avec paiements article et livraison séparés, réservations, espace livreur, courses en lot, programme de partenariat, encaissement par livreurs partenaires et suivi des reversements, suivi, code de confirmation | 5 | — | F1, F2, F3 |
| 8. Paiements et abonnements | Circuit Mobile Money (achats projets, option de demande de paiement), circuit achat intégré Apple / Google, abonnements Premium, droits | 7 | — | F4, F5, F6, F17, contrats agrégateur et magasins |
| 9. Pièces et portefeuille | Grand livre, cadeaux, envois, retraits, rapprochement, antifraude | 8 | — | F7 à F14, avis juridique (BCEAO) |
| 10. Lives | Live simple, Live de vente, outils, gadgets Premium, cadeaux animés, programmation | 5, 9 | 11 | F10, devis du prestataire vidéo |
| 11. Appels et Reels | Appels audio / vidéo, Reels (encodage, lecture adaptative) | 6 | 10 | Devis vidéo |
| 12. Croissance | Recherche par photo, recommandations avancées, publicité, anglais, rediffusion des Lives | Tous | — | Données d'usage réelles |

Priorités proposées pour Q61 (laissée vide) : priorité 1 = démarrage / inscription, nouveau projet, suivi, accueil, BimShop ; priorité 2 = commande et suivi, messages, profils, paramètres / Premium ; plus tard = Live, portefeuille / pièces.

## 12. Principaux risques

Les risques principaux sont réglementaires et financiers. Ils ne remettent pas en cause tes règles : ils indiquent ce qu'il faut sécuriser pour les appliquer.

| Risque | Gravité | Mesure |
| --- | --- | --- |
| Refus dans l'App Store ou Google Play si les pièces ou abonnements achetés dans l'app passent hors de l'achat intégré | Élevée | Circuit 2 de la section 6.2, décision F6 avant le lot 8 |
| Statut juridique de pièces convertibles en argent (monnaie électronique BCEAO, blanchiment) | Élevée | Avis juridique avant le lot 9 ; règles F8 à F14 appliquées telles que tu les fixes |
| Frais d'opérateurs et commission Apple / Google face au principe de 0 % | Élevée | Section 6.4, choix F13, tableau de bord des frais réels dès le premier paiement |
| Montants encaissés par un livreur partenaire et non reversés à la boutique | Moyenne | Registre des encaissements et reversements, encours maximal fixé par le marchand, litiges tracés |
| Argent des achats de projet reçu pour le compte de marchands | Moyenne à élevée selon F4 | Avis juridique si BIM reçoit les fonds |
| Coûts vidéo (Lives, appels, Reels) qui explosent avec l'audience | Moyenne à élevée | Plafonds de durée et de qualité, alertes de budget, LiveKit auto-hébergé à terme |
| Coûts IA de Peni | Moyenne | Quotas par offre, réponses courtes, modèles de programmes pré-écrits |
| Données de santé, biométrie, photos intimes exposées | Élevée | Section 9, autorisations ARTCI, tests d'accès automatiques |
| Rappels non délivrés (Android limite les alarmes exactes, iOS réserve les vraies alarmes à des API spécifiques) | Moyenne | Notification push serveur + alarme locale quand le système l'autorise ; tests sur des appareils réels courants en Côte d'Ivoire |
| Faux marchands, faux avis, contenus abusifs | Moyenne | KYC, avis réservés aux acheteurs livrés, modération, signalements |
| Périmètre très large pour une première version | Élevée | Livraison par lots ; première mise en magasin possible après les lots 0 à 7 |
| Connexions lentes et téléphones d'entrée de gamme | Moyenne | Images compressées, pagination, cache local, vidéo adaptative, tests sur réseau 3G simulé |

Sources consultées le 14/10/2026 : [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ; [Google Play — Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) ; [Google Play — user choice billing, pays éligibles](https://support.google.com/googleplay/android-developer/answer/13821247) ; [Comparatif frais Wave, Orange Money, CinetPay 2026 (Kolonell)](https://kolonell.com/fr/blog/frais-transaction-wave-orange-money-cinetpay-comparatif-2026) ; [Coût réel Wave Business API (Kolonell)](https://kolonell.com/fr/blog/cout-reel-wave-business-api-checkout-ci-2026) ; [Orange Money CI, retrait à 1 % (CIO Mag, 2021)](https://cio-mag.com/orange-money-cote-divoire-sadapte-a-wave-retrait-dargent-a-1-a-compter-du-20-octobre).

## 13. Reprise par une équipe et première étape

Le projet doit se comprendre sans cette conversation : tout ce qui est décidé vit dans le dépôt.

- **Fichiers de pilotage** : `PROJECT_STATUS.md` (état de chaque module avec les 9 statuts demandés, tests exécutés, erreurs connues, prochaines tâches), `DECISIONS.md` (une entrée par décision : date, contexte, choix, alternatives, statut décidé / recommandé / en attente), `docs/` (cette analyse, guides d'installation, configuration, variables d'environnement, tests, déploiement, sauvegarde et restauration, maintenance, services externes, limites connues).
- **Git** : `main` protégée, branches `feat/<module>-<sujet>`, commits conventionnels (`feat(projects): …`), relecture obligatoire, intégration continue (lint, tests, migrations) avant fusion.
- **Conventions** : anglais pour le code et les noms de tables, français pour l'interface et la documentation métier ; `snake_case` en base, `camelCase` en TypeScript et Dart ; une fonctionnalité = un dossier dans chaque app.
- **Arrivée d'un développeur** : une commande pour lancer base, API, worker et données de démonstration marquées « DEMO » ; un parcours de lecture (README → DECISIONS → module concerné) ; un ticket de démarrage simple.
- **Tests** : unitaires (règles métier), intégration sur une vraie base PostgreSQL de test, API (autorisations), interface Flutter (parcours principaux), financiers (doubles paiements, rejouages, soldes) ; les 12 parcours du cahier des charges deviennent des tests de bout en bout au fil des lots.
- **État honnête des fonctions** : un module ou un bouton sans intégration réelle affiche « Bientôt disponible » et figure comme tel dans `PROJECT_STATUS.md`.

Première étape concrète après ta validation (lot 0, partie 1) :

1. Créer le dépôt et sa structure, `README.md`, `PROJECT_STATUS.md`, `DECISIONS.md` (décisions de ce document), `.env.example` par environnement.
2. API NestJS : configuration, santé, journaux structurés, OpenAPI, Prisma avec la première migration (identité, profils, espaces, audit).
3. Module d'authentification complet : inscription selon Q13, connexion par e-mail / téléphone / @utilisateur, sessions, récupération ; Google, Apple et Facebook préparés mais désactivés tant que les clés n'existent pas.
4. App Flutter : thème BIM clair et sombre, jetons de design, logos et Peni en SVG, écrans 01 à 06 reliés à l'API.
5. Tests exécutés et résultats réels consignés ; archive du projet fournie.

Comptes et accès que tu devras créer toi-même plus tard (non nécessaires pour la première étape) : AWS, Apple Developer, Google Play Console, Firebase, agrégateur de paiement, prestataire KYC, prestataire vidéo, fournisseur IA.
