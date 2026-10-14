// Depuis Flutter 3.35, CupertinoPageTransitionsBuilder n'est plus exporté par material.dart.
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'tokens.dart';

/// Thèmes clair et sombre (Q1 : un bouton permet de basculer, écran 62).
/// Police : sans empattement du système (SF Pro sur iOS, Roboto sur Android) en attendant le choix d'une police
/// de marque embarquée (voir DECISIONS.md, D-UI-02).
abstract final class BimTheme {
  static ThemeData light() => _build(
        brightness: Brightness.light,
        background: BimColors.white,
        surface: BimColors.grey50,
        surfaceHigh: BimColors.grey100,
        onBackground: BimColors.black,
        muted: BimColors.grey600,
        outline: BimColors.grey200,
      );

  static ThemeData dark() => _build(
        brightness: Brightness.dark,
        background: BimColors.black,
        surface: BimColors.grey900,
        surfaceHigh: BimColors.grey800,
        onBackground: BimColors.white,
        muted: BimColors.grey400,
        outline: BimColors.grey800,
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
          bodyColor: onBackground,
          displayColor: onBackground,
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      splashFactory: InkRipple.splashFactory,
      textTheme: text.copyWith(
        headlineLarge: text.headlineLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.8, fontSize: 32),
        headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.6, fontSize: 28),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700, fontSize: 20),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600, fontSize: 17),
        bodyLarge: text.bodyLarge?.copyWith(fontSize: 17),
        bodyMedium: text.bodyMedium?.copyWith(fontSize: 15, color: muted),
        labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w700, fontSize: 17),
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
        contentPadding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: 18),
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
