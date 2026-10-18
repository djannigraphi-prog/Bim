# Démonstration gratuite sur téléphone Android (option 1)

Pour présenter BIM **sans rien payer** : le serveur tourne sur ton ordinateur, l'app s'installe sur des téléphones
Android du même Wi-Fi. Aucun SMS n'est envoyé (les codes s'affichent sur l'ordinateur), aucun argent réel ne circule
(Premium, pièces et retraits sont simulés), aucune vidéo payante (les Lives n'ont pas d'image).

## Une seule fois : préparer l'ordinateur

1. Installer **Docker Desktop** (gratuit pour un usage personnel ou une petite entreprise) : https://www.docker.com/products/docker-desktop/ — l'ouvrir une fois installé.
2. Télécharger le projet depuis GitHub (dépôt `djannigraphi-prog/Bim`, bouton **Code → Download ZIP**) et le décompresser.

## Une seule fois : récupérer l'app de démonstration

1. Sur GitHub : onglet **Actions** → **Démo gratuite** → la dernière exécution verte → en bas, **Artifacts** → `BIM-demo-apk`.
2. Décompresser : on obtient `BIM-demo.apk`.
3. L'envoyer sur chaque téléphone Android (WhatsApp, câble ou e-mail), l'ouvrir et accepter « Installer quand même »
   (autoriser les applications de cette source si le téléphone le demande). L'app s'appelle **BIM** ; elle ne remplacera
   jamais l'app publiée plus tard sur le Play Store.

## Le jour de la démonstration

1. Ordinateur et téléphones sur **le même Wi-Fi** (le partage de connexion d'un téléphone convient).
2. Ouvrir Docker Desktop, puis double-cliquer sur `demo/demarrer-demo-windows.bat` (sur Mac : `demo/demarrer-demo-mac-linux.sh`).
   Le premier démarrage prend quelques minutes ; ensuite moins d'une minute. Si Windows demande d'autoriser l'accès au
   réseau, accepter pour les **réseaux privés**.
3. La page **http://localhost:3000/demo** s'ouvre sur l'ordinateur. Elle affiche :
   - l'**adresse à saisir dans l'app** (ex. `http://192.168.1.20:3000`) ;
   - les **codes reçus** (inscription, retrait…), mis à jour toutes les 3 secondes ;
   - les **comptes de démo** et leur mot de passe.
4. Sur chaque téléphone : ouvrir BIM, toucher **« Serveur de démo »** en bas de l'écran d'accueil, saisir l'adresse,
   **Enregistrer** (une seule fois par téléphone, sauf si l'adresse change).
5. Se connecter avec un compte de démo, ou créer un compte : le code s'affiche sur la page de l'ordinateur.

Pour arrêter : `demo/arreter-demo-windows.bat` (les données sont gardées pour la prochaine fois).

## Comptes de démo (mot de passe commun : `Demo-BIM-2026!`)

| Compte | Rôle dans la démo |
| --- | --- |
| `awa.demo` | Créatrice avec Premium : publications, pièces reçues, un Live programmé |
| `koffi.demo` | Fan avec 10 000 pièces (simulées) pour encourager |
| `aminata.demo` | Marchande : boutique « Maison Aminata », 3 articles en vente |

## Ce qui est simulé

- Premium, achat de pièces, retraits : boutons « (démo) », **aucun paiement**.
- Lives : commentaires, cœurs, cadeaux, article épinglé, spectateurs ; **pas d'image vidéo** (« bientôt »).
- Codes de connexion : affichés sur la page de l'ordinateur, **aucun SMS**.
- iPhone : non disponible dans cette option (il faut un compte Apple payant ou un Mac).

## Si ça ne marche pas

- **L'app n'atteint pas le serveur** : vérifier le même Wi-Fi ; ressaisir l'adresse affichée sur la page ; sur Windows,
  autoriser Docker dans le pare-feu pour les réseaux privés.
- **La page /demo ne s'ouvre pas** : attendre une minute (premier démarrage) puis recharger ; vérifier que Docker
  Desktop est ouvert.
- **Repartir de zéro** (effacer toutes les données de démo) : dans le dossier `demo`, `docker compose down -v`.
