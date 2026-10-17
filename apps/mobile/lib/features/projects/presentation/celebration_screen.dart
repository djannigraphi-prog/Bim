import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../peni/data/peni_api.dart';
import '../application/projects_providers.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';
import 'transformation_screen.dart';

/// Écran 30 — Fin du programme. Les résultats chiffrés viennent uniquement des mesures notées par la personne
/// (« d'après tes mesures ») ; la publication « J'ai fait mon BIM » arrive avec le module social (lot 4).
class CelebrationScreen extends ConsumerWidget {
  const CelebrationScreen({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(projectDetailProvider(projectId));
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ProjectLoadError(error: e, onRetry: () => ref.invalidate(projectDetailProvider(projectId))),
          data: (p) => _Body(project: p),
        ),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.project});

  final ProjectDetail project;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final s = project.summary;
    final finished = s.isCompleted;
    final m = project.measurement;
    final measured = m?.change == null ? null : '${m!.change! > 0 ? '+' : '−'}${frNumber(m.change!.abs())}';
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        const SizedBox(height: BimSpacing.xl),
        Center(child: Peni(pose: finished ? PeniPose.cheer : PeniPose.happy, size: 180)),
        const SizedBox(height: BimSpacing.lg),
        Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(10)),
            child: Text(
              '🏆 ${s.durationDays} jours · ${project.totalSteps} étapes',
              style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700),
            ),
          ),
        ),
        const SizedBox(height: BimSpacing.md),
        Text(finished ? 'Programme terminé !' : 'Ton bilan', textAlign: TextAlign.center, style: theme.textTheme.headlineLarge),
        const SizedBox(height: BimSpacing.sm),
        Text(
          measured != null
              ? 'D’après tes mesures : $measured ${m!.unit}. ${finished ? 'Je suis tellement fière de toi ❤️' : 'Continue comme ça !'}'
              : finished
                  ? (ref.watch(peniMilestonesProvider(s.id)).valueOrNull?.completion?.text ?? 'Tu es allé·e au bout de « ${s.title} ». Je suis tellement fière de toi ❤️')
                  : 'Voici où tu en es pour « ${s.title} ».',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: BimSpacing.xl),
        Row(
          children: [
            if (measured != null) ...[
              _Tile(value: measured, label: m!.unit),
              const SizedBox(width: BimSpacing.sm),
            ],
            _Tile(value: '${project.completedSteps}', label: 'étapes faites'),
            const SizedBox(width: BimSpacing.sm),
            if (measured == null) ...[_Tile(value: '${s.progress} %', label: 'du programme'), const SizedBox(width: BimSpacing.sm)],
            _Tile(value: '${project.bestStreak}', label: 'jours d’affilée'),
          ],
        ),
        if (project.chests.any((c) => c.isOpen)) ...[
          const SizedBox(height: BimSpacing.lg),
          Text('Mes badges', style: theme.textTheme.titleMedium),
          const SizedBox(height: BimSpacing.sm),
          // Coffres ouverts (écran 26) : badges symboliques, sans valeur financière.
          Wrap(
            spacing: BimSpacing.sm,
            runSpacing: BimSpacing.sm,
            children: [
              for (final c in project.chests.where((c) => c.isOpen))
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(10)),
                  child: Text('🏅 ${c.badge}', style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
                ),
            ],
          ),
        ],
        const SizedBox(height: BimSpacing.xxl),
        BimButton(
          label: 'Prendre ma photo « après »',
          icon: Icons.photo_camera_outlined,
          onPressed: () async {
            if (await captureProjectPhoto(context, ref, s.id, 'after') && context.mounted) {
              await context.push('/projects/${s.id}/transformation');
            }
          },
        ),
        const SizedBox(height: BimSpacing.sm),
        BimButton(
          label: 'Publier « J’ai fait mon BIM »',
          variant: BimButtonVariant.outline,
          onPressed: () => context.push('/social/new', extra: s.id),
        ),
        const SizedBox(height: BimSpacing.sm),
        BimButton(label: 'Voir ma transformation', variant: BimButtonVariant.subtle, onPressed: () => context.push('/projects/${s.id}/transformation')),
        const SizedBox(height: BimSpacing.sm),
        BimButton(label: 'Plus tard', variant: BimButtonVariant.subtle, onPressed: () => context.go('/home')),
      ],
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: BimSpacing.md, horizontal: BimSpacing.xs),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Column(
          children: [
            Text(value, style: theme.textTheme.headlineMedium),
            Text(label, textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
