import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../bimshop/data/bimshop_api.dart';
import '../application/social_providers.dart';
import '../data/social_models.dart';

/// Lot 5-E — « Produits et services utilisés » d'un « J'ai fait mon BIM » (écran 11, règle E2).
/// Un lien vers la fiche du BimShop : aucun prix, aucun bouton d'achat, aucune commande depuis la publication.
const maxUsedProducts = 5;

class UsedProductsSection extends ConsumerWidget {
  const UsedProductsSection({super.key, required this.post, required this.onChanged});

  final FeedPost post;
  final ValueChanged<FeedPost> onChanged;

  Future<void> _edit(BuildContext context) async {
    final updated = await showModalBottomSheet<FeedPost>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _UsedProductsSheet(post: post),
    );
    if (updated != null) onChanged(updated);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final items = post.usedProducts;
    if (items.isEmpty && !post.isMine) return const SizedBox.shrink();
    return Column(
      key: const ValueKey('used-products'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: BimSpacing.lg),
        Row(
          children: [
            Expanded(child: Text('Produits et services utilisés', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
            if (post.isMine) TextButton(key: const ValueKey('used-products-edit'), onPressed: () => _edit(context), child: Text(items.isEmpty ? 'Ajouter' : 'Modifier')),
          ],
        ),
        if (items.isEmpty)
          Text('Ajoute les articles et prestations du BimShop qui t’ont aidé·e.', style: theme.textTheme.bodySmall)
        else
          for (final p in items)
            ListTile(
              key: ValueKey('used-product-${p.id}'),
              contentPadding: EdgeInsets.zero,
              leading: ClipRRect(
                borderRadius: BorderRadius.circular(BimRadius.chip),
                child: SizedBox(
                  width: 48,
                  height: 48,
                  child: p.imageUrl == null ? const Icon(Icons.shopping_bag_outlined) : Image.network(p.imageUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.shopping_bag_outlined)),
                ),
              ),
              title: Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text([p.shopName, if (!p.available) 'épuisé'].join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: const Icon(Icons.chevron_right),
              // Ouvre la fiche (écran 34) : la commande, s'il y en a une, se passe là-bas.
              onTap: () => context.push('/bimshop/products/${p.id}'),
            ),
      ],
    );
  }
}

/// Choisir jusqu'à 5 articles ou prestations visibles du BimShop ; le serveur revérifie chacun.
class _UsedProductsSheet extends ConsumerStatefulWidget {
  const _UsedProductsSheet({required this.post});
  final FeedPost post;

  @override
  ConsumerState<_UsedProductsSheet> createState() => _UsedProductsSheetState();
}

class _UsedProductsSheetState extends ConsumerState<_UsedProductsSheet> {
  final _q = TextEditingController();
  late final List<({String id, String title, String shop})> _selected = [for (final p in widget.post.usedProducts) (id: p.id, title: p.title, shop: p.shopName)];
  List<ShopCard> _results = const [];
  bool _searching = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final q = _q.text.trim();
    if (q.isEmpty) return;
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final r = await ref.read(bimShopApiProvider).browse(BimShopQuery(q: q));
      if (mounted) setState(() => _results = r.items);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _toggle(ShopCard c) {
    setState(() {
      if (_selected.any((s) => s.id == c.id)) {
        _selected.removeWhere((s) => s.id == c.id);
      } else if (_selected.length < maxUsedProducts) {
        _selected.add((id: c.id, title: c.title, shop: c.shop.name));
      }
    });
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final updated = await ref.read(socialApiProvider).setUsedProducts(widget.post.id, [for (final s in _selected) s.id]);
      if (mounted) Navigator.pop(context, updated);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = e.message);
        showApiError(context, e);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.lg, BimSpacing.screen, BimSpacing.lg + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Produits et services utilisés', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.xs),
            Text('$maxUsedProducts au plus. Tes lecteurs verront un lien vers la fiche du BimShop.', style: theme.textTheme.bodySmall),
            const SizedBox(height: BimSpacing.sm),
            Wrap(
              spacing: BimSpacing.xs,
              runSpacing: BimSpacing.xs,
              children: [
                for (final s in _selected)
                  InputChip(
                    key: ValueKey('used-selected-${s.id}'),
                    label: Text(s.title, overflow: TextOverflow.ellipsis),
                    deleteIcon: Icon(Icons.close, size: 18, key: ValueKey('used-remove-${s.id}')),
                    onDeleted: () => setState(() => _selected.removeWhere((x) => x.id == s.id)),
                  ),
              ],
            ),
            const SizedBox(height: BimSpacing.sm),
            TextField(
              key: const ValueKey('used-search'),
              controller: _q,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              decoration: InputDecoration(
                hintText: 'Chercher un article ou une prestation',
                suffixIcon: IconButton(key: const ValueKey('used-search-go'), tooltip: 'Chercher', icon: const Icon(Icons.search), onPressed: _searching ? null : _search),
              ),
            ),
            if (_searching) const Padding(padding: EdgeInsets.all(BimSpacing.md), child: Center(child: CircularProgressIndicator())),
            for (final c in _results)
              CheckboxListTile(
                key: ValueKey('used-result-${c.id}'),
                contentPadding: EdgeInsets.zero,
                value: _selected.any((s) => s.id == c.id),
                onChanged: !_selected.any((s) => s.id == c.id) && _selected.length >= maxUsedProducts ? null : (_) => _toggle(c),
                title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(c.shop.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            if (_error != null) Text(_error!, key: const ValueKey('used-error'), style: const TextStyle(color: BimColors.red)),
            const SizedBox(height: BimSpacing.md),
            BimButton(key: const ValueKey('used-save'), label: 'Enregistrer', loading: _saving, onPressed: _saving ? null : _save),
          ],
        ),
      ),
    );
  }
}
