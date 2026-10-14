import 'package:dio/dio.dart';

import '../storage/token_storage.dart';

/// Ajoute le jeton d'accès et, sur une réponse 401, rafraîchit la session UNE seule fois puis rejoue la requête.
/// QueuedInterceptor : les erreurs sont traitées une par une, donc deux 401 simultanés ne déclenchent pas
/// deux rafraîchissements (le serveur considérerait le second comme une réutilisation et couperait la session).
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({required this.storage, required this.refreshDio, required this.onSessionExpired});

  final TokenStorage storage;
  /// Client sans intercepteur, réservé à l'appel /v1/auth/refresh.
  final Dio refreshDio;
  final Future<void> Function() onSessionExpired;

  static const _retriedKey = 'bim.retried';

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await storage.accessToken();
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final request = err.requestOptions;
    final isAuthCall = request.path.startsWith('/v1/auth/login') ||
        request.path.startsWith('/v1/auth/refresh') ||
        request.path.startsWith('/v1/auth/register');
    if (err.response?.statusCode != 401 || isAuthCall || request.extra[_retriedKey] == true) {
      return handler.next(err);
    }

    final sentWith = request.headers['Authorization'];
    final current = await storage.accessToken();
    // Une autre requête a déjà rafraîchi la session pendant que celle-ci attendait : on rejoue directement.
    if (current != null && sentWith != 'Bearer $current') {
      return _retryOrFail(request, current, handler);
    }

    final refresh = await storage.refreshToken();
    if (refresh == null) {
      await onSessionExpired();
      return handler.next(err);
    }

    final Map<String, dynamic> tokens;
    try {
      final res = await refreshDio.post<Map<String, dynamic>>('/v1/auth/refresh', data: {'refreshToken': refresh});
      tokens = res.data!['tokens'] as Map<String, dynamic>;
    } on DioException catch (e) {
      // Seul un refus explicite du serveur met fin à la session ; une coupure réseau ne déconnecte pas.
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        await storage.clear();
        await onSessionExpired();
      }
      return handler.next(err);
    } catch (_) {
      return handler.next(err);
    }
    await storage.save(accessToken: tokens['accessToken'] as String, refreshToken: tokens['refreshToken'] as String);
    return _retryOrFail(request, tokens['accessToken'] as String, handler);
  }

  /// Rejoue la requête ; son éventuel échec est transmis tel quel (il ne remet jamais la session en cause).
  Future<void> _retryOrFail(RequestOptions request, String token, ErrorInterceptorHandler handler) async {
    try {
      handler.resolve(await _retry(request, token));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Future<Response<dynamic>> _retry(RequestOptions request, String token) {
    final options = request.copyWith(
      headers: {...request.headers, 'Authorization': 'Bearer $token'},
      extra: {...request.extra, _retriedKey: true},
    );
    return refreshDio.fetch<dynamic>(options);
  }
}
