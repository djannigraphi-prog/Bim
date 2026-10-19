import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// V1-1910-C — Badge de certification : réservé aux comptes Premium (personnes, et boutiques dont le propriétaire est
/// Premium). Le statut Gold est abandonné ; les boutiques non Premium montrent leurs étoiles grises à la place.
class CertifiedBadge extends StatelessWidget {
  const CertifiedBadge({super.key, this.size = 16});

  final double size;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: 'Compte certifié (Premium)',
        child: Icon(Icons.verified, key: const ValueKey('certified-badge'), size: size, color: BimColors.red, semanticLabel: 'Compte certifié'),
      );
}

/// Un nom suivi du badge quand le compte est certifié ; le nom se coupe avant le badge si la place manque.
class NameWithBadge extends StatelessWidget {
  const NameWithBadge({super.key, required this.name, required this.certified, this.badgeSize = 16});

  final Widget name;
  final bool certified;
  final double badgeSize;

  @override
  Widget build(BuildContext context) {
    if (!certified) return name;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(child: name),
        Padding(padding: const EdgeInsets.only(left: 4), child: CertifiedBadge(size: badgeSize)),
      ],
    );
  }
}
