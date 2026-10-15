import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/env.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/local_notifier.dart';
import '../application/reminder_scheduler.dart';
import '../application/reminder_sync.dart';
import '../data/notification_preferences_api.dart';

/// Choix d'une heure ; remplaçable dans les tests.
typedef PickTime = Future<TimeOfDay?> Function(BuildContext context, {required TimeOfDay initial, required String title});

Future<TimeOfDay?> showBimTimePicker(BuildContext context, {required TimeOfDay initial, required String title}) => showTimePicker(
      context: context,
      initialTime: initial,
      helpText: title,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

TimeOfDay _parse(String hhmm) => TimeOfDay(hour: int.parse(hhmm.substring(0, 2)), minute: int.parse(hhmm.substring(3, 5)));

/// Textes v3 des rappels (`apps/api/src/modules/notifications/reminders.ts`) pour une tâche d'exemple, avec la pose de
/// Peni : seulement pour l'essai sur téléphone. Le test `reminder-texts-sync.spec.ts` de l'API vérifie qu'ils sont identiques.
const testReminderTexts = [
  ('Séance d’essai : c’est l’heure ! 💪 Tu vas tout déchirer.', 'happy'),
  ('Séance d’essai t’attend encore. Un petit pas aujourd’hui, c’est déjà gagné 🙂', 'think'),
  ('Séance d’essai : encore un peu de temps ! Et sinon, demain est une nouvelle chance 💛', 'happy'),
];

/// Préférences de rappel (lot 2). La maquette 28 montre les notifications elles-mêmes, sur l'écran verrouillé :
/// elles dépendent de Firebase et ne sont pas encore en service. Cet écran ne règle que les choix de la personne,
/// enregistrés par l'API ; il n'active jamais le service des rappels et le dit clairement tant qu'il est fermé.
class ReminderPreferencesScreen extends ConsumerStatefulWidget {
  const ReminderPreferencesScreen({super.key, this.pickTime = showBimTimePicker});

  final PickTime pickTime;

  @override
  ConsumerState<ReminderPreferencesScreen> createState() => _ReminderPreferencesScreenState();
}

class _ReminderPreferencesScreenState extends ConsumerState<ReminderPreferencesScreen> {
  NotificationPreferences? _prefs;
  Object? _loadError;
  bool _saving = false;

  /// Autorisation système d'afficher des notifications (null = téléphone sans notifications programmées).
  bool? _systemAllowed;

  /// Heure du rappel d'essai programmé (versions de test).
  DateTime? _testAt;

  NotificationPreferencesApi get _api => ref.read(notificationPreferencesApiProvider);
  LocalNotifier get _notifier => ref.read(localNotifierProvider);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final prefs = await _api.load();
      final allowed = _notifier.supported ? await _notifier.permissionGranted() : null;
      if (mounted) {
        setState(() {
          _prefs = prefs;
          _systemAllowed = allowed;
        });
      }
      // Rappels activés : l'écran resynchronise et affiche ce qui est réellement programmé sur ce téléphone.
      if (mounted && prefs.remindersEnabled) await ReminderSync.syncNow(ref);
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  /// Enregistre un changement ; l'écran affiche ensuite la réponse du serveur (jamais une valeur supposée).
  Future<void> _save(Future<NotificationPreferences> Function(NotificationPreferencesApi api) change) async {
    setState(() => _saving = true);
    try {
      final prefs = await change(_api);
      if (!mounted) return;
      setState(() => _prefs = prefs);
      showBimSnack(context, 'Choix enregistré.');
      // Choix BIM enregistré ; l'autorisation du téléphone est une étape distincte, demandée seulement à l'activation.
      if (prefs.remindersEnabled && _systemAllowed == false) await _askSystemPermission();
      await ReminderSync.syncNow(ref);
    } catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _askSystemPermission() async {
    final allowed = await _notifier.requestPermission();
    if (!mounted) return;
    setState(() => _systemAllowed = allowed);
    if (allowed) {
      await ReminderSync.syncNow(ref);
    } else {
      showBimSnack(context, 'Sans autorisation, ton téléphone n’affichera pas les rappels. Tu peux l’activer dans ses réglages.');
    }
  }

  /// Rappel d'essai pour les tests sur téléphones : demande l'autorisation du téléphone si besoin, puis programme une
  /// notification dans [minutes] minutes (mode non exact, comme les rappels).
  Future<void> _scheduleTest(int minutes) => _scheduleTests([
        LocalReminder(
          id: testReminderId,
          fireAt: DateTime.now().add(Duration(minutes: minutes)),
          title: 'Peni',
          body: 'Rappel d’essai : c’est l’heure ! Ceci est un test des notifications de BIM 💪',
          payload: '',
        ),
      ]);

  /// Essai des trois textes de Peni et de leurs poses (à l'heure, +1 h, dernier rappel), une minute d'écart, pour les
  /// vérifier sur de vrais téléphones. Copie des textes v3 du serveur (`reminders.ts`), contrôlée par un test de l'API.
  Future<void> _scheduleTextTests() {
    final now = DateTime.now();
    return _scheduleTests([
      for (final (i, (body, pose)) in testReminderTexts.indexed)
        LocalReminder(id: i + 1, fireAt: now.add(Duration(minutes: i + 1)), title: 'Peni', body: body, pose: pose, payload: ''),
    ]);
  }

  Future<void> _scheduleTests(List<LocalReminder> reminders) async {
    var allowed = await _notifier.permissionGranted();
    if (!allowed) allowed = await _notifier.requestPermission();
    if (!mounted) return;
    setState(() => _systemAllowed = allowed);
    if (!allowed) {
      showBimSnack(context, 'Sans autorisation, ton téléphone n’affichera pas les rappels. Tu peux l’activer dans ses réglages.');
      return;
    }
    for (final r in reminders) {
      await _notifier.scheduleTest(r);
    }
    if (!mounted) return;
    setState(() => _testAt = reminders.first.fireAt);
    showBimSnack(context, 'Rappel d’essai prévu. Tu peux verrouiller le téléphone.');
  }

  Future<void> _editQuietHours(NotificationPreferences prefs) async {
    final current = prefs.quietHours;
    final start = await widget.pickTime(
      context,
      initial: current == null ? const TimeOfDay(hour: 22, minute: 0) : _parse(current.start),
      title: 'Début des heures calmes',
    );
    if (start == null || !mounted) return;
    final end = await widget.pickTime(
      context,
      initial: current == null ? const TimeOfDay(hour: 6, minute: 0) : _parse(current.end),
      title: 'Fin des heures calmes',
    );
    if (end == null || !mounted) return;
    if (start == end) {
      showBimSnack(context, 'Le début et la fin des heures calmes doivent être différents.');
      return;
    }
    await _save((api) => api.setQuietHours(QuietHours(start: _hhmm(start), end: _hhmm(end))));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final prefs = _prefs;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.lg),
            Text('Rappels', style: theme.textTheme.headlineMedium),
            const SizedBox(height: BimSpacing.xs),
            Text('Peni te rappelle les tâches de tes projets qui ne sont pas encore cochées.', style: theme.textTheme.bodyMedium),
            const SizedBox(height: BimSpacing.lg),
            if (prefs == null && _loadError == null) const Center(child: CircularProgressIndicator()),
            if (prefs == null && _loadError != null) ...[
              Text(_loadError is ApiException ? (_loadError! as ApiException).message : ApiException.unknown.message),
              const SizedBox(height: BimSpacing.md),
              BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _load),
            ],
            if (prefs != null) ..._content(context, prefs),
          ],
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context, NotificationPreferences prefs) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final border = BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card));
    final quiet = prefs.quietHours;
    final sync = ref.watch(reminderSyncStatusProvider);
    return [
      if (!prefs.remindersAvailable) ...[
        Container(
          key: const ValueKey('reminders-unavailable'),
          padding: const EdgeInsets.all(BimSpacing.md),
          decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.card)),
          child: const Row(
            children: [
              Peni(pose: PeniPose.think, size: 48),
              SizedBox(width: BimSpacing.md),
              Expanded(
                child: Text(
                  'Les rappels ne sont pas encore en service\u00a0: aucune notification n’est envoyée pour l’instant. '
                  'Tes choix sont enregistrés et s’appliqueront dès leur ouverture.',
                  style: TextStyle(color: BimColors.black, fontSize: 14, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: BimSpacing.lg),
      ],
      Container(
        decoration: border,
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.xs),
        child: SwitchListTile(
          key: const ValueKey('reminders-switch'),
          contentPadding: EdgeInsets.zero,
          secondary: const Icon(Icons.notifications_active_outlined),
          value: prefs.remindersEnabled,
          activeTrackColor: BimColors.red,
          title: const Text('Recevoir les rappels de Peni', style: TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(
            !prefs.remindersEnabled
                ? 'Désactivés : active-les pour que Peni te rappelle tes tâches.'
                : prefs.remindersAvailable
                    ? 'Activés pour toi.'
                    : 'Activés pour toi, dès l’ouverture du service.',
          ),
          onChanged: _saving ? null : (v) => _save((api) => api.setRemindersEnabled(v)),
        ),
      ),
      if (prefs.remindersEnabled && _systemAllowed != null) ...[
        const SizedBox(height: BimSpacing.md),
        Container(
          key: const ValueKey('system-permission'),
          decoration: border,
          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.xs),
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(_systemAllowed! ? Icons.phone_android : Icons.notifications_off_outlined),
            title: const Text('Notifications du téléphone', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(_systemAllowed! ? 'Autorisées pour BIM.' : 'Non autorisées : ton téléphone n’affichera pas les rappels.'),
            trailing: _systemAllowed!
                ? null
                : TextButton(key: const ValueKey('system-permission-request'), onPressed: _askSystemPermission, child: const Text('Autoriser')),
          ),
        ),
      ],
      if (prefs.remindersEnabled && sync?.status == ReminderSyncStatus.scheduled) ...[
        const SizedBox(height: BimSpacing.sm),
        Text(
          sync!.count == 0
              ? 'Aucun rappel à venir sur ce téléphone dans les prochaines 48 h.'
              : '${sync.count} rappel${sync.count > 1 ? 's' : ''} programmé${sync.count > 1 ? 's' : ''} sur ce téléphone pour les prochaines 48 h.',
          key: const ValueKey('reminders-scheduled'),
          style: theme.textTheme.bodySmall?.copyWith(color: BimColors.grey600),
        ),
      ],
      const SizedBox(height: BimSpacing.lg),
      Container(
        decoration: border,
        padding: const EdgeInsets.all(BimSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.bedtime_outlined),
                const SizedBox(width: BimSpacing.md),
                Expanded(child: Text('Heures calmes', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
              ],
            ),
            const SizedBox(height: BimSpacing.sm),
            Text(
              quiet == null ? 'Aucune' : 'De ${quiet.start} à ${quiet.end}',
              key: const ValueKey('quiet-hours-value'),
              style: theme.textTheme.titleLarge,
            ),
            Text(
              prefs.quietHoursArePersonal ? 'Tes heures' : 'Valeur par défaut de BIM',
              style: theme.textTheme.bodySmall?.copyWith(color: BimColors.grey600),
            ),
            const SizedBox(height: BimSpacing.sm),
            Text('Pendant ces heures, Peni ne t’envoie aucun rappel.', style: theme.textTheme.bodyMedium),
            const SizedBox(height: BimSpacing.md),
            Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                OutlinedButton.icon(
                  key: const ValueKey('quiet-hours-edit'),
                  onPressed: _saving ? null : () => _editQuietHours(prefs),
                  icon: const Icon(Icons.schedule),
                  label: const Text('Modifier'),
                ),
                if (prefs.quietHoursArePersonal)
                  TextButton(
                    key: const ValueKey('quiet-hours-reset'),
                    onPressed: _saving ? null : () => _save((api) => api.setQuietHours(null)),
                    child: const Text('Revenir à la valeur par défaut'),
                  ),
              ],
            ),
          ],
        ),
      ),
      if (!Env.isProduction && _notifier.supported) ...[
        const SizedBox(height: BimSpacing.lg),
        Container(
          key: const ValueKey('test-reminder'),
          decoration: border,
          padding: const EdgeInsets.all(BimSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Tests sur téléphone', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: BimSpacing.xs),
              Text(
                'Version de test uniquement : programme une vraie notification sur ce téléphone, comme un rappel, '
                'sans ouvrir le service des rappels.',
                style: theme.textTheme.bodySmall?.copyWith(color: BimColors.grey600),
              ),
              const SizedBox(height: BimSpacing.md),
              Wrap(
                spacing: BimSpacing.sm,
                runSpacing: BimSpacing.sm,
                children: [
                  OutlinedButton(key: const ValueKey('test-reminder-1'), onPressed: () => _scheduleTest(1), child: const Text('Dans 1 minute')),
                  OutlinedButton(key: const ValueKey('test-reminder-15'), onPressed: () => _scheduleTest(15), child: const Text('Dans 15 minutes')),
                  OutlinedButton(key: const ValueKey('test-reminder-texts'), onPressed: _scheduleTextTests, child: const Text('Les 3 textes de Peni')),
                ],
              ),
              if (_testAt != null) ...[
                const SizedBox(height: BimSpacing.sm),
                Text('Rappel d’essai prévu à ${_hhmm(TimeOfDay.fromDateTime(_testAt!))}.', key: const ValueKey('test-reminder-at')),
              ],
            ],
          ),
        ),
      ],
    ];
  }
}
