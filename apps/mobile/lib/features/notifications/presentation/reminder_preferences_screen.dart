import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
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

  NotificationPreferencesApi get _api => ref.read(notificationPreferencesApiProvider);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final prefs = await _api.load();
      if (mounted) setState(() => _prefs = prefs);
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
    } catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
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
                ? 'Coupés : Peni ne t’enverra aucun rappel.'
                : prefs.remindersAvailable
                    ? 'Activés pour toi.'
                    : 'Activés pour toi, dès l’ouverture du service.',
          ),
          onChanged: _saving ? null : (v) => _save((api) => api.setRemindersEnabled(v)),
        ),
      ),
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
    ];
  }
}
