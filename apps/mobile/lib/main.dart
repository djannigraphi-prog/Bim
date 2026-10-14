import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/network/api_client.dart';
import 'features/auth/application/session_controller.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWith(
          (ref) => ApiClient(
            storage: ref.read(tokenStorageProvider),
            onSessionExpired: () => ref.read(sessionProvider.notifier).onExpired(),
          ),
        ),
      ],
      child: const BimApp(),
    ),
  );
}
