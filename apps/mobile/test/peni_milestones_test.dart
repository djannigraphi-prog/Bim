import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/peni/data/peni_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/projects/presentation/project_map_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _chest = ProjectChest(kind: 'week', week: 2, day: '2026-10-14', due: 10, done: 8, state: 'open');

Future<void> _open(WidgetTester tester, {PeniMilestone? peni}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: BimTheme.light(),
    home: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () => showChest(context, _chest, peni: peni), child: const Text('ouvrir')))),
  ),);
  await tester.tap(find.text('ouvrir'));
  await tester.pumpAndSettle();
}

void main() {
  test('messages du serveur : un par coffre (semaine N, final), fin du programme ; entrée incomplète ignorée', () {
    final m = PeniMilestones.fromJson({
      'chests': [
        {'kind': 'week', 'week': 2, 'state': 'open', 'title': 'Semaine 2 tenue !', 'text': 'Bravo !', 'pose': 'cheer'},
        {'kind': 'final', 'week': null, 'state': 'upcoming', 'title': 'Coffre final', 'text': 'Bientôt', 'pose': 'think'},
        {'kind': 'week', 'week': 3, 'title': 'Incomplet'},
      ],
      'completion': null,
    });
    expect(m.chests.keys, ['week:2', 'final']);
    expect(m.chests['week:2']?.peniPose?.name, 'cheer');
    expect(m.completion, isNull);
  });

  testWidgets('coffre : texte du catalogue commun de Peni (serveur) affiché', (tester) async {
    await _open(tester, peni: const PeniMilestone(title: 'Semaine 2 tenue !', text: 'Texte du serveur', pose: 'cheer'));
    expect(find.text('Texte du serveur'), findsOneWidget);
  });

  testWidgets('coffre sans message du serveur : texte de l’app', (tester) async {
    await _open(tester);
    expect(find.text('Bravo, tu as fait 8 tâches sur 10 cette semaine. Je suis tellement fière de toi !'), findsOneWidget);
  });
}
