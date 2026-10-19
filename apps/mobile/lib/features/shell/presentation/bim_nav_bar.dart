import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';

/// Un onglet de la barre du bas.
typedef BimNavItem = ({IconData icon, IconData active, String label});

/// Barre du bas (maquette validée par le fondateur le 19/10/2026) : une pilule fine qui flotte au-dessus du contenu,
/// icônes sans texte (le nom de l'onglet reste lu par le lecteur d'écran et affiché en info-bulle), l'onglet actif dans
/// une pastille légère, le « + » en petit rond rouge. En mode nuit : transparente, effet vitre (flou du contenu dessous).
class BimNavBar extends StatelessWidget {
  const BimNavBar({super.key, required this.items, required this.current, required this.onTap, this.centerIndex = 2, this.badges = const {}});

  final List<BimNavItem> items;
  final int current;
  final int centerIndex;
  final ValueChanged<int> onTap;

  /// Pastille rouge par onglet (messages non lus).
  final Map<int, int> badges;

  static const height = 58.0;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bar = dark ? const Color(0x853A3A3E) : const Color(0xE0FFFFFF);
    final border = dark ? const Color(0x1AFFFFFF) : const Color(0x0F101116);
    final icon = dark ? const Color(0xFFE6E6EA) : BimColors.grey800;
    final activeColor = dark ? const Color(0xFFFF4D6A) : BimColors.red;
    final activeBg = dark ? const Color(0x1AFFFFFF) : const Color(0x17F20D3A);
    final radius = BorderRadius.circular(height / 2);
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: radius,
            boxShadow: [BoxShadow(color: dark ? const Color(0x59000000) : const Color(0x1A101116), blurRadius: 28, offset: const Offset(0, 8))],
          ),
          child: ClipRRect(
            borderRadius: radius,
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 22, sigmaY: 22),
              child: Container(
                key: const ValueKey('bim-nav'),
                height: height,
                padding: const EdgeInsets.symmetric(horizontal: 7),
                decoration: BoxDecoration(color: bar, borderRadius: radius, border: Border.all(color: border)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    for (var i = 0; i < items.length; i++)
                      i == centerIndex
                          ? _NavButton(
                              key: ValueKey('nav-$i'),
                              label: items[i].label,
                              selected: false,
                              onTap: () => onTap(i),
                              child: Container(
                                width: 42,
                                height: 42,
                                decoration: const BoxDecoration(color: BimColors.red, shape: BoxShape.circle),
                                child: Icon(items[i].icon, size: 24, color: BimColors.white),
                              ),
                            )
                          : _NavButton(
                              key: ValueKey('nav-$i'),
                              label: items[i].label,
                              selected: i == current,
                              onTap: () => onTap(i),
                              child: AnimatedContainer(
                                duration: BimDurations.fast,
                                width: 58,
                                height: 42,
                                decoration: BoxDecoration(color: i == current ? activeBg : Colors.transparent, borderRadius: BorderRadius.circular(21)),
                                child: Badge(
                                  isLabelVisible: (badges[i] ?? 0) > 0,
                                  label: Text((badges[i] ?? 0) > 99 ? '99+' : '${badges[i] ?? 0}'),
                                  backgroundColor: BimColors.red,
                                  alignment: const AlignmentDirectional(0.55, -0.75),
                                  child: Center(
                                    child: Icon(i == current ? items[i].active : items[i].icon, size: 24, color: i == current ? activeColor : icon),
                                  ),
                                ),
                              ),
                            ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({super.key, required this.label, required this.selected, required this.onTap, required this.child});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: label,
        child: Semantics(
          button: true,
          selected: selected,
          label: label,
          excludeSemantics: true,
          child: InkWell(customBorder: const StadiumBorder(), onTap: onTap, child: child),
        ),
      );
}
