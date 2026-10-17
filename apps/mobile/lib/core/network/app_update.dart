import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/tokens.dart';
import '../widgets/brand.dart';

/// Vrai dès que l'API a répondu APP_UPDATE_REQUIRED (version minimale, réservée au strict nécessaire, L7-09).
final updateRequiredProvider = StateProvider<bool>((ref) => false);

/// Version recommandée annoncée par l'API (en-tête X-Bim-Update-Available) : rappel non bloquant (L7-09).
final updateAvailableProvider = StateProvider<String?>((ref) => null);

/// Rappel fermé pour cette ouverture de l'app : il revient à la prochaine ouverture tant que l'app n'est pas à jour.
final updateReminderDismissedProvider = StateProvider<bool>((ref) => false);

/// Rappel non bloquant « Nouvelle version disponible » posé au-dessus des écrans ; toutes les fonctionnalités restent
/// accessibles. Fermé, il revient à la prochaine ouverture de l'app.
class UpdateReminder extends ConsumerWidget {
  const UpdateReminder({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final version = ref.watch(updateAvailableProvider);
    final dismissed = ref.watch(updateReminderDismissedProvider);
    if (version == null || dismissed) return child;
    final scheme = Theme.of(context).colorScheme;
    return Stack(
      children: [
        child,
        Positioned(
          left: BimSpacing.md,
          right: BimSpacing.md,
          bottom: BimSpacing.md + MediaQuery.paddingOf(context).bottom + 64,
          child: Material(
            key: const ValueKey('update-reminder'),
            elevation: 4,
            color: scheme.inverseSurface,
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.md, BimSpacing.sm, BimSpacing.xs, BimSpacing.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text('Une nouvelle version de BIM ($version) est disponible. Mets l’app à jour depuis la boutique d’applications.', style: TextStyle(color: scheme.onInverseSurface)),
                  ),
                  IconButton(
                    key: const ValueKey('update-reminder-close'),
                    tooltip: 'Plus tard',
                    icon: Icon(Icons.close, color: scheme.onInverseSurface),
                    onPressed: () => ref.read(updateReminderDismissedProvider.notifier).state = true,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Écran bloquant « Mise à jour nécessaire » : l'app trop ancienne ne peut plus échanger avec l'API.
class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      key: const ValueKey('update-required'),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Peni(pose: PeniPose.think, size: 120),
                const SizedBox(height: BimSpacing.lg),
                Text('Mise à jour nécessaire', textAlign: TextAlign.center, style: theme.textTheme.headlineSmall),
                const SizedBox(height: BimSpacing.sm),
                const Text('Cette version de BIM n’est plus prise en charge. Installe la dernière version depuis la boutique d’applications pour continuer.', textAlign: TextAlign.center),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
