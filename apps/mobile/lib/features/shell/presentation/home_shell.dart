import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';

/// Barre du bas des maquettes (Q8) : Accueil · Messages · « + » (nouveau projet, Q9) · Live · BimShop.
/// Lot 0 : la navigation et le mode visiteur sont en place ; le contenu de chaque onglet arrive avec son lot
/// et chaque onglet l'indique clairement (« Bientôt disponible »).
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;

  static const _tabs = [
    (icon: Icons.home_outlined, active: Icons.home_rounded, label: 'Accueil', lot: 'Le fil d’actualité, les stories et les Reels'),
    (icon: Icons.chat_bubble_outline_rounded, active: Icons.chat_bubble_rounded, label: 'Messages', lot: 'La messagerie'),
    (icon: Icons.add, active: Icons.add, label: '', lot: ''),
    (icon: Icons.radio_button_checked_outlined, active: Icons.radio_button_checked, label: 'Live', lot: 'Les Lives'),
    (icon: Icons.storefront_outlined, active: Icons.storefront, label: 'BimShop', lot: 'Le BimShop'),
  ];

  bool get _visitor => ref.read(sessionProvider) is! SessionSignedIn;

  void _onTap(int i) {
    if (i == 2) {
      // « + » central = créer un nouveau projet BIM (Q9) ; réservé aux comptes.
      if (_visitor) {
        showVisitorGate(context, ref);
      } else {
        showComingSoon(context, feature: 'La création de projet BIM');
      }
      return;
    }
    if (i == 1 && _visitor) {
      showVisitorGate(context, ref);
      return;
    }
    setState(() => _tab = i);
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final scheme = Theme.of(context).colorScheme;
    final tab = _tabs[_tab];
    return Scaffold(
      appBar: AppBar(
        centerTitle: false,
        titleSpacing: BimSpacing.screen,
        title: BimLogo(height: 36, color: Theme.of(context).brightness == Brightness.dark ? BimLogoColor.white : BimLogoColor.red),
        actions: [
          IconButton(tooltip: 'Rechercher', icon: const Icon(Icons.search_rounded), onPressed: () => showComingSoon(context, feature: 'La recherche')),
          IconButton(
            tooltip: 'Notifications',
            icon: const Icon(Icons.notifications_none_rounded),
            onPressed: () => _visitor ? showVisitorGate(context, ref) : showComingSoon(context, feature: 'Le centre de notifications'),
          ),
          IconButton(
            tooltip: session is SessionSignedIn ? 'Mon compte' : 'Se connecter',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => session is SessionSignedIn ? context.push('/account') : showVisitorGate(context, ref),
          ),
          const SizedBox(width: BimSpacing.sm),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(BimSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Peni(pose: PeniPose.think, size: 110),
              const SizedBox(height: BimSpacing.lg),
              Text(tab.label, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: BimSpacing.sm),
              Text('${tab.lot} arrive dans une prochaine version.', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          height: 72,
          decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outline))),
          child: Row(
            children: [
              for (var i = 0; i < _tabs.length; i++)
                Expanded(
                  child: i == 2
                      ? Center(
                          child: Semantics(
                            button: true,
                            label: 'Nouveau projet',
                            child: InkWell(
                              borderRadius: BorderRadius.circular(BimRadius.button),
                              onTap: () => _onTap(2),
                              child: Container(
                                width: 64,
                                height: 56,
                                decoration: BoxDecoration(color: scheme.onSurface, borderRadius: BorderRadius.circular(BimRadius.button)),
                                child: Icon(Icons.add, size: 32, color: scheme.surface),
                              ),
                            ),
                          ),
                        )
                      : InkWell(
                          onTap: () => _onTap(i),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(_tab == i ? _tabs[i].active : _tabs[i].icon, color: _tab == i ? BimColors.red : scheme.onSurface),
                              const SizedBox(height: 2),
                              Text(
                                _tabs[i].label,
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _tab == i ? BimColors.red : scheme.onSurface),
                              ),
                            ],
                          ),
                        ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
