import 'package:flutter/material.dart';

/// Correspondance entre les noms d'icônes envoyés par le serveur (référentiels administrables) et les icônes de l'app.
IconData bimIcon(String name) => switch (name) {
      'shirt' => Icons.checkroom_outlined,
      'dumbbell' => Icons.fitness_center,
      'sparkles' => Icons.auto_awesome_outlined,
      'flower' => Icons.local_florist_outlined,
      'scissors' => Icons.content_cut,
      'brush' => Icons.brush_outlined,
      'hand' => Icons.back_hand_outlined,
      'leaf' => Icons.eco_outlined,
      'camera' => Icons.photo_camera_outlined,
      'glasses' => Icons.diamond_outlined,
      'water' => Icons.water_drop_outlined,
      'stretch' => Icons.sync_alt,
      'check' => Icons.check_circle_outline,
      _ => Icons.star_outline,
    };

/// Couleur « #RRGGBB » envoyée par le serveur ; [fallback] si la valeur est illisible.
Color hexColor(String hex, Color fallback) {
  final v = int.tryParse(hex.replaceFirst('#', ''), radix: 16);
  return v == null ? fallback : Color(0xFF000000 | v);
}
