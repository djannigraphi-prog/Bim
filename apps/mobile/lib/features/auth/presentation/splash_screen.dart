import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/brand.dart';
import '../application/session_controller.dart';

/// Écran 01 — logo rouge sur fond blanc. Pendant l'affichage, la session enregistrée est revalidée par le serveur ;
/// le routeur redirige ensuite vers l'accueil ou l'écran de bienvenue.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(sessionProvider.notifier).restore());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider);
    final unreachable = state is SessionUnknown && state.unreachable;
    return Scaffold(
      backgroundColor: BimColors.white,
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(),
            const Center(child: BimLogo(height: 92)),
            const Spacer(),
            if (unreachable) ...[
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: BimSpacing.xl),
                child: Text(
                  'Impossible de joindre BIM pour le moment. Vérifie ta connexion : ta session est gardée.',
                  key: ValueKey('splash-unreachable'),
                  textAlign: TextAlign.center,
                  style: TextStyle(color: BimColors.grey800),
                ),
              ),
              const SizedBox(height: BimSpacing.md),
              TextButton(
                key: const ValueKey('splash-retry'),
                onPressed: () => ref.read(sessionProvider.notifier).restore(),
                child: const Text('Réessayer'),
              ),
              const SizedBox(height: BimSpacing.lg),
            ],
            Text(
              'Beauté · Image · Motivation',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: BimColors.grey600, fontWeight: FontWeight.w600, fontSize: 13),
            ),
            const SizedBox(height: BimSpacing.xxl),
          ],
        ),
      ),
    );
  }
}
