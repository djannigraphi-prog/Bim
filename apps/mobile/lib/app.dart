import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/network/app_update.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_controller.dart';
import 'features/notifications/application/reminder_sync.dart';

class BimApp extends ConsumerWidget {
  const BimApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'BIM',
      debugShowCheckedModeBanner: false,
      theme: BimTheme.light(),
      darkTheme: BimTheme.dark(),
      themeMode: ref.watch(themeModeProvider),
      routerConfig: ref.watch(routerProvider),
      // Français uniquement au lancement (Q60) ; l'anglais pourra être ajouté sans toucher aux écrans.
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      // Rappels programmés sur le téléphone (lot 2) : synchronisés avec l'API, ouverture de la journée depuis une notification.
      // 7-A : une app trop ancienne affiche « Mise à jour nécessaire » à la place des écrans.
      builder: (context, child) => ref.watch(updateRequiredProvider) ? const UpdateRequiredScreen() : ReminderSync(child: child ?? const SizedBox.shrink()),
    );
  }
}
