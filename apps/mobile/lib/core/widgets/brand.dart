import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Logo manuscrit « Bim » fourni par le fondateur (Q4 : logo conservé ; icône d'app = la lettre B).
enum BimLogoColor { red, black, white }

class BimLogo extends StatelessWidget {
  const BimLogo({super.key, this.color = BimLogoColor.red, this.height = 48});

  final BimLogoColor color;
  final double height;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
        'assets/brand/logo_${color.name}.svg',
        height: height,
        semanticsLabel: 'BIM',
      );
}

/// Poses de Peni, l'assistante BIM (Q27) : joie, contente, triste, réflexion, salut.
enum PeniPose { cheer, happy, sad, think, wave }

class Peni extends StatelessWidget {
  const Peni({super.key, this.pose = PeniPose.happy, this.size = 64});

  final PeniPose pose;
  final double size;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
        'assets/peni/peni_${pose.name}.svg',
        width: size,
        height: size,
        semanticsLabel: 'Peni',
      );
}
