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
    return Scaffold(
      backgroundColor: BimColors.white,
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(),
            const Center(child: BimLogo(height: 110)),
            const Spacer(),
            Text(
              'Beauté · Image · Motivation',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: BimColors.grey600, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: BimSpacing.xxl),
          ],
        ),
      ),
    );
  }
}
