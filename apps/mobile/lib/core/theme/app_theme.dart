// Depuis Flutter 3.35, CupertinoPageTransitionsBuilder n'est plus exporté par material.dart.
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'tokens.dart';

/// Thèmes clair et sombre (Q1 : un bouton permet de basculer, écran 62).
/// Police : Inter, celle des maquettes, embarquée dans l'app (D-UI-02, choisie le 19/10/2026), avec l'échelle de
/// tailles des maquettes (texte courant 15, secondaire 14).
abstract final class BimTheme {
  /// Police embarquée (pubspec.yaml).
  static const fontFamily = 'Inter';

  static ThemeData light() => _build(
        brightness: Brightness.light,
        background: BimColors.white,
        surface: BimColors.grey50,
        surfaceHigh: BimColors.grey100,
        onBackground: BimColors.black,
        muted: BimColors.grey600,
        outline: BimColors.grey200,
      );

  /// Mode nuit : gris foncé mat (#1C1C1E), pas un noir complet (maquette validée le 19/10/2026).
  static ThemeData dark() => _build(
        brightness: Brightness.dark,
        background: BimColors.night,
        surface: BimColors.nightSurface,
        surfaceHigh: BimColors.nightHigh,
        onBackground: const Color(0xFFF2F2F4),
        muted: const Color(0xFFA1A1A8),
        outline: BimColors.nightLine,
      );

  static ThemeData _build({
    required Brightness brightness,
    required Color background,
    required Color surface,
    required Color surfaceHigh,
    required Color onBackground,
    required Color muted,
    required Color outline,
  }) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: BimColors.red,
      onPrimary: BimColors.white,
      secondary: onBackground,
      onSecondary: background,
      error: BimColors.red,
      onError: BimColors.white,
      surface: background,
      onSurface: onBackground,
      surfaceContainerLow: surface,
      surfaceContainerHighest: surfaceHigh,
      onSurfaceVariant: muted,
      outline: outline,
      outlineVariant: outline,
    );

    final text = Typography.material2021(platform: TargetPlatform.android).black.apply(
          fontFamily: fontFamily,
          bodyColor: onBackground,
          displayColor: onBackground,
        );

    return ThemeData(
      useMaterial3: true,
      fontFamily: fontFamily,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      splashFactory: InkRipple.splashFactory,
      textTheme: text.copyWith(
        headlineLarge: text.headlineLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.8, fontSize: 30),
        headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.6, fontSize: 26),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700, fontSize: 19, letterSpacing: -0.2),
        // Pas d'espacement entre les lettres : les maquettes n'en ont pas (Material en ajoute par défaut).
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600, fontSize: 16, letterSpacing: 0),
        bodyLarge: text.bodyLarge?.copyWith(fontSize: 15, letterSpacing: 0),
        bodyMedium: text.bodyMedium?.copyWith(fontSize: 14, color: muted, letterSpacing: 0),
        bodySmall: text.bodySmall?.copyWith(fontSize: 12.5, color: muted, letterSpacing: 0),
        labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 16, letterSpacing: 0),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: onBackground,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        hintStyle: TextStyle(color: muted),
        contentPadding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: 14),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(BimRadius.field), borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BimRadius.field), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BimRadius.field),
          borderSide: const BorderSide(color: BimColors.red, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BimRadius.field),
          borderSide: const BorderSide(color: BimColors.red),
        ),
      ),
      // Boutons fins et arrondis (maquette du 19/10/2026) : 40 px de haut, pilule, texte 14,5.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 40),
          padding: const EdgeInsets.symmetric(horizontal: 18),
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 14.5, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 40),
          padding: const EdgeInsets.symmetric(horizontal: 18),
          shape: const StadiumBorder(),
          foregroundColor: onBackground,
          side: BorderSide(color: outline),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 14.5, fontWeight: FontWeight.w500),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 14.5, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: onBackground,
        contentTextStyle: TextStyle(color: background, fontSize: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.chip)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: background,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(BimRadius.sheet))),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: CupertinoPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }
}
