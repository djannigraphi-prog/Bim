// Captures des écrans du lot 0 pour les comparer aux maquettes 01 à 06 (format iPhone 390 × 844, ×3).
// Lancé par la CI avec `flutter test test_captures --update-goldens` : ce ne sont pas des tests de non-régression,
// seulement des images à examiner. Les polices réelles (Roboto, icônes Material) sont chargées depuis le SDK Flutter ;
// sans elles le texte serait dessiné en carrés et la comparaison n'aurait pas de sens, donc le test échoue.
//
// Aucune donnée fictive n'est présentée comme réelle : le serveur est remplacé par un faux qui renvoie
// la liste des centres d'intérêt de la migration 0001 et « connexions sociales non configurées ».
import 'dart:io';

import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/account/data/account_api.dart';
import 'package:bim/features/account/presentation/account_security_screens.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/shell/presentation/account_screen.dart';
import 'package:bim/features/auth/data/auth_api.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/auth/presentation/forgot_password_screen.dart';
import 'package:bim/features/auth/presentation/login_screen.dart';
import 'package:bim/features/auth/presentation/register_step1_screen.dart';
import 'package:bim/features/auth/presentation/register_step2_screen.dart';
import 'package:bim/features/auth/presentation/splash_screen.dart';
import 'package:bim/features/auth/presentation/verify_code_screen.dart';
import 'package:bim/features/auth/presentation/welcome_screen.dart';
import 'package:bim/features/projects/data/projects_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/projects/presentation/celebration_screen.dart';
import 'package:bim/features/projects/presentation/my_projects_screen.dart';
import 'package:bim/features/projects/presentation/new_project_screen.dart';
import 'package:bim/features/projects/presentation/program_screen.dart';
import 'package:bim/features/projects/presentation/project_day_screen.dart';
import 'package:bim/features/projects/presentation/project_map_screen.dart';
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
  @override
  Future<void> save({required String accessToken, required String refreshToken}) async {}
}

/// Données de démonstration POUR LES CAPTURES UNIQUEMENT.
class _FakeAccountApi extends AccountApi {
  _FakeAccountApi(super.api);

  @override
  Future<List<DeviceSession>> sessions() async => [
        DeviceSession(id: 's1', userAgent: 'Dart/3.13 (dart:io)', lastUsedAt: DateTime.now(), current: true),
        DeviceSession(id: 's2', userAgent: 'Mozilla/5.0 (Linux; Android 14)', lastUsedAt: DateTime.now().subtract(const Duration(days: 2)), current: false),
      ];

  @override
  Future<List<SpaceItem>> spaces() async => const [SpaceItem(type: 'user', id: 'u1', label: 'Awa Koné', status: 'active', usable: true, active: true)];
}

const _demoMe = {
  'id': 'u1',
  'fullName': 'Awa Koné',
  'username': 'awa.kone',
  'city': 'Cocody',
  'preferences': {'theme': 'light'},
  'contacts': [
    {'id': 'c1', 'type': 'phone', 'value': '+2250700000000', 'verified': true},
    {'id': 'c2', 'type': 'email', 'value': 'awa@exemple.com', 'verified': true},
  ],
};

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


/// Données de démonstration POUR LES CAPTURES UNIQUEMENT (jamais affichées dans l'app) ; le catalogue reprend la migration 0005.
class _FakeProjectsApi extends ProjectsApi {
  _FakeProjectsApi(super.api);

  static String iso(int offset) => DateTime.now().toUtc().add(Duration(days: offset)).toIso8601String().substring(0, 10);

  @override
  Future<ProjectCatalog> catalog() async => ProjectCatalog.fromJson({
        'categories': [
          for (final (code, label, icon, tint) in [
            ('sport', 'Sport', 'dumbbell', '#FDECEF'),
            ('style_look', 'Style & look', 'shirt', '#EEF0FF'),
            ('visage_peau', 'Visage & peau', 'sparkles', '#FFF4E5'),
            ('cheveux_coiffure', 'Cheveux & coiffure', 'scissors', '#EAF3FF'),
            ('ongles_mains', 'Ongles & mains', 'hand', '#FDEFF3'),
            ('maquillage', 'Maquillage', 'brush', '#F3EEFF'),
            ('bien_etre_spa', 'Bien-être & spa', 'flower', '#EAF7EF'),
          ])
            {
              'code': code,
              'label': label,
              'icon': icon,
              'tint': tint,
              'hasValidatedPrograms': false,
              'goals': code != 'sport'
                  ? <Map<String, dynamic>>[]
                  : [
                      {'code': 'sport_perte_poids', 'label': 'Perte de poids', 'quantityUnit': 'kg', 'quantityMin': 1, 'quantityMax': 30},
                      for (final g in ['Fessiers', 'Abdos', 'Pectoraux', 'Bras', 'Cuisses', 'Cardio & endurance', 'Prise de masse', 'Souplesse', 'Remise en forme'])
                        {'code': g, 'label': g, 'quantityUnit': null, 'quantityMin': null, 'quantityMax': null},
                    ],
            },
        ],
        'durationsDays': [30, 60, 90],
        'budgetTiers': {'small': '≈ 10 000 F', 'medium': '≈ 35 000 F', 'boosted': '75 000 F +'},
        'availabilityTimes': {'morning': '07:00', 'noon': '12:30', 'afternoon': '15:00'},
        'maxActive': 5,
      });

  static Map<String, dynamic> _summary(String id, String title, String cat, String icon, String mode, String status, int dayN, int dur, int progress) => {
        'id': id,
        'title': title,
        'categoryCode': cat,
        'categoryLabel': cat,
        'icon': icon,
        'mode': mode,
        'status': status,
        'isPublic': false,
        'startDate': iso(-dayN + 1),
        'plannedEndDate': iso(dur - dayN),
        'pausedUntil': null,
        'durationDays': dur,
        'currentDay': dayN,
        'progress': progress,
        'streak': 3,
      };

  @override
  Future<ProjectList> list() async => ProjectList.fromJson({
        'items': [
          _summary('p1', 'Perdre 10 kg', 'Sport', 'dumbbell', 'premium', 'active', 5, 60, 42),
          _summary('p2', 'Améliorer mon look', 'Style & look', 'shirt', 'eco', 'active', 24, 30, 78),
          _summary('p3', 'Avoir une peau soyeuse', 'Visage & peau', 'sparkles', 'premium', 'completed', 30, 30, 100),
        ],
        'activeCount': 2,
        'maxActive': 5,
        'today': iso(0),
      });

  @override
  Future<ProjectDetail> detail(String id) async {
    final states = ['done', 'done', 'missed', 'done', 'today'];
    return ProjectDetail.fromJson({
      ..._summary(id, 'Perdre 10 kg', 'Sport', 'dumbbell', 'premium', id == 'p3' ? 'completed' : 'active', 5, 60, 42),
      'goal': {'code': 'sport_perte_poids', 'label': 'Perte de poids', 'quantityUnit': 'kg'},
      'programSource': 'answers',
      'totalSteps': 48,
      'completedSteps': 20,
      'bestStreak': 9,
      'sessionsPerWeek': 3,
      'healthNote': null,
      'tasks': [
        {'id': 't1', 'title': 'Séance · Perte de poids', 'detail': 'Créée à partir de tes réponses.', 'icon': 'dumbbell', 'timeOfDay': '15:00', 'weekdays': 21, 'origin': 'answers'},
        {'id': 't2', 'title': 'Étirements', 'detail': '15 min', 'icon': 'check', 'timeOfDay': '21:00', 'weekdays': 127, 'origin': 'user'},
      ],
      'days': [
        for (var i = 0; i < 60; i++)
          {'day': iso(i - 4), 'index': i + 1, 'due': 2, 'done': i < 4 && states[i] == 'done' ? 2 : 0, 'state': i < 5 ? states[i] : 'upcoming'},
      ],
      'today': iso(0),
    });
  }

  @override
  Future<DayPlan> day(String id, String day) async => DayPlan.fromJson({
        'day': day,
        'index': 5,
        'durationDays': 60,
        'state': 'today',
        'editable': true,
        'tasks': [
          {'id': 't0', 'title': 'Marche', 'detail': '10 min', 'icon': 'leaf', 'timeOfDay': '07:00', 'done': true},
          {'id': 't1', 'title': 'Séance · Perte de poids', 'detail': 'Créée à partir de tes réponses.', 'icon': 'dumbbell', 'timeOfDay': '15:00', 'done': false},
          {'id': 't2', 'title': 'Étirements', 'detail': '15 min', 'icon': 'check', 'timeOfDay': '21:00', 'done': false},
        ],
      });
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

Future<ProviderContainer> _show(WidgetTester tester, String location, {ThemeMode mode = ThemeMode.light, Size physical = const Size(1170, 2532)}) async {
  tester.view.physicalSize = physical;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final storage = _NoTokens();
  final client = ApiClient(storage: storage, onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');
  final container = ProviderContainer(overrides: [
    tokenStorageProvider.overrideWithValue(storage),
    apiClientProvider.overrideWithValue(client),
    authApiProvider.overrideWithValue(_FakeAuthApi(client)),
    projectsApiProvider.overrideWithValue(_FakeProjectsApi(client)),
    accountApiProvider.overrideWithValue(_FakeAccountApi(client)),
  ],);
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
    GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
    GoRoute(path: '/account/contacts', builder: (_, __) => const ContactsScreen()),
    GoRoute(path: '/account/password', builder: (_, __) => const ChangePasswordScreen()),
    GoRoute(path: '/account/devices', builder: (_, __) => const DevicesScreen()),
    GoRoute(path: '/projects', builder: (_, __) => const MyProjectsScreen()),
    GoRoute(path: '/projects/new', builder: (_, __) => const NewProjectScreen()),
    GoRoute(path: '/projects/p1', builder: (_, __) => const ProjectMapScreen(projectId: 'p1')),
    GoRoute(path: '/projects/p1/program', builder: (_, __) => const ProgramScreen(projectId: 'p1')),
    GoRoute(path: '/projects/p3/done', builder: (_, __) => const CelebrationScreen(projectId: 'p3')),
    GoRoute(path: '/projects/p1/today', builder: (_, __) => ProjectDayScreen(projectId: 'p1', day: _FakeProjectsApi.iso(0))),
  ],);
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
  ),);
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
  // Petit téléphone (320 × 568, la largeur de l'émulateur de la CI) : un débordement ferait échouer ce test.
  testWidgets('04 inscription, petit écran', (t) async {
    await _show(t, '/register/1', physical: const Size(960, 1704));
    await _capture(t, 'x4_inscription_petit_ecran');
  });
  testWidgets('03 connexion, petit écran', (t) async {
    await _show(t, '/login', physical: const Size(960, 1704));
    await _capture(t, 'x5_connexion_petit_ecran');
  });
  for (final (route, name) in [('/welcome', '02'), ('/register/2', '05'), ('/verify', 'code'), ('/forgot', 'oubli'), ('/home', 'accueil')]) {
    testWidgets('$name, petit écran', (t) async {
      await _show(t, route, physical: const Size(960, 1704));
      await _capture(t, 'x6_petit_ecran_$name');
    });
  }

  testWidgets('18 mes projets', (t) async {
    await _show(t, '/projects');
    await _capture(t, '18_mes_projets');
  });
  testWidgets('19 à 23 nouveau projet', (t) async {
    await _show(t, '/projects/new');
    await t.tap(find.text('Mode Premium'));
    await t.pump();
    await t.tap(find.text('Moyen'));
    await _settle(t);
    await _capture(t, '19_np_mode');
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Sport'));
    await _settle(t);
    await _capture(t, '20_np_categorie');
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Perte de poids'));
    await _settle(t);
    await _capture(t, '21_np_objectif');
    await t.tap(find.text('Continuer'));
    await _settle(t);
    await _capture(t, '22_np_photo');
    await t.tap(find.text('Passer cette étape'));
    await _settle(t);
    await _capture(t, '23_np_questions');
  });
  testWidgets('20 et 23, petit écran', (t) async {
    await _show(t, '/projects/new', physical: const Size(960, 1704));
    await t.tap(find.text('Mode Éco'));
    await t.pump();
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Sport'));
    await _settle(t);
    await _capture(t, 'x8_petit_ecran_20');
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Abdos'));
    await t.pump();
    await t.tap(find.text('Continuer'));
    await t.pump();
    await t.tap(find.text('Passer cette étape'));
    await _settle(t);
    await _capture(t, 'x8_petit_ecran_23');
  });
  testWidgets('24 programme', (t) async {
    await _show(t, '/projects/p1/program');
    await _capture(t, '24_np_plan');
  });
  testWidgets('26 carte du projet', (t) async {
    await _show(t, '/projects/p1');
    await _capture(t, '26_projet_carte');
  });
  testWidgets('27 journée', (t) async {
    await _show(t, '/projects/p1/today');
    await _capture(t, '27_projet_jour');
  });
  testWidgets('29 pause', (t) async {
    await _show(t, '/projects/p1/today');
    await t.tap(find.text('Pause'));
    await _settle(t);
    await _capture(t, '29_pause');
  });
  testWidgets('30 fin du programme', (t) async {
    await _show(t, '/projects/p3/done');
    await _capture(t, '30_celebration');
  });
  for (final (route, name) in [('/projects', '18'), ('/projects/new', '19'), ('/projects/p1', '26'), ('/projects/p1/today', '27'), ('/projects/p1/program', '24')]) {
    testWidgets('$name projets, petit écran', (t) async {
      await _show(t, route, physical: const Size(960, 1704));
      await _capture(t, 'x7_petit_ecran_$name');
    });
  }

  Future<void> signedIn(WidgetTester t, String route, {Size physical = const Size(1170, 2532)}) async {
    final c = await _show(t, route, physical: physical);
    await c.read(sessionProvider.notifier).completeSignIn(
      (tokens: const Tokens(accessToken: 'a', refreshToken: 'r'), me: Me.fromJson(_demoMe)),
    );
    await _settle(t);
  }

  for (final (route, name) in [('/account', '62_parametres'), ('/account/contacts', 'x9_coordonnees'), ('/account/password', 'x9_mot_de_passe'), ('/account/devices', 'x9_appareils')]) {
    testWidgets('compte : $name', (t) async {
      await signedIn(t, route);
      await _capture(t, name);
    });
    testWidgets('compte : $name, petit écran', (t) async {
      await signedIn(t, route, physical: const Size(960, 1704));
      await _capture(t, '${name}_petit');
    });
  }
  testWidgets('53 changer de profil', (t) async {
    await signedIn(t, '/account');
    await t.tap(find.text('Changer de profil'));
    await _settle(t);
    await _capture(t, '53_changer_profil');
  });
  testWidgets('accueil visiteur (sombre)', (t) async {
    final c = await _show(t, '/home', mode: ThemeMode.dark);
    c.read(sessionProvider.notifier).continueAsVisitor();
    await _settle(t);
    await _capture(t, 'x3_accueil_sombre');
  });
}
