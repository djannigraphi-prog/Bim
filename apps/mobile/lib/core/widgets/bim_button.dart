import 'package:flutter/material.dart';

import '../theme/tokens.dart';

enum BimButtonVariant { primary, dark, outline, subtle }

/// Bouton BIM : rouge (action principale), noir (« Continuer », « Se connecter »), contour, ou discret.
/// Affiche un indicateur pendant le chargement et se désactive pour éviter les doubles envois.
class BimButton extends StatelessWidget {
  const BimButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = BimButtonVariant.primary,
    this.loading = false,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final BimButtonVariant variant;
  final bool loading;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (Color bg, Color fg, BorderSide side) = switch (variant) {
      BimButtonVariant.primary => (BimColors.red, BimColors.white, BorderSide.none),
      BimButtonVariant.dark => (scheme.onSurface, scheme.surface, BorderSide.none),
      BimButtonVariant.outline => (Colors.transparent, scheme.onSurface, BorderSide(color: scheme.outline, width: 1.5)),
      BimButtonVariant.subtle => (scheme.surfaceContainerLow, scheme.onSurface, BorderSide.none),
    };
    final enabled = onPressed != null && !loading;
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: FilledButton(
          onPressed: enabled ? onPressed : null,
          style: FilledButton.styleFrom(
            backgroundColor: bg,
            foregroundColor: fg,
            disabledBackgroundColor: variant == BimButtonVariant.primary ? BimColors.grey400 : bg.withValues(alpha: 0.5),
            disabledForegroundColor: variant == BimButtonVariant.primary ? BimColors.white : fg.withValues(alpha: 0.6),
            side: side,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.button)),
            // Hérite de la police du thème (police de marque à venir, D-UI-02).
            textStyle: theme.textTheme.labelLarge,
          ),
          child: AnimatedSwitcher(
            duration: BimDurations.fast,
            child: loading
                ? SizedBox(
                    key: const ValueKey('loading'),
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: fg),
                  )
                : Row(
                    key: const ValueKey('label'),
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: BimSpacing.sm)],
                      Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
