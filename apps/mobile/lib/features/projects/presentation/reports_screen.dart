import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/step_header.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';
import 'report_sheet.dart';

/// Signalements d'un projet (clé « p: » suivie de l'identifiant) ou tous (clé « all »).
final projectReportsProvider = FutureProvider.autoDispose.family<List<ProjectReport>, String>(
  (ref, key) => ref.watch(projectsApiProvider).reports(projectId: key == 'all' ? null : key.substring(2)),
);

/// Mes signalements, leur statut et les réponses de l'équipe BIM. Sans [projectId] : tous mes signalements.
class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key, this.projectId});

  final String? projectId;

  String get _key => projectId == null ? 'all' : 'p:$projectId';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(projectReportsProvider(_key));
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => ref.refresh(projectReportsProvider(_key).future),
          child: ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
              const SizedBox(height: BimSpacing.lg),
              Text('Mes signalements', style: theme.textTheme.headlineMedium),
              if (projectId == null) ...[
                const SizedBox(height: BimSpacing.sm),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      await reportProblem(context);
                      if (context.mounted) ref.invalidate(projectReportsProvider(_key));
                    },
                    icon: const Icon(Icons.support_outlined),
                    label: const Text('Signaler un nouveau problème'),
                  ),
                ),
              ],
              const SizedBox(height: BimSpacing.lg),
              ...async.when(
                loading: () => [const Center(child: CircularProgressIndicator())],
                error: (e, _) => [ProjectLoadError(error: e, onRetry: () => ref.invalidate(projectReportsProvider(_key)))],
                data: (items) => items.isEmpty
                    ? [Text(projectId == null ? 'Aucun signalement pour l’instant.' : 'Aucun signalement pour ce projet.', style: theme.textTheme.bodyMedium)]
                    : [for (final r in items) _ReportCard(report: r)],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report});

  final ProjectReport report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final r = report;
    final when = r.day != null ? capitalize(longDay(r.day!)) : (r.createdAt == null ? '' : capitalize(longDay(r.createdAt!.toIso8601String().substring(0, 10))));
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: BimSpacing.sm),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.card), side: BorderSide(color: theme.colorScheme.outline, width: 1.5)),
      child: Padding(
        padding: const EdgeInsets.all(BimSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(ProjectReport.label(r.reason), style: theme.textTheme.titleMedium),
            Text('${r.isGeneral ? 'Problème général' : (r.projectTitle ?? 'Projet')} · $when', style: theme.textTheme.bodyMedium),
            if (r.message != null) ...[const SizedBox(height: BimSpacing.xs), Text(r.message!)],
            if (r.imageUrl != null) ...[
              const SizedBox(height: BimSpacing.sm),
              GestureDetector(
                onTap: () => _showImage(context, r.imageUrl!),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(BimRadius.chip),
                  child: Image.network(
                    r.imageUrl!,
                    height: 120,
                    fit: BoxFit.cover,
                    semanticLabel: 'Image jointe au signalement',
                    errorBuilder: (_, __, ___) => const SizedBox(height: 48, child: Center(child: Icon(Icons.broken_image_outlined))),
                  ),
                ),
              ),
            ],
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
    );
  }

  void _showImage(BuildContext context, String url) {
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(BimSpacing.md),
        child: Stack(
          children: [
            InteractiveViewer(child: Image.network(url, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Padding(padding: EdgeInsets.all(32), child: Icon(Icons.broken_image_outlined)))),
            Positioned(right: 4, top: 4, child: IconButton.filledTonal(tooltip: 'Fermer', onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.close))),
          ],
        ),
      ),
    );
  }
}
