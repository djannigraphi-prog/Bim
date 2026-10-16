import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../../merchant/data/shop_api.dart' show formatFcfa;
import '../../messaging/presentation/messages_view.dart' show openShopConversation;
import '../data/bimshop_api.dart';
import 'bimshop_widgets.dart';

final _productStateProvider = FutureProvider.autoDispose.family<({bool favorite, bool followingShop}), String>((ref, id) => ref.watch(bimShopApiProvider).productState(id));

/// Lot 5-C — Écran 34, fiche article : photos, prix (prix barré), tailles disponibles, boutique, autres articles.
/// La commande arrive au lot 7 : le bouton l'annonce, aucun paiement ici.
class ShopProductScreen extends ConsumerStatefulWidget {
  const ShopProductScreen({super.key, required this.productId});

  final String productId;

  @override
  ConsumerState<ShopProductScreen> createState() => _ShopProductScreenState();
}

class _ShopProductScreenState extends ConsumerState<ShopProductScreen> {
  String? _variant;
  int _photo = 0;
  bool? _favorite;

  bool get _signedIn => ref.read(sessionProvider) is SessionSignedIn;

  /// Espace boutique actif : on n'écrit pas à une boutique en son nom (la messagerie cliente est dans l'espace utilisateur).
  bool get _merchantSpace => switch (ref.read(sessionProvider)) {
        SessionSignedIn(:final me) => me.activeSpaceType == 'merchant',
        _ => false,
      };

  Future<void> _toggleFavorite(bool current) async {
    if (!_signedIn) {
      await showVisitorGate(context, ref);
      return;
    }
    setState(() => _favorite = !current);
    try {
      await ref.read(bimShopApiProvider).setFavorite(widget.productId, !current);
      ref.invalidate(shopFavoritesProvider);
      if (mounted) showBimSnack(context, current ? 'Retiré de tes articles mis de côté' : 'Mis de côté');
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _favorite = current);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(shopProductProvider(widget.productId));
    final signedIn = ref.watch(sessionProvider) is SessionSignedIn;
    final state = signedIn ? ref.watch(_productStateProvider(widget.productId)).valueOrNull : null;
    final favorite = _favorite ?? state?.favorite ?? false;
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Padding(
              padding: const EdgeInsets.all(BimSpacing.xl),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Peni(pose: PeniPose.sad, size: 100),
                  const SizedBox(height: BimSpacing.md),
                  Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                  const SizedBox(height: BimSpacing.md),
                  const BimBackButton(),
                ],
              ),
            ),
          ),
          data: (p) => _body(context, p, favorite),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, ShopProduct p, bool favorite) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final needsVariant = p.kind != 'service' && p.variants.length > 1;
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 1,
                    child: p.photos.isEmpty
                        ? ColoredBox(color: scheme.surfaceContainerHighest, child: const Icon(Icons.image_outlined, size: 48))
                        : PageView(
                            onPageChanged: (i) => setState(() => _photo = i),
                            children: [
                              for (final url in p.photos)
                                url == null
                                    ? ColoredBox(color: scheme.surfaceContainerHighest, child: const Icon(Icons.image_outlined, size: 48))
                                    : Image.network(url, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined)),
                            ],
                          ),
                  ),
                  Positioned(
                    left: BimSpacing.sm,
                    top: BimSpacing.sm,
                    child: CircleAvatar(backgroundColor: scheme.surface, child: const BimBackButton()),
                  ),
                  Positioned(
                    right: BimSpacing.sm,
                    top: BimSpacing.sm,
                    // Le bouton garde sa taille de toucher (48 px) : un cercle de 40 px le masquait.
                    child: Material(
                      color: scheme.surface,
                      shape: const CircleBorder(),
                      child: IconButton(
                        key: const ValueKey('favorite'),
                        tooltip: favorite ? 'Retirer des articles mis de côté' : 'Mettre de côté',
                        icon: Icon(favorite ? Icons.favorite : Icons.favorite_border, color: favorite ? BimColors.red : null),
                        onPressed: () => _toggleFavorite(favorite),
                      ),
                    ),
                  ),
                  if (p.photos.length > 1)
                    Positioned(
                      bottom: BimSpacing.sm,
                      left: 0,
                      right: 0,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          for (var i = 0; i < p.photos.length; i++)
                            Container(
                              width: 8,
                              height: 8,
                              margin: const EdgeInsets.symmetric(horizontal: 3),
                              decoration: BoxDecoration(shape: BoxShape.circle, color: i == _photo ? BimColors.red : Colors.white70),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.all(BimSpacing.screen),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (p.categoryLabel != null) Text(p.categoryLabel!, style: theme.textTheme.bodySmall),
                    Text(p.title, style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
                    const SizedBox(height: BimSpacing.xs),
                    Wrap(
                      spacing: BimSpacing.sm,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(formatFcfa(p.priceFcfa), style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w800, fontSize: 22)),
                        if (p.compareAtFcfa != null) Text(formatFcfa(p.compareAtFcfa!), style: theme.textTheme.bodyLarge?.copyWith(decoration: TextDecoration.lineThrough)),
                      ],
                    ),
                    const SizedBox(height: BimSpacing.xs),
                    Text(
                      p.kind == 'service'
                          ? (p.durationMinutes == null ? 'Prestation' : 'Prestation · ${_duration(p.durationMinutes!)}')
                          : (p.available ? 'Disponible' : 'Épuisé pour le moment'),
                      style: TextStyle(color: p.available ? BimColors.success : BimColors.red, fontWeight: FontWeight.w600),
                    ),
                    if (needsVariant) ...[
                      const SizedBox(height: BimSpacing.lg),
                      Text('Taille ou modèle', style: theme.textTheme.titleMedium),
                      const SizedBox(height: BimSpacing.sm),
                      Wrap(
                        spacing: BimSpacing.sm,
                        runSpacing: BimSpacing.sm,
                        children: [
                          for (final v in p.variants)
                            ChoiceChip(
                              label: Text(v.label, style: v.available ? null : const TextStyle(decoration: TextDecoration.lineThrough)),
                              selected: _variant == v.id,
                              onSelected: v.available ? (_) => setState(() => _variant = v.id) : null,
                            ),
                        ],
                      ),
                    ],
                    if ((p.description ?? '').isNotEmpty) ...[
                      const SizedBox(height: BimSpacing.lg),
                      Text(p.description!, style: theme.textTheme.bodyLarge),
                    ],
                    const SizedBox(height: BimSpacing.lg),
                    InkWell(
                      key: const ValueKey('product-shop'),
                      borderRadius: BorderRadius.circular(BimRadius.card),
                      onTap: () => context.push('/bimshop/shops/${p.shop.slug}'),
                      child: Container(
                        padding: const EdgeInsets.all(BimSpacing.md),
                        decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
                        child: Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: BimColors.redSoft,
                              foregroundImage: p.shop.logoUrl == null ? null : NetworkImage(p.shop.logoUrl!),
                              child: const Icon(Icons.storefront_outlined, color: BimColors.red),
                            ),
                            const SizedBox(width: BimSpacing.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Flexible(child: Text(p.shop.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                                      if (p.shop.verified) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: BimColors.red)),
                                    ],
                                  ),
                                  if (p.shop.place.isNotEmpty) Text(p.shop.place, style: theme.textTheme.bodySmall),
                                ],
                              ),
                            ),
                            const Icon(Icons.chevron_right),
                          ],
                        ),
                      ),
                    ),
                    if (p.moreFromShop.isNotEmpty) ...[
                      const SizedBox(height: BimSpacing.xl),
                      Text('Du même marchand', style: theme.textTheme.titleMedium),
                      const SizedBox(height: BimSpacing.sm),
                      ShopCardGrid(cards: p.moreFromShop, showShop: false),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.md),
          child: Row(
            children: [
              // 6-B : écrire à la boutique à propos de cet article (visiteurs : invitation à créer un compte).
              if (!_merchantSpace) ...[
                Expanded(
                  child: BimButton(
                    key: const ValueKey('product-chat'),
                    label: 'Discuter',
                    icon: Icons.chat_bubble_outline_rounded,
                    variant: BimButtonVariant.outline,
                    onPressed: () => _signedIn ? openShopConversation(context, ref, p.shop.slug, productId: p.id) : showVisitorGate(context, ref),
                  ),
                ),
                const SizedBox(width: BimSpacing.sm),
              ],
              Expanded(
                child: BimButton(
                  key: const ValueKey('order'),
                  label: p.kind == 'service' ? 'Réserver' : 'Commander',
                  onPressed: p.available ? () => showComingSoon(context, feature: p.kind == 'service' ? 'La réservation' : 'La commande') : null,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  static String _duration(int minutes) {
    if (minutes < 60) return '$minutes min';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '$h h' : '$h h ${m.toString().padLeft(2, '0')}';
  }
}
