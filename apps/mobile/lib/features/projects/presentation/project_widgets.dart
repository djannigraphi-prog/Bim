import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_icons.dart';
import '../data/projects_models.dart';

/// Couleur de progression (Q30, écran 18) : rouge = début, orange = presque, jaune = atteint, gris = vide.
Color progressColor(int progress, {bool completed = false}) {
  if (completed || progress >= 100) return BimColors.progressReached;
  if (progress >= 66) return BimColors.progressAlmost;
  return BimColors.progressStart;
}

class ProgressBar extends StatelessWidget {
  const ProgressBar({super.key, required this.progress, this.completed = false, this.height = 10});

  final int progress;
  final bool completed;
  final double height;

  @override
  Widget build(BuildContext context) {
    final value = completed ? 1.0 : (progress.clamp(0, 100) / 100);
    return Semantics(
      label: 'Progression $progress %',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(height),
        child: LinearProgressIndicator(
          value: value,
          minHeight: height,
          backgroundColor: BimColors.progressEmpty,
          color: progressColor(progress, completed: completed),
        ),
      ),
    );
  }
}

/// Icône carrée d'une catégorie (écrans 18 et 20).
class CategoryIcon extends StatelessWidget {
  const CategoryIcon({super.key, required this.icon, this.size = 48, this.background});

  final String icon;
  final double size;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: background ?? scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.chip)),
      child: Icon(bimIcon(icon), size: size * 0.5, color: scheme.onSurface),
    );
  }
}

/// Carte d'un projet (écran 18).
class ProjectCard extends StatelessWidget {
  const ProjectCard({super.key, required this.project, required this.onTap, this.highlighted = false});

  final ProjectSummary project;
  final VoidCallback onTap;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final p = project;
    final footer = p.isCompleted
        ? 'Programme terminé · bravo !'
        : p.isPaused
            ? 'En pause'
            : 'Jour ${p.currentDay} sur ${p.durationDays}';
    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(BimRadius.card),
      child: InkWell(
        borderRadius: BorderRadius.circular(BimRadius.card),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(BimSpacing.lg),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(BimRadius.card),
            border: Border.all(color: highlighted ? scheme.onSurface : scheme.outline, width: highlighted ? 2 : 1.5),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CategoryIcon(icon: p.icon),
                  const SizedBox(width: BimSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.title, style: theme.textTheme.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                        Text('${p.categoryLabel} · ${p.modeLabel}', style: theme.textTheme.bodyMedium),
                      ],
                    ),
                  ),
                  const SizedBox(width: BimSpacing.sm),
                  Text('${p.isCompleted ? 100 : p.progress}%', style: theme.textTheme.titleLarge),
                ],
              ),
              const SizedBox(height: BimSpacing.md),
              ProgressBar(progress: p.progress, completed: p.isCompleted),
              const SizedBox(height: BimSpacing.sm),
              Row(
                children: [
                  Expanded(child: Text(footer, style: theme.textTheme.bodyMedium)),
                  Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Légende des couleurs de progression (écran 18).
class ProgressLegend extends StatelessWidget {
  const ProgressLegend({super.key});

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    Widget item(Color c, String label) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3))),
            const SizedBox(width: 4),
            Text(label, style: style),
          ],
        );
    return Wrap(
      spacing: BimSpacing.md,
      runSpacing: BimSpacing.xs,
      children: [
        item(BimColors.progressStart, 'Début'),
        item(BimColors.progressAlmost, 'Presque'),
        item(BimColors.progressReached, 'Atteint'),
        item(BimColors.progressEmpty, 'Vide'),
      ],
    );
  }
}

/// Puce sélectionnable (écrans 21 et 23).
class ChoiceChipBim extends StatelessWidget {
  const ChoiceChipBim({super.key, required this.label, required this.selected, required this.onTap, this.icon});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BimRadius.chip),
        child: AnimatedContainer(
          duration: BimDurations.fast,
          constraints: const BoxConstraints(minHeight: kBimMinTouch),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? BimColors.red : scheme.surface,
            borderRadius: BorderRadius.circular(BimRadius.chip),
            border: Border.all(color: selected ? BimColors.red : scheme.outline, width: 1.5),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 18, color: selected ? BimColors.white : scheme.onSurface), const SizedBox(width: 6)],
              Text(
                label,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: selected ? BimColors.white : scheme.onSurface),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
