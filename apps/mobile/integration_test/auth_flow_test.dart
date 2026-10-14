// Test de bout en bout sur Android : l'application réelle, lancée sur un émulateur, parle à l'API réelle
// (base PostgreSQL neuve, migrations réelles). Exécuté par la CI (job « android-e2e »).
//
// Parcours : bienvenue → inscription (2 étapes) → code reçu → accueil → déconnexion
//            → connexion avec un mauvais mot de passe (refusée) → connexion correcte → accueil
//            → nouveau projet (5 étapes) → programme → journée → séance cochée
//            → ajout d'un e-mail vérifié (opération protégée) → appareils → nouveau mot de passe → connexion par e-mail.
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
  // Un message temporaire (SnackBar) peut recouvrir le bouton, comme pour une vraie personne : on attend qu'il disparaisse.
  for (var i = 0; i < 40 && find.byType(SnackBar).evaluate().isNotEmpty; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
  await _waitFor(tester, finder);
  await tester.ensureVisible(finder.first);
  await tester.pump(const Duration(milliseconds: 300));
  await tester.tap(finder.first);
  await tester.pump(const Duration(milliseconds: 300));
}

/// Fait défiler l'écran jusqu'à l'élément (les listes ne construisent que la partie visible), puis le touche.
Future<void> _scrollTap(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 150, scrollable: find.byType(Scrollable).first);
  await _tap(tester, finder);
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

/// Dernier code envoyé à un numéro (8 derniers chiffres) ou à une adresse e-mail ; [previous] = code déjà utilisé.
Future<String> _codeFor(String digits, {String? email, String? previous}) async {
  final client = HttpClient();
  final query = email != null ? 'to=${Uri.encodeQueryComponent(email)}' : 'digits=$digits';
  try {
    for (var i = 0; i < 40; i++) {
      final req = await client.getUrl(Uri.parse('$_codeRelay/code?$query'));
      final res = await req.close();
      final body = await res.transform(utf8.decoder).join();
      if (res.statusCode == 200 && body.length == 6 && body != previous) return body;
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
    var lastPhoneCode = code;
    await tester.enterText(find.byType(TextField).first, code);

    // Accueil : la session est ouverte.
    await _waitFor(tester, find.byTooltip('Mon compte'));
    await _tap(tester, find.byTooltip('Mon compte'));
    await _waitFor(tester, find.text('@$username · compte utilisateur'));

    // Déconnexion → bienvenue.
    await _scrollTap(tester, find.text('Se déconnecter'));
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

    // Lot 1 : créer un projet (écrans 19 à 24), ouvrir la journée (27) et cocher la séance.
    await _waitFor(tester, find.text('Ton premier projet t’attend'));
    await _tap(tester, find.widgetWithText(FilledButton, 'Nouveau projet'));
    await _tap(tester, find.text('Mode Éco'));
    await _tap(tester, find.widgetWithText(FilledButton, 'Continuer'));
    await _tap(tester, find.text('Sport'));
    await _tap(tester, find.widgetWithText(FilledButton, 'Continuer'));
    await _tap(tester, find.text('Abdos'));
    await _tap(tester, find.widgetWithText(FilledButton, 'Continuer'));
    await _tap(tester, find.text('Passer cette étape'));
    await _scrollTap(tester, find.text('7'));
    await _tap(tester, find.text('Créer mon programme'));
    await _waitFor(tester, find.textContaining('Renforcer mes abdos', findRichText: true));
    await _tap(tester, find.text('Lancer mon programme'));
    await _tap(tester, find.text('Voir l’étape du jour'));
    await _tap(tester, find.text('Séance · Abdos'));
    await _waitFor(tester, find.text('Tout est fait pour aujourd’hui. Bravo, je suis fière de toi !'));

    // Lot 0, partie 2 : ajouter un e-mail (opération protégée : mot de passe + code SMS, puis code reçu par e-mail).
    await _tap(tester, find.byTooltip('Retour'));
    await _tap(tester, find.byTooltip('Retour'));
    await _tap(tester, find.byTooltip('Mon compte'));
    await _scrollTap(tester, find.text('Téléphone et e-mail'));
    await _tap(tester, find.text('Ajouter une coordonnée'));
    await _tap(tester, find.text('E-mail'));
    final email = '$username@exemple.com';
    await tester.enterText(find.byKey(const Key('new-contact-value')), email);
    await _tap(tester, find.widgetWithText(FilledButton, 'Continuer'));
    await tester.enterText(find.byKey(const Key('stepup-password')), password);
    await _tap(tester, find.text('Recevoir un code'));
    await _waitFor(tester, find.byKey(const Key('code-field')));
    lastPhoneCode = await _codeFor(digits, previous: lastPhoneCode);
    await tester.enterText(find.byKey(const Key('code-field')).last, lastPhoneCode);
    await _waitFor(tester, find.text('Vérifie cette adresse'));
    // Laisse la feuille précédente se fermer (sinon deux champs « code » coexistent un instant).
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(find.byKey(const Key('code-field')).last, await _codeFor('', email: email));
    await _waitFor(tester, find.text(email));
    expect(find.text('Non vérifié'), findsNothing);

    // Appareils connectés : la session en cours est reconnue.
    await _tap(tester, find.byTooltip('Retour'));
    await _scrollTap(tester, find.text('Appareils connectés'));
    await _waitFor(tester, find.textContaining('cet appareil'));
    await _tap(tester, find.byTooltip('Retour'));

    // Changer de mot de passe (opération protégée), puis se reconnecter avec le nouveau.
    const newPassword = 'Lagune-Ebrie-2027';
    await _scrollTap(tester, find.text('Mot de passe'));
    await tester.enterText(find.byKey(const Key('new-password')), newPassword);
    await tester.enterText(find.byKey(const Key('new-password-2')), newPassword);
    // Le clavier réduit l'écran : on fait défiler jusqu'au bouton lui-même avant de le toucher.
    await _scrollTap(tester, find.widgetWithText(FilledButton, 'Changer le mot de passe'));
    await tester.enterText(find.byKey(const Key('stepup-password')), password);
    await _tap(tester, find.text('Recevoir un code'));
    await _waitFor(tester, find.byKey(const Key('code-field')));
    lastPhoneCode = await _codeFor(digits, previous: lastPhoneCode);
    await tester.enterText(find.byKey(const Key('code-field')).last, lastPhoneCode);
    await _waitFor(tester, find.text('Paramètres'));
    await _scrollTap(tester, find.text('Se déconnecter'));
    await _tap(tester, find.text('Se connecter'));
    await _type(tester, 'E-mail, téléphone ou @nom d’utilisateur', email);
    await _typePassword(tester, newPassword);
    await _tap(tester, find.widgetWithText(FilledButton, 'Se connecter'));
    await _waitFor(tester, find.byTooltip('Mon compte'));
  });
}
