import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/step_header.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';

final projectReportsProvider = FutureProvider.autoDispose.family<List<ProjectReport>, String>((ref, id) => ref.watch(projectsApiProvider).reports(id));

/// Mes signalements et les réponses de l'équipe BIM.
class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(projectReportsProvider(projectId));
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.lg),
            Text('Mes signalements', style: theme.textTheme.headlineMedium),
            const SizedBox(height: BimSpacing.lg),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [ProjectLoadError(error: e, onRetry: () => ref.invalidate(projectReportsProvider(projectId)))],
              data: (items) => items.isEmpty
                  ? [Text('Aucun signalement pour ce projet.', style: theme.textTheme.bodyMedium)]
                  : [
                      for (final r in items)
                        Card(
                          elevation: 0,
                          margin: const EdgeInsets.only(bottom: BimSpacing.sm),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.card), side: BorderSide(color: theme.colorScheme.outline, width: 1.5)),
                          child: Padding(
                            padding: const EdgeInsets.all(BimSpacing.lg),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(ProjectReport.reasons[r.reason] ?? r.reason, style: theme.textTheme.titleMedium),
                                Text(capitalize(longDay(r.day)), style: theme.textTheme.bodyMedium),
                                if (r.message != null) ...[const SizedBox(height: BimSpacing.xs), Text(r.message!)],
                                const SizedBox(height: BimSpacing.sm),
                                if (r.status == 'resolved')
                                  Container(
                                    padding: const EdgeInsets.all(BimSpacing.md),
                                    decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.chip)),
                                    child: Text('Réponse de l’équipe BIM : ${r.resolution}'),
                                  )
                                else
                                  Text('En cours de traitement', style: theme.textTheme.bodyMedium?.copyWith(color: BimColors.progressAlmost)),
                              ],
                            ),
                          ),
                        ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}
