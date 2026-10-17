import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/projects/presentation/project_map_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _chest({Map<String, dynamic>? peni}) => {
      'kind': 'week',
      'week': 2,
      'day': '2026-10-14',
      'due': 10,
      'done': 8,
      'state': 'open',
      if (peni != null) 'peni': peni,
    };

Future<void> _open(WidgetTester tester, ProjectChest chest) async {
  await tester.pumpWidget(MaterialApp(
    theme: BimTheme.light(),
    home: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () => showChest(context, chest), child: const Text('ouvrir')))),
  ),);
  await tester.tap(find.text('ouvrir'));
  await tester.pumpAndSettle();
}

void main() {
  test('message de Peni du serveur lu ; absent ou incomplet : null', () {
    final c = ProjectChest.fromJson(_chest(peni: {'key': 'chest_week_open', 'title': 'Semaine 2 tenue !', 'text': 'Bravo !', 'pose': 'cheer'}));
    expect(c.peni?.title, 'Semaine 2 tenue !');
    expect(c.peni?.pose, 'cheer');
    expect(ProjectChest.fromJson(_chest()).peni, isNull);
    expect(ProjectChest.fromJson(_chest(peni: {'title': 'x'})).peni, isNull);
  });

  testWidgets('coffre : texte du catalogue commun de Peni (serveur) affiché', (tester) async {
    await _open(tester, ProjectChest.fromJson(_chest(peni: {'title': 'Semaine 2 tenue !', 'text': 'Texte du serveur', 'pose': 'cheer'})));
    expect(find.text('Texte du serveur'), findsOneWidget);
  });

  testWidgets('coffre sans message du serveur (ancienne API) : texte de l’app', (tester) async {
    await _open(tester, ProjectChest.fromJson(_chest()));
    expect(find.text('Bravo, tu as fait 8 tâches sur 10 cette semaine. Je suis tellement fière de toi !'), findsOneWidget);
  });
}
