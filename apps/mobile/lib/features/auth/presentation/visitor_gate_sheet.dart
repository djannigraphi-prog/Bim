import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';

/// Écran 06 — Un visiteur peut regarder l'Accueil, les Lives et le BimShop (Q14) ; dès qu'il veut agir
/// (aimer, commenter, envoyer des pièces, commander, créer un projet), cette feuille l'invite à créer un compte.
Future<void> showVisitorGate(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) {
      final theme = Theme.of(sheetContext);
      // La personne reste « visiteur » pendant l'inscription ou la connexion (les écrans publics lui sont ouverts) ;
      // une fois connectée, le routeur l'envoie à l'accueil.
      void go(String route) {
        Navigator.of(sheetContext).pop();
        context.push(route);
      }

      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, BimSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Peni(pose: PeniPose.happy, size: 120),
              const SizedBox(height: BimSpacing.lg),
              Text('Rejoins BIM pour réagir', style: theme.textTheme.headlineMedium, textAlign: TextAlign.center),
              const SizedBox(height: BimSpacing.sm),
              Text(
                'Aimer, commenter, envoyer des pièces, commander ou créer ton projet : il te faut un compte. Ça prend 1 minute.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: BimSpacing.xl),
              BimButton(label: 'Créer un compte', onPressed: () => go('/register/1')),
              const SizedBox(height: BimSpacing.md),
              BimButton(label: 'J’ai déjà un compte', variant: BimButtonVariant.outline, onPressed: () => go('/login')),
              TextButton(
                onPressed: () => Navigator.of(sheetContext).pop(),
                style: TextButton.styleFrom(minimumSize: const Size(0, kBimMinTouch)),
                child: Text('Continuer à visiter', style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
              ),
            ],
          ),
        ),
      );
    },
  );
}
