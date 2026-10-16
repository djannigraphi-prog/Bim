import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/auth/data/auth_api.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/auth/presentation/splash_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Jetons en mémoire (le stockage sécurisé du téléphone n'existe pas dans les tests).
class _MemoryTokens extends TokenStorage {
  String? access = 'a1';
  String? refresh = 'r1';
  @override
  Future<String?> accessToken() async => access;
  @override
  Future<String?> refreshToken() async => refresh;
  @override
  Future<void> save({required String accessToken, required String refreshToken}) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> clear() async => access = refresh = null;
}

/// Serveur simulé : /v1/me répond par l'erreur donnée (ou un profil), /v1/auth/logout réussit.
class _FakeAuth extends AuthApi {
  _FakeAuth(this.answer) : super(ApiClient(storage: _MemoryTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9'));
  ApiException? answer;
  int meCalls = 0;

  @override
  Future<Me> me() async {
    meCalls++;
    final a = answer;
    if (a != null) throw a;
    return Me.fromJson(const {'id': 'u1', 'fullName': 'Awa Koné', 'username': 'awa.kone', 'city': 'Cocody', 'contacts': <dynamic>[]});
  }

  @override
  Future<void> logout() async {}
}

(ProviderContainer, _MemoryTokens) _container(_FakeAuth api) {
  final tokens = _MemoryTokens();
  final c = ProviderContainer(overrides: [tokenStorageProvider.overrideWithValue(tokens), authApiProvider.overrideWithValue(api)]);
  addTearDown(c.dispose);
  return (c, tokens);
}

void main() {
  group('audit point 3 : démarrage, session gardée seulement pour une erreur momentanée', () {
    for (final (name, error) in [
      ('réseau', const ApiException(code: 'NETWORK', message: 'Hors connexion')),
      ('erreur serveur 503', const ApiException(code: 'UNAVAILABLE', message: 'Indisponible', status: 503)),
      ('limite 429', const ApiException(code: 'TOO_MANY_REQUESTS', message: 'Trop de requêtes', status: 429)),
      ('401 sans refus de session (rafraîchissement impossible)', const ApiException(code: 'UNAUTHENTICATED', message: 'Connecte-toi', status: 401)),
    ]) {
      test('$name : session gardée, écran « Réessayer »', () async {
        final (c, tokens) = _container(_FakeAuth(error));
        await c.read(sessionProvider.notifier).restore();
        final s = c.read(sessionProvider);
        expect(s, isA<SessionUnknown>());
        expect((s as SessionUnknown).unreachable, isTrue);
        expect(tokens.refresh, 'r1');
      });
    }

    for (final (name, error) in [
      ('403', const ApiException(code: 'ACCOUNT_SUSPENDED', message: 'Compte suspendu', status: 403)),
      ('404', const ApiException(code: 'NOT_FOUND', message: 'Introuvable', status: 404)),
      ('401 SESSION_INVALID', const ApiException(code: 'SESSION_INVALID', message: 'Session expirée', status: 401)),
    ]) {
      test('$name : déconnexion, jetons effacés (jamais de blocage sur l’écran d’accueil)', () async {
        final (c, tokens) = _container(_FakeAuth(error));
        await c.read(sessionProvider.notifier).restore();
        expect(c.read(sessionProvider), isA<SessionSignedOut>());
        expect(tokens.refresh, isNull);
      });
    }

    test('après « Réessayer » réussi : connecté', () async {
      final api = _FakeAuth(const ApiException(code: 'NETWORK', message: 'Hors connexion'));
      final (c, _) = _container(api);
      await c.read(sessionProvider.notifier).restore();
      api.answer = null;
      await c.read(sessionProvider.notifier).restore();
      expect(c.read(sessionProvider), isA<SessionSignedIn>());
      expect(api.meCalls, 2);
    });
  });

  testWidgets('écran d’accueil hors connexion : « Réessayer » et « Se déconnecter » ; se déconnecter efface la session', (tester) async {
    final tokens = _MemoryTokens();
    final api = _FakeAuth(const ApiException(code: 'NETWORK', message: 'Hors connexion'));
    final c = ProviderContainer(overrides: [tokenStorageProvider.overrideWithValue(tokens), authApiProvider.overrideWithValue(api)]);
    addTearDown(c.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container: c, child: const MaterialApp(home: SplashScreen())));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(const ValueKey('splash-unreachable')), findsOneWidget);
    expect(find.byKey(const ValueKey('splash-retry')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('splash-sign-out')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(c.read(sessionProvider), isA<SessionSignedOut>());
    expect(tokens.refresh, isNull);
  });
}
