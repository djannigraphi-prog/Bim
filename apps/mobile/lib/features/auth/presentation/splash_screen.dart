import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/brand.dart';
import '../application/session_controller.dart';

/// Écran 01 — logo rouge sur fond blanc, devise dessous ; en bas, discrètement, « from Generation Hybride »
/// (l'entreprise qui a créé BIM, proposition A choisie par le fondateur le 19/10/2026). Pendant l'affichage, la session enregistrée est revalidée par le serveur ;
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
            const SizedBox(height: BimSpacing.lg),
            Text(
              'Beauté · Image · Motivation',
              key: const ValueKey('splash-motto'),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: BimColors.grey600, fontWeight: FontWeight.w400, fontSize: 15),
            ),
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
              // Issue toujours disponible : se déconnecter de cet appareil et revenir à l'écran de bienvenue.
              TextButton(
                key: const ValueKey('splash-sign-out'),
                onPressed: () => ref.read(sessionProvider.notifier).signOut(),
                child: const Text('Se déconnecter', style: TextStyle(color: BimColors.grey600)),
              ),
              const SizedBox(height: BimSpacing.lg),
            ],
            // Signature de l'éditeur, comme « from Meta » : écriture fine et grise, logo réduit.
            const Text('from', key: ValueKey('splash-from'), style: TextStyle(color: BimColors.grey400, fontWeight: FontWeight.w300, fontSize: 13)),
            const SizedBox(height: 6),
            Row(
              key: const ValueKey('splash-publisher'),
              mainAxisSize: MainAxisSize.min,
              children: [
                Opacity(opacity: 0.85, child: Image.asset('assets/brand/generation_hybride.png', width: 19, height: 19, semanticLabel: 'Logo Generation Hybride')),
                const SizedBox(width: 7),
                const Text('Generation Hybride', style: TextStyle(color: BimColors.grey600, fontWeight: FontWeight.w400, fontSize: 16, letterSpacing: 0.2)),
              ],
            ),
            const SizedBox(height: BimSpacing.xl),
          ],
        ),
      ),
    );
  }
}
