import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/notifications/data/notification_preferences_api.dart';
import 'package:bim/features/notifications/presentation/reminder_preferences_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

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

/// Faux serveur : reproduit les réponses de `/v1/me/notification-preferences` (API du lot 2) et garde chaque requête,
/// pour vérifier exactement ce que l'écran envoie. Aucune donnée n'est affichée dans l'app réelle.
class _FakeServer extends ApiClient {
  _FakeServer({this.available = false}) : super(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');

  final bool available;
  bool enabled = true;
  Map<String, String>? personal;
  static const platformDefault = {'start': '22:00', 'end': '06:00'};
  final requests = <String>[];
  final bodies = <Map<String, dynamic>>[];
  ApiException? failNextPatch;
  int failGets = 0;

  Map<String, dynamic> _json() => {
        'remindersEnabled': enabled,
        'quietHours': personal ?? platformDefault,
        'quietHoursSource': personal == null ? 'default' : 'personal',
        'remindersAvailable': available,
      };

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    requests.add('GET $path');
    if (failGets > 0) {
      failGets--;
      throw ApiException.network;
    }
    return _json();
  }

  @override
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    requests.add('PATCH $path');
    final b = Map<String, dynamic>.from(body! as Map);
    bodies.add(b);
    final failure = failNextPatch;
    if (failure != null) {
      failNextPatch = null;
      throw failure;
    }
    if (b.containsKey('remindersEnabled')) enabled = b['remindersEnabled'] as bool;
    if (b.containsKey('quietStart')) {
      personal = b['quietStart'] == null ? null : {'start': b['quietStart'] as String, 'end': b['quietEnd'] as String};
    }
    return _json();
  }
}

class _Picker {
  _Picker(this.answers);
  final List<TimeOfDay?> answers;
  final asked = <(String, TimeOfDay)>[];

  Future<TimeOfDay?> call(BuildContext context, {required TimeOfDay initial, required String title}) async {
    asked.add((title, initial));
    return answers.removeAt(0);
  }
}

/// Écran de téléphone courant (390 × 844) par défaut ; [physical] pour un petit téléphone.
Future<void> _open(WidgetTester tester, _FakeServer server, {_Picker? picker, Size physical = const Size(1170, 2532)}) async {
  tester.view.physicalSize = physical;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [notificationPreferencesApiProvider.overrideWithValue(NotificationPreferencesApi(server))],
      child: MaterialApp(
        theme: BimTheme.light(),
        home: picker == null ? const ReminderPreferencesScreen() : ReminderPreferencesScreen(pickTime: picker.call),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// Laisse le message temporaire (SnackBar) disparaître : aucun minuteur ne doit rester en attente.
Future<void> _finish(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pump(const Duration(seconds: 1));
}

SwitchListTile _switch(WidgetTester tester) => tester.widget<SwitchListTile>(find.byKey(const ValueKey('reminders-switch')));

void main() {
  group('modèle', () {
    test('lit la réponse de l’API ; service considéré fermé si l’information manque', () {
      final p = NotificationPreferences.fromJson({
        'remindersEnabled': false,
        'quietHours': {'start': '21:00', 'end': '07:30'},
        'quietHoursSource': 'personal',
        'remindersAvailable': true,
      });
      expect(p.remindersEnabled, isFalse);
      expect(p.quietHours, const QuietHours(start: '21:00', end: '07:30'));
      expect(p.quietHoursArePersonal, isTrue);
      expect(p.remindersAvailable, isTrue);

      final missing = NotificationPreferences.fromJson({'remindersEnabled': true, 'quietHours': null, 'quietHoursSource': 'default'});
      expect(missing.remindersAvailable, isFalse);
      expect(missing.quietHours, isNull);
      expect(missing.quietHoursArePersonal, isFalse);
    });

    test('chaque changement n’envoie que ce qu’il modifie', () async {
      final server = _FakeServer();
      final api = NotificationPreferencesApi(server);
      await api.setRemindersEnabled(false);
      await api.setQuietHours(const QuietHours(start: '23:00', end: '05:00'));
      await api.setQuietHours(null);
      expect(server.bodies, [
        {'remindersEnabled': false},
        {'quietStart': '23:00', 'quietEnd': '05:00'},
        {'quietStart': null, 'quietEnd': null},
      ]);
      expect(server.requests.every((r) => r.endsWith('/v1/me/notification-preferences')), isTrue);
    });
  });

  group('écran des rappels', () {
    testWidgets('affiche les choix enregistrés et dit clairement que le service n’est pas ouvert', (tester) async {
      final server = _FakeServer();
      await _open(tester, server);
      expect(find.byKey(const ValueKey('reminders-unavailable')), findsOneWidget);
      expect(find.textContaining('aucune notification n’est envoyée'), findsOneWidget);
      expect(_switch(tester).value, isTrue);
      expect(find.text('Activés pour toi, dès l’ouverture du service.'), findsOneWidget);
      expect(find.text('De 22:00 à 06:00'), findsOneWidget);
      expect(find.text('Valeur par défaut de BIM'), findsOneWidget);
      expect(find.byKey(const ValueKey('quiet-hours-reset')), findsNothing);
      // Ouvrir l'écran ne modifie rien.
      expect(server.requests, ['GET /v1/me/notification-preferences']);
    });

    testWidgets('couper les rappels n’envoie que ce choix et n’ouvre pas le service', (tester) async {
      final server = _FakeServer();
      await _open(tester, server);
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      await tester.pump();
      await tester.pump();
      expect(server.bodies, [
        {'remindersEnabled': false},
      ]);
      expect(_switch(tester).value, isFalse);
      expect(find.text('Coupés : Peni ne t’enverra aucun rappel.'), findsOneWidget);
      expect(find.text('Choix enregistré.'), findsOneWidget);
      expect(find.byKey(const ValueKey('reminders-unavailable')), findsOneWidget);
      // Le réactiver renvoie seulement ce choix.
      await _finish(tester);
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      await tester.pump();
      await tester.pump();
      expect(server.bodies.last, {'remindersEnabled': true});
      expect(_switch(tester).value, isTrue);
      expect(server.requests.where((r) => !r.endsWith('/v1/me/notification-preferences')), isEmpty);
      await _finish(tester);
    });

    testWidgets('heures calmes : choisir les siennes puis revenir à la valeur par défaut', (tester) async {
      final server = _FakeServer();
      final picker = _Picker([const TimeOfDay(hour: 21, minute: 30), const TimeOfDay(hour: 7, minute: 0)]);
      await _open(tester, server, picker: picker);
      await tester.tap(find.byKey(const ValueKey('quiet-hours-edit')));
      await tester.pump();
      await tester.pump();
      expect(picker.asked, [
        ('Début des heures calmes', const TimeOfDay(hour: 22, minute: 0)),
        ('Fin des heures calmes', const TimeOfDay(hour: 6, minute: 0)),
      ]);
      expect(server.bodies, [
        {'quietStart': '21:30', 'quietEnd': '07:00'},
      ]);
      expect(find.text('De 21:30 à 07:00'), findsOneWidget);
      expect(find.text('Tes heures'), findsOneWidget);
      await _finish(tester);

      await tester.tap(find.byKey(const ValueKey('quiet-hours-reset')));
      await tester.pump();
      await tester.pump();
      expect(server.bodies.last, {'quietStart': null, 'quietEnd': null});
      expect(find.text('De 22:00 à 06:00'), findsOneWidget);
      expect(find.text('Valeur par défaut de BIM'), findsOneWidget);
      expect(_switch(tester).value, isTrue); // les rappels ne sont pas touchés
      await _finish(tester);
    });

    testWidgets('heures calmes : choix annulé ou début égal à la fin, rien n’est envoyé', (tester) async {
      final server = _FakeServer();
      final picker = _Picker([null, const TimeOfDay(hour: 8, minute: 0), const TimeOfDay(hour: 8, minute: 0)]);
      await _open(tester, server, picker: picker);
      await tester.tap(find.byKey(const ValueKey('quiet-hours-edit')));
      await tester.pump();
      expect(server.bodies, isEmpty);
      await tester.tap(find.byKey(const ValueKey('quiet-hours-edit')));
      await tester.pump();
      await tester.pump();
      expect(server.bodies, isEmpty);
      expect(find.text('Le début et la fin des heures calmes doivent être différents.'), findsOneWidget);
      expect(find.text('De 22:00 à 06:00'), findsOneWidget);
      await _finish(tester);
    });

    testWidgets('refus du serveur : message affiché, l’écran garde la valeur enregistrée', (tester) async {
      final server = _FakeServer()..failNextPatch = const ApiException(code: 'VALIDATION_FAILED', message: 'Vérifie les informations saisies.', status: 400);
      await _open(tester, server);
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      await tester.pump();
      await tester.pump();
      expect(find.text('Vérifie les informations saisies.'), findsOneWidget);
      expect(_switch(tester).value, isTrue);
      expect(server.enabled, isTrue);
      await _finish(tester);
    });

    testWidgets('pas de connexion au chargement : message et nouvel essai', (tester) async {
      final server = _FakeServer()..failGets = 1;
      await _open(tester, server);
      expect(find.text(ApiException.network.message), findsOneWidget);
      expect(find.byKey(const ValueKey('reminders-switch')), findsNothing);
      await tester.tap(find.text('Réessayer'));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const ValueKey('reminders-switch')), findsOneWidget);
      expect(server.requests, ['GET /v1/me/notification-preferences', 'GET /v1/me/notification-preferences']);
    });

    testWidgets('service ouvert : pas d’avertissement', (tester) async {
      await _open(tester, _FakeServer(available: true));
      expect(find.byKey(const ValueKey('reminders-unavailable')), findsNothing);
      expect(find.text('Activés pour toi.'), findsOneWidget);
    });

    testWidgets('petit téléphone (320 dp) : aucun débordement', (tester) async {
      final server = _FakeServer()..personal = {'start': '21:30', 'end': '07:00'};
      await _open(tester, server, physical: const Size(960, 1704));
      expect(tester.takeException(), isNull);
      // Le bas de l'écran est atteint en faisant défiler, sans débordement.
      await tester.scrollUntilVisible(find.byKey(const ValueKey('quiet-hours-reset')), 100);
      expect(find.byKey(const ValueKey('quiet-hours-reset')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
