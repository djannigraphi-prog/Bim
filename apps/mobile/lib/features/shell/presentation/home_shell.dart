import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollDirection;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/app_foreground.dart';
import '../../../core/widgets/brand.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../../bimshop/presentation/bimshop_view.dart';
import '../../lives/presentation/lives_view.dart';
import '../../messaging/data/messaging_api.dart';
import '../../messaging/presentation/messages_view.dart';
import '../../notifications/data/inbox_api.dart';
import '../../social/presentation/feed_view.dart';
import 'bim_nav_bar.dart';

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
  Timer? _unreadTimer;

  /// Barre du bas cachée quand on descend, de retour quand on remonte (demande du fondateur, 19/10/2026).
  bool _navHidden = false;

  bool _onScroll(UserScrollNotification n) {
    // Seulement le défilement vertical de la page (pas les rangées horizontales : stories, filtres).
    if (n.metrics.axis != Axis.vertical) return false;
    final hide = switch (n.direction) {
      ScrollDirection.reverse => n.metrics.extentBefore > 40,
      ScrollDirection.forward => false,
      ScrollDirection.idle => _navHidden,
    };
    if (hide != _navHidden) setState(() => _navHidden = hide);
    return false;
  }

  @override
  void initState() {
    super.initState();
    // Lot 6-A : pas de notification sur le téléphone ; la pastille Messages est mise à jour régulièrement.
    _unreadTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      // App en arrière-plan : pas de lecture inutile (batterie, forfait).
      if (appInForeground && ref.read(sessionProvider) is SessionSignedIn) ref.invalidate(messagesUnreadProvider);
    });
  }

  @override
  void dispose() {
    _unreadTimer?.cancel();
    super.dispose();
  }

  static const _tabs = [
    (icon: Icons.home_outlined, active: Icons.home_rounded, label: 'Accueil', lot: 'Le fil d’actualité, les stories et les Reels'),
    (icon: Icons.chat_bubble_outline_rounded, active: Icons.chat_bubble_rounded, label: 'Messages', lot: 'La messagerie'),
    (icon: Icons.add_rounded, active: Icons.add_rounded, label: 'Nouveau projet', lot: ''),
    (icon: Icons.sensors_rounded, active: Icons.sensors_rounded, label: 'Live', lot: 'Les Lives'),
    (icon: Icons.shopping_bag_outlined, active: Icons.shopping_bag_rounded, label: 'BimShop', lot: 'Le BimShop'),
  ];

  bool get _visitor => ref.read(sessionProvider) is! SessionSignedIn;

  void _onTap(int i) {
    if (i == 2) {
      // « + » central = créer un nouveau projet BIM (Q9) ; réservé aux comptes.
      if (_visitor) {
        showVisitorGate(context, ref);
      } else {
        context.push('/projects/new');
      }
      return;
    }
    if ((i == 1 || i == 3) && _visitor) {
      showVisitorGate(context, ref);
      return;
    }
    setState(() {
      _tab = i;
      _navHidden = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final tab = _tabs[_tab];
    // Pastille de la cloche : notifications pas encore vues (lot 2, écran 17).
    final unread = session is SessionSignedIn ? (ref.watch(inboxUnreadProvider).valueOrNull ?? 0) : 0;
    final messagesUnread = session is SessionSignedIn ? ref.watch(messagesUnreadProvider).valueOrNull : null;
    final messagesBadge = (messagesUnread?.conversations ?? 0) + (messagesUnread?.requests ?? 0);
    return Scaffold(
      // Barre du bas flottante (maquette du 19/10/2026) : le contenu défile dessous (effet vitre en mode nuit).
      extendBody: true,
      // V1 : l'onglet BimShop a son propre en-tête (« BimShop », maquette 32).
      appBar: _tab == 4
          ? null
          : AppBar(
        centerTitle: false,
        titleSpacing: BimSpacing.screen,
        title: BimLogo(height: 36, color: Theme.of(context).brightness == Brightness.dark ? BimLogoColor.white : BimLogoColor.red),
        actions: [
          // Maquette 10 : Reels (clap), recherche, notifications.
          if (_tab == 0)
            IconButton(
              key: const ValueKey('open-reels'),
              tooltip: 'Reels',
              icon: const Icon(Icons.movie_creation_outlined),
              onPressed: () => context.push('/reels'),
            ),
          IconButton(
            tooltip: 'Rechercher',
            icon: const Icon(Icons.search_rounded),
            onPressed: () => _visitor ? showVisitorGate(context, ref) : context.push('/search'),
          ),
          IconButton(
            tooltip: 'Notifications',
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text(unread > 99 ? '99+' : '$unread'),
              backgroundColor: BimColors.red,
              child: const Icon(Icons.notifications_none_rounded),
            ),
            onPressed: () => _visitor ? showVisitorGate(context, ref) : context.push('/notifications'),
          ),
          IconButton(
            tooltip: session is SessionSignedIn ? 'Mon compte' : 'Se connecter',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => session is SessionSignedIn ? context.push('/account') : showVisitorGate(context, ref),
          ),
          const SizedBox(width: BimSpacing.sm),
        ],
      ),
      // Lot 4 : l'Accueil d'une personne connectée est le fil (écran 10), avec ses projets en tête.
      // Lot 5-C : l'onglet BimShop (écran 32), visiteurs compris.
      body: NotificationListener<UserScrollNotification>(
        onNotification: _onScroll,
        child: _tab == 0
          ? FeedView(visitor: session is! SessionSignedIn)
          : _tab == 1 && session is SessionSignedIn
              ? const MessagesView()
              : _tab == 3 && session is SessionSignedIn
              ? const LivesView()
              : _tab == 4
              ? BimShopView(visitor: session is! SessionSignedIn)
              : Center(
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
      ),
      bottomNavigationBar: AnimatedSlide(
        key: const ValueKey('bim-nav-slide'),
        offset: _navHidden ? const Offset(0, 1.5) : Offset.zero,
        duration: BimDurations.fast,
        curve: Curves.easeOut,
        child: BimNavBar(
          items: [for (final t in _tabs) (icon: t.icon, active: t.active, label: t.label)],
          current: _tab,
          onTap: _onTap,
          badges: {1: messagesBadge},
        ),
      ),
    );
  }
}
