import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../core/theme/tokens.dart';

/// Façon de programmer un rappel sur le téléphone.
///
/// Version 1 : **non exacte** (décision du 15/10/2026) — Android peut décaler un peu l'affichage pour économiser la
/// batterie, sans autorisation spéciale. L'alarme exacte (autorisation « alarmes et rappels » d'Android, à demander à la
/// personne) pourra s'ajouter ici plus tard, sans changer le calcul des rappels ni les écrans.
enum ReminderTiming { inexact }

/// Un rappel à afficher par le téléphone à une heure donnée.
class LocalReminder {
  const LocalReminder({
    required this.id,
    required this.fireAt,
    required this.title,
    required this.body,
    required this.payload,
    this.pose = 'happy',
  });

  /// Pose de Peni affichée dans la notification (choisie par l'API selon la tentative) : happy, think ou sad.
  final String pose;

  final int id;
  final DateTime fireAt;
  final String title;
  final String body;

  /// Données rendues à l'app quand la personne touche la notification (projet et jour à ouvrir).
  final String payload;
}

/// Ce que l'app doit ouvrir quand la personne touche « J'y vais ! » ou la notification.
class ReminderTarget {
  const ReminderTarget({required this.projectId, required this.day});

  final String projectId;
  final String day;

  String get route => '/projects/$projectId/day/$day';

  String encode() => jsonEncode({'projectId': projectId, 'day': day});

  static ReminderTarget? decode(String? payload) {
    if (payload == null) return null;
    try {
      final j = jsonDecode(payload);
      if (j is Map && j['projectId'] is String && j['day'] is String) {
        return ReminderTarget(projectId: j['projectId'] as String, day: j['day'] as String);
      }
    } on FormatException {
      return null;
    }
    return null;
  }
}

/// Identifiant Android stable d'un rappel, tiré de sa clé (« projet|tâche|jour|tentative ») : FNV-1a 32 bits, positif.
int reminderNotificationId(String key) {
  var h = 0x811c9dc5;
  for (final c in utf8.encode(key)) {
    h ^= c;
    h = (h * 0x01000193) & 0xffffffff;
  }
  return h & 0x7fffffff;
}

/// Notifications programmées sur le téléphone. Interface séparée de la bibliothèque pour les tests.
abstract class LocalNotifier {
  /// Ce téléphone sait programmer des notifications (Android pour l'instant).
  bool get supported;

  /// [onOpen] reçoit la cible quand la personne touche la notification ou « J'y vais ! » (app ouverte ou en arrière-plan).
  Future<void> init({required void Function(ReminderTarget target) onOpen});

  /// Autorisation système d'afficher des notifications (distincte du choix « recevoir les rappels » dans BIM).
  Future<bool> permissionGranted();

  /// Demande l'autorisation système (Android 13 et plus). Renvoie la réponse de la personne.
  Future<bool> requestPermission();

  /// Remplace tous les rappels programmés par [reminders].
  Future<void> replaceAll(List<LocalReminder> reminders, {ReminderTiming timing = ReminderTiming.inexact});

  Future<void> cancelAll();

  /// Nombre de rappels programmés (contrôle et tests).
  Future<int> pendingCount();

  /// Cible de la notification qui a lancé l'app, s'il y en a une (consommée une seule fois).
  Future<ReminderTarget?> takeLaunchTarget();
}

/// Plateforme sans notifications locales (tests, iOS non encore compilé) : rien n'est programmé, rien n'est simulé.
class NoopLocalNotifier implements LocalNotifier {
  const NoopLocalNotifier();
  @override
  bool get supported => false;
  @override
  Future<void> init({required void Function(ReminderTarget target) onOpen}) async {}
  @override
  Future<bool> permissionGranted() async => false;
  @override
  Future<bool> requestPermission() async => false;
  @override
  Future<void> replaceAll(List<LocalReminder> reminders, {ReminderTiming timing = ReminderTiming.inexact}) async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<int> pendingCount() async => 0;
  @override
  Future<ReminderTarget?> takeLaunchTarget() async => null;
}

/// Action « Plus tard » : la notification est simplement fermée (le rappel suivant du rythme reste programmé).
/// Point d'entrée d'arrière-plan exigé par la bibliothèque ; aucun traitement supplémentaire.
@pragma('vm:entry-point')
void onReminderActionInBackground(NotificationResponse response) {}

/// Implémentation Android (flutter_local_notifications), canal « Rappels de Peni », actions « J'y vais ! / Plus tard ».
class PluginLocalNotifier implements LocalNotifier {
  PluginLocalNotifier([FlutterLocalNotificationsPlugin? plugin]) : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _launchTaken = false;

  @override
  bool get supported => Platform.isAndroid;

  static const channelId = 'rappels';
  static const actionGo = 'go';
  static const actionLater = 'later';

  /// Petite icône de la barre d'état (« B » de BIM, monochrome) et avatar de Peni (maquette 28), générés par
  /// `scripts/generate-notification-icons.py` à partir des dessins de l'app.
  static const smallIcon = 'ic_stat_bim';
  static const poses = {'happy', 'think', 'sad'};

  static NotificationDetails details(String pose) => NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          'Rappels de Peni',
          channelDescription: 'Rappels des tâches de tes projets BIM',
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.reminder,
          icon: smallIcon,
          color: BimColors.red,
          largeIcon: DrawableResourceAndroidBitmap('peni_notif_${poses.contains(pose) ? pose : 'happy'}'),
          actions: const [
            AndroidNotificationAction(actionGo, 'J’y vais !', showsUserInterface: true),
            AndroidNotificationAction(actionLater, 'Plus tard'),
          ],
        ),
      );

  AndroidFlutterLocalNotificationsPlugin? get _android => _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();

  @override
  Future<void> init({required void Function(ReminderTarget target) onOpen}) async {
    await _plugin.initialize(
      settings: const InitializationSettings(android: AndroidInitializationSettings(smallIcon)),
      onDidReceiveNotificationResponse: (response) {
        if (response.actionId == actionLater) return;
        final target = ReminderTarget.decode(response.payload);
        if (target != null) onOpen(target);
      },
      onDidReceiveBackgroundNotificationResponse: onReminderActionInBackground,
    );
  }

  @override
  Future<bool> permissionGranted() async => Platform.isAndroid && (await _android?.areNotificationsEnabled() ?? false);

  @override
  Future<bool> requestPermission() async => Platform.isAndroid && (await _android?.requestNotificationsPermission() ?? false);

  @override
  Future<void> replaceAll(List<LocalReminder> reminders, {ReminderTiming timing = ReminderTiming.inexact}) async {
    await _plugin.cancelAll();
    for (final r in reminders) {
      await _plugin.zonedSchedule(
        id: r.id,
        scheduledDate: tz.TZDateTime.from(r.fireAt.toUtc(), tz.UTC),
        notificationDetails: details(r.pose),
        androidScheduleMode: switch (timing) {
          ReminderTiming.inexact => AndroidScheduleMode.inexactAllowWhileIdle,
        },
        title: r.title,
        body: r.body,
        payload: r.payload,
      );
    }
  }

  @override
  Future<void> cancelAll() => _plugin.cancelAll();

  @override
  Future<int> pendingCount() async => (await _plugin.pendingNotificationRequests()).length;

  @override
  Future<ReminderTarget?> takeLaunchTarget() async {
    if (_launchTaken) return null;
    _launchTaken = true;
    final details = await _plugin.getNotificationAppLaunchDetails();
    final response = details?.notificationResponse;
    if (details?.didNotificationLaunchApp != true || response == null || response.actionId == actionLater) return null;
    return ReminderTarget.decode(response.payload);
  }
}

/// Remplacé au démarrage par [PluginLocalNotifier] (main.dart) ; sans effet dans les tests.
final localNotifierProvider = Provider<LocalNotifier>((ref) => const NoopLocalNotifier());
