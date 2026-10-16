import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../data/bimshop_api.dart';
import 'bimshop_widgets.dart';

/// Lot 5-C — Écran 32, onglet BimShop : recherche, rubriques, tri, grille d'articles.
/// Visiteurs compris (lecture seule). Recherche par photo et Gold : plus tard (non prévus dans ce lot).
class BimShopView extends ConsumerStatefulWidget {
  const BimShopView({super.key, this.visitor = false});

  final bool visitor;

  @override
  ConsumerState<BimShopView> createState() => _BimShopViewState();
}

class _BimShopViewState extends ConsumerState<BimShopView> {
  late final _search = TextEditingController(text: ref.read(bimShopQueryProvider).q);

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _setQuery(BimShopQuery q) => ref.read(bimShopQueryProvider.notifier).state = q;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = ref.watch(bimShopQueryProvider);
    final results = ref.watch(bimShopResultsProvider);
    final rubriques = ref.watch(rubriquesProvider).valueOrNull ?? const <Rubrique>[];
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(bimShopResultsProvider)
          ..invalidate(rubriquesProvider);
        await ref.read(bimShopResultsProvider.future);
      },
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.extentAfter < 600) ref.read(bimShopResultsProvider.notifier).loadMore().ignore();
          return false;
        },
        child: ListView(
          key: const PageStorageKey('bimshop'),
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('bimshop-search'),
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (v) => _setQuery(query.copyWith(q: v)),
                    decoration: InputDecoration(
                      hintText: 'Rechercher un article, une boutique…',
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: query.q.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Effacer',
                              icon: const Icon(Icons.close),
                              onPressed: () {
                                _search.clear();
                                _setQuery(query.copyWith(q: ''));
                              },
                            ),
                    ),
                  ),
                ),
                const SizedBox(width: BimSpacing.xs),
                IconButton(
                  key: const ValueKey('bimshop-favorites'),
                  tooltip: 'Mis de côté',
                  icon: const Icon(Icons.favorite_border),
                  onPressed: () => widget.visitor ? showVisitorGate(context, ref) : context.push('/bimshop/favorites'),
                ),
              ],
            ),
            const SizedBox(height: BimSpacing.md),
            SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: BimSpacing.sm),
                    child: ActionChip(
                      key: const ValueKey('rubriques'),
                      avatar: const Icon(Icons.grid_view_rounded, size: 18),
                      label: const Text('Rubriques'),
                      onPressed: () => context.push('/bimshop/categories'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(right: BimSpacing.sm),
                    child: ChoiceChip(label: const Text('Tout'), selected: query.category == null, onSelected: (_) => _setQuery(query.copyWith(clearCategory: true))),
                  ),
                  for (final r in rubriques)
                    Padding(
                      padding: const EdgeInsets.only(right: BimSpacing.sm),
                      child: ChoiceChip(
                        label: Text(r.label),
                        selected: query.category == r.code || r.children.any((c) => c.code == query.category),
                        onSelected: (_) => _setQuery(query.copyWith(category: r.code, categoryLabel: r.label)),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: BimSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: Text(
                    query.categoryLabel ?? (query.q.isEmpty ? 'Nouveautés' : 'Résultats'),
                    style: theme.textTheme.titleLarge,
                  ),
                ),
                PopupMenuButton<String>(
                  key: const ValueKey('bimshop-sort'),
                  tooltip: 'Trier',
                  initialValue: query.sort,
                  onSelected: (s) => _setQuery(query.copyWith(sort: s)),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'recent', child: Text('Plus récents')),
                    PopupMenuItem(value: 'price_asc', child: Text('Prix croissant')),
                    PopupMenuItem(value: 'price_desc', child: Text('Prix décroissant')),
                  ],
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(const {'recent': 'Plus récents', 'price_asc': 'Prix croissant', 'price_desc': 'Prix décroissant'}[query.sort] ?? ''),
                      const Icon(Icons.expand_more),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: BimSpacing.md),
            ...results.when(
              loading: () => [const Padding(padding: EdgeInsets.all(BimSpacing.xxl), child: Center(child: CircularProgressIndicator()))],
              error: (e, _) => [
                const SizedBox(height: BimSpacing.xl),
                const Peni(pose: PeniPose.sad, size: 100),
                const SizedBox(height: BimSpacing.md),
                Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                const SizedBox(height: BimSpacing.md),
                BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(bimShopResultsProvider)),
              ],
              data: (page) => page.items.isEmpty
                  ? [
                      const SizedBox(height: BimSpacing.xl),
                      const Peni(pose: PeniPose.think, size: 100),
                      const SizedBox(height: BimSpacing.md),
                      Text(
                        query.q.isEmpty && query.category == null ? 'Les premières boutiques arrivent bientôt sur BIM.' : 'Aucun article ne correspond pour l’instant.',
                        textAlign: TextAlign.center,
                      ),
                    ]
                  : [
                      ShopCardGrid(cards: page.items),
                      if (page.loadingMore)
                        const Padding(padding: EdgeInsets.all(BimSpacing.lg), child: Center(child: CircularProgressIndicator()))
                      else if (page.hasMore)
                        // Toujours accessible, même si la première page ne remplit pas l'écran.
                        Center(
                          child: TextButton(
                            key: const ValueKey('bimshop-more'),
                            onPressed: () => ref.read(bimShopResultsProvider.notifier).loadMore(retry: true),
                            child: Text(page.pageError ? 'Réessayer' : 'Voir plus'),
                          ),
                        ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Écran 33 — Rubriques et sous-rubriques ; le choix filtre l'écran 32.
class RubriquesScreen extends ConsumerWidget {
  const RubriquesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(rubriquesProvider);
    void pick(String code, String label) {
      ref.read(bimShopQueryProvider.notifier).state = ref.read(bimShopQueryProvider).copyWith(category: code, categoryLabel: label);
      context.canPop() ? context.pop() : context.go('/home');
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Rubriques')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(e is ApiException ? e.message : ApiException.unknown.message)),
        data: (items) => ListView(
          padding: const EdgeInsets.symmetric(vertical: BimSpacing.sm),
          children: [
            for (final r in items)
              r.children.isEmpty
                  ? ListTile(
                      title: Text(r.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                      trailing: Text('${r.products}'),
                      onTap: () => pick(r.code, r.label),
                    )
                  : ExpansionTile(
                      key: ValueKey('rubrique-${r.code}'),
                      title: Text(r.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(r.products == 0 ? 'Aucun article pour l’instant' : '${r.products} article${r.products > 1 ? 's' : ''}'),
                      children: [
                        ListTile(title: Text('Tout « ${r.label} »'), onTap: () => pick(r.code, r.label)),
                        for (final c in r.children) ListTile(title: Text(c.label), trailing: Text('${c.products}'), onTap: () => pick(c.code, '${r.label} · ${c.label}')),
                      ],
                    ),
          ],
        ),
      ),
    );
  }
}
