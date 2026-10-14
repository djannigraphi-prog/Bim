// Test de bout en bout sur Android : l'application réelle, lancée sur un émulateur, parle à l'API réelle
// (base PostgreSQL neuve, migrations réelles). Exécuté par la CI (job « android-e2e »).
//
// Parcours : bienvenue → inscription (2 étapes) → code reçu → accueil → déconnexion
//            → connexion avec un mauvais mot de passe (refusée) → connexion correcte → accueil.
// Le code est lu par un relais de la CI dans les journaux de l'API de développement, comme une personne lirait son SMS.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:bim/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const _codeRelay = String.fromEnvironment('BIM_TEST_CODE_URL');

Future<void> _waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('Délai dépassé en attendant : $finder');
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await _waitFor(tester, finder);
  await tester.ensureVisible(finder.first);
  await tester.pump(const Duration(milliseconds: 300));
  await tester.tap(finder.first);
  await tester.pump(const Duration(milliseconds: 300));
}

Future<void> _type(WidgetTester tester, String hint, String text) async {
  final field = find.widgetWithText(TextField, hint);
  await _waitFor(tester, field);
  await tester.ensureVisible(field.first);
  await tester.enterText(field.first, text);
  await tester.pump(const Duration(milliseconds: 200));
}

/// Le champ mot de passe (masqué) : son indication disparaît dès qu'il contient du texte.
Future<void> _typePassword(WidgetTester tester, String text) async {
  final field = find.byWidgetPredicate((w) => w is TextField && w.obscureText);
  await _waitFor(tester, field);
  await tester.ensureVisible(field.first);
  await tester.enterText(field.first, text);
  await tester.pump(const Duration(milliseconds: 200));
}

Future<String> _codeFor(String digits) async {
  final client = HttpClient();
  try {
    for (var i = 0; i < 40; i++) {
      final req = await client.getUrl(Uri.parse('$_codeRelay/code?digits=$digits'));
      final res = await req.close();
      final body = await res.transform(utf8.decoder).join();
      if (res.statusCode == 200 && body.length == 6) return body;
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
  } finally {
    client.close();
  }
  fail("Aucun code reçu pour le numéro se terminant par $digits.");
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('inscription, code, connexion et déconnexion contre l’API réelle', (tester) async {
    expect(_codeRelay, isNotEmpty, reason: 'BIM_TEST_CODE_URL doit être fourni par la CI.');
    final rnd = Random();
    final digits = List.generate(8, (_) => rnd.nextInt(10)).join();
    final username = 'e2e${DateTime.now().millisecondsSinceEpoch % 100000000}';
    const password = 'Soleil-Abidjan-2026';

    app.main();

    // Écran 02 → inscription, étape 1 (écran 04).
    await _tap(tester, find.text('Créer un compte'));
    await _type(tester, 'Ex. Awa Koné', 'Test Bout En Bout');
    await _type(tester, 'awa.kone', username);
    await _tap(tester, find.widgetWithText(TextField, 'JJ/MM/AAAA'));
    await _tap(tester, find.text('OK'));
    await _type(tester, 'Cocody', 'Cocody');
    await _type(tester, '+225 07 00 00 00 00', '+225 07$digits');
    await _typePassword(tester, password);
    await _tap(tester, find.text('Continuer'));

    // Étape 2 (écran 05) : centres d'intérêt servis par l'API.
    for (final label in ['Mode', 'Coiffure', 'Ongles']) {
      await _tap(tester, find.text(label));
    }
    await _tap(tester, find.text('Terminer l’inscription'));

    // Code reçu « par SMS » (journal de l'API de développement) ; 6 chiffres = validation automatique.
    await _waitFor(tester, find.text('Entre ton code'));
    final code = await _codeFor(digits);
    await tester.enterText(find.byType(TextField).first, code);

    // Accueil : la session est ouverte.
    await _waitFor(tester, find.byTooltip('Mon compte'));
    await _tap(tester, find.byTooltip('Mon compte'));
    await _waitFor(tester, find.text('@$username · compte utilisateur'));

    // Déconnexion → bienvenue.
    await _tap(tester, find.text('Se déconnecter'));
    await _waitFor(tester, find.text('Créer un compte'));

    // Connexion refusée avec un mauvais mot de passe.
    await _tap(tester, find.text('Se connecter'));
    await _waitFor(tester, find.text('Content de te revoir'));
    await _type(tester, 'E-mail, téléphone ou @nom d’utilisateur', username);
    await _typePassword(tester, 'Mauvais-mot-de-passe-1');
    await _tap(tester, find.widgetWithText(FilledButton, 'Se connecter'));
    // Le message du serveur s'affiche sous le champ et la session reste fermée.
    await _waitFor(tester, find.text('Identifiant ou mot de passe incorrect.'));
    expect(find.byTooltip('Mon compte'), findsNothing);

    // Connexion correcte.
    await _typePassword(tester, password);
    await _tap(tester, find.widgetWithText(FilledButton, 'Se connecter'));
    await _waitFor(tester, find.byTooltip('Mon compte'));
  });
}
