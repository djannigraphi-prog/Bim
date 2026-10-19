import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/core/theme/tokens.dart';
import 'package:bim/core/widgets/bim_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('couleurs de marque du questionnaire (Q3)', () {
    expect(BimColors.red, const Color(0xFFF20D3A));
    expect(BimColors.black, const Color(0xFF101116));
    expect(BimTheme.light().colorScheme.primary, BimColors.red);
    // Mode nuit : gris foncé mat, plus de noir complet (décision du fondateur, 19/10/2026).
    expect(BimTheme.dark().scaffoldBackgroundColor, BimColors.night);
  });

  testWidgets('un bouton en chargement est désactivé (pas de double envoi)', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: BimTheme.light(),
        home: Scaffold(body: BimButton(label: 'Continuer', loading: true, onPressed: () => taps++)),
      ),
    );
    await tester.tap(find.byType(FilledButton));
    expect(taps, 0);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
