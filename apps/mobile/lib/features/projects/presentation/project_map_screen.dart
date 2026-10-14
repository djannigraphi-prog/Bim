import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_icons.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/projects_providers.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';
import 'project_widgets.dart';

/// Écran 26 — Carte du projet : un chemin de jours (le premier en bas), l'étape du jour mise en avant.
class ProjectMapScreen extends ConsumerWidget {
  const ProjectMapScreen({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(projectDetailProvider(projectId));
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ProjectLoadError(error: e, onRetry: () => ref.invalidate(projectDetailProvider(projectId))),
          data: (p) => _Map(project: p),
        ),
      ),
    );
  }
}

enum _MenuAction { program, pause, resume, delete }

class _Map extends ConsumerWidget {
  const _Map({required this.project});

  final ProjectDetail project;

  Future<void> _onMenu(BuildContext context, WidgetRef ref, _MenuAction a) async {
    final s = project.summary;
    final api = ref.read(projectsApiProvider);
    try {
      switch (a) {
        case _MenuAction.program:
          await context.push('/projects/${s.id}/program');
        case _MenuAction.pause:
          final days = await askPause(context, title: s.title, plannedEndDate: s.plannedEndDate);
          if (days == null) return;
          await api.pause(s.id, days);
          refreshProject(ref, s.id);
        case _MenuAction.resume:
          await api.resume(s.id);
          refreshProject(ref, s.id);
        case _MenuAction.delete:
          if (!await confirmAbandon(context, s.title)) return;
          await api.abandon(s.id);
          ref.invalidate(myProjectsProvider);
          if (context.mounted) context.go('/home');
      }
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final s = project.summary;
    final todayDay = project.days.where((d) => d.day == project.today).firstOrNull;
    final completed = s.isCompleted;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.sm, 0),
          child: Row(
            children: [
              BimBackButton(onPressed: () => context.canPop() ? context.pop() : context.go('/home')),
              Expanded(
                child: Column(
                  children: [
                    Text(s.title, style: theme.textTheme.titleLarge, textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(
                      '${s.categoryLabel} · ${s.mode == 'premium' ? 'Premium' : 'Éco'} · '
                      '${s.isPaused ? 'En pause' : 'Jour ${s.currentDay} / ${s.durationDays}'}',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              PopupMenuButton<_MenuAction>(
                tooltip: 'Plus d’options',
                icon: const Icon(Icons.more_horiz),
                onSelected: (a) => _onMenu(context, ref, a),
                itemBuilder: (_) => [
                  const PopupMenuItem(value: _MenuAction.program, child: Text('Mon programme')),
                  if (s.status == 'active') const PopupMenuItem(value: _MenuAction.pause, child: Text('Mettre en pause')),
                  if (s.isPaused) const PopupMenuItem(value: _MenuAction.resume, child: Text('Reprendre maintenant')),
                  const PopupMenuItem(value: _MenuAction.delete, child: Text('Supprimer le projet')),
                ],
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen, vertical: BimSpacing.sm),
          child: Row(
            children: [
              Expanded(child: ProgressBar(progress: s.progress, completed: completed)),
              const SizedBox(width: BimSpacing.md),
              Text('${s.progress} %', style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(width: BimSpacing.sm),
              Semantics(
                label: 'Série : ${s.streak} jours',
                child: Row(
                  children: [
                    const Icon(Icons.local_fire_department, color: BimColors.progressAlmost, size: 20),
                    Text('${s.streak}', style: const TextStyle(color: BimColors.progressAlmost, fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (s.isPaused)
          _Banner(text: 'Projet en pause jusqu’au ${shortDay(s.pausedUntil!)} inclus. Fin prévue le ${shortDay(s.plannedEndDate)}.'),
        Expanded(child: _Path(project: project)),
        Padding(
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
          child: completed
              ? BimButton(label: 'Voir mon bilan', icon: Icons.emoji_events_outlined, onPressed: () => context.push('/projects/${s.id}/done'))
              : BimButton(
                  label: 'Voir l’étape du jour',
                  icon: Icons.play_arrow_rounded,
                  onPressed: todayDay == null ? null : () => context.push('/projects/${s.id}/day/${project.today}'),
                ),
        ),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
      padding: const EdgeInsets.all(BimSpacing.md),
      decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
      child: Row(
        children: [
          const Icon(Icons.pause_circle_outline, color: BimColors.black),
          const SizedBox(width: BimSpacing.sm),
          Expanded(child: Text(text, style: const TextStyle(color: BimColors.black))),
        ],
      ),
    );
  }
}

/// Chemin des jours, en zigzag, du jour 1 (en bas) au dernier jour (en haut).
class _Path extends StatefulWidget {
  const _Path({required this.project});

  final ProjectDetail project;

  @override
  State<_Path> createState() => _PathState();
}

class _PathState extends State<_Path> {
  static const _rowHeight = 112.0;
  late final ScrollController _scroll;

  @override
  void initState() {
    super.initState();
    final days = widget.project.days;
    final todayIndex = days.indexWhere((d) => d.day == widget.project.today);
    // Liste inversée : le jour du jour est placé vers le bas de l'écran.
    _scroll = ScrollController(initialScrollOffset: todayIndex <= 1 ? 0 : (todayIndex - 1) * _rowHeight);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.project;
    const offsets = [0.0, 0.45, 0.7, 0.45, 0.0, -0.45, -0.7, -0.45];
    return ListView.builder(
      controller: _scroll,
      reverse: true,
      padding: const EdgeInsets.symmetric(vertical: BimSpacing.xl),
      itemCount: p.days.length,
      itemExtent: _rowHeight,
      itemBuilder: (context, i) {
        final d = p.days[i];
        final isToday = d.day == p.today;
        final tappable = d.state != 'upcoming' && d.state != 'paused' && d.day.compareTo(p.today) <= 0;
        return Align(
          alignment: Alignment(offsets[i % offsets.length], 0),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _DayNode(
                day: d,
                isToday: isToday,
                icon: p.summary.icon,
                onTap: tappable ? () => context.push('/projects/${p.summary.id}/day/${d.day}') : null,
              ),
              if (isToday && !p.summary.isPaused) ...[const SizedBox(width: BimSpacing.md), const Peni(pose: PeniPose.wave, size: 64)],
            ],
          ),
        );
      },
    );
  }
}

class _DayNode extends StatelessWidget {
  const _DayNode({required this.day, required this.isToday, required this.icon, this.onTap});

  final ProjectDay day;
  final bool isToday;
  final String icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (Color bg, Widget child, String state) = switch (day.state) {
      'done' => (BimColors.red, const Icon(Icons.check_rounded, color: BimColors.white, size: 36), 'terminé'),
      'partial' => (BimColors.progressAlmost, Text('${day.done}/${day.due}', style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w800)), 'commencé'),
      'missed' => (scheme.surfaceContainerHighest, Icon(Icons.close_rounded, color: scheme.onSurfaceVariant, size: 30), 'manqué'),
      'today' => (BimColors.red, Icon(bimIcon(icon), color: BimColors.white, size: 32), 'aujourd’hui'),
      'rest' => (scheme.surfaceContainerLow, Icon(Icons.bedtime_outlined, color: scheme.onSurfaceVariant), 'repos'),
      'paused' => (scheme.surfaceContainerLow, Icon(Icons.pause_rounded, color: scheme.onSurfaceVariant), 'en pause'),
      _ => (scheme.surfaceContainerHighest, Icon(Icons.lock_outline_rounded, color: scheme.onSurfaceVariant), 'à venir'),
    };
    final size = isToday ? 84.0 : 68.0;
    final label = day.index == null ? 'Pause' : 'Jour ${day.index}';
    return Semantics(
      button: onTap != null,
      label: '$label, $state',
      child: GestureDetector(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                color: bg,
                shape: BoxShape.circle,
                border: isToday ? Border.all(color: BimColors.redSoft, width: 6) : null,
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.12), offset: const Offset(0, 4))],
              ),
              alignment: Alignment.center,
              child: child,
            ),
            const SizedBox(height: 4),
            Text(isToday ? '$label · aujourd’hui' : label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
