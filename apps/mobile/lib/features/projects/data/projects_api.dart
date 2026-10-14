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

  Future<Measurement> addMeasurement(String id, double value) async =>
      Measurement.fromJson(await _api.post('/v1/projects/$id/measurements', body: {'value': value}));

  /// Renvoie vrai si le serveur recommande de consulter un professionnel (douleur, malaise).
  Future<bool> report(String id, {required String day, String? taskId, required String reason, String? message}) async {
    final res = await _api.post('/v1/projects/$id/reports', body: {
      'day': day,
      if (taskId != null) 'taskId': taskId,
      'reason': reason,
      if (message != null && message.isNotEmpty) 'message': message,
    },);
    return (res['healthAdvice'] ?? false) as bool;
  }

  Future<List<ProjectReport>> reports(String id) async =>
      ((await _api.get('/v1/projects/$id/reports'))['items'] as List<dynamic>).map((e) => ProjectReport.fromJson(e as Map<String, dynamic>)).toList();

  Future<({bool available, List<ProjectPhoto> items})> photos(String id) async {
    final res = await _api.get('/v1/projects/$id/photos');
    return (
      available: (res['available'] ?? false) as bool,
      items: (res['items'] as List<dynamic>).map((e) => ProjectPhoto.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<void> uploadPhoto(String id, String kind, List<int> bytes) {
    final png = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47;
    return _api.upload(
      '/v1/projects/$id/photos?kind=$kind',
      field: 'photo',
      bytes: bytes,
      filename: png ? '$kind.png' : '$kind.jpg',
      contentType: png ? 'image/png' : 'image/jpeg',
    );
  }

  Future<void> deletePhoto(String id, String photoId) => _api.delete('/v1/projects/$id/photos/$photoId');

  Future<ProjectDetail> resume(String id) async => ProjectDetail.fromJson(await _api.post('/v1/projects/$id/resume'));
}

final projectsApiProvider = Provider<ProjectsApi>((ref) => ProjectsApi(ref.watch(apiClientProvider)));
