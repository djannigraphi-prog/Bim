import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';

/// Brouillon d'inscription partagé entre l'écran 04 (étape 1) et l'écran 05 (étape 2).
/// Rien n'est envoyé au serveur avant « Terminer l'inscription ».
class RegistrationController extends Notifier<RegistrationDraft> {
  @override
  RegistrationDraft build() => const RegistrationDraft();

  void update(RegistrationDraft Function(RegistrationDraft) change) => state = change(state);

  void toggleInterest(String code) {
    final next = {...state.interests};
    if (!next.remove(code)) next.add(code);
    state = state.copyWith(interests: next);
  }

  void reset() => state = const RegistrationDraft();
}

final registrationProvider = NotifierProvider<RegistrationController, RegistrationDraft>(RegistrationController.new);

/// Erreurs de validation renvoyées par le serveur, par champ, affichées sur l'écran concerné.
class RegistrationErrors extends Notifier<Map<String, String>> {
  @override
  Map<String, String> build() => const {};

  void set(Map<String, String> errors) => state = errors;
  void clear() => state = const {};
}

final registrationErrorsProvider = NotifierProvider<RegistrationErrors, Map<String, String>>(RegistrationErrors.new);
