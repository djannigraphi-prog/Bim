/// Erreur renvoyée par l'API au format { error: { code, message, details } } (docs/API_ERRORS.md).
class ApiException implements Exception {
  const ApiException({required this.code, required this.message, this.status, this.details = const {}});

  final String code;
  final String message;
  final int? status;
  final Map<String, dynamic> details;

  /// Message d'erreur d'un champ de formulaire (validation serveur), ou null.
  String? fieldError(String field) {
    final fields = details['fields'];
    if (fields is Map && fields[field] is List && (fields[field] as List<dynamic>).isNotEmpty) {
      return (fields[field] as List<dynamic>).first.toString();
    }
    return null;
  }

  bool get isNetwork => code == 'NETWORK';

  static const network = ApiException(
    code: 'NETWORK',
    message: 'Connexion impossible. Vérifie ta connexion internet et réessaie.',
  );

  static const unknown = ApiException(code: 'UNKNOWN', message: 'Une erreur est survenue. Réessaie plus tard.');

  @override
  String toString() => 'ApiException($code, $status): $message';
}
