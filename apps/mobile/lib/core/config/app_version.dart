import 'package:flutter/foundation.dart';

/// Version de l'app envoyée à l'API (en-tête `X-Bim-App-Version`) ; doit rester égale à `version:` de pubspec.yaml
/// (sans le numéro de build) — vérifié par un test.
const kAppVersion = '0.1.0';

/// Plateforme envoyée à l'API (en-tête `X-Bim-Platform`) : android ou ios ; null ailleurs (aucune exigence de version).
String? appPlatform() => switch (defaultTargetPlatform) {
      TargetPlatform.android => 'android',
      TargetPlatform.iOS => 'ios',
      _ => null,
    };
