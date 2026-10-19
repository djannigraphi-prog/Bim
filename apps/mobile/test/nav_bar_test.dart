import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/shell/presentation/bim_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _items = <BimNavItem>[
  (icon: Icons.home_outlined, active: Icons.home_rounded, label: 'Accueil'),
  (icon: Icons.chat_bubble_outline_rounded, active: Icons.chat_bubble_rounded, label: 'Messages'),
  (icon: Icons.add_rounded, active: Icons.add_rounded, label: 'Nouveau projet'),
  (icon: Icons.sensors_rounded, active: Icons.sensors_rounded, label: 'Live'),
  (icon: Icons.shopping_bag_outlined, active: Icons.shopping_bag_rounded, label: 'BimShop'),
];

Future<List<int>> _pump(WidgetTester tester, ThemeData theme, {int current = 0, Map<int, int> badges = const {}}) async {
  final taps = <int>[];
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: Scaffold(
        extendBody: true,
        body: const SizedBox.expand(),
        bottomNavigationBar: BimNavBar(items: _items, current: current, onTap: taps.add, badges: badges),
      ),
    ),
  );
  return taps;
}

void main() {
  testWidgets('barre du bas fine : icônes sans texte, nom lu par le lecteur d’écran, onglet actif, « + », pastille', (tester) async {
    final semantics = tester.ensureSemantics();
    final taps = await _pump(tester, BimTheme.light(), badges: {1: 3});
    // Pas de texte sous les icônes ; chaque onglet garde son nom (lecteur d'écran, info-bulle).
    expect(find.text('Accueil'), findsNothing);
    expect(find.bySemanticsLabel('Messages'), findsOneWidget);
    expect(find.byTooltip('BimShop'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    // Barre fine : 58 px de haut.
    expect(tester.getSize(find.byKey(const ValueKey('bim-nav'))).height, 58);
    // Onglet actif : icône pleine.
    expect(find.byIcon(Icons.home_rounded), findsOneWidget);
    expect(find.byIcon(Icons.chat_bubble_outline_rounded), findsOneWidget);
    for (final i in [1, 2, 4]) {
      await tester.tap(find.byKey(ValueKey('nav-$i')));
    }
    expect(taps, [1, 2, 4]);
    semantics.dispose();
  });

  testWidgets('mode nuit : fond gris mat (pas noir), barre transparente effet vitre', (tester) async {
    await _pump(tester, BimTheme.dark(), current: 4);
    expect(BimTheme.dark().scaffoldBackgroundColor, const Color(0xFF1C1C1E));
    expect(find.byType(BackdropFilter), findsOneWidget);
    final box = tester.widget<Container>(find.byKey(const ValueKey('bim-nav'))).decoration! as BoxDecoration;
    expect(box.color!.a, lessThan(0.7));
    expect(find.byIcon(Icons.shopping_bag_rounded), findsOneWidget);
  });
}
