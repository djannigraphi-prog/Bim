# Notifications de Peni : apparence et protocole de test

**06/11/2026.** Correction demandée par le fondateur : sur Android, les rappels de Peni montraient un rond avec la
lettre « B » au lieu de Peni (maquette 28 : avatar de Peni à gauche, « Peni » en titre, le message à côté).

**État : code modifié, NON VALIDÉ sur téléphone.** Rien n'est considéré comme corrigé avant les captures sur un vrai
Android et un vrai iPhone décrites plus bas.

## Cause

Constat sur les captures de l'émulateur (`captures/a28_*`, 22/10/2026) : la notification utilisait la présentation
standard d'Android, qui place **la petite icône dans un rond à gauche** (ici le « B » de BIM) ; l'avatar de Peni
était seulement la « grande icône », petite et placée selon les versions d'Android. Quand plusieurs rappels sont
affichés, Android les regroupe sous l'en-tête de l'app, qui montre aussi ce rond.

## Ce qui change

| Plateforme | Avant | Après |
| --- | --- | --- |
| Android, petite icône | « B » blanc (`ic_stat_bim`) | **Silhouette blanche de Peni** sur fond transparent (`ic_stat_peni`, 5 densités), colorée par Android en rouge BIM |
| Android, présentation | Notification standard + grande icône | **Notification de conversation** (`MessagingStyle`) : Peni est l'expéditrice, **son avatar s'affiche à gauche**, le nom « Peni » en titre et le message à côté. La grande icône reste pour les anciennes versions d'Android |
| Android, couleur d'accent | Rouge BIM `#F20D3A` | Inchangée (vérifiée par un test) |
| iPhone | **Aucun rappel programmé** (seul Android était pris en charge) | Rappels programmés sur iPhone ; **l'icône de l'app s'affiche toujours à gauche** (règle d'Apple) ; l'**avatar de Peni est joint** à la notification (vignette à droite) ; actions « J'y vais ! / Plus tard » |

### iPhone : avatar de Peni à gauche

Sur iPhone, seule une **notification de communication** remplace l'icône de l'app par l'avatar de l'expéditeur. Elle
demande la capacité « Communication Notifications » d'Apple, qui ne s'active qu'avec le **compte Apple Developer**
(99 $ par an, **non engagé**) et la signature de l'app. Tant que ce compte n'existe pas, l'iPhone montre l'icône de
BIM à gauche et Peni en vignette. À faire après l'ouverture du compte : ajouter la capacité, une extension
« Notification Service » et l'intention de message (`INSendMessageIntent`) avec l'avatar de Peni.

## Fichiers

- `scripts/generate-notification-icons.py` : génère aussi `ic_stat_peni` et les avatars pour l'iPhone
  (`apps/mobile/assets/peni/notif/`).
- `apps/mobile/lib/features/notifications/application/local_notifier.dart` : présentation conversation, iPhone
  (autorisation, catégorie d'actions, pièce jointe).
- `apps/mobile/ios/Runner/AppDelegate.swift` : les notifications passent par l'app (affichage app ouverte, actions).
- `apps/mobile/android/app/src/main/res/raw/keep.xml` : `ic_stat_peni` conservée dans la version publiée.
- `apps/mobile/test/reminder_scheduler_test.dart` : tests de l'apparence (Android et iPhone).

## Protocole de test sur vrais téléphones (à faire, captures obligatoires)

Pour chaque téléphone : Rappels → « Rappel d'essai » (versions de test), puis attendre la notification.

| Cas | Android (modèle et version à noter) | iPhone (modèle et version à noter) |
| --- | --- | --- |
| App ouverte | capture | capture |
| App en arrière-plan | capture | capture |
| App fermée (balayée) | capture | capture |
| Écran verrouillé | capture | capture |
| Plusieurs rappels regroupés | capture | capture |
| « J'y vais ! » ouvre la bonne journée | vidéo ou capture | vidéo ou capture |

Points à vérifier sur chaque capture : avatar de Peni à gauche (Android), silhouette de Peni dans la barre d'état,
« Peni » en titre, texte complet, boutons, couleur rouge BIM. Sur Samsung et Xiaomi, la surcouche du fabricant peut
modifier la présentation : noter la marque.

**Prérequis :** une version de l'app compilée par la CI (accès en écriture au dépôt) ; pour l'iPhone, installer
l'app demande le compte Apple Developer (ou un Mac avec Xcode et un compte Apple gratuit, valable 7 jours).
