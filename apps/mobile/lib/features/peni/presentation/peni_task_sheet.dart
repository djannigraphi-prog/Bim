import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../data/peni_api.dart';

/// Écran 24 : Peni explique une tâche du programme, dans une feuille qui se ferme pour revenir au programme.
Future<void> showPeniTaskExplanation(BuildContext context, {required String projectId, required String taskId}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => PeniTaskSheet(projectId: projectId, taskId: taskId),
  );
}

/// Questions courtes (« C'est quoi ? », « Quand ? »…) ; la réponse s'affiche sous la question choisie. Textes de l'API.
class PeniTaskSheet extends ConsumerStatefulWidget {
  const PeniTaskSheet({super.key, required this.projectId, required this.taskId});

  final String projectId;
  final String taskId;

  @override
  ConsumerState<PeniTaskSheet> createState() => _PeniTaskSheetState();
}

class _PeniTaskSheetState extends ConsumerState<PeniTaskSheet> {
  PeniTaskExplanation? _explanation;
  Object? _error;
  String _selected = 'what';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final e = await ref.read(peniApiProvider).explainTask(widget.projectId, widget.taskId);
      if (mounted) setState(() => _explanation = e);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final e = _explanation;
    final error = _error;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (error != null) ...[
              Text(error is ApiException ? error.message : ApiException.unknown.message, key: const ValueKey('peni-explain-error')),
              const SizedBox(height: BimSpacing.md),
              BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _load),
            ] else if (e == null)
              const Padding(padding: EdgeInsets.all(BimSpacing.xl), child: Center(child: CircularProgressIndicator()))
            else
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Peni(pose: e.peniPose, size: 56),
                          const SizedBox(width: BimSpacing.md),
                          Expanded(
                            child: Container(
                              padding: const EdgeInsets.all(BimSpacing.md),
                              decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
                              child: Text(e.intro, key: const ValueKey('peni-explain-intro'), style: theme.textTheme.bodyLarge),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: BimSpacing.lg),
                      Wrap(
                        spacing: BimSpacing.sm,
                        runSpacing: BimSpacing.sm,
                        children: [
                          for (final s in e.sections)
                            ChoiceChip(
                              key: ValueKey('peni-explain-q-${s.id}'),
                              label: Text(s.question),
                              selected: s.id == _selected,
                              showCheckmark: false,
                              selectedColor: BimColors.redSoft,
                              labelStyle: TextStyle(color: s.id == _selected ? BimColors.red : theme.colorScheme.onSurface, fontWeight: FontWeight.w600),
                              onSelected: (_) => setState(() => _selected = s.id),
                            ),
                        ],
                      ),
                      const SizedBox(height: BimSpacing.md),
                      for (final s in e.sections.where((s) => s.id == _selected))
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(BimSpacing.lg),
                          decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.card)),
                          child: Text(s.answer, key: const ValueKey('peni-explain-answer'), style: const TextStyle(color: BimColors.black, fontSize: 15)),
                        ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: BimSpacing.lg),
            BimButton(
              key: const ValueKey('peni-explain-close'),
              label: 'Revenir à mon programme',
              variant: BimButtonVariant.dark,
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}
