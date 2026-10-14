import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Bouton retour carré arrondi des maquettes.
class BimBackButton extends StatelessWidget {
  const BimBackButton({super.key, this.onPressed, this.icon = Icons.arrow_back_ios_new_rounded, this.tooltip = 'Retour'});

  final VoidCallback? onPressed;
  final IconData icon;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onPressed ?? () => Navigator.of(context).maybePop(),
          child: SizedBox(width: kBimMinTouch, height: kBimMinTouch, child: Icon(icon, size: 20, color: scheme.onSurface)),
        ),
      ),
    );
  }
}

/// En-tête des parcours en plusieurs étapes (écrans 04, 05, 19-23) : retour, « Étape x sur y », barre segmentée.
class StepHeader extends StatelessWidget {
  const StepHeader({super.key, required this.step, required this.total, this.title, this.onBack});

  final int step;
  final int total;
  final String? title;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        Row(
          children: [
            BimBackButton(onPressed: onBack),
            Expanded(
              child: Text(
                title ?? 'Étape $step sur $total',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 17, color: scheme.onSurfaceVariant),
              ),
            ),
            const SizedBox(width: kBimMinTouch),
          ],
        ),
        const SizedBox(height: BimSpacing.lg),
        Semantics(
          label: 'Étape $step sur $total',
          child: Row(
            children: [
              for (var i = 1; i <= total; i++) ...[
                Expanded(
                  child: AnimatedContainer(
                    duration: BimDurations.normal,
                    height: 5,
                    decoration: BoxDecoration(
                      color: i <= step ? BimColors.red : scheme.outline,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
                if (i < total) const SizedBox(width: BimSpacing.sm),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
