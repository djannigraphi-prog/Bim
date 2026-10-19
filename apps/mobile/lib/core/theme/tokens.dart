import 'package:flutter/material.dart';

/// Jetons de design BIM, relevés sur les maquettes (écrans 01 à 63) et le questionnaire (Q1 à Q7).
/// Toute couleur, taille ou rayon utilisé dans l'app vient d'ici : jamais de valeur en dur dans un écran.
abstract final class BimColors {
  /// Rouge BIM : actions principales, marque, progression (Q3).
  static const red = Color(0xFFF20D3A);
  static const redSoft = Color(0xFFFDE7EC);
  /// Noir BIM : contraste, boutons secondaires pleins.
  static const black = Color(0xFF101116);
  static const white = Color(0xFFFFFFFF);

  // Gris neutres (textes secondaires, séparateurs, fonds de champs).
  static const grey50 = Color(0xFFF6F6F8);
  static const grey100 = Color(0xFFEEEEF1);
  static const grey200 = Color(0xFFE2E2E7);
  static const grey400 = Color(0xFFA3A3AD);
  static const grey600 = Color(0xFF6E6E78);
  static const grey800 = Color(0xFF2A2B31);
  static const grey900 = Color(0xFF1A1B21);

  // Mode nuit (19/10/2026, maquette validée par le fondateur) : gris foncé mat, jamais noir complet.
  static const night = Color(0xFF1C1C1E);
  static const nightSurface = Color(0xFF262628);
  static const nightHigh = Color(0xFF2E2E31);
  static const nightLine = Color(0xFF3A3A3D);

  // Couleurs de progression des projets (Q30, écran 18).
  static const progressStart = red;
  static const progressAlmost = Color(0xFFFF8A1F);
  static const progressReached = Color(0xFFFFC83D);
  static const progressEmpty = grey200;

  static const success = Color(0xFF1EA463);
  static const warningBg = Color(0xFFFFF4D6);
  static const coin = Color(0xFFF5B400);
}

abstract final class BimSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  /// Marge latérale des écrans.
  static const screen = 20.0;
}

abstract final class BimRadius {
  static const field = 16.0;
  static const button = 18.0;
  static const card = 20.0;
  static const chip = 14.0;
  static const sheet = 28.0;
}

abstract final class BimDurations {
  /// Transitions douces (Q7) et discrètes : jamais plus de 300 ms.
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 250);
}

/// Hauteur minimale des cibles tactiles (accessibilité : 48 dp).
const double kBimMinTouch = 48;
