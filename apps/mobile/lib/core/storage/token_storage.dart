import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Jetons de session dans le stockage sécurisé du téléphone (Keychain iOS, Keystore Android).
class TokenStorage {
  TokenStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FlutterSecureStorage _storage;
  static const _access = 'bim.access_token';
  static const _refresh = 'bim.refresh_token';

  String? _accessCache;

  Future<String?> accessToken() async => _accessCache ??= await _storage.read(key: _access);
  Future<String?> refreshToken() => _storage.read(key: _refresh);

  Future<void> save({required String accessToken, required String refreshToken}) async {
    _accessCache = accessToken;
    await _storage.write(key: _access, value: accessToken);
    await _storage.write(key: _refresh, value: refreshToken);
  }

  Future<void> saveAccess(String accessToken) async {
    _accessCache = accessToken;
    await _storage.write(key: _access, value: accessToken);
  }

  Future<void> clear() async {
    _accessCache = null;
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}
