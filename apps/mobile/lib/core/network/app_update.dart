import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../theme/tokens.dart';
import '../widgets/brand.dart';

/// Vrai dès que l'API a répondu APP_UPDATE_REQUIRED (version minimale de l'app, lot 7-A).
final updateRequiredProvider = StateProvider<bool>((ref) => false);

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
