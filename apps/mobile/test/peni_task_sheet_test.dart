import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/peni/data/peni_api.dart';
import 'package:bim/features/peni/presentation/peni_task_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

/// Réponses de l'API simulées (les textes réels sont testés côté API, task-explanations.spec.ts).
class _FakePeni extends PeniApi {
  _FakePeni({this.failures = 0}) : super(ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9'));
  int failures;
  final calls = <String>[];

  @override
  Future<PeniTaskExplanation> explainTask(String projectId, String taskId) async {
    calls.add('$projectId $taskId');
    if (failures > 0) {
      failures--;
      throw ApiException.network;
    }
    return const PeniTaskExplanation(
      taskId: 't1',
      title: 'Séance · Abdos',
      intro: 'Bonne question ! Voici « Séance · Abdos » expliquée simplement 👇',
      pose: 'think',
      sections: [
        (id: 'what', question: 'C’est quoi ?', answer: 'C’est ta séance de sport · abdos.'),
        (id: 'when', question: 'Quand ?', answer: 'À 15 h, le samedi et le dimanche : 2 fois par semaine.'),
        (id: 'missed', question: 'Et si je ne peux pas ?', answer: 'Pas grave 💛'),
      ],
    );
  }
}

Future<void> _open(WidgetTester tester, _FakePeni peni) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [peniApiProvider.overrideWithValue(peni)],
      child: MaterialApp(
        theme: BimTheme.light(),
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(onPressed: () => showPeniTaskExplanation(context, projectId: 'p1', taskId: 't1'), child: const Text('Mon programme')),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Mon programme'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Peni explique la tâche : introduction, question par défaut, autre question au toucher', (tester) async {
    final peni = _FakePeni();
    await _open(tester, peni);
    expect(peni.calls, ['p1 t1']);
    expect(find.text('Bonne question ! Voici « Séance · Abdos » expliquée simplement 👇'), findsOneWidget);
    expect(find.text('C’est ta séance de sport · abdos.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('peni-explain-q-when')));
    await tester.pump();
    expect(find.text('À 15 h, le samedi et le dimanche : 2 fois par semaine.'), findsOneWidget);
    expect(find.text('C’est ta séance de sport · abdos.'), findsNothing);
  });

  testWidgets('« Revenir à mon programme » ferme la feuille', (tester) async {
    await _open(tester, _FakePeni());
    await tester.tap(find.byKey(const ValueKey('peni-explain-close')));
    await tester.pumpAndSettle();
    expect(find.byType(PeniTaskSheet), findsNothing);
    expect(find.text('Mon programme'), findsOneWidget);
  });

  testWidgets('API indisponible : message et « Réessayer », puis l’explication s’affiche', (tester) async {
    final peni = _FakePeni(failures: 1);
    await _open(tester, peni);
    expect(find.byKey(const ValueKey('peni-explain-error')), findsOneWidget);
    expect(find.byKey(const ValueKey('peni-explain-close')), findsOneWidget); // on peut toujours revenir au programme
    await tester.tap(find.text('Réessayer'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('peni-explain-intro')), findsOneWidget);
    expect(peni.calls, hasLength(2));
  });
}
