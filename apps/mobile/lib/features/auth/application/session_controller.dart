import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/theme_controller.dart';
import '../data/auth_api.dart';
import '../data/models.dart';

/// État de session de l'app : inconnu (au démarrage), visiteur (écran 06), connecté.
sealed class SessionState {
  const SessionState();
}

class SessionUnknown extends SessionState {
  const SessionUnknown();
}

class SessionSignedOut extends SessionState {
  const SessionSignedOut({this.visitor = false});
  /// Vrai si la personne a choisi « Voir des articles » sans compte (Q14).
  final bool visitor;
}

class SessionSignedIn extends SessionState {
  const SessionSignedIn(this.me);
  final Me me;
}

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionUnknown();

  AuthApi get _api => ref.read(authApiProvider);

  /// Au démarrage : une session enregistrée est revalidée par le serveur (le jeton peut avoir été révoqué).
  Future<void> restore() async {
    final storage = ref.read(tokenStorageProvider);
    if (await storage.refreshToken() == null) {
      state = const SessionSignedOut();
      return;
    }
    try {
      _signedIn(await _api.me());
    } on ApiException catch (e) {
      if (e.isNetwork) {
        // Hors connexion : on ne déconnecte pas ; l'écran affichera l'erreur réseau et pourra réessayer.
        state = const SessionSignedOut();
        return;
      }
      await storage.clear();
      state = const SessionSignedOut();
    } catch (_) {
      // Réponse inattendue ou stockage illisible : on repart d'un état propre plutôt que de rester bloqué au démarrage.
      state = const SessionSignedOut();
    }
  }

  Future<void> completeSignIn(({Tokens tokens, Me me}) result) async {
    await ref.read(tokenStorageProvider).save(accessToken: result.tokens.accessToken, refreshToken: result.tokens.refreshToken);
    _signedIn(result.me);
  }

  /// Profil mis à jour par le serveur (ex. après l'ajout d'une coordonnée).
  void updateMe(Me me) {
    final current = state;
    // Certaines réponses ne disent pas l'espace actif : on garde celui qu'on connaît.
    if (current is SessionSignedIn) state = SessionSignedIn(me.activeSpaceType == null ? me.withActiveSpace(current.me.activeSpaceType) : me);
  }

  Future<void> refreshMe() async => updateMe(await _api.me());

  void continueAsVisitor() => state = const SessionSignedOut(visitor: true);

  void leaveVisitor() => state = const SessionSignedOut();

  Future<void> signOut() async {
    try {
      await _api.logout();
    } on ApiException {
      // La session locale est effacée même si le serveur est injoignable.
    }
    await ref.read(tokenStorageProvider).clear();
    state = const SessionSignedOut();
  }

  /// Appelé par l'intercepteur réseau quand la session ne peut plus être rafraîchie.
  Future<void> onExpired() async {
    if (state is SessionSignedIn) state = const SessionSignedOut();
  }

  void _signedIn(Me me) {
    ref.read(themeModeProvider.notifier).setFromServer(me.theme);
    state = SessionSignedIn(me);
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);
