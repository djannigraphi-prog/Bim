import 'package:bim/features/notifications/application/local_notifier.dart';
import 'package:flutter_test/flutter_test.dart';

/// Téléphone simulé : enregistre ce qui est programmé.
class FakeNotifier implements LocalNotifier {
  FakeNotifier({this.allowed = true, this.grantOnRequest = false});
  bool allowed;

  /// La personne accepte la demande d'autorisation du téléphone.
  final bool grantOnRequest;
  int permissionRequests = 0;
  int cancels = 0;
  List<LocalReminder> scheduled = [];

  @override
  bool get supported => true;
  @override
  Future<void> init({required void Function(ReminderTarget target) onOpen}) async {}
  @override
  Future<bool> permissionGranted() async => allowed;
  @override
  Future<bool> requestPermission() async {
    permissionRequests++;
    if (grantOnRequest) allowed = true;
    return allowed;
  }

  @override
  Future<void> replaceAll(List<LocalReminder> reminders, {ReminderTiming timing = ReminderTiming.inexact}) async {
    expect(timing, ReminderTiming.inexact); // version 1 : jamais d'alarme exacte
    scheduled = List.of(reminders);
  }

  @override
  Future<void> cancelAll() async {
    cancels++;
    scheduled = [];
    test = null;
  }

  /// Rappel d'essai programmé (tests sur téléphones).
  LocalReminder? test;

  @override
  Future<void> scheduleTest(LocalReminder reminder) async => test = reminder;

  @override
  Future<int> pendingCount() async => scheduled.length;
  @override
  Future<ReminderTarget?> takeLaunchTarget() async => null;
}

