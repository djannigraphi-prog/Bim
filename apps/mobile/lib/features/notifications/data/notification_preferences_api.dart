import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Heures calmes « HH:MM » à l'heure locale de la personne (la fenêtre peut passer minuit, ex. 22:00 → 06:00).
class QuietHours {
  const QuietHours({required this.start, required this.end});

  final String start;
  final String end;

  static QuietHours? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final start = json['start'];
    final end = json['end'];
    return start is String && end is String ? QuietHours(start: start, end: end) : null;
  }

  @override
  bool operator ==(Object other) => other is QuietHours && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(start, end);
}

/// Préférences de rappel renvoyées par `GET /v1/me/notification-preferences` (lot 2).
class NotificationPreferences {
  const NotificationPreferences({
    required this.remindersEnabled,
    required this.quietHours,
    required this.quietHoursArePersonal,
    required this.remindersAvailable,
  });

  /// Choix de la personne : recevoir ou non les rappels de Peni.
  final bool remindersEnabled;

  /// Heures calmes appliquées (les siennes, ou la valeur par défaut de BIM ; null = aucune).
  final QuietHours? quietHours;

  /// true si la personne a choisi ses propres heures calmes.
  final bool quietHoursArePersonal;

  /// false tant que les rappels ne sont pas en service sur la plateforme : aucune notification n'est envoyée.
  final bool remindersAvailable;

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) => NotificationPreferences(
        remindersEnabled: json['remindersEnabled'] == true,
        quietHours: QuietHours.fromJson(json['quietHours']),
        quietHoursArePersonal: json['quietHoursSource'] == 'personal',
        // Absent ou inattendu : on considère le service comme fermé (jamais l'inverse).
        remindersAvailable: json['remindersAvailable'] == true,
      );
}

class NotificationPreferencesApi {
  NotificationPreferencesApi(this._api);
  final ApiClient _api;

  static const path = '/v1/me/notification-preferences';

  Future<NotificationPreferences> load() async => NotificationPreferences.fromJson(await _api.get(path));

  /// Active ou coupe les rappels de cette personne. Ne touche à rien d'autre (ni heures calmes, ni service).
  Future<NotificationPreferences> setRemindersEnabled(bool enabled) async =>
      NotificationPreferences.fromJson(await _api.patch(path, body: {'remindersEnabled': enabled}));

  /// Heures calmes personnelles ; `null` revient à la valeur par défaut de BIM.
  Future<NotificationPreferences> setQuietHours(QuietHours? hours) async => NotificationPreferences.fromJson(
        await _api.patch(path, body: {'quietStart': hours?.start, 'quietEnd': hours?.end}),
      );
}

final notificationPreferencesApiProvider =
    Provider<NotificationPreferencesApi>((ref) => NotificationPreferencesApi(ref.watch(apiClientProvider)));
