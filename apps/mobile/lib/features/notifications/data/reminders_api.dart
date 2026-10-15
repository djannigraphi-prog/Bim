import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Un rappel à programmer sur le téléphone, calculé par l'API (mêmes règles et mêmes textes que l'envoi serveur).
class UpcomingReminder {
  const UpcomingReminder({
    required this.key,
    required this.projectId,
    required this.taskId,
    required this.day,
    required this.attempt,
    required this.fireAt,
    required this.title,
    required this.body,
  });

  /// Clé stable « projet|tâche|jour|tentative » : identifie le rappel (pas de doublon, annulation ciblée).
  final String key;
  final String projectId;
  final String taskId;
  final String day;
  final int attempt;
  final DateTime fireAt;
  final String title;
  final String body;

  factory UpcomingReminder.fromJson(Map<String, dynamic> json) => UpcomingReminder(
        key: json['key'] as String,
        projectId: json['projectId'] as String,
        taskId: json['taskId'] as String,
        day: json['day'] as String,
        attempt: (json['attempt'] as num).toInt(),
        fireAt: DateTime.parse(json['fireAt'] as String).toUtc(),
        title: json['title'] as String,
        body: json['body'] as String,
      );
}

/// Réponse de `GET /v1/me/reminders/upcoming`.
class UpcomingReminders {
  const UpcomingReminders({required this.available, required this.enabled, required this.channel, required this.reminders});

  /// Le service des rappels est ouvert sur la plateforme.
  final bool available;

  /// La personne a activé ses rappels.
  final bool enabled;

  /// « local » : le téléphone programme lui-même ; « push » : le serveur envoie (rien à programmer ici).
  final String channel;
  final List<UpcomingReminder> reminders;

  bool get scheduleLocally => available && enabled && channel == 'local';

  factory UpcomingReminders.fromJson(Map<String, dynamic> json) => UpcomingReminders(
        available: json['available'] == true,
        enabled: json['enabled'] == true,
        channel: json['channel'] == 'push' ? 'push' : 'local',
        reminders: [
          for (final r in (json['reminders'] as List<dynamic>? ?? const [])) UpcomingReminder.fromJson(r as Map<String, dynamic>),
        ],
      );
}

class RemindersApi {
  RemindersApi(this._api);
  final ApiClient _api;

  Future<UpcomingReminders> upcoming() async => UpcomingReminders.fromJson(await _api.get('/v1/me/reminders/upcoming'));

  /// Inscrit ce téléphone pour les notifications du serveur (jeton Firebase). Inactif tant que Firebase n'est pas configuré.
  Future<void> registerPushDevice({required String token, required String platform, String? appVersion}) =>
      _api.put('/v1/me/push-device', body: {'token': token, 'platform': platform, if (appVersion != null) 'appVersion': appVersion});

  /// Ce téléphone ne reçoit plus les notifications du serveur.
  Future<void> removePushDevice() => _api.delete('/v1/me/push-device');
}

final remindersApiProvider = Provider<RemindersApi>((ref) => RemindersApi(ref.watch(apiClientProvider)));
