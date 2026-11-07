import 'dart:convert';
import 'dart:io' show File, Platform;

import 'package:flutter/services.dart' show rootBundle;

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
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
  /// Ce téléphone sait programmer des notifications (Android et iPhone).
  bool get supported;

  /// [onOpen] reçoit la cible quand la personne touche la notification ou « J'y vais ! » (app ouverte ou en arrière-plan).
  Future<void> init({required void Function(ReminderTarget target) onOpen});

  /// Autorisation système d'afficher des notifications (distincte du choix « recevoir les rappels » dans BIM).
  Future<bool> permissionGranted();

  /// Demande l'autorisation système (Android 13 et plus). Renvoie la réponse de la personne.
  Future<bool> requestPermission();

  /// Remplace tous les rappels programmés par [reminders] (le rappel d'essai éventuel est conservé).
  Future<void> replaceAll(List<LocalReminder> reminders, {ReminderTiming timing = ReminderTiming.inexact});

  Future<void> cancelAll();

  /// Rappel d'essai (versions de test uniquement, tests sur téléphones) : une vraie notification programmée de la même
  /// façon que les rappels, sans passer par le service des rappels. Identifiant [testReminderId].
  Future<void> scheduleTest(LocalReminder reminder);

  /// Nombre de rappels programmés (contrôle et tests).
  Future<int> pendingCount();

  /// Cible de la notification qui a lancé l'app, s'il y en a une (consommée une seule fois).
  Future<ReminderTarget?> takeLaunchTarget();
}

/// Identifiant réservé au rappel d'essai : jamais annulé par la synchronisation des rappels.
const testReminderId = 1;

/// Identifiants réservés aux essais des trois textes de Peni (1, 2, 3) : jamais annulés par la synchronisation.
const testReminderIds = {testReminderId, 2, 3};

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
  Future<void> scheduleTest(LocalReminder reminder) async {}
  @override
  Future<int> pendingCount() async => 0;
  @override
  Future<ReminderTarget?> takeLaunchTarget() async => null;
}

/// Action « Plus tard » : la notification est simplement fermée (le rappel suivant du rythme reste programmé).
/// Point d'entrée d'arrière-plan exigé par la bibliothèque ; aucun traitement supplémentaire.
@pragma('vm:entry-point')
void onReminderActionInBackground(NotificationResponse response) {}

/// Implémentation Android et iPhone (flutter_local_notifications), canal « Rappels de Peni », actions
/// « J'y vais ! / Plus tard ».
///
/// Maquette 28 : l'avatar de Peni à gauche, « Peni » en titre, le message à côté.
/// - Android : notification de type conversation (Peni est l'expéditrice, avec son avatar), petite icône = silhouette
///   blanche de Peni, couleur d'accent rouge BIM ; grande icône = avatar de Peni (affichée par les anciennes versions
///   d'Android qui n'ont pas la présentation conversation).
/// - iPhone : l'icône de l'app s'affiche toujours à gauche (règle d'Apple) ; l'avatar de Peni est joint à la
///   notification (vignette). L'avatar à gauche demande les « notifications de communication » d'Apple, possibles
///   seulement avec le compte Apple Developer (droit à signer) : voir docs/NOTIFICATIONS_PENI.md.
class PluginLocalNotifier implements LocalNotifier {
  PluginLocalNotifier([FlutterLocalNotificationsPlugin? plugin]) : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _launchTaken = false;

  @override
  bool get supported => Platform.isAndroid || Platform.isIOS;

  static const channelId = 'rappels';
  static const actionGo = 'go';
  static const actionLater = 'later';

  /// Petites icônes de la barre d'état (monochromes, blanches sur fond transparent) : « B » de BIM par défaut,
  /// silhouette de Peni pour ses rappels ; avatar de Peni (maquette 28). Tous générés par
  /// `scripts/generate-notification-icons.py` à partir des dessins de l'app.
  static const smallIcon = 'ic_stat_bim';
  static const peniIcon = 'ic_stat_peni';
  static const poses = {'happy', 'think', 'sad'};
  static const iosCategory = 'peni_reminder';

  static String poseOf(String pose) => poses.contains(pose) ? pose : 'happy';

  /// Peni, expéditrice des rappels (avatar selon la pose).
  static Person peni(String pose) => Person(
        key: 'peni',
        name: 'Peni',
        bot: true,
        important: true,
        icon: DrawableResourceAndroidIcon('peni_notif_${poseOf(pose)}'),
      );

  /// Chemins des avatars copiés dans les fichiers de l'app (iPhone : pièce jointe de la notification).
  final Map<String, String> _iosAvatars = {};

  NotificationDetails detailsFor(LocalReminder r) => details(r.pose, body: r.body, at: r.fireAt, iosAvatar: _iosAvatars[poseOf(r.pose)]);

  static NotificationDetails details(String pose, {required String body, required DateTime at, String? iosAvatar}) => NotificationDetails(
        iOS: DarwinNotificationDetails(
          categoryIdentifier: iosCategory,
          threadIdentifier: 'peni',
          presentAlert: true,
          presentBanner: true,
          presentList: true,
          presentSound: true,
          attachments: iosAvatar == null ? null : [DarwinNotificationAttachment(iosAvatar)],
        ),
        android: AndroidNotificationDetails(
          channelId,
          'Rappels de Peni',
          channelDescription: 'Rappels des tâches de tes projets BIM',
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.reminder,
          icon: peniIcon,
          color: BimColors.red,
          colorized: false,
          largeIcon: DrawableResourceAndroidBitmap('peni_notif_${poseOf(pose)}'),
          styleInformation: MessagingStyleInformation(
            peni(pose),
            groupConversation: false,
            messages: [Message(body, at, peni(pose))],
          ),
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
      settings: InitializationSettings(
        android: const AndroidInitializationSettings(smallIcon),
        // iPhone : l'autorisation est demandée par l'écran Rappels (requestPermission), jamais au démarrage.
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
          notificationCategories: [
            DarwinNotificationCategory(iosCategory, actions: [
              DarwinNotificationAction.plain(actionGo, 'J’y vais !', options: {DarwinNotificationActionOption.foreground}),
              DarwinNotificationAction.plain(actionLater, 'Plus tard'),
            ]),
          ],
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        if (response.actionId == actionLater) return;
        final target = ReminderTarget.decode(response.payload);
        if (target != null) onOpen(target);
      },
      onDidReceiveBackgroundNotificationResponse: onReminderActionInBackground,
    );
    if (Platform.isIOS) await _copyIosAvatars();
  }

  /// iPhone : une pièce jointe doit être un fichier ; les avatars sont copiés une fois depuis l'app.
  Future<void> _copyIosAvatars() async {
    try {
      final dir = await getApplicationSupportDirectory();
      for (final pose in poses) {
        final file = File('${dir.path}/peni_notif_$pose.png');
        if (!await file.exists()) {
          final data = await rootBundle.load('assets/peni/notif/peni_notif_$pose.png');
          await file.writeAsBytes(data.buffer.asUint8List(), flush: true);
        }
        _iosAvatars[pose] = file.path;
      }
    } on Exception {
      _iosAvatars.clear(); // Sans avatar, la notification reste affichée avec l'icône de l'app.
    }
  }

  IOSFlutterLocalNotificationsPlugin? get _ios => _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();

  @override
  Future<bool> permissionGranted() async {
    if (Platform.isAndroid) return await _android?.areNotificationsEnabled() ?? false;
    if (Platform.isIOS) return (await _ios?.checkPermissions())?.isEnabled ?? false;
    return false;
  }

  @override
  Future<bool> requestPermission() async {
    if (Platform.isAndroid) return await _android?.requestNotificationsPermission() ?? false;
    if (Platform.isIOS) return await _ios?.requestPermissions(alert: true, badge: true, sound: true) ?? false;
    return false;
  }

  @override
  Future<void> replaceAll(List<LocalReminder> reminders, {ReminderTiming timing = ReminderTiming.inexact}) async {
    for (final p in await _plugin.pendingNotificationRequests()) {
      if (!testReminderIds.contains(p.id)) await _plugin.cancel(id: p.id);
    }
    for (final r in reminders) {
      await _schedule(r, timing);
    }
  }

  Future<void> _schedule(LocalReminder r, ReminderTiming timing) => _plugin.zonedSchedule(
        id: r.id,
        scheduledDate: tz.TZDateTime.from(r.fireAt.toUtc(), tz.UTC),
        notificationDetails: detailsFor(r),
        androidScheduleMode: switch (timing) {
          ReminderTiming.inexact => AndroidScheduleMode.inexactAllowWhileIdle,
        },
        title: r.title,
        body: r.body,
        payload: r.payload,
      );

  @override
  Future<void> cancelAll() => _plugin.cancelAll();

  @override
  Future<void> scheduleTest(LocalReminder reminder) => _schedule(reminder, ReminderTiming.inexact);

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
