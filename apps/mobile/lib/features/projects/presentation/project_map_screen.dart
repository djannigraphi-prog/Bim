import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
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

enum _MenuAction { program, mode, measure, photos, reports, pause, resume, delete }

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
        case _MenuAction.mode:
          final choice = await askMode(context, mode: s.mode, budget: project.budget);
          if (choice == null) return;
          await api.update(s.id, mode: choice.mode, budget: choice.budget);
          refreshProject(ref, s.id);
        case _MenuAction.measure:
          final m = project.measurement!;
          final v = await askMeasurement(context, unit: m.unit, last: m.latest);
          if (v == null) return;
          await api.addMeasurement(s.id, v);
          refreshProject(ref, s.id);
          if (context.mounted) showBimSnack(context, 'Mesure enregistrée.');
        case _MenuAction.photos:
          await context.push('/projects/${s.id}/transformation');
        case _MenuAction.reports:
          await context.push('/projects/${s.id}/reports');
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
                  if (!completed) const PopupMenuItem(value: _MenuAction.mode, child: Text('Changer de mode')),
                  if (project.measurement != null)
                    PopupMenuItem(value: _MenuAction.measure, child: Text(project.measurement!.unit == 'kg' ? 'Noter mon poids' : 'Noter une mesure')),
                  const PopupMenuItem(value: _MenuAction.photos, child: Text('Mes photos avant / après')),
                  const PopupMenuItem(value: _MenuAction.reports, child: Text('Mes signalements')),
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
        if (s.nextTask != null && !s.isPaused)
          Container(
            margin: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
            padding: const EdgeInsets.all(BimSpacing.md),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              borderRadius: BorderRadius.circular(BimRadius.card),
              boxShadow: const [BoxShadow(color: Color(0x1A000000), blurRadius: 12, offset: Offset(0, 4))],
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('AUJOURD’HUI · ${s.nextTask!.timeOfDay}', style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w800, fontSize: 12)),
                      Text(s.nextTask!.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    ],
                  ),
                ),
                const Text('On y va ?'),
              ],
            ),
          ),
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
  static const _rowHeight = 136.0;
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
        final peni = isToday && !p.summary.isPaused;
        final chests = p.chests.where((c) => c.day == d.day).toList();
        return LayoutBuilder(
          builder: (context, c) {
            // Colonne de largeur fixe : le centre de chaque rond est connu, ce qui permet de tracer le chemin (maquette 26).
            const slot = 170.0;
            double cx(int k) => (c.maxWidth - slot) / 2 * (1 + offsets[k % offsets.length]) + slot / 2;
            // Centre vertical du rond : la colonne (rond + 4 + libellé ≈ 18) est centrée dans la ligne.
            const cy = _rowHeight / 2 - 11;
            final x = cx(i);
            final r = (isToday ? 84.0 : 68.0) / 2;
            return Stack(
              clipBehavior: Clip.none,
              children: [
                if (i + 1 < p.days.length)
                  Positioned.fill(
                    child: CustomPaint(
                      painter: _DotsPainter(
                        from: Offset(x, cy),
                        fromRadius: r,
                        // Liste inversée : le jour suivant est dessiné au-dessus.
                        to: Offset(cx(i + 1), cy - _rowHeight),
                        toRadius: p.days[i + 1].day == p.today ? 42 : 34,
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                    ),
                  ),
                Positioned(
                  left: x - slot / 2,
                  width: slot,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: _DayNode(
                      day: d,
                      isToday: isToday,
                      icon: p.summary.icon,
                      onTap: tappable ? () => context.push('/projects/${p.summary.id}/day/${d.day}') : null,
                    ),
                  ),
                ),
                if (peni)
                  Positioned(
                    // Peni à côté du rond, du côté où il reste de la place.
                    left: offsets[i % offsets.length] > 0 ? x - r - BimSpacing.md - 64 : x + r + BimSpacing.md,
                    top: cy - 32,
                    child: const Peni(pose: PeniPose.wave, size: 64),
                  ),
                if (chests.isNotEmpty)
                  Builder(
                    builder: (context) {
                      // Coffre(s) de la période qui se termine ce jour-là, du côté libre (Peni occupe l'autre côté aujourd'hui).
                      const size = 46.0;
                      final width = chests.length * size + (chests.length - 1) * 6;
                      final peniLeft = offsets[i % offsets.length] > 0;
                      final left = peni ? !peniLeft : (x - r) > (c.maxWidth - x - r);
                      return Positioned(
                        left: left ? x - r - BimSpacing.sm - width : x + r + BimSpacing.sm,
                        top: cy - size / 2,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            for (final (k, chest) in chests.indexed) ...[
                              if (k > 0) const SizedBox(width: 6),
                              _ChestNode(
                                key: ValueKey('chest-${chest.isFinal ? 'final' : chest.week}'),
                                chest: chest,
                                size: size,
                                onTap: () => showChest(context, chest),
                              ),
                            ],
                          ],
                        ),
                      );
                    },
                  ),
              ],
            );
          },
        );
      },
    );
  }
}

/// Coffre du chemin (écran 26) : jaune s'il est ouvert, gris sinon. Symbolique : un badge et un message de Peni.
class _ChestNode extends StatelessWidget {
  const _ChestNode({super.key, required this.chest, required this.size, required this.onTap});

  final ProjectChest chest;
  final double size;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = chest.isFinal ? 'Coffre final' : 'Coffre de la semaine ${chest.week}';
    final state = switch (chest.state) { 'open' => 'ouvert', 'missed' => 'pas encore obtenu', _ => 'à venir' };
    final art = SvgPicture.asset('assets/gifts/gift_chest_s.svg', width: size * 0.62);
    return Semantics(
      button: true,
      label: '$name, $state',
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: chest.isOpen ? BimColors.progressReached : scheme.surfaceContainerHighest,
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.12), offset: const Offset(0, 3))],
          ),
          child: chest.isOpen
              ? art
              : Opacity(
                  opacity: 0.55,
                  child: ColorFiltered(
                    colorFilter: const ColorFilter.matrix([0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0, 0, 0, 1, 0]),
                    child: art,
                  ),
                ),
        ),
      ),
    );
  }
}

/// Fenêtre d'un coffre : badge et message de Peni, sans reproche. Aucune valeur financière.
Future<void> showChest(BuildContext context, ProjectChest chest) {
  final theme = Theme.of(context);
  final week = 'la semaine ${chest.week}';
  final (PeniPose pose, String title, String message) = switch ((chest.isFinal, chest.state)) {
    (false, 'open') => (PeniPose.cheer, 'Semaine ${chest.week} tenue !', 'Bravo, tu as fait ${chest.done} tâches sur ${chest.due} cette semaine. Je suis tellement fière de toi !'),
    (false, 'missed') => (
        PeniPose.happy,
        'Coffre de $week',
        'Cette semaine a été plus difficile, ce n’est pas grave. Tu peux encore rattraper les jours passés : '
            'il faut ${chest.needed} tâches sur ${chest.due}, tu en as fait ${chest.done}.',
      ),
    (false, _) => (PeniPose.think, 'Coffre de $week', 'Fais au moins ${chest.needed} des ${chest.due} tâches prévues cette semaine pour l’ouvrir. Pour l’instant : ${chest.done}.'),
    (true, 'open') => (PeniPose.cheer, 'Programme terminé !', 'Tu as fait ${chest.done} tâches sur ${chest.due}. Tu peux être fier·ère de toi, moi je le suis !'),
    (true, 'missed') => (
        PeniPose.happy,
        'Coffre final',
        'Il manquait quelques tâches pour l’ouvrir (${chest.done} sur ${chest.due}). Tout ce que tu as accompli compte, et tu peux recommencer quand tu veux.',
      ),
    (true, _) => (
        PeniPose.think,
        'Coffre final',
        'Il s’ouvre le dernier jour si tu as fait au moins ${chest.needed} des ${chest.due} tâches du programme. Pour l’instant : ${chest.done}.',
      ),
  };
  return showModalBottomSheet<void>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, BimSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Peni(pose: pose, size: 88),
            const SizedBox(height: BimSpacing.sm),
            Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.sm),
            Text(message, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
            if (chest.isOpen) ...[
              const SizedBox(height: BimSpacing.md),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(10)),
                child: Text('🏅 Badge « ${chest.badge} »', style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
              ),
            ],
            const SizedBox(height: BimSpacing.md),
            Text(
              'Un coffre est une récompense symbolique : un badge et un message de Peni. Il ne contient ni pièces ni argent.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: BimSpacing.md),
            BimButton(label: 'Continuer', variant: BimButtonVariant.dark, onPressed: () => Navigator.pop(ctx)),
          ],
        ),
      ),
    ),
  );
}

/// Pointillés entre deux jours, sans recouvrir les ronds.
class _DotsPainter extends CustomPainter {
  _DotsPainter({required this.from, required this.fromRadius, required this.to, required this.toRadius, required this.color});

  final Offset from;
  final double fromRadius;
  final Offset to;
  final double toRadius;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final delta = to - from;
    final length = delta.distance;
    if (length == 0) return;
    final dir = delta / length;
    final paint = Paint()..color = color;
    // Le chemin monte vers le jour suivant et arrive donc par le bas, où se trouve son libellé « Jour N » (≈ 22 px).
    for (var t = fromRadius + 10; t < length - toRadius - 28; t += 11) {
      canvas.drawCircle(from + dir * t, 3.5, paint);
    }
  }

  @override
  bool shouldRepaint(_DotsPainter old) => old.from != from || old.to != to || old.color != color;
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
