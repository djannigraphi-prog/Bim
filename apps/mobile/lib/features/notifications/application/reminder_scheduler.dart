import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/reminders_api.dart';
import 'local_notifier.dart';

/// Résultat d'une synchronisation (affiché dans l'écran Rappels et vérifié par les tests).
enum ReminderSyncStatus {
  /// Rappels programmés sur ce téléphone.
  scheduled,

  /// Service des rappels pas encore ouvert sur la plateforme.
  serviceClosed,

  /// La personne n'a pas activé ses rappels.
  disabled,

  /// Ce téléphone reçoit les rappels du serveur : rien à programmer (pas de doublon).
  serverPush,

  /// Le téléphone n'autorise pas les notifications de BIM.
  permissionMissing,
}

class ReminderSyncResult {
  const ReminderSyncResult(this.status, [this.count = 0]);
  final ReminderSyncStatus status;
  final int count;
}

/// Programme sur le téléphone les rappels des prochaines heures, calculés par l'API (mêmes règles, mêmes textes).
///
/// Appelé à l'ouverture de l'app, au retour au premier plan, après un changement de préférences et après une tâche
/// cochée. Chaque synchronisation remplace tout ce qui était programmé : un rappel annulé ou une tâche cochée
/// disparaît au plus tard à la synchronisation suivante. Sans réseau, la synchronisation échoue et les rappels déjà
/// programmés restent en place.
class ReminderScheduler {
  ReminderScheduler(this._api, this._notifier);

  final RemindersApi _api;
  final LocalNotifier _notifier;

  Future<ReminderSyncResult> sync({DateTime? now}) async {
    final up = await _api.upcoming();
    if (!up.scheduleLocally) {
      await _notifier.cancelAll();
      if (!up.available) return const ReminderSyncResult(ReminderSyncStatus.serviceClosed);
      if (!up.enabled) return const ReminderSyncResult(ReminderSyncStatus.disabled);
      return const ReminderSyncResult(ReminderSyncStatus.serverPush);
    }
    if (!await _notifier.permissionGranted()) {
      await _notifier.cancelAll();
      return const ReminderSyncResult(ReminderSyncStatus.permissionMissing);
    }
    final limit = (now ?? DateTime.now()).toUtc().add(const Duration(seconds: 5));
    final list = [
      for (final r in up.reminders)
        if (r.fireAt.isAfter(limit))
          LocalReminder(
            id: reminderNotificationId(r.key),
            fireAt: r.fireAt,
            title: r.title,
            body: r.body,
            payload: ReminderTarget(projectId: r.projectId, day: r.day).encode(),
          ),
    ];
    await _notifier.replaceAll(list);
    return ReminderSyncResult(ReminderSyncStatus.scheduled, list.length);
  }

  /// Déconnexion : plus aucun rappel sur ce téléphone.
  Future<void> clear() => _notifier.cancelAll();
}

final reminderSchedulerProvider = Provider<ReminderScheduler>(
  (ref) => ReminderScheduler(ref.watch(remindersApiProvider), ref.watch(localNotifierProvider)),
);
