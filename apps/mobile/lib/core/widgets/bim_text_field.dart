import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Champ de formulaire des écrans 03-04 : libellé au-dessus, astérisque rouge si obligatoire,
/// badge « Facultatif » sinon, icône à gauche, erreur sous le champ.
class BimTextField extends StatelessWidget {
  const BimTextField({
    super.key,
    this.label,
    required this.controller,
    this.hint,
    this.icon,
    this.required = false,
    this.optional = false,
    this.errorText,
    this.keyboardType,
    this.textInputAction,
    this.obscure = false,
    this.suffix,
    this.onChanged,
    this.onSubmitted,
    this.autofillHints,
    this.readOnly = false,
    this.onTap,
    this.maxLength,
    this.prefixText,
  });

  final String? label;
  final TextEditingController controller;
  final String? hint;
  final IconData? icon;
  final bool required;
  final bool optional;
  final String? errorText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscure;
  final Widget? suffix;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Iterable<String>? autofillHints;
  final bool readOnly;
  final VoidCallback? onTap;
  final int? maxLength;
  final String? prefixText;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Row(
            children: [
              // Le libellé passe à la ligne sur les petits écrans au lieu de déborder (relevé sur émulateur Android).
              Flexible(
                child: Text.rich(
                  TextSpan(
                    text: label,
                    children: [
                      if (required) const TextSpan(text: '  *', style: TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
                    ],
                  ),
                  style: theme.textTheme.titleMedium,
                ),
              ),
              if (optional) ...[const SizedBox(width: BimSpacing.sm), const OptionalBadge()],
            ],
          ),
          const SizedBox(height: BimSpacing.sm),
        ],
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          obscureText: obscure,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          autofillHints: autofillHints,
          readOnly: readOnly,
          onTap: onTap,
          maxLength: maxLength,
          style: theme.textTheme.bodyLarge,
          decoration: InputDecoration(
            hintText: hint,
            errorText: errorText,
            errorMaxLines: 3,
            counterText: '',
            prefixText: prefixText,
            prefixIcon: icon == null ? null : Icon(icon, color: theme.colorScheme.onSurfaceVariant),
            suffixIcon: suffix,
          ),
        ),
      ],
    );
  }
}

class OptionalBadge extends StatelessWidget {
  const OptionalBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm, vertical: 2),
      decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(6)),
      child: Text('Facultatif', style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant)),
    );
  }
}
