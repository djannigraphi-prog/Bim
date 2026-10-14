# BIM — application mobile (Flutter)

Android et iOS, une seule base de code. Architecture par fonctionnalité :

```
lib/
├─ core/            config, thème (jetons), réseau, stockage sécurisé, composants partagés, routeur
└─ features/<nom>/  data (API, modèles) · application (état Riverpod) · presentation (écrans)
```

## Lancer

```bash
flutter pub get
# API locale (émulateur Android : 10.0.2.2 = la machine hôte)
flutter run --dart-define=BIM_API_URL=http://10.0.2.2:3000 --dart-define=BIM_ENV=dev
# Simulateur iOS
flutter run --dart-define=BIM_API_URL=http://localhost:3000
flutter analyze && flutter test
```

Aucun secret dans l'app : seule l'adresse de l'API est injectée à la compilation.

## État (lot 0)

Écrans 01 à 06 + code de vérification + mot de passe oublié + paramètres minimaux, reliés à l'API.
Les onglets Accueil, Messages, Live, BimShop et le bouton « + » affichent « Bientôt disponible ».
Voir `PROJECT_STATUS.md` à la racine : le code n'a pas encore été compilé (SDK Flutter indisponible dans l'environnement de la session 1).
