// Captures des écrans du lot 0 pour les comparer aux maquettes 01 à 06 (format iPhone 390 × 844, ×3).
// Lancé par la CI avec `flutter test test_captures --update-goldens` : ce ne sont pas des tests de non-régression,
// seulement des images à examiner. Les polices réelles (Roboto, icônes Material) sont chargées depuis le SDK Flutter ;
// sans elles le texte serait dessiné en carrés et la comparaison n'aurait pas de sens, donc le test échoue.
//
// Aucune donnée fictive n'est présentée comme réelle : le serveur est remplacé par un faux qui renvoie
// la liste des centres d'intérêt de la migration 0001 et « connexions sociales non configurées ».
import 'dart:io';
import 'dart:typed_data';

import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/auth/data/auth_api.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/auth/presentation/forgot_password_screen.dart';
import 'package:bim/features/auth/presentation/login_screen.dart';
import 'package:bim/features/auth/presentation/register_step1_screen.dart';
import 'package:bim/features/auth/presentation/register_step2_screen.dart';
import 'package:bim/features/auth/presentation/splash_screen.dart';
import 'package:bim/features/auth/presentation/verify_code_screen.dart';
import 'package:bim/features/auth/presentation/welcome_screen.dart';
import 'package:bim/features/shell/presentation/home_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
  @override
  Future<void> clear() async {}
}

class _FakeAuthApi extends AuthApi {
  _FakeAuthApi(super.api);

  // Liste identique à la migration 0001 (référentiel réel, pas un exemple inventé).
  @override
  Future<List<Interest>> interests() async => const [
        Interest(code: 'mode', label: 'Mode', icon: 'shirt'),
        Interest(code: 'sport_coaching', label: 'Sport & coaching', icon: 'dumbbell'),
        Interest(code: 'beaute_esthetique', label: 'Beauté / esthétique', icon: 'sparkles'),
        Interest(code: 'soins_spa', label: 'Soins / spa', icon: 'flower'),
        Interest(code: 'coiffure', label: 'Coiffure', icon: 'scissors'),
        Interest(code: 'maquillage', label: 'Maquillage', icon: 'brush'),
        Interest(code: 'ongles', label: 'Ongles', icon: 'hand'),
        Interest(code: 'bien_etre', label: 'Bien-être', icon: 'leaf'),
        Interest(code: 'lifestyle', label: 'Lifestyle', icon: 'camera'),
        Interest(code: 'accessoires', label: 'Accessoires', icon: 'glasses'),
      ];

  @override
  Future<Map<String, bool>> socialProviders() async => const {'google': false, 'apple': false, 'facebook': false};
}

Future<void> _loadSdkFonts() async {
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null) fail('FLUTTER_ROOT absent : polices du SDK introuvables.');
  final dir = Directory('$root/bin/cache/artifacts/material_fonts');
  final files = dir.existsSync() ? dir.listSync().whereType<File>().toList() : <File>[];
  ByteData bytes(File f) => ByteData.sublistView(Uint8List.fromList(f.readAsBytesSync()));
  final roboto = FontLoader('Roboto');
  final icons = FontLoader('MaterialIcons');
  var r = 0, i = 0;
  for (final f in files) {
    final name = f.uri.pathSegments.last;
    if (name.startsWith('Roboto-') && name.endsWith('.ttf')) {
      roboto.addFont(Future.value(bytes(f)));
      r++;
    } else if (name.startsWith('MaterialIcons-Regular')) {
      icons.addFont(Future.value(bytes(f)));
      i++;
    }
  }
  if (r == 0 || i == 0) fail('Polices Roboto ($r) ou MaterialIcons ($i) introuvables dans ${dir.path}.');
  await roboto.load();
  await icons.load();
}

final _challenge = Challenge(
  challengeId: '00000000-0000-7000-8000-000000000000',
  channel: 'phone',
  destination: '+225 07 •• •• •• 12',
  expiresAt: DateTime.now().add(const Duration(minutes: 10)),
  resendAvailableAt: DateTime.now().add(const Duration(seconds: 45)),
);

Future<ProviderContainer> _show(WidgetTester tester, String location, {ThemeMode mode = ThemeMode.light}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final storage = _NoTokens();
  final client = ApiClient(storage: storage, onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');
  final container = ProviderContainer(overrides: [
    tokenStorageProvider.overrideWithValue(storage),
    apiClientProvider.overrideWithValue(client),
    authApiProvider.overrideWithValue(_FakeAuthApi(client)),
  ]);
  addTearDown(container.dispose);
  final router = GoRouter(initialLocation: location, routes: [
    GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
    GoRoute(path: '/welcome', builder: (_, __) => const WelcomeScreen()),
    GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
    GoRoute(path: '/register/1', builder: (_, __) => const RegisterStep1Screen()),
    GoRoute(path: '/register/2', builder: (_, __) => const RegisterStep2Screen()),
    GoRoute(path: '/verify', builder: (_, __) => VerifyCodeScreen(challenge: _challenge)),
    GoRoute(path: '/forgot', builder: (_, __) => const ForgotPasswordScreen()),
    GoRoute(path: '/home', builder: (_, __) => const HomeShell()),
  ]);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp.router(
      debugShowCheckedModeBanner: false,
      theme: BimTheme.light(),
      darkTheme: BimTheme.dark(),
      themeMode: mode,
      routerConfig: router,
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
    ),
  ));
  await _settle(tester);
  return container;
}

/// Laisse le temps aux SVG (chargés hors du fil principal) et aux futures de se terminer, sans attendre
/// la fin des animations infinies (indicateur de chargement).
Future<void> _settle(WidgetTester tester) async {
  for (var k = 0; k < 6; k++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 150)));
    await tester.pump(const Duration(milliseconds: 400));
  }
}

Future<void> _capture(WidgetTester tester, String name) =>
    expectLater(find.byType(MaterialApp), matchesGoldenFile('captures/$name.png'));

void main() {
  setUpAll(_loadSdkFonts);

  testWidgets('01 splash', (t) async {
    await _show(t, '/splash');
    await _capture(t, '01_splash');
  });
  testWidgets('02 bienvenue', (t) async {
    await _show(t, '/welcome');
    await _capture(t, '02_bienvenue');
  });
  testWidgets('03 connexion', (t) async {
    await _show(t, '/login');
    await _capture(t, '03_connexion');
  });
  testWidgets('04 inscription', (t) async {
    await _show(t, '/register/1');
    await _capture(t, '04_inscription');
  });
  testWidgets('05 centres d’intérêt', (t) async {
    await _show(t, '/register/2');
    await _capture(t, '05_interets');
  });
  testWidgets('06 visiteur', (t) async {
    final c = await _show(t, '/home');
    c.read(sessionProvider.notifier).continueAsVisitor();
    await t.pump();
    await t.tap(find.byIcon(Icons.add).last);
    await _settle(t);
    await _capture(t, '06_visiteur');
  });
  testWidgets('ajout D-UI-03 : saisie du code', (t) async {
    await _show(t, '/verify');
    await _capture(t, 'x1_code');
  });
  testWidgets('ajout D-UI-03 : mot de passe oublié', (t) async {
    await _show(t, '/forgot');
    await _capture(t, 'x2_mot_de_passe_oublie');
  });
  testWidgets('accueil visiteur (sombre)', (t) async {
    final c = await _show(t, '/home', mode: ThemeMode.dark);
    c.read(sessionProvider.notifier).continueAsVisitor();
    await _settle(t);
    await _capture(t, 'x3_accueil_sombre');
  });
}
