import 'dart:math';

import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';
import '../../wallet/presentation/gift_sheet.dart';

/// V1 — Cadeaux animés et ambiances des Lives, dessinés dans l'app (aucun fichier ni service externe).

/// Ambiances de la scène (gadget Premium de l'hôte).
const liveThemes = {
  'classic': ('Classique', [BimColors.grey900, BimColors.black]),
  'sunset': ('Coucher de soleil', [Color(0xFF8E2D4D), Color(0xFF2B0F1E)]),
  'ocean': ('Océan', [Color(0xFF0E4F6B), Color(0xFF041A26)]),
  'gold': ('Or', [Color(0xFF7A5A12), Color(0xFF1E1606)]),
};

List<Color> liveThemeColors(String theme) => (liveThemes[theme] ?? liveThemes['classic']!).$2;

/// Animation d'un cadeau reçu : le cadeau surgit en rebondissant ; au-delà de 100 pièces des pièces jaillissent ; au-delà
/// de 1 000, une pluie de pièces traverse l'écran. Visible par tous les spectateurs, 3 secondes.
class GiftBurst extends StatefulWidget {
  const GiftBurst({super.key, required this.giftCode, required this.coins, required this.label});

  final String giftCode;
  final int coins;
  final String label;

  @override
  State<GiftBurst> createState() => _GiftBurstState();
}

class _GiftBurstState extends State<GiftBurst> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2800))..forward();
  late final List<_Particle> _particles = _makeParticles();

  List<_Particle> _makeParticles() {
    final n = widget.coins >= 1000 ? 26 : (widget.coins >= 100 ? 12 : 0);
    final r = Random(widget.giftCode.hashCode ^ widget.coins);
    return [for (var i = 0; i < n; i++) _Particle(dx: r.nextDouble() * 2 - 1, delay: r.nextDouble() * 0.35, speed: 0.6 + r.nextDouble() * 0.6, size: 10 + r.nextDouble() * 12)];
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final t = _c.value;
          // Entrée avec rebond (0 → 0,25), maintien, sortie en fondu (0,8 → 1).
          final scale = t < 0.25 ? Curves.elasticOut.transform(t / 0.25) : 1.0;
          final opacity = t > 0.8 ? (1 - (t - 0.8) / 0.2).clamp(0.0, 1.0) : 1.0;
          return IgnorePointer(
            child: Opacity(
              opacity: opacity,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  for (final p in _particles) _coin(p, t),
                  Transform.scale(
                    scale: scale,
                    child: Container(
                      key: const ValueKey('live-gift-anim'),
                      padding: const EdgeInsets.all(BimSpacing.md),
                      decoration: BoxDecoration(
                        color: BimColors.white.withValues(alpha: 0.94),
                        borderRadius: BorderRadius.circular(BimRadius.card),
                        boxShadow: [BoxShadow(color: BimColors.coin.withValues(alpha: 0.6), blurRadius: 24 + 16 * sin(t * pi * 4).abs())],
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          GiftArt(code: widget.giftCode, size: widget.coins >= 1000 ? 96 : 72),
                          Text(widget.label, style: const TextStyle(fontWeight: FontWeight.w800)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );

  Widget _coin(_Particle p, double t) {
    final local = ((t - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
    if (local <= 0) return const SizedBox.shrink();
    // Pluie (gros cadeau) : de haut en bas ; jaillissement : vers le haut puis retombée.
    final big = widget.coins >= 1000;
    final y = big ? -260 + 520 * local * p.speed : -180 * sin(local * pi) * p.speed;
    final x = p.dx * (big ? 170 : 120) * (big ? 1 : local);
    return Transform.translate(
      offset: Offset(x, y),
      child: Icon(Icons.monetization_on_rounded, color: BimColors.coin, size: p.size),
    );
  }
}

class _Particle {
  const _Particle({required this.dx, required this.delay, required this.speed, required this.size});
  final double dx;
  final double delay;
  final double speed;
  final double size;
}

/// Cœur qui s'envole quand on appuie sur « J'aime » pendant un Live.
class FloatingHeart extends StatefulWidget {
  const FloatingHeart({super.key, required this.onDone, this.seed = 0});

  final VoidCallback onDone;
  final int seed;

  @override
  State<FloatingHeart> createState() => _FloatingHeartState();
}

class _FloatingHeartState extends State<FloatingHeart> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))
    ..forward().whenComplete(() {
      if (mounted) widget.onDone();
    });
  late final double _drift = (Random(widget.seed).nextDouble() * 2 - 1) * 40;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        builder: (_, __) => IgnorePointer(
          child: Transform.translate(
            offset: Offset(_drift * sin(_c.value * pi), -220 * _c.value),
            child: Opacity(opacity: (1 - _c.value).clamp(0.0, 1.0), child: Icon(Icons.favorite_rounded, color: BimColors.red, size: 26 + 10 * (1 - _c.value))),
          ),
        ),
      );
}
