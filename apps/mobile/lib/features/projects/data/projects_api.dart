import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'projects_models.dart';

/// Appels HTTP des projets (lot 1). Aucune règle métier ici.
class ProjectsApi {
  ProjectsApi(this._api);
  final ApiClient _api;

  Future<ProjectCatalog> catalog() async => ProjectCatalog.fromJson(await _api.get('/v1/projects/catalog'));

  Future<ProjectList> list() async => ProjectList.fromJson(await _api.get('/v1/projects'));

  Future<ProjectDetail> create(ProjectDraft draft) async => ProjectDetail.fromJson(await _api.post('/v1/projects', body: draft.toJson()));

  Future<ProjectDetail> detail(String id) async => ProjectDetail.fromJson(await _api.get('/v1/projects/$id'));

  Future<ProjectDetail> update(String id, {String? title, bool? isPublic, String? mode, String? budget}) async => ProjectDetail.fromJson(
        await _api.patch('/v1/projects/$id', body: {
          if (title != null) 'title': title,
          if (isPublic != null) 'isPublic': isPublic,
          if (mode != null) 'mode': mode,
          if (budget != null) 'budget': budget,
        },),
      );

  Future<void> abandon(String id) => _api.delete('/v1/projects/$id');

  Future<DayPlan> day(String id, String day) async => DayPlan.fromJson(await _api.get('/v1/projects/$id/days/$day'));

  Future<DayPlan> setDone(String id, String day, String taskId, {required bool done}) async {
    final path = '/v1/projects/$id/days/$day/tasks/$taskId/done';
    return DayPlan.fromJson(done ? await _api.put(path) : await _api.delete(path));
  }

  Future<ProjectDetail> addTask(String id, {required String title, String? detail, required String timeOfDay, required int weekdays}) async =>
      ProjectDetail.fromJson(
        await _api.post('/v1/projects/$id/tasks', body: {
          'title': title,
          if (detail != null && detail.isNotEmpty) 'detail': detail,
          'timeOfDay': timeOfDay,
          'weekdays': weekdays,
        },),
      );

  Future<ProjectDetail> removeTask(String id, String taskId) async => ProjectDetail.fromJson(await _api.delete('/v1/projects/$id/tasks/$taskId'));

  Future<ProjectDetail> pause(String id, int days) async => ProjectDetail.fromJson(await _api.post('/v1/projects/$id/pause', body: {'days': days}));

  Future<ProjectDetail> resume(String id) async => ProjectDetail.fromJson(await _api.post('/v1/projects/$id/resume'));
}

final projectsApiProvider = Provider<ProjectsApi>((ref) => ProjectsApi(ref.watch(apiClientProvider)));
