import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/projects_api.dart';
import '../data/projects_models.dart';

final projectCatalogProvider = FutureProvider<ProjectCatalog>((ref) => ref.watch(projectsApiProvider).catalog());

final myProjectsProvider = FutureProvider.autoDispose<ProjectList>((ref) => ref.watch(projectsApiProvider).list());

final projectDetailProvider = FutureProvider.autoDispose.family<ProjectDetail, String>((ref, id) => ref.watch(projectsApiProvider).detail(id));

final projectDayProvider =
    FutureProvider.autoDispose.family<DayPlan, ({String id, String day})>((ref, k) => ref.watch(projectsApiProvider).day(k.id, k.day));

/// Brouillon du parcours « Nouveau projet » ; remis à zéro après la création.
class ProjectDraftController extends Notifier<ProjectDraft> {
  @override
  ProjectDraft build() => const ProjectDraft();

  void update(ProjectDraft Function(ProjectDraft d) f) => state = f(state);

  void reset() => state = const ProjectDraft();
}

final projectDraftProvider = NotifierProvider<ProjectDraftController, ProjectDraft>(ProjectDraftController.new);

/// Change à chaque modification d'un projet (case cochée, pause, tâche ajoutée…). D'autres fonctions s'y abonnent
/// (rappels programmés sur le téléphone) sans que le module Projets les connaisse.
final projectsRevisionProvider = StateProvider<int>((ref) => 0);

/// Après une action (case cochée, pause…) : rafraîchit la liste et le détail.
void refreshProject(WidgetRef ref, String id) {
  ref
    ..invalidate(myProjectsProvider)
    ..invalidate(projectDetailProvider(id));
  ref.read(projectsRevisionProvider.notifier).state++;
}
