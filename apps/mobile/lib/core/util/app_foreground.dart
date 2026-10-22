import 'package:flutter/widgets.dart';

/// Vrai si l'app est au premier plan. Les mises à jour périodiques (conversation, live, compteurs) sautent leur tour
/// quand l'app est en arrière-plan : pas de requêtes inutiles (batterie, forfait) ; elles reprennent au retour.
/// État inconnu (tests, démarrage) : considéré au premier plan.
bool get appInForeground {
  final s = WidgetsBinding.instance.lifecycleState;
  return s == null || s == AppLifecycleState.resumed;
}
