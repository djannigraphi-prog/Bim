import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/network/api_client.dart';
import 'core/network/app_update.dart';
import 'features/auth/application/session_controller.dart';
import 'features/demo/demo_server.dart';
import 'features/notifications/application/local_notifier.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Version de démonstration : adresse du serveur enregistrée sur le téléphone (null ailleurs).
  runBim(baseUrl: await DemoServer.load());
}

/// Démarre l'app. [overrides] sert uniquement aux tests de bout en bout (ex. source de photos simulée,
/// car le sélecteur de photos du système ne peut pas être piloté par un test automatique).
void runBim({List<Override> overrides = const [], String? baseUrl}) {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWith(
          (ref) => ApiClient(
            storage: ref.read(tokenStorageProvider),
            baseUrl: baseUrl,
            onSessionExpired: () => ref.read(sessionProvider.notifier).onExpired(),
            onUpdateRequired: () => ref.read(updateRequiredProvider.notifier).state = true,
            onUpdateAvailable: (v) => ref.read(updateAvailableProvider.notifier).state = v,
          ),
        ),
        // Notifications programmées sur le téléphone : Android pour l'instant (iOS pas encore compilé).
        localNotifierProvider.overrideWithValue(Platform.isAndroid ? PluginLocalNotifier() : const NoopLocalNotifier()),
        ...overrides,
      ],
      child: const BimApp(),
    ),
  );
}
