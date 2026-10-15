import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Source du jeton de notification « serveur » de ce téléphone (Firebase Cloud Messaging).
///
/// **Préparée, inactive** : aucun projet Firebase n'existe encore (création soumise à l'accord du fondateur, voir
/// `docs/FIREBASE_PROJET.md`). Tant que [available] est faux, l'app ne s'inscrit pas pour les notifications du serveur
/// et programme elle-même ses rappels sur le téléphone (notifications programmées classiques). Le jour où le projet
/// existe, une implémentation Firebase remplace [UnavailablePushTokenSource] sans toucher au reste de l'app.
abstract class PushTokenSource {
  /// Le téléphone peut recevoir les notifications du serveur (service configuré et disponible).
  bool get available;

  /// Jeton de ce téléphone, ou null s'il n'est pas disponible (service absent, autorisation refusée…).
  Future<String?> token();

  /// Nouveaux jetons (le service peut le renouveler) : à renvoyer à l'API.
  Stream<String> get onTokenRefresh;

  /// Retire le jeton localement (déconnexion, rappels désactivés).
  Future<void> deleteToken();
}

/// Aucun service de notifications serveur configuré (situation actuelle) : rien n'est simulé.
class UnavailablePushTokenSource implements PushTokenSource {
  const UnavailablePushTokenSource();

  @override
  bool get available => false;

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get onTokenRefresh => const Stream<String>.empty();

  @override
  Future<void> deleteToken() async {}
}

final pushTokenSourceProvider = Provider<PushTokenSource>((ref) => const UnavailablePushTokenSource());
