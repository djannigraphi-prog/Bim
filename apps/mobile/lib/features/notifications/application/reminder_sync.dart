import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/router/app_router.dart';
import '../../auth/application/session_controller.dart';
import '../../projects/application/projects_providers.dart';
import '../data/inbox_api.dart';
import 'local_notifier.dart';
import 'reminder_scheduler.dart';

/// Dernier résultat de synchronisation des rappels sur ce téléphone (null = pas encore synchronisé).
final reminderSyncStatusProvider = StateProvider<ReminderSyncResult?>((ref) => null);

/// Synchronise les rappels programmés sur le téléphone avec l'API, et ouvre la journée du projet quand la personne
/// touche une notification ou « J'y vais ! ».
/// Moments : connexion, ouverture de l'app, retour au premier plan ; à la déconnexion, tout est annulé.
class ReminderSync extends ConsumerStatefulWidget {
  const ReminderSync({super.key, required this.child});

  final Widget child;

  /// Synchronise maintenant (après un changement de préférences ou une tâche cochée). Ne lève jamais d'erreur :
  /// sans réseau, les rappels déjà programmés restent en place.
  static Future<ReminderSyncResult?> syncNow(WidgetRef ref) async {
    if (ref.read(sessionProvider) is! SessionSignedIn) return null;
    // Mêmes moments pour la pastille de la cloche (ouverture, retour au premier plan, changements).
    ref.invalidate(inboxUnreadProvider);
    try {
      final result = await ref.read(reminderSchedulerProvider).sync();
      ref.read(reminderSyncStatusProvider.notifier).state = result;
      return result;
    } catch (_) {
      return null;
    }
  }

  @override
  ConsumerState<ReminderSync> createState() => _ReminderSyncState();
}

class _ReminderSyncState extends ConsumerState<ReminderSync> with WidgetsBindingObserver {
  ReminderTarget? _pending;
  Timer? _debounce;

  bool get _signedIn => ref.read(sessionProvider) is SessionSignedIn;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  Future<void> _start() async {
    final notifier = ref.read(localNotifierProvider);
    try {
      await notifier.init(onOpen: _open);
      final launch = await notifier.takeLaunchTarget();
      if (launch != null) _open(launch);
    } catch (_) {
      // Notifications indisponibles sur cet appareil : l'app fonctionne sans.
    }
    if (!mounted) return;
    ref.listenManual<SessionState>(sessionProvider, (previous, next) {
      if (next is SessionSignedIn && previous is! SessionSignedIn) {
        ReminderSync.syncNow(ref);
        final pending = _pending;
        _pending = null;
        if (pending != null) _open(pending);
      } else if (next is! SessionSignedIn && previous is SessionSignedIn) {
        ref.read(reminderSchedulerProvider).clear().catchError((_) {});
        ref.read(reminderSyncStatusProvider.notifier).state = null;
      }
    }, fireImmediately: true,);
    // Projet modifié (tâche cochée, pause…) : rappels recalculés peu après (regroupe les modifications rapprochées).
    ref.listenManual<int>(projectsRevisionProvider, (_, __) {
      _debounce?.cancel();
      _debounce = Timer(const Duration(seconds: 2), () => ReminderSync.syncNow(ref));
    });
  }

  void _open(ReminderTarget target) {
    if (!_signedIn) {
      _pending = target; // ouverte dès que la session est rétablie
      return;
    }
    ref.read(routerProvider).push(target.route);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _signedIn) ReminderSync.syncNow(ref);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
