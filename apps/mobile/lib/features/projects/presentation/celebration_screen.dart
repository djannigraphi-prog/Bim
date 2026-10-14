import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../application/projects_providers.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';

/// Écran 30 — Fin du programme. On célèbre ce qui a été fait, sans affirmer un résultat que BIM ne mesure pas
/// (ex. kilos perdus) : la photo « après » et la publication arrivent avec les modules médias et social.
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

class _Body extends StatelessWidget {
  const _Body({required this.project});

  final ProjectDetail project;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = project.summary;
    final finished = s.isCompleted;
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
          finished ? 'Tu es allé·e au bout de « ${s.title} ». Je suis tellement fière de toi ❤️' : 'Voici où tu en es pour « ${s.title} ».',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: BimSpacing.xl),
        Row(
          children: [
            _Tile(value: '${project.completedSteps}', label: 'étapes faites'),
            const SizedBox(width: BimSpacing.sm),
            _Tile(value: '${s.progress} %', label: 'du programme'),
            const SizedBox(width: BimSpacing.sm),
            _Tile(value: '${project.bestStreak}', label: 'jours d’affilée'),
          ],
        ),
        const SizedBox(height: BimSpacing.xxl),
        BimButton(
          label: 'Prendre ma photo « après »',
          icon: Icons.photo_camera_outlined,
          onPressed: () => showComingSoon(context, feature: 'La photo « après » et la comparaison avant / après'),
        ),
        const SizedBox(height: BimSpacing.sm),
        BimButton(
          label: 'Publier « J’ai fait mon BIM »',
          variant: BimButtonVariant.outline,
          onPressed: () => showComingSoon(context, feature: 'La publication « J’ai fait mon BIM »'),
        ),
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
