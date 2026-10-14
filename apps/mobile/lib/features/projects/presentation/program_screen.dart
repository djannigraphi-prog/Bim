import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_icons.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/projects_providers.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';

/// Écran 24 — « Ton programme ». Redessiné selon F4 : aucun paiement dans le projet ; le bouton lance le programme.
class ProgramScreen extends ConsumerWidget {
  const ProgramScreen({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(projectDetailProvider(projectId));
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ProjectLoadError(error: e, onRetry: () => ref.invalidate(projectDetailProvider(projectId))),
          data: (p) => _Program(project: p),
        ),
      ),
    );
  }
}

class _Program extends ConsumerWidget {
  const _Program({required this.project});

  final ProjectDetail project;

  Future<void> _run(BuildContext context, WidgetRef ref, Future<void> Function(ProjectsApi api) action) async {
    try {
      await action(ref.read(projectsApiProvider));
      refreshProject(ref, project.summary.id);
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final p = project;
    final s = p.summary;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
          child: Row(
            children: [
              BimBackButton(onPressed: () => context.go('/home')),
              Expanded(child: Text('Ton programme', textAlign: TextAlign.center, style: theme.textTheme.titleLarge)),
              IconButton(
                tooltip: 'Renommer le projet',
                icon: const Icon(Icons.edit_outlined),
                onPressed: () async {
                  final title = await askProjectTitle(context, s.title);
                  if (title != null && context.mounted) await _run(context, ref, (api) => api.update(s.id, title: title));
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Peni(pose: PeniPose.cheer, size: 84),
                  const SizedBox(width: BimSpacing.md),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(BimSpacing.md),
                      decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(BimRadius.card)),
                      child: Text.rich(
                        TextSpan(
                          children: [
                            const TextSpan(text: 'Ton programme est prêt ! ', style: TextStyle(fontWeight: FontWeight.w800)),
                            TextSpan(text: '${s.durationDays} jours pour « ${s.title} ». Je serai là chaque jour.'),
                          ],
                        ),
                        style: const TextStyle(color: BimColors.black, fontSize: 15),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: BimSpacing.lg),
              Row(
                children: [
                  _Stat(value: '${s.durationDays} j', label: 'Durée'),
                  const SizedBox(width: BimSpacing.sm),
                  _Stat(value: '${p.totalSteps}', label: 'Étapes'),
                  const SizedBox(width: BimSpacing.sm),
                  _Stat(value: '${p.perWeek}×', label: 'Par semaine'),
                ],
              ),
              const SizedBox(height: BimSpacing.xl),
              Row(
                children: [
                  Expanded(child: Text('Tes tâches', style: theme.textTheme.titleLarge)),
                  TextButton.icon(
                    onPressed: () async {
                      final t = await askNewTask(context);
                      if (t != null && context.mounted) {
                        await _run(context, ref, (api) => api.addTask(s.id, title: t.title, detail: t.detail, timeOfDay: t.time, weekdays: t.weekdays));
                      }
                    },
                    icon: const Icon(Icons.add),
                    label: const Text('Ajouter'),
                    style: TextButton.styleFrom(foregroundColor: BimColors.red),
                  ),
                ],
              ),
              if (p.programSource == 'template' && p.validatedBy != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: BimSpacing.sm),
                  child: Row(
                    children: [
                      const Icon(Icons.verified_outlined, size: 18, color: BimColors.success),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Programme type BIM « ${p.programTitle} », validé par ${p.validatedBy}.',
                          style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                      ),
                    ],
                  ),
                ),
              if (p.programSource == 'answers')
                Padding(
                  padding: const EdgeInsets.only(bottom: BimSpacing.sm),
                  child: Text(
                    'Construit à partir de tes réponses. Les programmes types de l’équipe BIM arrivent bientôt pour cette catégorie.',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
              for (final t in p.tasks)
                Card(
                  margin: const EdgeInsets.only(bottom: BimSpacing.sm),
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.card), side: BorderSide(color: scheme.outline, width: 1.5)),
                  child: ListTile(
                    leading: Icon(bimIcon(t.icon)),
                    title: Text(t.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${t.timeOfDay} · ${t.weekdaysLabel}${t.detail == null ? '' : '\n${t.detail}'}'),
                    isThreeLine: t.detail != null,
                    trailing: p.tasks.length > 1
                        ? IconButton(
                            tooltip: 'Retirer cette tâche',
                            icon: const Icon(Icons.remove_circle_outline),
                            onPressed: () => _run(context, ref, (api) => api.removeTask(s.id, t.id)),
                          )
                        : null,
                  ),
                ),
              if (s.mode == 'premium') ...[
                const SizedBox(height: BimSpacing.lg),
                Text('Recommandé pour toi', style: theme.textTheme.titleLarge),
                const SizedBox(height: BimSpacing.sm),
                Container(
                  padding: const EdgeInsets.all(BimSpacing.lg),
                  decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
                  child: Text(
                    'Les salles, coachs, soins et produits recommandés par des marchands vérifiés arriveront avec le BimShop. '
                    'Les achats se feront sur le BimShop, jamais dans ton projet.',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
              const SizedBox(height: BimSpacing.lg),
              Container(
                decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
                padding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.xs),
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  secondary: const Icon(Icons.public),
                  value: s.isPublic,
                  activeTrackColor: BimColors.red,
                  title: const Text('Projet public', style: TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: const Text('Tes amis pourront t’encourager quand le fil d’actualité sera ouvert.'),
                  onChanged: (v) => _run(context, ref, (api) => api.update(s.id, isPublic: v)),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
          child: BimButton(label: 'Lancer mon programme', onPressed: () => context.go('/projects/${s.id}')),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: BimSpacing.md),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Column(
          children: [
            Text(value, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            Text(label, style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
