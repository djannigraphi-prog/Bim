import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/notifications/application/local_notifier.dart';
import 'package:bim/features/notifications/data/notification_preferences_api.dart';
import 'package:bim/features/notifications/data/reminders_api.dart';
import 'package:bim/features/notifications/presentation/reminder_preferences_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_notifier.dart';

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
  /// Rappels désactivés par défaut (décision du 15/10/2026), comme l'API.
  bool enabled = false;
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
Future<void> _open(
  WidgetTester tester,
  _FakeServer server, {
  _Picker? picker,
  Size physical = const Size(1170, 2532),
  List<Override> overrides = const [],
}) async {
  tester.view.physicalSize = physical;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [notificationPreferencesApiProvider.overrideWithValue(NotificationPreferencesApi(server)), ...overrides],
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

/// Fait défiler jusqu'à l'élément puis le touche (en test, les textes prennent plus de place : le bas peut être caché).
Future<void> _tapKey(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  // Élément pas encore construit (bas d'une longue liste) : on fait défiler jusqu'à lui.
  if (find.byKey(ValueKey(key), skipOffstage: false).evaluate().isEmpty) await tester.scrollUntilVisible(finder, 200);
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pump();
  await tester.pump();
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
      // Désactivés par défaut : rien n'est activé sans le choix de la personne.
      expect(_switch(tester).value, isFalse);
      expect(find.text('Désactivés : active-les pour que Peni te rappelle tes tâches.'), findsOneWidget);
      expect(find.text('De 22:00 à 06:00'), findsOneWidget);
      expect(find.text('Valeur par défaut de BIM'), findsOneWidget);
      expect(find.byKey(const ValueKey('quiet-hours-reset')), findsNothing);
      // Ouvrir l'écran ne modifie rien.
      expect(server.requests, ['GET /v1/me/notification-preferences']);
    });

    testWidgets('activer ses rappels n’envoie que ce choix et n’ouvre pas le service', (tester) async {
      final server = _FakeServer();
      await _open(tester, server);
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      await tester.pump();
      await tester.pump();
      expect(server.bodies, [
        {'remindersEnabled': true},
      ]);
      expect(_switch(tester).value, isTrue);
      expect(find.text('Activés pour toi, dès l’ouverture du service.'), findsOneWidget);
      expect(find.text('Choix enregistré.'), findsOneWidget);
      expect(find.byKey(const ValueKey('reminders-unavailable')), findsOneWidget);
      // Les désactiver renvoie seulement ce choix.
      await _finish(tester);
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      await tester.pump();
      await tester.pump();
      expect(server.bodies.last, {'remindersEnabled': false});
      expect(_switch(tester).value, isFalse);
      expect(find.text('Désactivés : active-les pour que Peni te rappelle tes tâches.'), findsOneWidget);
      expect(server.requests.where((r) => !r.endsWith('/v1/me/notification-preferences')), isEmpty);
      await _finish(tester);
    });

    testWidgets('heures calmes : choisir les siennes puis revenir à la valeur par défaut', (tester) async {
      final server = _FakeServer();
      final picker = _Picker([const TimeOfDay(hour: 21, minute: 30), const TimeOfDay(hour: 7, minute: 0)]);
      await _open(tester, server, picker: picker);
      await _tapKey(tester, 'quiet-hours-edit');
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

      await _tapKey(tester, 'quiet-hours-reset');
      expect(server.bodies.last, {'quietStart': null, 'quietEnd': null});
      expect(find.text('De 22:00 à 06:00'), findsOneWidget);
      expect(find.text('Valeur par défaut de BIM'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('reminders-switch')));
      await tester.pump();
      expect(_switch(tester).value, isFalse); // les rappels ne sont pas touchés (toujours désactivés)
      await _finish(tester);
    });

    testWidgets('heures calmes : choix annulé ou début égal à la fin, rien n’est envoyé', (tester) async {
      final server = _FakeServer();
      final picker = _Picker([null, const TimeOfDay(hour: 8, minute: 0), const TimeOfDay(hour: 8, minute: 0)]);
      await _open(tester, server, picker: picker);
      await _tapKey(tester, 'quiet-hours-edit');
      expect(picker.asked, hasLength(1)); // choix annulé dès le début : pas de second choix
      expect(server.bodies, isEmpty);
      await _tapKey(tester, 'quiet-hours-edit');
      expect(picker.asked, hasLength(3));
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
      expect(_switch(tester).value, isFalse);
      expect(server.enabled, isFalse);
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
      await _open(tester, _FakeServer(available: true)..enabled = true);
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

  group('autorisation du téléphone et programmation', () {
    /// Personne connectée, téléphone simulé, API des rappels à venir simulée (un rappel demain).
    List<Override> phone(FakeNotifier notifier, _FakeServer server) => [
          sessionProvider.overrideWith(_SignedIn.new),
          localNotifierProvider.overrideWithValue(notifier),
          remindersApiProvider.overrideWithValue(_FakeRemindersApi(server)),
        ];

    testWidgets('activer : choix enregistré, puis autorisation du téléphone demandée une fois, puis rappels programmés', (tester) async {
      final server = _FakeServer(available: true);
      final notifier = FakeNotifier(allowed: false, grantOnRequest: true);
      await _open(tester, server, overrides: phone(notifier, server));
      // Rappels désactivés : aucune demande d'autorisation, rien n'est programmé.
      expect(find.byKey(const ValueKey('system-permission')), findsNothing);
      expect(notifier.permissionRequests, 0);

      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      for (var i = 0; i < 6; i++) {
        await tester.pump();
      }
      expect(server.bodies, [
        {'remindersEnabled': true},
      ]);
      expect(notifier.permissionRequests, 1);
      expect(notifier.scheduled, hasLength(1));
      expect(find.text('Autorisées pour BIM.'), findsOneWidget);
      expect(find.text('1 rappel programmé sur ce téléphone pour les prochaines 48 h.'), findsOneWidget);
      await _finish(tester);

      // Désactiver : tout est annulé sur le téléphone.
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      for (var i = 0; i < 6; i++) {
        await tester.pump();
      }
      expect(server.bodies.last, {'remindersEnabled': false});
      expect(notifier.scheduled, isEmpty);
      await _finish(tester);
    });

    testWidgets('rappel d’essai (versions de test) : autorisation demandée, vraie notification programmée, service inchangé', (tester) async {
      final server = _FakeServer();
      final notifier = FakeNotifier(allowed: false, grantOnRequest: true);
      await _open(tester, server, overrides: phone(notifier, server));
      final before = DateTime.now();
      await _tapKey(tester, 'test-reminder-1');
      await tester.pump();
      expect(notifier.permissionRequests, 1);
      final test = notifier.test!;
      expect(test.id, testReminderId);
      expect(test.body, contains('Rappel d’essai'));
      expect(test.fireAt.difference(before).inSeconds, inInclusiveRange(55, 65));
      expect(find.byKey(const ValueKey('test-reminder-at')), findsOneWidget);
      // Ni préférence ni service touchés : rien n'est envoyé à l'API.
      expect(server.bodies, isEmpty);
      expect(server.enabled, isFalse);
      await _finish(tester);
    });

    testWidgets('autorisation refusée : le choix BIM reste enregistré, l’écran le dit et propose d’autoriser', (tester) async {
      final server = _FakeServer(available: true);
      final notifier = FakeNotifier(allowed: false);
      await _open(tester, server, overrides: phone(notifier, server));
      await tester.tap(find.byKey(const ValueKey('reminders-switch')));
      for (var i = 0; i < 6; i++) {
        await tester.pump();
      }
      expect(server.enabled, isTrue); // préférence distincte de l'autorisation système
      expect(notifier.permissionRequests, 1);
      expect(notifier.scheduled, isEmpty);
      expect(find.text('Non autorisées : ton téléphone n’affichera pas les rappels.'), findsOneWidget);
      expect(find.byKey(const ValueKey('system-permission-request')), findsOneWidget);
      await _finish(tester);
    });
  });
}

class _SignedIn extends SessionController {
  @override
  SessionState build() => SessionSignedIn(
        Me.fromJson(const {'id': 'u1', 'fullName': 'Awa Koné', 'username': 'awa.kone', 'city': 'Cocody', 'contacts': <dynamic>[]}),
      );
}

/// Rappels à venir renvoyés par l'API simulée : un rappel demain si la personne a activé ses rappels.
class _FakeRemindersApi extends RemindersApi {
  _FakeRemindersApi(this.server) : super(server);
  final _FakeServer server;

  @override
  Future<UpcomingReminders> upcoming() async => UpcomingReminders(
        available: server.available,
        enabled: server.enabled,
        channel: 'local',
        reminders: [
          if (server.available && server.enabled)
            UpcomingReminder(
              key: 'p1|t1|d|0',
              projectId: 'p1',
              taskId: 't1',
              day: '2026-10-16',
              attempt: 0,
              fireAt: DateTime.now().toUtc().add(const Duration(days: 1)),
              title: 'Peni',
              body: 'C’est l’heure : Séance. On y va ?',
            ),
        ],
      );
}
