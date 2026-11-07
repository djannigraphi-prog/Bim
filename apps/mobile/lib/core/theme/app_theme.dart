// Depuis Flutter 3.35, CupertinoPageTransitionsBuilder n'est plus exporté par material.dart.
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'tokens.dart';

/// Thèmes clair et sombre (Q1 : un bouton permet de basculer, écran 62).
/// Police : Inter, celle des maquettes, embarquée dans l'app (D-UI-02, choisie le 19/10/2026).
/// Affinement du 07/11/2026 (D-UI-03, proposition validée par le fondateur) : textes et formes plus petits pour ne
/// pas encombrer l'écran (texte courant 14, secondaire 13), traits fins, fond clair gris très léger avec cartes
/// blanches, mode nuit gris foncé mat.
abstract final class BimTheme {
  /// Police embarquée (pubspec.yaml).
  static const fontFamily = 'Inter';

  static ThemeData light() => _build(
        brightness: Brightness.light,
        background: BimColors.grey50,
        surface: BimColors.white,
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
        headlineLarge: text.headlineLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.6, fontSize: 24),
        headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5, fontSize: 22),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700, fontSize: 17, letterSpacing: -0.2),
        // Pas d'espacement entre les lettres : les maquettes n'en ont pas (Material en ajoute par défaut).
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600, fontSize: 13.5, letterSpacing: 0),
        titleSmall: text.titleSmall?.copyWith(fontWeight: FontWeight.w600, fontSize: 13, letterSpacing: 0),
        bodyLarge: text.bodyLarge?.copyWith(fontSize: 14, letterSpacing: 0),
        bodyMedium: text.bodyMedium?.copyWith(fontSize: 13, color: muted, letterSpacing: 0),
        bodySmall: text.bodySmall?.copyWith(fontSize: 11.5, color: muted, letterSpacing: 0),
        labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600, fontSize: 13.5, letterSpacing: 0),
        labelMedium: text.labelMedium?.copyWith(fontWeight: FontWeight.w500, fontSize: 12.5, letterSpacing: 0),
        labelSmall: text.labelSmall?.copyWith(fontWeight: FontWeight.w500, fontSize: 11, letterSpacing: 0),
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
        // Champs : fond gris léger sur le fond de page, 40 px de haut environ, texte 14.
        fillColor: surfaceHigh,
        isDense: true,
        hintStyle: TextStyle(color: muted, fontSize: 14),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(BimRadius.field), borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BimRadius.field), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BimRadius.field),
          borderSide: const BorderSide(color: BimColors.red, width: 1),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BimRadius.field),
          borderSide: const BorderSide(color: BimColors.red),
        ),
      ),
      // Boutons fins et arrondis : 36 px de haut, pilule, texte 13,5, contour fin.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(56, 36),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 13.5, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(56, 36),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          shape: const StadiumBorder(),
          foregroundColor: onBackground,
          side: BorderSide(color: outline, width: BimStroke.hairline),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 13.5, fontWeight: FontWeight.w500),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          shape: const StadiumBorder(),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 13.5, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: onBackground,
        contentTextStyle: TextStyle(color: background, fontSize: 13.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.chip)),
      ),
      // Cartes, séparateurs, puces et icônes : traits fins, tailles réduites.
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BimRadius.card),
          side: BorderSide(color: outline, width: BimStroke.hairline),
        ),
      ),
      dividerTheme: DividerThemeData(color: outline, thickness: BimStroke.hairline, space: 1),
      chipTheme: ChipThemeData(
        shape: const StadiumBorder(),
        side: BorderSide.none,
        backgroundColor: surfaceHigh,
        selectedColor: onBackground,
        labelStyle: TextStyle(fontFamily: fontFamily, fontSize: 13, fontWeight: FontWeight.w500, color: onBackground),
        secondaryLabelStyle: TextStyle(fontFamily: fontFamily, fontSize: 13, fontWeight: FontWeight.w600, color: background),
        padding: const EdgeInsets.symmetric(horizontal: 4),
        visualDensity: VisualDensity.compact,
      ),
      listTileTheme: ListTileThemeData(
        dense: true,
        titleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w500, color: onBackground),
        subtitleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 12.5, color: muted),
      ),
      iconTheme: IconThemeData(color: onBackground, size: 21),
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
