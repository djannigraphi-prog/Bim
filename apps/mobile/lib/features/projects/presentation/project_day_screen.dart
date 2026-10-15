import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/bim_icons.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/projects_providers.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';

/// Écran 27 — Journée du projet : tâches à l'heure, cases à cocher, pause, suppression.
class ProjectDayScreen extends ConsumerStatefulWidget {
  const ProjectDayScreen({super.key, required this.projectId, required this.day});

  final String projectId;
  final String day;

  @override
  ConsumerState<ProjectDayScreen> createState() => _ProjectDayScreenState();
}

class _ProjectDayScreenState extends ConsumerState<ProjectDayScreen> {
  /// Réponse la plus récente du serveur après une case cochée (évite un rechargement complet).
  DayPlan? _local;
  final Set<String> _pending = {};

  ({String id, String day}) get _key => (id: widget.projectId, day: widget.day);

  Future<void> _toggle(ProjectTask t) async {
    if (_pending.contains(t.id)) return;
    setState(() => _pending.add(t.id));
    try {
      final next = await ref.read(projectsApiProvider).setDone(widget.projectId, widget.day, t.id, done: !t.done);
      setState(() => _local = next);
      refreshProject(ref, widget.projectId);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _pending.remove(t.id));
    }
  }

  Future<void> _pause() async {
    final detail = await ref.read(projectDetailProvider(widget.projectId).future);
    if (!mounted) return;
    final days = await askPause(context, title: detail.summary.title, plannedEndDate: detail.summary.plannedEndDate);
    if (days == null) return;
    try {
      await ref.read(projectsApiProvider).pause(widget.projectId, days);
      refreshProject(ref, widget.projectId);
      ref.invalidate(projectDayProvider(_key));
      setState(() => _local = null);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _report(DayPlan plan) async {
    final input = await askReport(context, tasks: plan.tasks);
    if (input == null || !mounted) return;
    try {
      final health = await ref.read(projectsApiProvider).report(widget.projectId, day: widget.day, taskId: input.taskId, reason: input.reason, message: input.message);
      if (!mounted) return;
      if (health) {
        await showHealthAdvice(context);
      } else {
        showBimSnack(context, 'Merci, ton signalement est envoyé à l’équipe BIM.');
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _delete() async {
    final detail = await ref.read(projectDetailProvider(widget.projectId).future);
    if (!mounted || !await confirmAbandon(context, detail.summary.title)) return;
    try {
      await ref.read(projectsApiProvider).abandon(widget.projectId);
      ref.invalidate(myProjectsProvider);
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(projectDayProvider(_key));
    final plan = _local ?? async.valueOrNull;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
              child: Row(
                children: [
                  const BimBackButton(),
                  Expanded(
                    child: Column(
                      children: [
                        Text(plan?.index == null ? 'Pause' : 'Jour ${plan!.index}', style: theme.textTheme.titleLarge),
                        Text(capitalize(longDay(widget.day)), style: theme.textTheme.bodyMedium),
                      ],
                    ),
                  ),
                  const SizedBox(width: kBimMinTouch),
                ],
              ),
            ),
            Expanded(
              child: plan == null
                  ? async.hasError
                      ? ProjectLoadError(error: async.error!, onRetry: () => ref.invalidate(projectDayProvider(_key)))
                      : const Center(child: CircularProgressIndicator())
                  : _DayBody(plan: plan, pending: _pending, onToggle: _toggle),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
              child: Row(
                children: [
                  Expanded(
                    child: _FooterButton(icon: Icons.pause_rounded, label: 'Pause', onTap: plan?.state == 'paused' ? null : _pause),
                  ),
                  const SizedBox(width: BimSpacing.sm),
                  Expanded(
                    child: _FooterButton(icon: Icons.flag_outlined, label: 'Signaler', onTap: plan == null ? null : () => _report(plan)),
                  ),
                  const SizedBox(width: BimSpacing.sm),
                  _FooterButton(icon: Icons.delete_outline, color: BimColors.red, tooltip: 'Supprimer le projet', onTap: _delete),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DayBody extends StatelessWidget {
  const _DayBody({required this.plan, required this.pending, required this.onToggle});

  final DayPlan plan;
  final Set<String> pending;
  final ValueChanged<ProjectTask> onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final done = plan.tasks.where((t) => t.done).length;
    final total = plan.tasks.length;
    final (PeniPose pose, String defaultMessage) = switch (plan.state) {
      'paused' => (PeniPose.sad, 'Ton projet est en pause aujourd’hui. Repose-toi bien, je t’attends !'),
      'rest' => (PeniPose.happy, 'Pas de tâche prévue aujourd’hui : journée de repos.'),
      _ when total > 0 && done == total => (PeniPose.cheer, 'Tout est fait pour aujourd’hui. Bravo, je suis fière de toi !'),
      'upcoming' => (PeniPose.think, 'Cette journée n’a pas encore commencé.'),
      _ => (PeniPose.happy, '$done tâche${done > 1 ? 's' : ''} sur $total faite${done > 1 ? 's' : ''}. On y va ?'),
    };
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        Container(
          padding: const EdgeInsets.all(BimSpacing.md),
          decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.card)),
          child: Row(
            children: [
              Peni(pose: pose, size: 56),
              const SizedBox(width: BimSpacing.md),
              Expanded(
                child: plan.tipText == null
                    ? Text(defaultMessage, style: const TextStyle(color: BimColors.black, fontSize: 15, fontWeight: FontWeight.w600))
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text.rich(
                            TextSpan(children: [
                              const TextSpan(text: 'Habitude du jour : ', style: TextStyle(fontWeight: FontWeight.w800)),
                              TextSpan(text: plan.tipText),
                            ],),
                            style: const TextStyle(color: BimColors.black, fontSize: 15),
                          ),
                          const SizedBox(height: 4),
                          Text('Conseil d’un programme validé par ${plan.tipValidatedBy}', style: const TextStyle(color: BimColors.grey600, fontSize: 12)),
                        ],
                      ),
              ),
            ],
          ),
        ),
        const SizedBox(height: BimSpacing.lg),
        for (final t in plan.tasks)
          _TaskRow(
            task: t,
            editable: plan.editable,
            // Tâche en cours (maquette 27) : la première pas encore faite d'une journée modifiable.
            current: plan.editable && identical(t, plan.tasks.where((x) => !x.done).firstOrNull),
            busy: pending.contains(t.id),
            onToggle: () => onToggle(t),
          ),
        if (plan.tasks.isNotEmpty) ...[
          const SizedBox(height: BimSpacing.sm),
          Row(
            children: [
              Icon(Icons.notifications_none, size: 18, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: BimSpacing.xs),
              Expanded(
                child: Text('Les rappels et l’alarme de Peni arrivent dans une prochaine version.', style: theme.textTheme.bodySmall),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.task, required this.editable, required this.current, required this.busy, required this.onToggle});

  final ProjectTask task;
  final bool editable;
  final bool current;
  final bool busy;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: BimSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 52,
            child: Padding(
              padding: const EdgeInsets.only(top: BimSpacing.lg),
              child: Text(task.timeOfDay, style: TextStyle(fontWeight: FontWeight.w700, color: task.done ? BimColors.success : current ? BimColors.red : scheme.onSurfaceVariant)),
            ),
          ),
          Expanded(
            child: Semantics(
              checked: task.done,
              enabled: editable,
              label: task.title,
              child: InkWell(
                borderRadius: BorderRadius.circular(BimRadius.card),
                onTap: editable && !busy ? onToggle : null,
                child: Container(
                  padding: const EdgeInsets.all(BimSpacing.md),
                  decoration: BoxDecoration(
                    color: current ? BimColors.redSoft.withValues(alpha: 0.5) : null,
                    borderRadius: BorderRadius.circular(BimRadius.card),
                    border: Border.all(color: current ? BimColors.red : scheme.outline, width: 1.5),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.chip)),
                        child: Icon(bimIcon(task.icon)),
                      ),
                      const SizedBox(width: BimSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              task.title,
                              style: theme.textTheme.titleMedium?.copyWith(
                                decoration: task.done ? TextDecoration.lineThrough : null,
                                color: task.done ? scheme.onSurfaceVariant : null,
                              ),
                            ),
                            if (task.detail != null) Text(task.detail!, style: theme.textTheme.bodyMedium),
                          ],
                        ),
                      ),
                      const SizedBox(width: BimSpacing.sm),
                      if (busy)
                        const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2.5))
                      else
                        AnimatedContainer(
                          duration: BimDurations.fast,
                          width: 30,
                          height: 30,
                          decoration: BoxDecoration(
                            color: task.done ? BimColors.red : Colors.transparent,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: editable ? BimColors.red : scheme.outline, width: 2),
                          ),
                          child: task.done ? const Icon(Icons.check_rounded, color: BimColors.white, size: 22) : null,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FooterButton extends StatelessWidget {
  const _FooterButton({required this.icon, this.label, this.tooltip, this.onTap, this.color});

  final IconData icon;
  final String? label;
  final String? tooltip;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fg = onTap == null ? scheme.onSurfaceVariant : (color ?? scheme.onSurface);
    final button = Material(
      color: scheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(BimRadius.button),
      child: InkWell(
        borderRadius: BorderRadius.circular(BimRadius.button),
        onTap: onTap,
        child: SizedBox(
          height: 52,
          width: label == null ? 56 : null,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: fg),
              if (label != null) ...[const SizedBox(width: BimSpacing.sm), Text(label!, style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 16))],
            ],
          ),
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip, child: button);
  }
}
