import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/tokens.dart';
import 'package:bim/features/notifications/application/local_notifier.dart';
import 'package:bim/features/notifications/application/push_token_source.dart';
import 'package:bim/features/notifications/application/reminder_scheduler.dart';
import 'package:bim/features/notifications/data/reminders_api.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
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

/// Réponse de l'API `GET /v1/me/reminders/upcoming` simulée ; garde les requêtes d'inscription d'appareil.
class _FakeClient extends ApiClient {
  _FakeClient(this.response) : super(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');
  Map<String, dynamic> response;
  final calls = <String>[];

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    calls.add('GET $path');
    return response;
  }

  @override
  Future<Map<String, dynamic>> put(String path, {Object? body}) async {
    calls.add('PUT $path $body');
    return {'registered': true};
  }

  @override
  Future<Map<String, dynamic>> delete(String path, {Map<String, String>? headers}) async {
    calls.add('DELETE $path');
    return {};
  }
}

Map<String, dynamic> _reminder(String key, DateTime fireAt, {int attempt = 0, String? pose}) => {
      'key': key,
      'projectId': 'p1',
      'taskId': 't1',
      'day': '2026-10-16',
      'attempt': attempt,
      'fireAt': fireAt.toUtc().toIso8601String(),
      'title': 'Peni',
      'body': 'C’est l’heure ! Séance 💪 Tu vas tout déchirer.',
      if (pose != null) 'pose': pose,
    };

void main() {
  final now = DateTime.utc(2026, 10, 15, 12);

  group('liste des rappels à venir', () {
    test('lecture de la réponse de l’API ; « push » ou service fermé : rien à programmer ici', () {
      final up = UpcomingReminders.fromJson({
        'available': true,
        'enabled': true,
        'channel': 'local',
        'reminders': [_reminder('p1|t1|2026-10-16|0', DateTime.utc(2026, 10, 16, 15))],
      });
      expect(up.scheduleLocally, isTrue);
      expect(up.reminders.single.fireAt, DateTime.utc(2026, 10, 16, 15));
      expect(up.reminders.single.attempt, 0);
      expect(UpcomingReminders.fromJson({'available': true, 'enabled': true, 'channel': 'push', 'reminders': <dynamic>[]}).scheduleLocally, isFalse);
      expect(UpcomingReminders.fromJson({'available': false, 'enabled': true, 'channel': 'local'}).scheduleLocally, isFalse);
      expect(UpcomingReminders.fromJson({'available': true, 'enabled': false, 'channel': 'local'}).scheduleLocally, isFalse);
    });

    test('identifiant de notification stable, positif et propre à chaque rappel', () {
      final a = reminderNotificationId('p1|t1|2026-10-16|0');
      expect(a, reminderNotificationId('p1|t1|2026-10-16|0'));
      expect(a, greaterThanOrEqualTo(0));
      expect(a, lessThanOrEqualTo(0x7fffffff));
      final ids = {for (var i = 0; i < 3; i++) for (var d = 10; d < 30; d++) reminderNotificationId('p1|t1|2026-10-$d|$i')};
      expect(ids, hasLength(60));
    });

    test('cible ouverte par « J’y vais ! » : journée du projet ; donnée illisible ignorée', () {
      const t = ReminderTarget(projectId: 'p1', day: '2026-10-16');
      expect(ReminderTarget.decode(t.encode())!.route, '/projects/p1/day/2026-10-16');
      expect(ReminderTarget.decode('pas du json'), isNull);
      expect(ReminderTarget.decode('{"projectId": 3}'), isNull);
      expect(ReminderTarget.decode(null), isNull);
    });
  });

  group('programmation sur le téléphone', () {
    test('rappels à venir programmés en mode non exact ; ceux déjà passés ignorés', () async {
      final client = _FakeClient({
        'available': true,
        'enabled': true,
        'channel': 'local',
        'reminders': [
          _reminder('p1|t1|2026-10-15|0', now.subtract(const Duration(minutes: 1))),
          _reminder('p1|t1|2026-10-16|0', DateTime.utc(2026, 10, 16, 15)),
          _reminder('p1|t1|2026-10-16|1', DateTime.utc(2026, 10, 16, 16), attempt: 1, pose: 'think'),
        ],
      });
      final notifier = FakeNotifier();
      final r = await ReminderScheduler(RemindersApi(client), notifier).sync(now: now);
      expect(r.status, ReminderSyncStatus.scheduled);
      expect(r.count, 2);
      expect(notifier.scheduled.map((x) => x.id), [reminderNotificationId('p1|t1|2026-10-16|0'), reminderNotificationId('p1|t1|2026-10-16|1')]);
      expect(notifier.scheduled.first.fireAt, DateTime.utc(2026, 10, 16, 15));
      expect(notifier.scheduled.first.title, 'Peni');
      // Pose de Peni choisie par l'API (maquette 28) ; absente : pose joyeuse par défaut.
      expect(notifier.scheduled.map((x) => x.pose), ['happy', 'think']);
      expect(ReminderTarget.decode(notifier.scheduled.first.payload)!.route, '/projects/p1/day/2026-10-16');
      expect(client.calls, ['GET /v1/me/reminders/upcoming']);
    });

    test('service fermé, rappels désactivés, notifications du serveur : tout est annulé, rien n’est programmé', () async {
      for (final (json, status) in [
        ({'available': false, 'enabled': true, 'channel': 'local'}, ReminderSyncStatus.serviceClosed),
        ({'available': true, 'enabled': false, 'channel': 'local'}, ReminderSyncStatus.disabled),
        ({'available': true, 'enabled': true, 'channel': 'push'}, ReminderSyncStatus.serverPush),
      ]) {
        final notifier = FakeNotifier()..scheduled = [LocalReminder(id: 1, fireAt: now, title: 'x', body: 'y', payload: '')];
        final r = await ReminderScheduler(RemindersApi(_FakeClient({...json, 'reminders': <dynamic>[]})), notifier).sync(now: now);
        expect(r.status, status);
        expect(notifier.scheduled, isEmpty);
        expect(notifier.cancels, 1);
      }
    });

    test('notifications refusées par le téléphone : rien n’est programmé, aucune demande faite d’office', () async {
      final client = _FakeClient({
        'available': true,
        'enabled': true,
        'channel': 'local',
        'reminders': [_reminder('p1|t1|2026-10-16|0', DateTime.utc(2026, 10, 16, 15))],
      });
      final notifier = FakeNotifier(allowed: false);
      final r = await ReminderScheduler(RemindersApi(client), notifier).sync(now: now);
      expect(r.status, ReminderSyncStatus.permissionMissing);
      expect(notifier.scheduled, isEmpty);
      expect(notifier.permissionRequests, 0); // la demande se fait seulement quand la personne active ses rappels
    });
  });

  group('apparence des notifications (maquette 28)', () {
    final at = DateTime.utc(2026, 10, 14, 17);
    test('silhouette de Peni, couleur BIM, avatar de Peni selon la pose, actions « J’y vais ! / Plus tard »', () {
      final android = PluginLocalNotifier.details('sad', body: 'Encore un effort', at: at).android!;
      expect(android.icon, 'ic_stat_peni');
      expect(android.color, BimColors.red);
      expect((android.largeIcon! as DrawableResourceAndroidBitmap).data, 'peni_notif_sad');
      expect(android.actions!.map((a) => a.title), ['J’y vais !', 'Plus tard']);
      expect(android.actions!.first.showsUserInterface, isTrue);
      expect(android.actions!.last.showsUserInterface, isFalse);
      // Pose inconnue : jamais de ressource manquante, avatar joyeux.
      expect((PluginLocalNotifier.details('inconnue', body: 'x', at: at).android!.largeIcon! as DrawableResourceAndroidBitmap).data,
          'peni_notif_happy');
    });

    test('Android : conversation dont Peni est l’expéditrice, avec son avatar (avatar à gauche, comme la maquette)', () {
      final style = PluginLocalNotifier.details('think', body: 'Ta séance t’attend', at: at).android!.styleInformation!
          as MessagingStyleInformation;
      expect(style.person.name, 'Peni');
      expect((style.person.icon! as DrawableResourceAndroidIcon).data, 'peni_notif_think');
      expect(style.groupConversation, isFalse);
      expect(style.messages!.single.text, 'Ta séance t’attend');
      expect(style.messages!.single.timestamp, at);
      expect(style.messages!.single.person!.name, 'Peni');
    });

    test('iPhone : catégorie avec les deux actions, avatar de Peni joint quand il est disponible', () {
      final withAvatar = PluginLocalNotifier.details('happy', body: 'x', at: at, iosAvatar: '/app/peni_notif_happy.png').iOS!;
      expect(withAvatar.categoryIdentifier, PluginLocalNotifier.iosCategory);
      expect(withAvatar.attachments!.single.filePath, '/app/peni_notif_happy.png');
      // Sans avatar copié : notification affichée quand même, avec l'icône de l'app.
      expect(PluginLocalNotifier.details('happy', body: 'x', at: at).iOS!.attachments, isNull);
    });
  });

  group('préparation Firebase (sans projet)', () {
    test('aucune source de jeton serveur : rien n’est simulé', () async {
      const source = UnavailablePushTokenSource();
      expect(source.available, isFalse);
      expect(await source.token(), isNull);
      expect(await source.onTokenRefresh.isEmpty, isTrue);
    });

    test('inscription et retrait de l’appareil : routes de l’API prêtes', () async {
      final client = _FakeClient({});
      final api = RemindersApi(client);
      await api.registerPushDevice(token: 'jeton-fcm', platform: 'android', appVersion: '0.1.0');
      await api.removePushDevice();
      expect(client.calls, ['PUT /v1/me/push-device {token: jeton-fcm, platform: android, appVersion: 0.1.0}', 'DELETE /v1/me/push-device']);
    });
  });
}
