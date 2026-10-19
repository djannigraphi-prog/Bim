import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../application/projects_providers.dart';
import '../data/projects_models.dart';
import 'project_widgets.dart';

/// Écran 18 — Mes projets. Depuis le lot 4, l'Accueil montre le fil et, en tête, la carte du jour (TodayCard) ou
/// l'invitation à créer un premier projet (ProjectsEmptyState) ; la liste complète reste ici.
class MyProjectsView extends ConsumerWidget {
  const MyProjectsView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myProjectsProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(myProjectsProvider.future),
      child: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorState(error: e, onRetry: () => ref.invalidate(myProjectsProvider)),
        data: (list) => _ProjectsList(list: list),
      ),
    );
  }
}

class _ProjectsList extends StatelessWidget {
  const _ProjectsList({required this.list});

  final ProjectList list;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final active = list.items.where((p) => !p.isCompleted).toList();
    final today = active.where((p) => !p.isPaused).firstOrNull;
    final limitReached = list.maxActive != null && list.activeCount >= list.maxActive!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
      children: [
        Row(
          children: [
            Expanded(child: Text('Mes projets', style: theme.textTheme.headlineMedium)),
            if (list.maxActive != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(10)),
                child: Text(
                  '${list.activeCount} / ${list.maxActive} projets',
                  style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700),
                ),
              ),
          ],
        ),
        const SizedBox(height: BimSpacing.lg),
        if (list.items.isEmpty) const ProjectsEmptyState(),
        if (today != null) ...[
          TodayCard(project: today, today: list.today),
          const SizedBox(height: BimSpacing.lg),
        ],
        for (final p in list.items) ...[
          ProjectCard(
            project: p,
            highlighted: p.id == today?.id,
            onTap: () => context.push(p.isCompleted ? '/projects/${p.id}/done' : '/projects/${p.id}'),
          ),
          const SizedBox(height: BimSpacing.md),
        ],
        if (list.items.isNotEmpty) ...[const SizedBox(height: BimSpacing.sm), const ProgressLegend()],
        const SizedBox(height: BimSpacing.xl),
        if (limitReached)
          Text(
            'Tu as atteint ${list.maxActive} projets en cours. Termine ou supprime un projet pour en créer un nouveau.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium,
          )
        else
          // Maquette 18 : bouton flottant à droite, pas sur toute la largeur.
          Align(alignment: Alignment.centerRight, child: SizedBox(width: 220, child: BimButton(label: 'Nouveau projet', icon: Icons.add, onPressed: () => context.push('/projects/new')))),
      ],
    );
  }
}

/// Carte sombre « Aujourd'hui » (écran 18) : le projet du jour et l'accès direct à la journée.
class TodayCard extends StatelessWidget {
  const TodayCard({super.key, required this.project, required this.today, this.compact = false});

  final ProjectSummary project;
  final String today;
  /// Version courte en tête du fil (le premier Bim reste visible, comme sur la maquette 10).
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final title = project.nextTask == null ? project.title : '${project.nextTask!.title} à ${hourFr(project.nextTask!.timeOfDay)}';
    void open() => context.push('/projects/${project.id}/day/$today');
    if (compact) {
      return Material(
        color: BimColors.black,
        borderRadius: BorderRadius.circular(BimRadius.card),
        child: InkWell(
          key: const ValueKey('today-compact'),
          borderRadius: BorderRadius.circular(BimRadius.card),
          onTap: open,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(BimSpacing.md, BimSpacing.md, BimSpacing.md, BimSpacing.md),
            child: Row(
              children: [
                const Peni(pose: PeniPose.happy, size: 40),
                const SizedBox(width: BimSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Aujourd’hui · Jour ${project.currentDay}', style: const TextStyle(color: BimColors.grey400, fontSize: 12.5)),
                      Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: BimColors.white, fontSize: 15, fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
                const SizedBox(width: BimSpacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(color: BimColors.red, borderRadius: BorderRadius.circular(BimRadius.button)),
                  child: const Text('Ma journée', style: TextStyle(color: BimColors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.all(BimSpacing.lg),
      decoration: BoxDecoration(color: BimColors.black, borderRadius: BorderRadius.circular(BimRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Peni(pose: PeniPose.happy, size: 56),
              const SizedBox(width: BimSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Aujourd’hui · Jour ${project.currentDay}', style: const TextStyle(color: BimColors.grey400, fontSize: 14)),
                    const SizedBox(height: 2),
                    Text(
                      title,
                      style: const TextStyle(color: BimColors.white, fontSize: 18, fontWeight: FontWeight.w700),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      project.nextTask == null
                          ? 'Tout est fait pour aujourd’hui, bravo !'
                          : project.streak > 0
                              ? '${project.title} · ${project.streak} jour${project.streak > 1 ? 's' : ''} d’affilée'
                              : 'N’abandonne pas, on y va ensemble !',
                      style: const TextStyle(color: BimColors.grey400, fontSize: 14),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: BimSpacing.md),
          BimButton(label: 'Voir ma journée', onPressed: open),
        ],
      ),
    );
  }
}

class ProjectsEmptyState extends StatelessWidget {
  const ProjectsEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: BimSpacing.xl),
      child: Column(
        children: [
          const Peni(pose: PeniPose.wave, size: 110),
          const SizedBox(height: BimSpacing.lg),
          Text('Ton premier projet t’attend', style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: BimSpacing.sm),
          Text(
            'Choisis ce que tu veux améliorer, je t’accompagne chaque jour.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException ? (error as ApiException).message : ApiException.unknown.message;
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.xl),
      children: [
        const SizedBox(height: BimSpacing.xxl),
        const Peni(pose: PeniPose.sad, size: 96),
        const SizedBox(height: BimSpacing.lg),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: BimSpacing.lg),
        BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: onRetry),
      ],
    );
  }
}

/// Écran 18 seul (accessible depuis le compte et les notifications plus tard).
class MyProjectsScreen extends StatelessWidget {
  const MyProjectsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: SafeArea(child: MyProjectsView()));
  }
}
