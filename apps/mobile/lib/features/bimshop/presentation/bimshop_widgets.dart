import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../merchant/data/shop_api.dart' show formatFcfa;
import '../data/bimshop_api.dart';

/// Carte d'un article (grille des écrans 32 et 54) : photo, nom, prix (prix barré), boutique.
class ShopCardTile extends StatelessWidget {
  const ShopCardTile({super.key, required this.card, this.showShop = true});

  final ShopCard card;
  final bool showShop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final c = card;
    return InkWell(
      key: ValueKey('shop-card-${c.id}'),
      borderRadius: BorderRadius.circular(BimRadius.card),
      onTap: () => context.push('/bimshop/products/${c.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(BimRadius.card),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (c.imageUrl == null)
                    ColoredBox(color: scheme.surfaceContainerHighest, child: const Icon(Icons.image_outlined, size: 36))
                  else
                    Image.network(c.imageUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => ColoredBox(color: scheme.surfaceContainerHighest, child: const Icon(Icons.broken_image_outlined))),
                  if (!c.available)
                    const Positioned(
                      left: BimSpacing.sm,
                      top: BimSpacing.sm,
                      child: _Badge(text: 'Épuisé', color: BimColors.grey800),
                    )
                  else if (c.compareAtFcfa != null)
                    Positioned(
                      left: BimSpacing.sm,
                      top: BimSpacing.sm,
                      child: _Badge(text: '-${(100 - c.priceFcfa * 100 / c.compareAtFcfa!).round()} %', color: BimColors.red),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: BimSpacing.xs),
          Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
          Wrap(
            spacing: BimSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(formatFcfa(c.priceFcfa), style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w800)),
              if (c.compareAtFcfa != null) Text(formatFcfa(c.compareAtFcfa!), style: theme.textTheme.bodySmall?.copyWith(decoration: TextDecoration.lineThrough)),
            ],
          ),
          if (showShop)
            Row(
              children: [
                Flexible(child: Text(c.shop.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall)),
                if (c.shop.verified) const Padding(padding: EdgeInsets.only(left: 2), child: Icon(Icons.verified, size: 14, color: BimColors.red)),
              ],
            ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm, vertical: 2),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: Text(text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
      );
}

/// Grille de cartes à deux colonnes, dans une liste qui défile déjà.
class ShopCardGrid extends StatelessWidget {
  const ShopCardGrid({super.key, required this.cards, this.showShop = true});

  final List<ShopCard> cards;
  final bool showShop;

  @override
  Widget build(BuildContext context) => GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: BimSpacing.lg, crossAxisSpacing: BimSpacing.md, childAspectRatio: 0.62),
        itemCount: cards.length,
        itemBuilder: (_, i) => ShopCardTile(card: cards[i], showShop: showShop),
      );
}
