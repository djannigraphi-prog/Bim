import 'dart:convert';
import 'dart:typed_data';

import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/util/picker_guard.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

/// Serveur simulé : rend toujours la même réponse (page HTML d'un portail Wi-Fi, réponse vide…).
class _Server implements HttpClientAdapter {
  _Server(this.respond);
  final ResponseBody Function() respond;

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (requestStream != null) await requestStream.drain<void>();
    return respond();
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _client(ResponseBody Function() respond) =>
    ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://api.test')..dio.httpClientAdapter = _Server(respond);

ResponseBody _text(int status, String body, String type) => ResponseBody.fromString(body, status, headers: {Headers.contentTypeHeader: [type]});

void main() {
  group('réponses inattendues : toujours une ApiException (jamais une TypeError qui bloquerait un bouton)', () {
    test('page HTML (portail Wi-Fi) à la place du JSON', () async {
      final api = _client(() => _text(200, '<html><body>Connectez-vous au Wi-Fi</body></html>', 'text/html'));
      await expectLater(
        api.get('/v1/me'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UNEXPECTED_RESPONSE').having((e) => e.message, 'message', ApiException.unexpected.message)),
      );
    });

    test('liste JSON à la place d’un objet', () async {
      final api = _client(() => _text(200, jsonEncode([1, 2]), Headers.jsonContentType));
      await expectLater(api.post('/v1/x'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'UNEXPECTED_RESPONSE')));
    });

    test('réponse vide (204) : acceptée, rien à lire', () async {
      final api = _client(() => ResponseBody.fromString('', 204));
      expect(await api.delete('/v1/x'), isEmpty);
    });

    test('objet JSON : rendu tel quel', () async {
      final api = _client(() => _text(200, jsonEncode({'ok': true}), Headers.jsonContentType));
      expect(await api.get('/v1/x'), {'ok': true});
    });

    test('fichier trop lourd refusé par un intermédiaire (413 sans JSON) : message clair', () async {
      final api = _client(() => _text(413, '<html>413 Request Entity Too Large</html>', 'text/html'));
      await expectLater(
        api.upload('/v1/reels', field: 'video', bytes: List<int>.filled(16, 1), filename: 'reel.mp4', contentType: 'video/mp4'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FILE_TOO_LARGE')),
      );
    });

    test('FILE_TOO_LARGE de l’API : son message est affiché tel quel', () async {
      final api = _client(() => _text(413, jsonEncode({'error': {'code': 'FILE_TOO_LARGE', 'message': 'Vidéo trop lourde : 100 Mo au plus.'}}), Headers.jsonContentType));
      await expectLater(
        api.upload('/v1/reels', field: 'video', bytes: List<int>.filled(16, 1), filename: 'reel.mp4', contentType: 'video/mp4'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FILE_TOO_LARGE').having((e) => e.message, 'message', 'Vidéo trop lourde : 100 Mo au plus.')),
      );
    });
  });

  test('délai d’envoi selon la taille du fichier : 60 s + 1 s par 100 Ko, 10 minutes au plus', () {
    expect(ApiClient.uploadTimeout(0), const Duration(seconds: 60));
    expect(ApiClient.uploadTimeout(10 * 1024 * 1024), const Duration(seconds: 60 + 102));
    expect(ApiClient.uploadTimeout(100 * 1024 * 1024), const Duration(minutes: 10));
    expect(ApiClient.uploadTimeout(0, base: 90), const Duration(seconds: 90));
  });

  group('sélecteur de photos du téléphone : erreurs traduites', () {
    test('autorisation refusée', () async {
      await expectLater(
        guardPicker<List<int>>(() => throw const PlatformException(code: 'photo_access_denied', message: 'denied')),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Autorise l’appareil photo et la galerie dans les réglages du téléphone.')),
      );
      await expectLater(guardPicker<List<int>>(() => throw const PlatformException(code: 'camera_access_denied')), throwsA(same(pickerDenied)));
    });

    test('pas d’appareil photo', () async {
      await expectLater(
        guardPicker<List<int>>(() => throw const PlatformException(code: 'no_available_camera')),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'PICKER_NO_CAMERA')),
      );
    });

    test('sélecteur déjà ouvert (double appui) : rien, sans erreur', () async {
      expect(await guardPicker<List<int>>(() => throw const PlatformException(code: 'already_active')), isNull);
    });

    test('autre erreur (fichier illisible) : message générique, et l’ApiException passe telle quelle', () async {
      await expectLater(guardPicker<List<int>>(() => throw StateError('x')), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'PICKER_FAILED')));
      const tooBig = ApiException(code: 'FILE_TOO_LARGE', message: 'Trop lourd');
      await expectLater(guardPicker<List<int>>(() => throw tooBig), throwsA(same(tooBig)));
    });
  });
}
