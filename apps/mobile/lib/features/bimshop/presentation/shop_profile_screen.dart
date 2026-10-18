import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../../messaging/presentation/messages_view.dart' show openShopConversation;
import '../data/bimshop_api.dart';
import 'bimshop_widgets.dart';

final _shopStateProvider = FutureProvider.autoDispose.family<({bool following, bool own}), String>((ref, slug) => ref.watch(bimShopApiProvider).shopState(slug));

/// Lot 5-C — Écran 54, profil public d'une boutique : présentation, abonnés, « Suivre », articles en ligne.
/// Onglets Lives et avis : avec leurs lots (Lives : lot 6 ; avis : après les commandes).
class ShopProfileScreen extends ConsumerStatefulWidget {
  const ShopProfileScreen({super.key, required this.slug});

  final String slug;

  @override
  ConsumerState<ShopProfileScreen> createState() => _ShopProfileScreenState();
}

class _ShopProfileScreenState extends ConsumerState<ShopProfileScreen> {
  bool? _following;
  int _delta = 0;
  bool _busy = false;
  // « Voir plus » (audit du 18/10) : pages suivantes des articles.
  final List<ShopCard> _more = [];
  String? _cursor;
  bool _loadingMore = false;

  Future<void> _loadMore(String cursor) async {
    setState(() => _loadingMore = true);
    try {
      final page = await ref.read(bimShopApiProvider).shop(widget.slug, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _more.addAll(page.items);
        _cursor = page.nextCursor ?? '';
      });
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  bool get _merchantSpace => switch (ref.read(sessionProvider)) {
        SessionSignedIn(:final me) => me.activeSpaceType == 'merchant',
        _ => false,
      };

  Future<void> _toggle(bool current) async {
    if (ref.read(sessionProvider) is! SessionSignedIn) {
      await showVisitorGate(context, ref);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(bimShopApiProvider).setFollow(widget.slug, !current);
      if (!mounted) return;
      setState(() {
        _following = !current;
        _delta += current ? -1 : 1;
      });
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(publicShopProvider(widget.slug));
    final signedIn = ref.watch(sessionProvider) is SessionSignedIn;
    final state = signedIn ? ref.watch(_shopStateProvider(widget.slug)).valueOrNull : null;
    final following = _following ?? state?.following ?? false;
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Peni(pose: PeniPose.sad, size: 100),
                const SizedBox(height: BimSpacing.md),
                Text(e is ApiException ? e.message : ApiException.unknown.message),
                const SizedBox(height: BimSpacing.md),
                const BimBackButton(),
              ],
            ),
          ),
          data: (s) => ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
              const SizedBox(height: BimSpacing.md),
              Row(
                children: [
                  CircleAvatar(
                    radius: 36,
                    backgroundColor: BimColors.redSoft,
                    foregroundImage: s.shop.logoUrl == null ? null : NetworkImage(s.shop.logoUrl!),
                    child: const Icon(Icons.storefront_outlined, color: BimColors.red, size: 32),
                  ),
                  const SizedBox(width: BimSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(child: Text(s.shop.name, overflow: TextOverflow.ellipsis, style: theme.textTheme.headlineMedium?.copyWith(fontSize: 22))),
                            if (s.shop.verified) const Padding(padding: EdgeInsets.only(left: 4), child: Tooltip(message: 'Boutique vérifiée', child: Icon(Icons.verified, color: BimColors.red, size: 20))),
                          ],
                        ),
                        if (s.shop.place.isNotEmpty) Text(s.shop.place, style: theme.textTheme.bodyMedium),
                        const SizedBox(height: 2),
                        Text(
                          '${s.productCount} article${s.productCount > 1 ? 's' : ''} · ${s.followers + _delta} abonné${s.followers + _delta > 1 ? 's' : ''}',
                          key: const ValueKey('shop-counts'),
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if ((s.description ?? '').isNotEmpty) ...[
                const SizedBox(height: BimSpacing.md),
                Text(s.description!, style: theme.textTheme.bodyLarge),
              ],
              if (state?.own != true) ...[
                const SizedBox(height: BimSpacing.lg),
                Row(
                  children: [
                    Expanded(
                      child: BimButton(
                        key: const ValueKey('follow-shop'),
                        label: following ? 'Abonné' : 'Suivre',
                        icon: following ? Icons.check : Icons.add,
                        variant: following ? BimButtonVariant.outline : BimButtonVariant.primary,
                        loading: _busy,
                        onPressed: () => _toggle(following),
                      ),
                    ),
                    // 6-B : écrire à la boutique (pas depuis l'espace boutique).
                    if (!_merchantSpace) ...[
                      const SizedBox(width: BimSpacing.sm),
                      Expanded(
                        child: BimButton(
                          key: const ValueKey('shop-chat'),
                          label: 'Écrire',
                          icon: Icons.chat_bubble_outline_rounded,
                          variant: BimButtonVariant.outline,
                          onPressed: () => ref.read(sessionProvider) is SessionSignedIn ? openShopConversation(context, ref, widget.slug) : showVisitorGate(context, ref),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
              const SizedBox(height: BimSpacing.xl),
              Text('Articles', style: theme.textTheme.titleLarge),
              const SizedBox(height: BimSpacing.md),
              if (s.items.isEmpty) const Text('Aucun article en ligne pour l’instant.') else ShopCardGrid(cards: [...s.items, ..._more], showShop: false),
              if ((_cursor ?? s.nextCursor ?? '').isNotEmpty)
                Center(
                  child: _loadingMore
                      ? const Padding(padding: EdgeInsets.all(BimSpacing.md), child: CircularProgressIndicator())
                      : TextButton(key: const ValueKey('shop-more'), onPressed: () => _loadMore(_cursor ?? s.nextCursor!), child: const Text('Voir plus')),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Articles mis de côté (cœur des écrans 32 et 34).
class ShopFavoritesScreen extends ConsumerWidget {
  const ShopFavoritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(shopFavoritesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mis de côté')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(e is ApiException ? e.message : ApiException.unknown.message)),
        data: (items) => items.isEmpty
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(BimSpacing.xl),
                  child: Text('Touche le cœur d’un article pour le retrouver ici.', textAlign: TextAlign.center),
                ),
              )
            : ListView(padding: const EdgeInsets.all(BimSpacing.screen), children: [ShopCardGrid(cards: items)]),
      ),
    );
  }
}
