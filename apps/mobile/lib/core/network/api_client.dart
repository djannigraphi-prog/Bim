import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_version.dart';
import '../config/env.dart';
import '../storage/token_storage.dart';
import 'api_exception.dart';
import 'auth_interceptor.dart';

/// Client HTTP unique de l'app. Les écrans n'appellent jamais Dio directement : ils passent par les *Api des fonctionnalités.
class ApiClient {
  ApiClient({required this.storage, required Future<void> Function() onSessionExpired, String? baseUrl, this.onUpdateRequired}) {
    final platform = appPlatform();
    final options = BaseOptions(
      baseUrl: baseUrl ?? Env.apiUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      contentType: 'application/json',
      // 7-A : version et plateforme de l'app, pour la version minimale exigée par l'API.
      headers: {'Accept': 'application/json', 'X-Bim-App-Version': kAppVersion, if (platform != null) 'X-Bim-Platform': platform},
    );
    final refreshDio = Dio(options);
    dio = Dio(options)
      ..interceptors.add(AuthInterceptor(storage: storage, refreshDio: refreshDio, onSessionExpired: onSessionExpired));
  }

  final TokenStorage storage;
  late final Dio dio;

  /// Appelé quand l'API exige une version plus récente de l'app (APP_UPDATE_REQUIRED).
  final void Function()? onUpdateRequired;

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _run(() => dio.get<dynamic>(path, queryParameters: query));

  Future<Map<String, dynamic>> post(String path, {Object? body, Map<String, String>? headers}) =>
      _run(() => dio.post<dynamic>(path, data: body, options: Options(headers: headers)));

  Future<Map<String, dynamic>> put(String path, {Object? body}) => _run(() => dio.put<dynamic>(path, data: body));

  /// Envoi d'un fichier (photo) en multipart/form-data.
  /// `method` : POST par défaut, PUT pour remplacer une ressource (photo de profil, lot 4).
  Future<Map<String, dynamic>> upload(String path, {required String field, required List<int> bytes, required String filename, required String contentType, String method = 'POST'}) =>
      _run(() => dio.request<dynamic>(
            path,
            data: FormData.fromMap({field: MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(contentType))}),
            options: Options(method: method, contentType: 'multipart/form-data', sendTimeout: const Duration(seconds: 60)),
          ),);

  /// Formulaire multipart : champs texte et, si fourni, un fichier (signalement avec image).
  Future<Map<String, dynamic>> postForm(String path, {required Map<String, String> fields, String? fileField, List<int>? bytes, String? filename, String? contentType}) =>
      _run(() => dio.post<dynamic>(
            path,
            data: FormData.fromMap({
              ...fields,
              if (fileField != null && bytes != null) fileField: MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(contentType!)),
            }),
            options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(seconds: 60)),
          ),);

  /// Formulaire multipart avec plusieurs fichiers dans le même champ (publication avec photos, lot 4).
  Future<Map<String, dynamic>> postFiles(String path, {required Map<String, String> fields, required String fileField, required List<List<int>> files}) =>
      _run(() => dio.post<dynamic>(
            path,
            data: FormData.fromMap({
              ...fields,
              fileField: [
                for (final (i, b) in files.indexed)
                  MultipartFile.fromBytes(b, filename: _isPng(b) ? 'photo$i.png' : 'photo$i.jpg', contentType: DioMediaType.parse(_isPng(b) ? 'image/png' : 'image/jpeg')),
              ],
            }),
            options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(seconds: 90)),
          ),);

  static bool _isPng(List<int> b) => b.length > 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47;

  Future<Map<String, dynamic>> patch(String path, {Object? body}) => _run(() => dio.patch<dynamic>(path, data: body));

  Future<Map<String, dynamic>> delete(String path, {Map<String, String>? headers}) =>
      _run(() => dio.delete<dynamic>(path, options: Options(headers: headers)));

  Future<Map<String, dynamic>> _run(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      final data = res.data;
      return data is Map<String, dynamic> ? data : <String, dynamic>{};
    } on DioException catch (e) {
      final err = _map(e);
      if (err.code == 'APP_UPDATE_REQUIRED') onUpdateRequired?.call();
      throw err;
    }
  }

  ApiException _map(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
        return ApiException.network;
      default:
        break;
    }
    final data = e.response?.data;
    if (data is Map && data['error'] is Map) {
      final err = data['error'] as Map<String, dynamic>;
      final details = err['details'];
      return ApiException(
        code: (err['code'] ?? 'UNKNOWN').toString(),
        message: (err['message'] ?? ApiException.unknown.message).toString(),
        status: e.response?.statusCode,
        details: details is Map<String, dynamic> ? details : const {},
      );
    }
    return ApiException.unknown;
  }
}

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

/// Remplacé au démarrage (main.dart) pour brancher le rappel « session expirée » sur le contrôleur de session.
final apiClientProvider = Provider<ApiClient>((ref) => throw UnimplementedError('apiClientProvider non initialisé'));
