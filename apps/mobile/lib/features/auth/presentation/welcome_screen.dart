import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../demo/demo_server.dart';
import '../application/session_controller.dart';

/// Écran 02 — Bienvenue : « Fais ton BIM. », créer un compte, se connecter, ou visiter sans compte (Q14).
/// Les photos de la maquette sont des exemples : elles seront remplacées par des visuels éditoriaux dont BIM détient
/// les droits. En attendant, la composition utilise des cartes aux couleurs de la marque.
class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
          child: Column(
            children: [
              const Expanded(child: _HeroComposition()),
              const BimLogo(color: BimLogoColor.black, height: 64),
              const SizedBox(height: BimSpacing.md),
              Text('Fais ton BIM.', style: theme.textTheme.headlineMedium),
              const SizedBox(height: BimSpacing.sm),
              Text(
                'Ton style, ta beauté, ta forme :\nfixe ton objectif, on t’accompagne.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: BimSpacing.xl),
              BimButton(label: 'Créer un compte', onPressed: () => context.push('/register/1')),
              const SizedBox(height: BimSpacing.md),
              BimButton(label: 'Se connecter', variant: BimButtonVariant.outline, onPressed: () => context.push('/login')),
              const SizedBox(height: BimSpacing.sm),
              TextButton.icon(
                onPressed: () {
                  ref.read(sessionProvider.notifier).continueAsVisitor();
                  context.go('/home');
                },
                iconAlignment: IconAlignment.end,
                icon: const Icon(Icons.arrow_forward_rounded),
                label: const Text('Voir des articles'),
                style: TextButton.styleFrom(foregroundColor: theme.colorScheme.onSurface, minimumSize: const Size(0, kBimMinTouch)),
              ),
              // Version de démonstration seulement : adresse du serveur (ordinateur sur le même Wi-Fi).
              const DemoServerButton(),
              const SizedBox(height: BimSpacing.sm),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeroComposition extends StatelessWidget {
  const _HeroComposition();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final w = c.maxWidth;
        final card = w * 0.42;
        return Stack(
          alignment: Alignment.center,
          children: [
            Positioned(left: 0, top: c.maxHeight * 0.08, child: _Card(width: card, color: const Color(0xFFFFD9E1), icon: Icons.checkroom, angle: -0.08)),
            Positioned(right: 0, top: 0, child: _Card(width: card, color: const Color(0xFFFFE9C7), icon: Icons.spa_outlined, angle: 0.08)),
            Positioned(bottom: c.maxHeight * 0.05, child: _Card(width: card * 1.05, color: BimColors.red, icon: Icons.auto_awesome, iconColor: BimColors.white)),
            Positioned(
              left: w * 0.06,
              bottom: c.maxHeight * 0.3,
              child: const _Pill(icon: Icons.auto_awesome, text: 'a fait son BIM', red: true),
            ),
            Positioned(
              right: 0,
              bottom: c.maxHeight * 0.36,
              child: const _Pill(peni: true, text: 'Salut ! Moi c’est Peni'),
            ),
          ],
        );
      },
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.width, required this.color, required this.icon, this.iconColor = BimColors.black, this.angle = 0});

  final double width;
  final Color color;
  final IconData icon;
  final Color iconColor;
  final double angle;

  @override
  Widget build(BuildContext context) => Transform.rotate(
        angle: angle,
        child: Container(
          width: width,
          height: width * 1.3,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(BimRadius.card),
            border: Border.all(color: BimColors.white, width: 4),
            boxShadow: const [BoxShadow(color: Color(0x1A000000), blurRadius: 24, offset: Offset(0, 10))],
          ),
          child: Icon(icon, size: width * 0.3, color: iconColor),
        ),
      );
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, this.icon, this.red = false, this.peni = false});

  final String text;
  final IconData? icon;
  final bool red;
  final bool peni;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
        decoration: BoxDecoration(
          color: red ? BimColors.red : BimColors.white,
          borderRadius: BorderRadius.circular(BimRadius.chip),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 16, offset: Offset(0, 6))],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (peni) const Peni(pose: PeniPose.wave, size: 32),
            if (icon != null) Icon(icon, size: 18, color: red ? BimColors.white : BimColors.black),
            const SizedBox(width: BimSpacing.sm),
            Text(text, style: TextStyle(fontWeight: FontWeight.w700, color: red ? BimColors.white : BimColors.black)),
          ],
        ),
      );
}
