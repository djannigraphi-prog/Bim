/// Configuration injectée à la compilation : flutter run --dart-define=BIM_API_URL=https://api.staging.bim.ci
/// Trois environnements : dev (défaut, API locale), staging, production. Aucun secret dans l'app mobile.
abstract final class Env {
  static const apiUrl = String.fromEnvironment('BIM_API_URL', defaultValue: 'http://10.0.2.2:3000');
  static const name = String.fromEnvironment('BIM_ENV', defaultValue: 'dev');
  static bool get isProduction => name == 'production';
}
