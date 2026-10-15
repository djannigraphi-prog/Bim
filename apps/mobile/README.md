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

## État (15/10/2026)

Lots 0 et 1 (comptes, projets) et lot 2 (rappels et notifications : écran Rappels, notifications programmées sur le
téléphone avec « J'y vais ! / Plus tard », centre de notifications) reliés à l'API. Analyse, tests, captures et
compilation Android exécutés en CI ; parcours de bout en bout sur émulateur Android contre l'API réelle. iOS non compilé.
État détaillé et vérifié : `PROJECT_STATUS.md` à la racine ; clôture du lot 2 : `docs/CLOTURE_LOT2.md`.

Tests sur téléphones physiques : `docs/TESTS_TELEPHONES.md` (APK de test, rappel d'essai, grille T1 à T15).
