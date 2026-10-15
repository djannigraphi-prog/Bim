// Test de bout en bout sur Android : l'application réelle, lancée sur un émulateur, parle à l'API réelle
// (base PostgreSQL neuve, migrations réelles). Exécuté par la CI (job « android-e2e »).
//
// Parcours : bienvenue → inscription (2 étapes) → code reçu → accueil → déconnexion
//            → connexion avec un mauvais mot de passe (refusée) → connexion correcte → accueil
//            → nouveau projet (5 étapes) → programme → journée → séance cochée
//            → préférences de rappel (enregistrées, service fermé)
//            → ajout d'un e-mail vérifié (opération protégée) → appareils → nouveau mot de passe → connexion par e-mail.
// Le code est lu par un relais de la CI dans les journaux de l'API de développement, comme une personne lirait son SMS.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'dart:ui' as ui;

import 'package:bim/features/projects/application/photo_source.dart';
import 'package:bim/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
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

/// Capture réelle de l'écran de l'émulateur (adb, via le relais de la CI) : rendu Android véritable.
/// [shade] : volet des notifications d'Android ouvert (notifications réellement affichées).
Future<void> _shot(WidgetTester tester, String name, {bool shade = false}) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
  final client = HttpClient();
  try {
    final res = await (await client.getUrl(Uri.parse('$_codeRelay/shot?name=$name${shade ? '&shade=1' : ''}'))).close();
    await res.drain<void>();
    if (res.statusCode != 200) fail('Capture « $name » impossible (${res.statusCode}).');
  } finally {
    client.close();
  }
}

/// Appel au relais de la CI (système Android ou base de test), pendant que l'app continue de tourner.
/// Renvoie la réponse ; échoue avec le message du relais (ce qu'il a vu) si l'opération n'a pas abouti.
Future<String> _relay(WidgetTester tester, String path) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
  try {
    final req = await client.getUrl(Uri.parse('$_codeRelay$path'));
    final pending = req.close().then((res) async => (res.statusCode, await res.transform(utf8.decoder).join()));
    // L'app continue d'afficher ses images pendant l'attente (le relais peut attendre plusieurs minutes).
    var done = false;
    late (int, String) result;
    unawaited(
      pending.then((r) {
        result = r;
        done = true;
      }),
    );
    while (!done) {
      await tester.pump(const Duration(milliseconds: 500));
    }
    if (result.$1 != 200) fail('Relais $path : ${result.$1} ${result.$2}');
    return result.$2;
  } finally {
    client.close();
  }
}

/// Attend que [count] images réseau soient réellement décodées et affichées (pas d'icône d'image cassée).
Future<void> _expectLoadedImages(WidgetTester tester, int count) async {
  final end = DateTime.now().add(const Duration(seconds: 30));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    final loaded = tester.widgetList<RawImage>(find.byType(RawImage)).where((r) => r.image != null).length;
    if (loaded >= count) {
      expect(find.byIcon(Icons.broken_image_outlined), findsNothing);
      return;
    }
  }
  final images = tester.widgetList<Image>(find.byType(Image)).map((i) => i.image.runtimeType).toList();
  final broken = find.byIcon(Icons.broken_image_outlined).evaluate().length;
  fail('Images non chargées (attendu : $count ; widgets Image : $images ; icônes d’image cassée : $broken).');
}

/// Source de photos du test : une image PNG dessinée par le test (le sélecteur du système n'est pas pilotable).
class _TestPhotoSource implements PhotoSource {
  // Une couleur différente à chaque image, avec un disque blanc : sur les captures réelles, on voit que chaque
  // image affichée est bien la bonne (et pas un fond vide).
  static const _colors = [ui.Color(0xFF1E88E5), ui.Color(0xFF43A047), ui.Color(0xFFF20D3A), ui.Color(0xFF8E24AA), ui.Color(0xFFFB8C00)];
  int _n = 0;

  @override
  Future<List<int>?> pick({required bool camera}) async {
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    canvas.drawRect(const ui.Rect.fromLTWH(0, 0, 600, 800), ui.Paint()..color = _colors[_n++ % _colors.length]);
    canvas.drawCircle(const ui.Offset(300, 400), 150, ui.Paint()..color = const ui.Color(0xFFFFFFFF));
    final image = await recorder.endRecording().toImage(600, 800);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data!.buffer.asUint8List();
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('inscription, code, connexion et déconnexion contre l’API réelle', (tester) async {
    expect(_codeRelay, isNotEmpty, reason: 'BIM_TEST_CODE_URL doit être fourni par la CI.');
    final rnd = Random();
    final digits = List.generate(8, (_) => rnd.nextInt(10)).join();
    final username = 'e2e${DateTime.now().millisecondsSinceEpoch % 100000000}';
    const password = 'Soleil-Abidjan-2026';

    app.runBim(overrides: [photoSourceProvider.overrideWithValue(_TestPhotoSource())]);

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
    // Écran 22 : photo « avant » (privée), envoyée après la création du projet.
    await _tap(tester, find.byTooltip('Choisir dans la galerie'));
    await _tap(tester, find.widgetWithText(FilledButton, 'Continuer'));
    await _scrollTap(tester, find.text('7'));
    await _tap(tester, find.text('Créer mon programme'));
    await _waitFor(tester, find.textContaining('Renforcer mes abdos', findRichText: true));
    await _tap(tester, find.text('Lancer mon programme'));
    // Écran 26 réel : le chemin des jours (coffre de la semaine 1 au jour 7).
    await _waitFor(tester, find.text('Voir l’étape du jour'));
    await _shot(tester, 'a26_carte');
    await _tap(tester, find.text('Voir l’étape du jour'));
    await _tap(tester, find.text('Séance · Abdos'));
    await _waitFor(tester, find.text('Tout est fait pour aujourd’hui. Bravo, je suis fière de toi !'));

    // Écran 27 : signaler un problème, transmis au support.
    await _tap(tester, find.text('Signaler'));
    await _tap(tester, find.text('Trop difficile pour moi'));
    // Image jointe (capture ou photo) : envoyée, ré-encodée et stockée en privé par l'API.
    await _tap(tester, find.text('Joindre une image ou une capture'));
    await _tap(tester, find.text('Choisir une image ou une capture d’écran'));
    await _waitFor(tester, find.text('Image jointe'));
    await _tap(tester, find.text('Envoyer'));
    await _waitFor(tester, find.textContaining('Merci, ton signalement est envoyé à l’équipe BIM.'));

    // Écran 31 : la photo « avant » est bien enregistrée et lisible ; ajout de la photo « après ».
    await _tap(tester, find.byTooltip('Retour'));
    await _tap(tester, find.byTooltip('Plus d’options'));
    await _tap(tester, find.text('Mes photos avant / après'));
    await _waitFor(tester, find.textContaining('Avant · '));
    await _tap(tester, find.text('Ajouter la photo « après »'));
    await _tap(tester, find.text('Choisir dans la galerie'));
    await _waitFor(tester, find.textContaining('Après · '));
    await _waitFor(tester, find.text('Waouh, la différence ! Tu veux partager ton BIM pour motiver les autres ?'));
    // Les deux photos sont réellement téléchargées par leur lien temporaire et affichées.
    await _expectLoadedImages(tester, 2);
    await _shot(tester, 'a31_avant_apres');
    await _tap(tester, find.text('Garder pour moi'));
    await _tap(tester, find.byTooltip('Plus d’options'));
    await _tap(tester, find.text('Mes signalements'));
    await _waitFor(tester, find.text('En cours de traitement'));
    await _expectLoadedImages(tester, 1);
    await _shot(tester, 'a27_mes_signalements_projet');
    // Écran 30 (bilan) ouvert directement pour vérifier l'affichage réel des émojis sur Android.
    final router = GoRouter.of(tester.element(find.text('Mes signalements').first));
    final projectId = router.routerDelegate.currentConfiguration.uri.pathSegments[1];
    final opened = router.push<void>('/projects/$projectId/done');
    await _waitFor(tester, find.text('Ton bilan'));
    expect(find.textContaining('🏆'), findsOneWidget);
    await _shot(tester, 'a30_bilan_emoji');
    router.pop();
    await opened;
    await _waitFor(tester, find.text('En cours de traitement'));
    await _tap(tester, find.byTooltip('Retour'));

    // Lot 0, partie 2 : ajouter un e-mail (opération protégée : mot de passe + code SMS, puis code reçu par e-mail).
    await _tap(tester, find.byTooltip('Retour'));
    await _tap(tester, find.byTooltip('Mon compte'));

    // « Résoudre un problème » (C8) : problème général, description et capture jointe, puis suivi du statut.
    await _scrollTap(tester, find.text('Résoudre un problème'));
    await _tap(tester, find.text('Difficulté avec l’application'));
    await tester.enterText(find.byKey(const Key('report-message')), 'Test automatique : le bouton Continuer ne réagit pas.');
    await _tap(tester, find.text('Joindre une image ou une capture'));
    await _tap(tester, find.text('Choisir une image ou une capture d’écran'));
    await _waitFor(tester, find.text('Image jointe'));
    await _tap(tester, find.text('Envoyer'));
    await _waitFor(tester, find.textContaining('Merci, ton signalement est envoyé à l’équipe BIM.'));
    await _scrollTap(tester, find.text('Mes signalements'));
    await _waitFor(tester, find.textContaining('Problème général'));
    await _expectLoadedImages(tester, 2);
    await _shot(tester, 'a21_mes_signalements');
    await _tap(tester, find.byTooltip('Retour'));

    // Lot 2 : préférences de rappel enregistrées par l'API réelle. Le service des rappels reste fermé
    // (réglage « en attente ») : l'écran le dit, et activer ses rappels n'ouvre rien.
    // Le support répond aux deux signalements envoyés plus haut (base de test de la CI) : ils apparaîtront dans le
    // centre de notifications (écran 17), lu dans les vraies données.
    expect(await _relay(tester, '/resolve-reports'), '2');
    await _scrollTap(tester, find.text('Rappels'));
    await _waitFor(tester, find.byKey(const ValueKey('reminders-unavailable')));
    // Rappels désactivés par défaut (décision du 15/10/2026) : la personne les active elle-même.
    expect(tester.widget<SwitchListTile>(find.byKey(const ValueKey('reminders-switch'))).value, isFalse);
    await _tap(tester, find.byKey(const ValueKey('reminders-switch')));
    // Autorisation du téléphone, distincte du choix BIM : la vraie fenêtre d'Android est acceptée.
    await _relay(tester, '/ui-tap?text=Allow&wait=30');
    await _waitFor(tester, find.text('Autorisées pour BIM.'));
    await _waitFor(tester, find.text('Activés pour toi, dès l’ouverture du service.'));
    await _shot(tester, 'a28_rappels');
    // Toucher l'interrupteur a fait défiler l'écran : on remonte exactement jusqu'au bouton « Retour »
    // (sans glisser au-delà du haut de la liste : cet étirement faisait tomber l'émulateur de la CI).
    await tester.ensureVisible(find.byTooltip('Retour', skipOffstage: false));
    await tester.pump(const Duration(milliseconds: 300));
    await _tap(tester, find.byTooltip('Retour'));

    // Notifications programmées classiques (maquette 28). Base de test de la CI uniquement : service des rappels
    // ouvert et deux tâches ajoutées dans quelques minutes, pour recevoir de vrais rappels sur l'émulateur.
    await _relay(tester, '/reminders-service?on=1');
    await _relay(tester, '/reminder-soon?count=2&minutes=2');
    // Rouvert, l'écran relit le serveur (choix bien enregistré) et programme les rappels sur le téléphone.
    await _scrollTap(tester, find.text('Rappels'));
    await _waitFor(tester, find.text('Activés pour toi.'));
    expect(find.byKey(const ValueKey('reminders-unavailable')), findsNothing);
    await _waitFor(tester, find.textContaining('programmés sur ce téléphone pour les prochaines 48 h'));
    // Android affiche les deux rappels à l'heure prévue (mode non exact : quelques minutes au plus).
    final shown = jsonDecode(await _relay(tester, '/notifications?min=2&wait=420')) as List<dynamic>;
    for (final n in shown.cast<Map<String, dynamic>>()) {
      expect(n['title'], 'Peni', reason: jsonEncode(shown));
      expect(n['text'] as String, contains('Rappel test'), reason: jsonEncode(shown));
      expect(n['actions'], ['J’y vais !', 'Plus tard'], reason: jsonEncode(shown));
    }
    await _shot(tester, 'a28_notifications', shade: true);
    // « Plus tard » : la notification se ferme, l'app ne change pas d'écran.
    await _relay(tester, '/ui-tap?text=Plus%20tard&shade=1');
    final left = jsonDecode(await _relay(tester, '/notifications?max=${shown.length - 1}&wait=20')) as List<dynamic>;
    expect(left, hasLength(shown.length - 1));
    // « J'y vais ! » : l'app s'ouvre sur la journée du projet, où figure la tâche du rappel.
    await _relay(tester, '/ui-tap?text=vais&shade=1');
    await _waitFor(tester, find.textContaining('Rappel test'));
    await _shot(tester, 'a28_jy_vais');
    await _tap(tester, find.byTooltip('Retour'));
    await _relay(tester, '/reminders-service?on=0');
    await _tap(tester, find.byTooltip('Retour'));

    // Centre de notifications (écran 17) : pastille de la cloche, réponses de l'équipe BIM, puis marquées vues.
    await _tap(tester, find.byTooltip('Retour'));
    await _waitFor(tester, find.descendant(of: find.byTooltip('Notifications'), matching: find.text('2')));
    await _tap(tester, find.byTooltip('Notifications'));
    await _waitFor(tester, find.textContaining('L’équipe BIM a répondu à ton signalement.', findRichText: true));
    expect(find.textContaining('L’équipe BIM a répondu à ton signalement.', findRichText: true), findsNWidgets(2));
    await _shot(tester, 'a17_notifications');
    await _tap(tester, find.byTooltip('Retour'));
    await _waitFor(tester, find.byTooltip('Mon compte'));
    final badge = find.descendant(of: find.byTooltip('Notifications'), matching: find.text('2'));
    for (var i = 0; i < 40 && badge.evaluate().isNotEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(badge, findsNothing);
    await _tap(tester, find.byTooltip('Mon compte'));

    // La section « Notifications » allonge les Paramètres : « Téléphone et e-mail » est maintenant au-dessus.
    await tester.scrollUntilVisible(find.text('Téléphone et e-mail'), -150, scrollable: find.byType(Scrollable).first);
    await _tap(tester, find.text('Téléphone et e-mail'));
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
    // Retour à l'écran du compte (son titre peut être sorti de l'écran après défilement : on attend un élément voisin).
    await _waitFor(tester, find.text('Appareils connectés'));
    await _scrollTap(tester, find.text('Se déconnecter'));
    await _tap(tester, find.text('Se connecter'));
    await _type(tester, 'E-mail, téléphone ou @nom d’utilisateur', email);
    await _typePassword(tester, newPassword);
    await _tap(tester, find.widgetWithText(FilledButton, 'Se connecter'));
    await _waitFor(tester, find.byTooltip('Mon compte'));
  });
}
