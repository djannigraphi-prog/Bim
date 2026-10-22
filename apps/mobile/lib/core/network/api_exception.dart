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

  /// Réponse du serveur illisible (pas du JSON attendu) : portail Wi-Fi, proxy, serveur de démo mal configuré.
  static const unexpected = ApiException(code: 'UNEXPECTED_RESPONSE', message: 'Réponse inattendue du serveur. Réessaie dans un instant.');

  /// Fichier trop lourd (413), message aligné sur celui de l'API (code FILE_TOO_LARGE).
  static const fileTooLarge = ApiException(code: 'FILE_TOO_LARGE', message: 'Fichier trop lourd : 100 Mo au plus.', status: 413);

  static const unknown = ApiException(code: 'UNKNOWN', message: 'Une erreur est survenue. Réessaie plus tard.');

  @override
  String toString() => 'ApiException($code, $status): $message';
}
