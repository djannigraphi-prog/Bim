import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../auth/data/models.dart';

/// Opérations sensibles du compte (F16) : chacune exige une autorisation « step-up »
/// (mot de passe + code reçu sur une coordonnée vérifiée), valable une seule fois.
enum StepUpScope { contactChange, passwordChange }

extension on StepUpScope {
  String get api => switch (this) {
        StepUpScope.contactChange => 'contact_change',
        StepUpScope.passwordChange => 'password_change',
      };
}

class DeviceSession {
  const DeviceSession({required this.id, this.deviceName, this.userAgent, required this.lastUsedAt, required this.current});

  final String id;
  final String? deviceName;
  final String? userAgent;
  final DateTime lastUsedAt;
  final bool current;

  String get label => deviceName ?? (userAgent == null ? 'Appareil' : _describe(userAgent!));

  static String _describe(String ua) {
    if (ua.contains('Android')) return 'Android';
    if (ua.contains('iPhone') || ua.contains('iOS')) return 'iPhone';
    if (ua.startsWith('Dart/')) return 'Application BIM';
    return 'Navigateur';
  }
}

class SpaceItem {
  const SpaceItem({required this.type, required this.id, required this.label, required this.status, required this.usable, required this.active});

  final String type;
  final String id;
  final String label;
  final String status;
  final bool usable;
  final bool active;
}

class AccountApi {
  AccountApi(this._api);
  final ApiClient _api;

  Future<Challenge> startStepUp(StepUpScope scope, String password) async =>
      Challenge.fromJson(await _api.post('/v1/auth/step-up', body: {'scope': scope.api, 'password': password}));

  Future<String> completeStepUp(String challengeId, String code) async {
    final res = await _api.post('/v1/auth/step-up/verify', body: {'challengeId': challengeId, 'code': code});
    return res['stepUpToken'] as String;
  }

  Future<Challenge> addContact(String type, String value, String stepUpToken) async => Challenge.fromJson(
        await _api.post('/v1/me/contacts', body: {'type': type, 'value': value}, headers: {'X-Step-Up-Token': stepUpToken}),
      );

  Future<Me> verifyContact(String challengeId, String code) async =>
      Me.fromJson(await _api.post('/v1/me/contacts/verify', body: {'challengeId': challengeId, 'code': code}));

  Future<Me> removeContact(String id, String stepUpToken) async =>
      Me.fromJson(await _api.delete('/v1/me/contacts/$id', headers: {'X-Step-Up-Token': stepUpToken}));

  Future<void> changePassword(String newPassword, String stepUpToken) =>
      _api.post('/v1/me/password', body: {'newPassword': newPassword}, headers: {'X-Step-Up-Token': stepUpToken});

  Future<List<DeviceSession>> sessions() async {
    final res = await _api.get('/v1/me/sessions');
    final current = res['currentSessionId'] as String?;
    return (res['items'] as List<dynamic>).map((e) {
      final j = e as Map<String, dynamic>;
      return DeviceSession(
        id: j['id'] as String,
        deviceName: j['deviceName'] as String?,
        userAgent: j['userAgent'] as String?,
        lastUsedAt: DateTime.parse(j['lastUsedAt'] as String),
        current: j['id'] == current,
      );
    }).toList();
  }

  Future<void> revokeSession(String id) => _api.delete('/v1/me/sessions/$id');

  Future<List<SpaceItem>> spaces() async {
    final res = await _api.get('/v1/me/spaces');
    final active = res['active'] as Map<String, dynamic>?;
    return (res['items'] as List<dynamic>).map((e) {
      final j = e as Map<String, dynamic>;
      return SpaceItem(
        type: j['type'] as String,
        id: j['id'] as String,
        label: j['label'] as String,
        status: j['status'] as String,
        usable: j['usable'] as bool,
        active: active != null && active['type'] == j['type'] && active['id'] == j['id'],
      );
    }).toList();
  }

  /// Renvoie le nouveau jeton d'accès, valable pour l'espace choisi.
  Future<String> switchSpace(String type, String id) async {
    final res = await _api.post('/v1/auth/switch-space', body: {'type': type, 'id': id});
    return res['accessToken'] as String;
  }
}

final accountApiProvider = Provider<AccountApi>((ref) => AccountApi(ref.watch(apiClientProvider)));
