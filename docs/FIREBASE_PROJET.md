# Créer le projet Firebase de BIM (au nom de l'entreprise)

Statut : **à faire par le fondateur, après accord explicite**. Rien n'est créé. Le code est prêt à s'y brancher (lot 2, étapes E et H).

## À quoi il sert, et ce qu'il coûte

- Envoyer les rappels **depuis le serveur** (Firebase Cloud Messaging, FCM), même quand l'app n'a pas été ouverte depuis longtemps. Sans lui, les rappels sont programmés par le téléphone lui-même (notifications programmées classiques, déjà développées), mais seulement pour les 48 heures qui suivent la dernière ouverture de l'app.
- **Coût : 0.** FCM est gratuit à tout volume, dans la formule gratuite « Spark ». **Ne pas passer à la formule « Blaze »** (elle demande une carte bancaire et n'apporte rien pour FCM).
- iOS : les notifications passent par Apple (APNs, gratuit) ; il faudra le compte Apple Developer (99 USD/an), déjà nécessaire pour publier l'app.

## Étapes (environ 30 minutes)

1. **Compte Google de l'entreprise.** Utiliser un compte au nom de BIM (par exemple `tech@<domaine de BIM>`), pas un compte personnel. Activer la validation en deux étapes. Prévoir un second propriétaire de confiance, pour ne jamais perdre l'accès.
2. **Créer deux projets** sur [console.firebase.google.com](https://console.firebase.google.com) : `bim-staging` (tests) et `bim-production`. Deux projets séparés évitent qu'un test envoie une notification à de vraies personnes.
   - Google Analytics : **désactivé** (inutile pour les rappels ; moins de données partagées). Il pourra être activé plus tard, sur décision.
   - Formule : rester sur **Spark** (gratuite).
3. **Conditions de traitement des données.** Paramètres du projet → Confidentialité : accepter les conditions de traitement des données de Firebase et renseigner l'entreprise comme responsable du traitement. Google devient sous-traitant des jetons d'appareil : à mentionner dans la politique de confidentialité et dans la déclaration à l'ARTCI.
4. **Ajouter l'app Android** dans chaque projet, avec l'identifiant `ci.bim.app`. Cet identifiant est **provisoire** (D-APP-01) : le confirmer avant, car il ne peut plus changer après la publication. L'empreinte SHA-1 n'est pas nécessaire pour FCM. Télécharger le fichier `google-services.json`. Il n'est pas secret au sens strict, mais il ne sera pas mis dans le dépôt : il sera fourni à la compilation.
5. **Vérifier que l'« API Firebase Cloud Messaging (V1) » est activée.** Elle l'est par défaut sur les nouveaux projets : Paramètres → Cloud Messaging.
6. **Compte de service du serveur.** Dans Google Cloud (IAM) du projet, créer un compte de service dédié `bim-api-fcm` avec le seul rôle « Firebase Cloud Messaging API Admin », puis générer une clé JSON. Ne pas utiliser le compte « firebase-adminsdk » créé automatiquement, qui a beaucoup plus de droits.
   - **Cette clé est un secret.** Ne jamais l'envoyer par e-mail, par message ou dans la conversation, ni la mettre dans le dépôt. Elle va directement dans AWS Parameter Store (paramètre chiffré `/bim/<environnement>/fcm_service_account`), lisible par le seul service des rappels.
7. **iOS (plus tard)** : ajouter l'app iOS dans chaque projet et y déposer la clé APNs (fichier `.p8`) créée dans le compte Apple Developer.

## Ce que tu me transmets

Seulement les **identifiants des deux projets** (par exemple `bim-staging-1a2b3`) et la confirmation que les étapes 1 à 6 sont faites. Aucun mot de passe, aucune clé privée.

## Ce que je ferai ensuite (sans dépense)

1. Ajouter Firebase à l'app (`firebase_core`, `firebase_messaging`) et une source de jeton Firebase à la place de `UnavailablePushTokenSource` : `apps/mobile/lib/features/notifications/application/push_token_source.dart`.
2. Inscrire le téléphone auprès de l'API (`PUT /v1/me/push-device`, déjà prêt) quand la personne a activé ses rappels et autorisé les notifications ; le désinscrire à la désactivation et à la déconnexion. Un téléphone inscrit ne programme plus ses rappels lui-même : l'API renvoie alors `channel: "push"`, ce qui évite les doublons.
3. Configurer le projet de test (`PUSH_PROVIDER=fcm` et `FCM_SERVICE_ACCOUNT_JSON` depuis le secret) et tester sur de vrais téléphones courants en Côte d'Ivoire.
4. Production seulement après ton accord sur le service des rappels (dépense d'hébergement, `docs/LOT2_RAPPELS_ETUDE.md`, section 10).
