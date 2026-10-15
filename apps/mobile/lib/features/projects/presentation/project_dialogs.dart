import 'package:flutter/material.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../data/projects_models.dart';
import 'project_widgets.dart';

class ProjectLoadError extends StatelessWidget {
  const ProjectLoadError({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(BimSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Peni(pose: PeniPose.sad, size: 96),
            const SizedBox(height: BimSpacing.lg),
            Text(error is ApiException ? (error as ApiException).message : ApiException.unknown.message, textAlign: TextAlign.center),
            const SizedBox(height: BimSpacing.lg),
            BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: onRetry),
          ],
        ),
      ),
    );
  }
}

Future<String?> askProjectTitle(BuildContext context, String current) async {
  final controller = TextEditingController(text: current);
  final result = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Nom du projet'),
      content: TextField(controller: controller, maxLength: 80, autofocus: true),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
        TextButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Enregistrer')),
      ],
    ),
  );
  controller.dispose();
  return (result == null || result.length < 2) ? null : result;
}

typedef NewTask = ({String title, String? detail, String time, int weekdays});

/// Ajout d'une tâche au programme : titre, précision, heure, jours.
Future<NewTask?> askNewTask(BuildContext context) {
  return showModalBottomSheet<NewTask>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => const _NewTaskSheet(),
  );
}

class _NewTaskSheet extends StatefulWidget {
  const _NewTaskSheet();

  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  final _title = TextEditingController();
  final _detail = TextEditingController();
  TimeOfDay _time = const TimeOfDay(hour: 7, minute: 0);
  int _weekdays = 127;
  static const _labels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  static const _names = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

  @override
  void dispose() {
    _title.dispose();
    _detail.dispose();
    super.dispose();
  }

  String get _hhmm => '${_time.hour.toString().padLeft(2, '0')}:${_time.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, MediaQuery.viewInsetsOf(context).bottom + BimSpacing.lg),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Nouvelle tâche', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.md),
            TextField(controller: _title, maxLength: 80, decoration: const InputDecoration(hintText: 'Ex. : Étirements', counterText: '')),
            const SizedBox(height: BimSpacing.sm),
            TextField(controller: _detail, maxLength: 200, decoration: const InputDecoration(hintText: 'Précision (facultatif)', counterText: '')),
            const SizedBox(height: BimSpacing.md),
            OutlinedButton.icon(
              onPressed: () async {
                final t = await showTimePicker(context: context, initialTime: _time);
                if (t != null) setState(() => _time = t);
              },
              icon: const Icon(Icons.schedule),
              label: Text('Heure : $_hhmm'),
            ),
            const SizedBox(height: BimSpacing.md),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (var i = 0; i < 7; i++)
                  Semantics(
                    label: _names[i],
                    child: ChoiceChipBim(
                      label: _labels[i],
                      selected: _weekdays & (1 << i) != 0,
                      onTap: () => setState(() {
                        final next = _weekdays ^ (1 << i);
                        if (next != 0) _weekdays = next;
                      }),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: BimSpacing.lg),
            BimButton(
              label: 'Ajouter',
              onPressed: () {
                if (_title.text.trim().length < 2) return;
                Navigator.pop<NewTask>(context, (title: _title.text.trim(), detail: _detail.text.trim(), time: _hhmm, weekdays: _weekdays));
              },
            ),
          ],
        ),
      ),
    );
  }
}

Future<bool> confirmAbandon(BuildContext context, String title) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Supprimer « $title » ?'),
      content: const Text('Le projet disparaîtra de ta liste. Tu pourras en créer un nouveau à tout moment.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Garder')),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          style: TextButton.styleFrom(foregroundColor: BimColors.red),
          child: const Text('Supprimer'),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Écran 29 — Mettre en pause : avertissement général (C8, décidé le 15/10), durée, nouvelle fin prévue.
/// Informe des conséquences sans culpabiliser. Renvoie le nombre de jours, ou null si la personne continue.
Future<int?> askPause(BuildContext context, {required String title, required String plannedEndDate}) {
  return showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => _PauseSheet(title: title, plannedEndDate: plannedEndDate),
  );
}

class _PauseSheet extends StatefulWidget {
  const _PauseSheet({required this.title, required this.plannedEndDate});

  final String title;
  final String plannedEndDate;

  @override
  State<_PauseSheet> createState() => _PauseSheetState();
}

class _PauseSheetState extends State<_PauseSheet> {
  int _days = 3;
  bool _custom = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const presets = [(1, '1 jour'), (3, '3 jours'), (7, '1 semaine')];
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, BimSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Center(child: Peni(pose: PeniPose.think, size: 88)),
            const SizedBox(height: BimSpacing.md),
            Text('Mettre ton programme en pause\u00A0?', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
            Text('«\u00A0${widget.title}\u00A0»', textAlign: TextAlign.center, style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: BimSpacing.md),
            Container(
              padding: const EdgeInsets.all(BimSpacing.md),
              decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.info_outline, color: BimColors.progressAlmost),
                  const SizedBox(width: BimSpacing.sm),
                  Expanded(
                    child: Text.rich(
                      const TextSpan(children: [
                        TextSpan(text: 'Attention : ', style: TextStyle(fontWeight: FontWeight.w800)),
                        TextSpan(
                          text: 'faire une pause peut ralentir l’atteinte de ton objectif. Pendant la pause, ton programme est suspendu '
                              'et sa date de fin est décalée d’autant. Tes progrès et les tâches déjà accomplies sont conservés.',
                        ),
                      ],),
                      style: const TextStyle(color: BimColors.black, fontSize: 15),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: BimSpacing.lg),
            Text('Durée de la pause', style: theme.textTheme.titleMedium),
            const SizedBox(height: BimSpacing.sm),
            Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                for (final (n, label) in presets)
                  ChoiceChipBim(label: label, selected: !_custom && _days == n, onTap: () => setState(() {
                    _custom = false;
                    _days = n;
                  }),
                ),
                ChoiceChipBim(label: _custom ? '$_days jours' : 'Autre', selected: _custom, onTap: () => setState(() => _custom = true)),
              ],
            ),
            if (_custom)
              Slider(
                value: _days.toDouble(),
                min: 1,
                max: 30,
                divisions: 29,
                label: '$_days jours',
                activeColor: BimColors.red,
                onChanged: (v) => setState(() => _days = v.round()),
              ),
            const SizedBox(height: BimSpacing.sm),
            Row(
              children: [
                const Icon(Icons.sync, size: 20),
                const SizedBox(width: BimSpacing.sm),
                Expanded(
                  child: Text(
                    'Ton programme sera réajusté : fin prévue le ${shortDay(addDaysTo(widget.plannedEndDate, _days))} '
                    'au lieu du ${shortDay(widget.plannedEndDate)}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: BimSpacing.lg),
            BimButton(label: 'Continuer mon programme', variant: BimButtonVariant.dark, onPressed: () => Navigator.pop(context)),
            const SizedBox(height: BimSpacing.sm),
            BimButton(label: 'Mettre en pause', variant: BimButtonVariant.outline, onPressed: () => Navigator.pop(context, _days)),
          ],
        ),
      ),
    );
  }
}

/// Changer le mode du projet (écran 19 : « Tu pourras changer de mode plus tard »). Gratuit, sans lien avec l'abonnement (C6).
Future<({String mode, String? budget})?> askMode(BuildContext context, {required String mode, String? budget}) {
  return showModalBottomSheet<({String mode, String? budget})>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => _ModeSheet(mode: mode, budget: budget),
  );
}

class _ModeSheet extends StatefulWidget {
  const _ModeSheet({required this.mode, this.budget});

  final String mode;
  final String? budget;

  @override
  State<_ModeSheet> createState() => _ModeSheetState();
}

class _ModeSheetState extends State<_ModeSheet> {
  late String _mode = widget.mode;
  late String? _budget = widget.budget;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const budgets = [('small', 'Petit'), ('medium', 'Moyen'), ('boosted', 'Boosté')];
    final valid = _mode == 'eco' || _budget != null;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, BimSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Mode du projet', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.md),
            Wrap(
              spacing: BimSpacing.sm,
              children: [
                ChoiceChipBim(label: 'Économique', selected: _mode == 'eco', onTap: () => setState(() => _mode = 'eco')),
                ChoiceChipBim(label: 'Premium', selected: _mode == 'premium', onTap: () => setState(() => _mode = 'premium')),
              ],
            ),
            if (_mode == 'premium') ...[
              const SizedBox(height: BimSpacing.md),
              Text('Budget indicatif', style: theme.textTheme.titleMedium),
              const SizedBox(height: BimSpacing.sm),
              Wrap(
                spacing: BimSpacing.sm,
                children: [
                  for (final (code, label) in budgets)
                    ChoiceChipBim(label: label, selected: _budget == code, onTap: () => setState(() => _budget = code)),
                ],
              ),
            ],
            const SizedBox(height: BimSpacing.md),
            const ModeIsFreeNote(),
            const SizedBox(height: BimSpacing.lg),
            BimButton(
              label: 'Enregistrer',
              variant: BimButtonVariant.dark,
              onPressed: valid ? () => Navigator.pop(context, (mode: _mode, budget: _mode == 'premium' ? _budget : null)) : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// Noter une mesure (ex. poids en kg). Renvoie la valeur saisie.
Future<double?> askMeasurement(BuildContext context, {required String unit, double? last}) async {
  final controller = TextEditingController(text: last == null ? '' : frNumber(last));
  final result = await showDialog<double>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(unit == 'kg' ? 'Ton poids aujourd’hui' : 'Ta mesure aujourd’hui'),
      content: TextField(
        key: const Key('measurement-field'),
        controller: controller,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(suffixText: unit, helperText: 'Privé · une décimale au plus'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
        TextButton(
          onPressed: () {
            final v = double.tryParse(controller.text.trim().replaceAll(',', '.'));
            if (v != null && v > 0) Navigator.pop(ctx, (v * 10).round() / 10);
          },
          child: const Text('Enregistrer'),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}

// Signalement : voir report_sheet.dart (formulaire commun aux écrans 21 et 27).

/// Conseil affiché après un signalement « douleur ou malaise » : BIM ne donne pas d'avis médical.
Future<void> showHealthAdvice(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.health_and_safety_outlined, color: BimColors.red),
      title: const Text('Prends soin de toi'),
      content: const Text(
        'Arrête l’exercice si tu as mal. BIM ne donne pas d’avis médical : en cas de douleur, de malaise ou de doute, '
        'demande conseil à un professionnel de santé. Tu peux mettre ton projet en pause.\n\nEn cas d’urgence, appelle le 185 (urgences médicales) ou le 180 (pompiers).',
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('J’ai compris'))],
    ),
  );
}
