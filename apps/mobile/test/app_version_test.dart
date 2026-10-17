import 'dart:io';

import 'package:bim/core/config/app_version.dart';
import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/network/app_update.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

void main() {
  test('7-A : la version envoyée à l’API est celle de pubspec.yaml', () {
    final line = File('pubspec.yaml').readAsLinesSync().firstWhere((l) => l.startsWith('version:'));
    expect(line.substring('version:'.length).trim().split('+').first, kAppVersion);
  });

  test('7-A : chaque requête porte la version et la plateforme de l’app', () {
    final c = ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');
    expect(c.dio.options.headers['X-Bim-App-Version'], kAppVersion);
    expect(c.dio.options.headers['X-Bim-Platform'], 'android'); // plateforme par défaut des tests Flutter
  });

  test('7-A : réponse APP_UPDATE_REQUIRED de l’API → rappel « mise à jour nécessaire »', () async {
    var called = false;
    final c = ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9', onUpdateRequired: () => called = true);
    c.dio.interceptors.insert(
      0,
      InterceptorsWrapper(
        onRequest: (o, h) => h.reject(
          DioException(
            requestOptions: o,
            type: DioExceptionType.badResponse,
            response: Response<dynamic>(requestOptions: o, statusCode: 426, data: {'error': {'code': 'APP_UPDATE_REQUIRED', 'message': 'Mets l’app à jour.'}}),
          ),
        ),
      ),
    );
    await expectLater(c.get('/v1/me'), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'APP_UPDATE_REQUIRED')));
    expect(called, isTrue);
  });

  testWidgets('7-A : écran bloquant « Mise à jour nécessaire »', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: BimTheme.light(), home: const UpdateRequiredScreen()));
    expect(find.text('Mise à jour nécessaire'), findsOneWidget);
  });

  test('L7-09 : version recommandée annoncée par l’API → rappel (sans erreur)', () async {
    String? announced;
    final c = ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9', onUpdateAvailable: (v) => announced = v);
    c.dio.interceptors.insert(
      0,
      InterceptorsWrapper(
        onRequest: (o, h) => h.resolve(Response<dynamic>(requestOptions: o, statusCode: 200, data: {'ok': true}, headers: Headers.fromMap({'x-bim-update-available': ['0.3.0']})), true),
      ),
    );
    expect(await c.get('/v1/me'), {'ok': true});
    expect(announced, '0.3.0');
  });

  testWidgets('L7-09 : rappel non bloquant, fermable, l’écran reste utilisable', (tester) async {
    var tapped = false;
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(updateAvailableProvider.notifier).state = '0.3.0';
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(theme: BimTheme.light(), home: UpdateReminder(child: Scaffold(body: Center(child: TextButton(onPressed: () => tapped = true, child: const Text('Mes projets')))))),
    ),);
    expect(find.byKey(const ValueKey('update-reminder')), findsOneWidget);
    await tester.tap(find.text('Mes projets'));
    expect(tapped, isTrue);
    await tester.tap(find.byKey(const ValueKey('update-reminder-close')));
    await tester.pump();
    expect(find.byKey(const ValueKey('update-reminder')), findsNothing);
  });
}
