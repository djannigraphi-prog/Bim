import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../account/data/account_api.dart';
import '../../auth/application/session_controller.dart';
import '../../messaging/data/messaging_api.dart';
import '../../orders/data/orders_api.dart';
import '../data/shop_api.dart';

/// Lot 5-B — Écran 55, espace marchand : la boutique, ses articles et prestations.
/// Les ventes et commandes arrivent avec les commandes (lot 7) : rien n'est affiché à leur place, aucun chiffre inventé.
/// Le « + » central ajoute un article (E15).
class MerchantSpaceScreen extends ConsumerStatefulWidget {
  const MerchantSpaceScreen({super.key});

  @override
  ConsumerState<MerchantSpaceScreen> createState() => _MerchantSpaceScreenState();
}

class _MerchantSpaceScreenState extends ConsumerState<MerchantSpaceScreen> {
  String _tab = 'published';
  bool _leaving = false;
  Timer? _unreadTimer;

  @override
  void initState() {
    super.initState();
    // 6-B : pas de notification sur le téléphone ; la pastille Messages de la boutique est mise à jour régulièrement.
    _unreadTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (ref.read(shopDashboardProvider).valueOrNull?.can('messages.reply') ?? false) ref.invalidate(shopInboxUnreadProvider);
    });
  }

  @override
  void dispose() {
    _unreadTimer?.cancel();
    super.dispose();
  }

  /// Revenir au profil utilisateur (écran 53) : l'espace actif change côté serveur.
  Future<void> _backToProfile() async {
    setState(() => _leaving = true);
    try {
      final api = ref.read(accountApiProvider);
      final user = (await api.spaces()).firstWhere((s) => s.type == 'user');
      await ref.read(tokenStorageProvider).saveAccess(await api.switchSpace('user', user.id));
      await ref.read(sessionProvider.notifier).refreshMe();
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _leaving = false);
    }
  }

  void _refresh() {
    ref
      ..invalidate(shopDashboardProvider)
      ..invalidate(shopProductsProvider)
      ..invalidate(shopOrderCountsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final dash = ref.watch(shopDashboardProvider);
    // 7-A : « Messages » et « + » seulement avec la permission correspondante (propriétaire : tout).
    final me = dash.valueOrNull;
    final canReply = me?.can('messages.reply') ?? false;
    final canEdit = me?.can('products.edit') ?? false;
    final inboxUnread = canReply ? (ref.watch(shopInboxUnreadProvider).valueOrNull?.unread ?? 0) : 0;
    return Scaffold(
      body: SafeArea(
        child: dash.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Padding(
              padding: const EdgeInsets.all(BimSpacing.xl),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Peni(pose: PeniPose.sad, size: 110),
                  const SizedBox(height: BimSpacing.lg),
                  Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                  const SizedBox(height: BimSpacing.lg),
                  BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _refresh),
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(label: 'Revenir à mon profil', variant: BimButtonVariant.subtle, loading: _leaving, onPressed: _backToProfile),
                ],
              ),
            ),
          ),
          data: (d) => RefreshIndicator(
            onRefresh: () async {
              _refresh();
              await ref.read(shopDashboardProvider.future);
            },
            child: ListView(
              key: const PageStorageKey('merchant-space'),
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.lg, BimSpacing.screen, BimSpacing.xxl),
              children: [
                _Header(shop: d),
                const SizedBox(height: BimSpacing.lg),
                Row(
                  children: [
                    Expanded(child: _Stat(value: d.published, label: 'En ligne')),
                    const SizedBox(width: BimSpacing.sm),
                    Expanded(child: _Stat(value: d.drafts, label: 'Brouillons')),
                    const SizedBox(width: BimSpacing.sm),
                    Expanded(child: _Stat(value: d.followers, label: 'Abonnés')),
                  ],
                ),
                const SizedBox(height: BimSpacing.md),
                // 7-B : commandes à traiter (compteurs réels), pour qui peut les consulter.
                if (d.can('orders.read')) const _OrdersCard(),
                const SizedBox(height: BimSpacing.lg),
                // 7-A : les actions suivent mes permissions (le serveur les contrôle de toute façon).
                Row(
                  children: [
                    if (d.can('products.edit'))
                      _Action(key: const ValueKey('action-article'), icon: Icons.add_box_outlined, label: 'Article', onTap: () => context.push('/shop/products/new')),
                    _Action(icon: Icons.videocam_outlined, label: 'Live', onTap: () => showComingSoon(context, feature: 'Le live')),
                    _Action(icon: Icons.local_offer_outlined, label: 'Promo', onTap: () => showComingSoon(context, feature: 'Les promotions')),
                    if (d.isOwner) ...[
                      _Action(key: const ValueKey('action-requests'), icon: Icons.assignment_outlined, label: 'Demandes', onTap: () => context.push('/shop/requests')),
                      _Action(key: const ValueKey('action-team'), icon: Icons.group_outlined, label: 'Équipe', onTap: () => context.push('/shop/team')),
                    ],
                  ],
                ),
                const SizedBox(height: BimSpacing.xl),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'published', label: Text('En ligne (${d.published})')),
                    ButtonSegment(value: 'hidden', label: Text('Masqués (${d.hidden})')),
                    ButtonSegment(value: 'draft', label: Text('Brouillons (${d.drafts})')),
                  ],
                  selected: {_tab},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) => setState(() => _tab = s.first),
                ),
                const SizedBox(height: BimSpacing.md),
                _ProductList(status: _tab),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          height: 72,
          decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outline))),
          child: Row(
            children: [
              const Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.storefront, color: BimColors.red),
                    SizedBox(height: 2),
                    Text('Boutique', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: BimColors.red)),
                  ],
                ),
              ),
              if (!canReply)
                const Expanded(child: SizedBox())
              else
              Expanded(
                child: InkWell(
                  key: const ValueKey('shop-messages'),
                  onTap: () async {
                    await context.push('/shop/messages');
                    ref.invalidate(shopInboxUnreadProvider);
                  },
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Badge(
                        isLabelVisible: inboxUnread > 0,
                        label: Text(inboxUnread > 99 ? '99+' : '$inboxUnread'),
                        backgroundColor: BimColors.red,
                        child: Icon(Icons.chat_bubble_outline_rounded, color: scheme.onSurface),
                      ),
                      const SizedBox(height: 2),
                      Text('Messages', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: scheme.onSurface)),
                    ],
                  ),
                ),
              ),
              if (!canEdit)
                const Expanded(child: SizedBox())
              else
              Expanded(
                child: Center(
                  child: Semantics(
                    button: true,
                    label: 'Ajouter un article',
                    child: InkWell(
                      key: const ValueKey('add-product'),
                      borderRadius: BorderRadius.circular(BimRadius.button),
                      onTap: () => context.push('/shop/products/new'),
                      child: Container(
                        width: 64,
                        height: 56,
                        decoration: BoxDecoration(color: scheme.onSurface, borderRadius: BorderRadius.circular(BimRadius.button)),
                        child: Icon(Icons.add, size: 32, color: scheme.surface),
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: InkWell(
                  key: const ValueKey('back-to-profile'),
                  onTap: _leaving ? null : _backToProfile,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.swap_horiz, color: scheme.onSurface),
                      const SizedBox(height: 2),
                      Text('Mon profil', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: scheme.onSurface)),
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

class _Header extends StatelessWidget {
  const _Header({required this.shop});

  final ShopDashboard shop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final place = [shop.commune, shop.city].whereType<String>().where((s) => s.isNotEmpty).join(', ');
    return Row(
      children: [
        CircleAvatar(
          radius: 32,
          backgroundColor: BimColors.redSoft,
          foregroundImage: shop.logoUrl == null ? null : NetworkImage(shop.logoUrl!),
          child: const Icon(Icons.storefront_outlined, color: BimColors.red, size: 30),
        ),
        const SizedBox(width: BimSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(child: Text(shop.name, overflow: TextOverflow.ellipsis, style: theme.textTheme.headlineMedium?.copyWith(fontSize: 22))),
                  if (shop.verified) ...[
                    const SizedBox(width: BimSpacing.xs),
                    const Tooltip(message: 'Boutique vérifiée', child: Icon(Icons.verified, color: BimColors.red, size: 20)),
                  ],
                ],
              ),
              Text(place.isEmpty ? 'Espace marchand' : 'Espace marchand · $place', style: theme.textTheme.bodyMedium),
            ],
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final int value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: BimSpacing.md),
      decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
      child: Column(
        children: [
          Text('$value', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({super.key, required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Expanded(
        child: InkWell(
          borderRadius: BorderRadius.circular(BimRadius.card),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: BimSpacing.sm),
            child: Column(
              children: [
                CircleAvatar(radius: 26, backgroundColor: BimColors.redSoft, child: Icon(icon, color: BimColors.red)),
                const SizedBox(height: BimSpacing.xs),
                Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ),
      );
}

class _ProductList extends ConsumerWidget {
  const _ProductList({required this.status});

  final String status;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(shopProductsProvider(status));
    return async.when(
      loading: () => const Padding(padding: EdgeInsets.all(BimSpacing.xl), child: Center(child: CircularProgressIndicator())),
      error: (e, _) => Text(e is ApiException ? e.message : ApiException.unknown.message),
      data: (items) => items.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: BimSpacing.xl),
              child: Column(
                children: [
                  const Peni(pose: PeniPose.wave, size: 90),
                  const SizedBox(height: BimSpacing.md),
                  Text(
                    switch (status) {
                      'published' => 'Aucun article en ligne pour l’instant. Ajoute ton premier article avec « + ».',
                      'hidden' => 'Aucun article masqué. Masque un article en rupture : il garde sa référence et sa réputation.',
                      _ => 'Aucun brouillon.',
                    },
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            )
          : Column(children: [for (final p in items) _ProductTile(product: p)]),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product});

  final ProductSummary product;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final p = product;
    final stock = p.stock;
    return Padding(
      padding: const EdgeInsets.only(bottom: BimSpacing.sm),
      child: InkWell(
        key: ValueKey('product-${p.id}'),
        borderRadius: BorderRadius.circular(BimRadius.card),
        onTap: () => context.push('/shop/products/${p.id}'),
        child: Container(
          padding: const EdgeInsets.all(BimSpacing.sm),
          decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(BimRadius.chip),
                child: SizedBox(
                  width: 64,
                  height: 64,
                  child: p.imageUrl == null
                      ? ColoredBox(color: scheme.surfaceContainerHighest, child: const Icon(Icons.image_outlined))
                      : Image.network(p.imageUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined)),
                ),
              ),
              const SizedBox(width: BimSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    if (p.reference.isNotEmpty) Text('Réf. ${p.reference}', style: theme.textTheme.bodySmall),
                    const SizedBox(height: 2),
                    Wrap(
                      spacing: BimSpacing.sm,
                      children: [
                        Text(formatFcfa(p.priceFcfa), style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
                        if (p.compareAtFcfa != null)
                          Text(formatFcfa(p.compareAtFcfa!), style: theme.textTheme.bodySmall?.copyWith(decoration: TextDecoration.lineThrough)),
                      ],
                    ),
                    Text(
                      p.kind == 'service' ? 'Prestation' : (stock == 0 ? 'Rupture de stock' : 'Stock : $stock'),
                      style: theme.textTheme.bodySmall?.copyWith(color: stock == 0 && p.kind != 'service' ? BimColors.red : null),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

/// Commandes à traiter : à confirmer, à préparer, prêtes ; un appui ouvre « Commandes reçues ».
class _OrdersCard extends ConsumerWidget {
  const _OrdersCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final c = ref.watch(shopOrderCountsProvider).valueOrNull;
    final text = c == null
        ? 'Commandes reçues'
        : (c.toConfirm + c.toPrepare + c.ready == 0
            ? 'Aucune commande à traiter.'
            : [if (c.toConfirm > 0) '${c.toConfirm} à confirmer', if (c.toPrepare > 0) '${c.toPrepare} à préparer', if (c.ready > 0) '${c.ready} prête${c.ready > 1 ? 's' : ''}'].join(' · '));
    return InkWell(
      key: const ValueKey('shop-orders'),
      borderRadius: BorderRadius.circular(BimRadius.card),
      onTap: () => context.push('/shop/orders'),
      child: Container(
        padding: const EdgeInsets.all(BimSpacing.lg),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Row(
          children: [
            const Icon(Icons.receipt_long_outlined),
            const SizedBox(width: BimSpacing.md),
            Expanded(child: Text(text, key: const ValueKey('shop-orders-counts'), style: theme.textTheme.bodyMedium)),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}
