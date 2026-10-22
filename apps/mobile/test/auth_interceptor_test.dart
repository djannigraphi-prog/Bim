import 'dart:convert';
import 'dart:typed_data';

import 'package:bim/core/network/auth_interceptor.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// Jetons en mémoire (le stockage sécurisé du téléphone n'existe pas dans les tests).
class _MemoryTokens extends TokenStorage {
  _MemoryTokens(this.access, this.refresh);
  String? access;
  String? refresh;

  @override
  Future<String?> accessToken() async => access;
  @override
  Future<String?> refreshToken() async => refresh;
  @override
  Future<void> save({required String accessToken, required String refreshToken}) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> saveAccess(String accessToken) async => access = accessToken;
  @override
  Future<void> clear() async => access = refresh = null;
}

/// Jeton au format JWT (signature factice) portant l'espace actif, comme ceux de l'API.
String _jwt(String type, String id) {
  String part(Object o) => base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${part({'alg': 'HS256'})}.${part({'sub': 'u1', 'sid': 's1', 'space': {'type': type, 'id': id}})}.sig';
}

/// Serveur simulé : chaque requête est notée ; la réponse dépend du chemin et du jeton envoyé.
class _Server implements HttpClientAdapter {
  _Server(this.respond);
  final ResponseBody Function(RequestOptions o) respond;
  final calls = <String>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add('${o.method} ${o.path} ${o.headers['Authorization'] ?? ''}'.trim());
    // Comme un vrai serveur : le corps (formulaire multipart compris) est lu en entier.
    if (requestStream != null) {
      final body = <int>[];
      await for (final chunk in requestStream) {
        body.addAll(chunk);
      }
      bodies.add(utf8.decode(body, allowMalformed: true));
    }
    return respond(o);
  }

  final bodies = <String>[];

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});

(Dio, _Server, _MemoryTokens, List<String>) _client(_MemoryTokens tokens, ResponseBody Function(RequestOptions o) respond) {
  final server = _Server(respond);
  final expired = <String>[];
  final refreshDio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = server;
  final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))
    ..httpClientAdapter = server
    ..interceptors.add(AuthInterceptor(storage: tokens, refreshDio: refreshDio, onSessionExpired: () async => expired.add('expired')));
  return (dio, server, tokens, expired);
}

void main() {
  final merchantOld = _jwt('merchant', 'shop1');
  final userNew = _jwt('user', 'u1');
  final merchantNew = '${_jwt('merchant', 'shop1')}x';

  test('jeton expiré dans l’espace boutique : rafraîchi, espace boutique redemandé, requête rejouée', () async {
    final (dio, server, tokens, _) = _client(_MemoryTokens(merchantOld, 'r1'), (o) {
      final auth = o.headers['Authorization'];
      if (o.path == '/v1/auth/refresh') return _json(200, {'tokens': {'accessToken': userNew, 'refreshToken': 'r2'}});
      if (o.path == '/v1/auth/switch-space') return _json(200, {'accessToken': merchantNew});
      if (auth == 'Bearer $merchantNew') return _json(200, {'ok': true});
      return _json(401, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Connecte-toi.'}});
    });
    final res = await dio.get<Map<String, dynamic>>('/v1/shop');
    expect(res.data, {'ok': true});
    expect(tokens.access, merchantNew);
    expect(tokens.refresh, 'r2');
    expect(server.calls.map((c) => c.split(' ').take(2).join(' ')), ['GET /v1/shop', 'POST /v1/auth/refresh', 'POST /v1/auth/switch-space', 'GET /v1/shop']);
  });

  test('espace utilisateur : pas de changement d’espace après le rafraîchissement', () async {
    final (dio, server, _, _) = _client(_MemoryTokens(_jwt('user', 'u1'), 'r1'), (o) {
      if (o.path == '/v1/auth/refresh') return _json(200, {'tokens': {'accessToken': userNew, 'refreshToken': 'r2'}});
      if (o.headers['Authorization'] == 'Bearer $userNew') return _json(200, {'ok': true});
      return _json(401, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Connecte-toi.'}});
    });
    await dio.get<Map<String, dynamic>>('/v1/me');
    expect(server.calls.where((c) => c.contains('switch-space')), isEmpty);
  });

  test('mauvais mot de passe (401 INVALID_CREDENTIALS) : aucun rafraîchissement, aucune nouvelle tentative', () async {
    final (dio, server, tokens, _) = _client(_MemoryTokens(userNew, 'r1'), (o) => _json(401, {'error': {'code': 'INVALID_CREDENTIALS', 'message': 'Mot de passe incorrect.'}}));
    await expectLater(dio.post<Map<String, dynamic>>('/v1/auth/step-up', data: {'password': 'x'}), throwsA(isA<DioException>()));
    expect(server.calls, hasLength(1));
    expect(tokens.refresh, 'r1');
  });

  test('envoi d’une photo (multipart) avec un jeton expiré : rafraîchi puis renvoyé avec une copie du formulaire', () async {
    final (dio, server, _, _) = _client(_MemoryTokens(_jwt('user', 'u1').replaceFirst('.sig', '.old'), 'r1'), (o) {
      if (o.path == '/v1/auth/refresh') return _json(200, {'tokens': {'accessToken': userNew, 'refreshToken': 'r2'}});
      if (o.headers['Authorization'] == 'Bearer $userNew') return _json(201, {'ok': true});
      return _json(401, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Connecte-toi.'}});
    });
    final form = FormData.fromMap({
      'caption': 'Ma routine',
      'video': MultipartFile.fromBytes(List<int>.filled(64, 7), filename: 'reel.mp4', contentType: DioMediaType.parse('video/mp4')),
    });
    final res = await dio.post<Map<String, dynamic>>('/v1/reels', data: form);
    expect(res.data, {'ok': true});
    expect(server.calls.map((c) => c.split(' ').take(2).join(' ')), ['POST /v1/reels', 'POST /v1/auth/refresh', 'POST /v1/reels']);
    // Le formulaire renvoyé est complet (champ texte et fichier), pas vide ni refusé par Dio.
    final uploads = server.bodies.where((b) => b.contains('reel.mp4')).toList();
    expect(uploads, hasLength(2));
    expect(uploads.last, contains('Ma routine'));
  });

  test('rafraîchissement en erreur serveur : la session est gardée ; refusé (401) : elle est effacée', () async {
    final (dio, _, tokens, expired) = _client(_MemoryTokens(userNew, 'r1'), (o) {
      if (o.path == '/v1/auth/refresh') return _json(503, {'error': {'code': 'UNAVAILABLE', 'message': '…'}});
      return _json(401, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Connecte-toi.'}});
    });
    await expectLater(dio.get<Map<String, dynamic>>('/v1/me'), throwsA(isA<DioException>()));
    expect(tokens.refresh, 'r1');
    expect(expired, isEmpty);

    final (dio2, _, tokens2, expired2) = _client(_MemoryTokens(userNew, 'r1'), (o) {
      if (o.path == '/v1/auth/refresh') return _json(401, {'error': {'code': 'SESSION_INVALID', 'message': '…'}});
      return _json(401, {'error': {'code': 'UNAUTHENTICATED', 'message': 'Connecte-toi.'}});
    });
    await expectLater(dio2.get<Map<String, dynamic>>('/v1/me'), throwsA(isA<DioException>()));
    expect(tokens2.refresh, isNull);
    expect(expired2, ['expired']);
  });
}
