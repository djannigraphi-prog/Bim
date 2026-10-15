import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/peni/data/peni_api.dart';
import 'package:bim/features/projects/data/projects_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/projects/presentation/project_day_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

ApiClient _client() => ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');

class _FakeProjects extends ProjectsApi {
  _FakeProjects() : super(_client());

  @override
  Future<DayPlan> day(String id, String day) async => DayPlan.fromJson({
        'day': day,
        'index': 5,
        'durationDays': 60,
        'state': 'today',
        'editable': true,
        'tip': {'text': 'Boire un grand verre d’eau au réveil.', 'validatedBy': 'Coach BIM'},
        'tasks': [
          {'id': 't0', 'title': 'Marche', 'detail': '10 min', 'icon': 'leaf', 'timeOfDay': '07:00', 'done': true},
          {'id': 't1', 'title': 'Séance · Abdos', 'detail': '20 min', 'icon': 'dumbbell', 'timeOfDay': '15:00', 'done': false},
          {'id': 't2', 'title': 'Étirements', 'detail': '15 min', 'icon': 'check', 'timeOfDay': '21:00', 'done': false},
        ],
      });
}

class _FakePeni extends PeniApi {
  _FakePeni({this.fail = false}) : super(_client());
  final bool fail;
  final calls = <String>[];

  @override
  Future<PeniEncouragement> encouragement(String projectId, {required String context, String? day}) async {
    calls.add('$projectId $context ${day ?? '-'}');
    if (fail) throw ApiException.network;
    return const PeniEncouragement(key: 'partial', text: '1 sur 3, c’est un bon début 👏 On continue ?', pose: 'happy');
  }
}

Future<void> _open(WidgetTester tester, _FakePeni peni) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [projectsApiProvider.overrideWithValue(_FakeProjects()), peniApiProvider.overrideWithValue(peni)],
      child: MaterialApp(
        theme: BimTheme.light(),
        locale: const Locale('fr'),
        supportedLocales: const [Locale('fr')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: const ProjectDayScreen(projectId: 'p1', day: '2026-10-15'),
      ),
    ),
  );
  for (var i = 0; i < 4; i++) {
    await tester.pump();
  }
}

void main() {
  testWidgets('journée (écran 27) : l’encouragement écrit par l’API s’affiche, avec l’habitude du jour', (tester) async {
    final peni = _FakePeni();
    await _open(tester, peni);
    expect(peni.calls, ['p1 day 2026-10-15']);
    expect(find.byKey(const ValueKey('peni-partial')), findsOneWidget);
    expect(find.text('1 sur 3, c’est un bon début 👏 On continue ?'), findsOneWidget);
    expect(find.textContaining('Boire un grand verre d’eau au réveil.', findRichText: true), findsOneWidget);
  });

  testWidgets('API de Peni indisponible : l’écran garde son message habituel, sans erreur', (tester) async {
    await _open(tester, _FakePeni(fail: true));
    expect(find.byKey(const ValueKey('peni-local')), findsOneWidget);
    expect(find.text('1 tâche sur 3 faite. On y va ?'), findsOneWidget);
  });
}
