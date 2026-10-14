import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'models.dart';

/// Appels HTTP de l'authentification. Aucune règle métier ici : le serveur valide tout.
class AuthApi {
  AuthApi(this._api);
  final ApiClient _api;

  Future<List<Interest>> interests() async {
    final res = await _api.get('/v1/interests');
    return (res['items'] as List<dynamic>).map((e) => Interest.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<({bool available, String? reason})> usernameAvailability(String username) async {
    final res = await _api.get('/v1/auth/username-availability', query: {'username': username});
    return (available: res['available'] as bool, reason: res['reason'] as String?);
  }

  Future<Challenge> register(RegistrationDraft draft) async {
    final res = await _api.post('/v1/auth/register', body: draft.toJson());
    return Challenge.fromJson(res['verification'] as Map<String, dynamic>);
  }

  Future<({Tokens tokens, Me me})> verifySignup(String challengeId, String code, {String? deviceName}) async {
    final res = await _api.post('/v1/auth/register/verify', body: {
      'challengeId': challengeId,
      'code': code,
      if (deviceName != null) 'deviceName': deviceName,
    },
    );
    return (tokens: Tokens.fromJson(res['tokens'] as Map<String, dynamic>), me: Me.fromJson(res['me'] as Map<String, dynamic>));
  }

  Future<Challenge> resend(String challengeId) async =>
      Challenge.fromJson(await _api.post('/v1/auth/codes/resend', body: {'challengeId': challengeId}));

  Future<({Tokens tokens, Me me})> login(String identifier, String password) async {
    final res = await _api.post('/v1/auth/login', body: {'identifier': identifier, 'password': password});
    return (tokens: Tokens.fromJson(res['tokens'] as Map<String, dynamic>), me: Me.fromJson(res['me'] as Map<String, dynamic>));
  }

  Future<Challenge> forgotPassword(String identifier) async =>
      Challenge.fromJson(await _api.post('/v1/auth/password/forgot', body: {'identifier': identifier}));

  Future<void> resetPassword(String challengeId, String code, String newPassword) =>
      _api.post('/v1/auth/password/reset', body: {'challengeId': challengeId, 'code': code, 'newPassword': newPassword});

  Future<Me> me() async => Me.fromJson(await _api.get('/v1/me'));

  Future<void> logout() => _api.post('/v1/auth/logout');

  Future<Map<String, bool>> socialProviders() async {
    final res = await _api.get('/v1/auth/providers');
    return res.map((k, v) => MapEntry(k, ((v as Map<String, dynamic>)['available'] ?? false) as bool));
  }
}

final authApiProvider = Provider<AuthApi>((ref) => AuthApi(ref.watch(apiClientProvider)));
