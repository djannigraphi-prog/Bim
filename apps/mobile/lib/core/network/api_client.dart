import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/env.dart';
import '../storage/token_storage.dart';
import 'api_exception.dart';
import 'auth_interceptor.dart';

/// Client HTTP unique de l'app. Les écrans n'appellent jamais Dio directement : ils passent par les *Api des fonctionnalités.
class ApiClient {
  ApiClient({required this.storage, required Future<void> Function() onSessionExpired, String? baseUrl}) {
    final options = BaseOptions(
      baseUrl: baseUrl ?? Env.apiUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      contentType: 'application/json',
      headers: {'Accept': 'application/json'},
    );
    final refreshDio = Dio(options);
    dio = Dio(options)
      ..interceptors.add(AuthInterceptor(storage: storage, refreshDio: refreshDio, onSessionExpired: onSessionExpired));
  }

  final TokenStorage storage;
  late final Dio dio;

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _run(() => dio.get<dynamic>(path, queryParameters: query));

  Future<Map<String, dynamic>> post(String path, {Object? body, Map<String, String>? headers}) =>
      _run(() => dio.post<dynamic>(path, data: body, options: Options(headers: headers)));

  Future<Map<String, dynamic>> put(String path, {Object? body}) => _run(() => dio.put<dynamic>(path, data: body));

  /// Envoi d'un fichier (photo) en multipart/form-data.
  Future<Map<String, dynamic>> upload(String path, {required String field, required List<int> bytes, required String filename, required String contentType}) =>
      _run(() => dio.post<dynamic>(
            path,
            data: FormData.fromMap({field: MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(contentType))}),
            options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(seconds: 60)),
          ),);

  Future<Map<String, dynamic>> patch(String path, {Object? body}) => _run(() => dio.patch<dynamic>(path, data: body));

  Future<Map<String, dynamic>> delete(String path, {Map<String, String>? headers}) =>
      _run(() => dio.delete<dynamic>(path, options: Options(headers: headers)));

  Future<Map<String, dynamic>> _run(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      final data = res.data;
      return data is Map<String, dynamic> ? data : <String, dynamic>{};
    } on DioException catch (e) {
      throw _map(e);
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
