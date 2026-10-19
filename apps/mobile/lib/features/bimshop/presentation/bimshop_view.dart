import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../data/bimshop_api.dart';
import 'bimshop_widgets.dart';

/// Lot 5-C — Écran 32, onglet BimShop : recherche, rubriques, tri, articles. Visiteurs compris (lecture seule).
/// V1 (19/10/2026) : comme la maquette 32, mosaïque façon Pinterest à grandes photos ou vidéos (carré ou portrait).
/// Recherche par photo : plus tard.
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

  /// Tri et rubriques (bouton de filtre de la maquette 32).
  Future<void> _filters(BimShopQuery query) async {
    const sorts = {'recent': 'Plus récents', 'price_asc': 'Prix croissant', 'price_desc': 'Prix décroissant'};
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(title: Text('Trier', style: TextStyle(fontWeight: FontWeight.w800))),
            for (final e in sorts.entries)
              ListTile(
                key: ValueKey('sort-${e.key}'),
                title: Text(e.value),
                trailing: query.sort == e.key ? const Icon(Icons.check_rounded) : null,
                onTap: () => Navigator.pop(ctx, e.key),
              ),
            const Divider(),
            ListTile(
              key: const ValueKey('rubriques'),
              leading: const Icon(Icons.grid_view_rounded),
              title: const Text('Toutes les rubriques'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.pop(ctx, 'rubriques'),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    if (choice == 'rubriques') {
      await context.push('/bimshop/categories');
    } else {
      _setQuery(query.copyWith(sort: choice));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = ref.watch(bimShopQueryProvider);
    final results = ref.watch(bimShopResultsProvider);
    final rubriques = ref.watch(rubriquesProvider).valueOrNull ?? const <Rubrique>[];
    final saved = widget.visitor ? 0 : (ref.watch(shopFavoritesProvider).valueOrNull?.length ?? 0);
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
          // Marges fines : les photos sont grandes, comme sur Pinterest (décision du fondateur, 19/10/2026).
          padding: EdgeInsets.fromLTRB(12, MediaQuery.paddingOf(context).top + BimSpacing.md, 12, BimSpacing.xxl + MediaQuery.paddingOf(context).bottom),
          children: [
            // Maquette 32 : « BimShop », mes commandes (camion) et articles mis de côté (sac).
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  Expanded(child: Text('BimShop', style: theme.textTheme.headlineLarge?.copyWith(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -0.5))),
                  IconButton(
                    key: const ValueKey('bimshop-orders'),
                    tooltip: 'Mes commandes',
                    iconSize: 30,
                    icon: const Icon(Icons.local_shipping_outlined),
                    onPressed: () => widget.visitor ? showVisitorGate(context, ref) : context.push('/orders'),
                  ),
                  IconButton(
                    key: const ValueKey('bimshop-favorites'),
                    tooltip: 'Mis de côté',
                    iconSize: 30,
                    icon: Badge(
                      isLabelVisible: saved > 0,
                      backgroundColor: BimColors.red,
                      label: Text(saved > 99 ? '99+' : '$saved'),
                      child: const Icon(Icons.shopping_bag_outlined),
                    ),
                    onPressed: () => widget.visitor ? showVisitorGate(context, ref) : context.push('/bimshop/favorites'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: BimSpacing.md),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('bimshop-search'),
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (v) => _setQuery(query.copyWith(q: v)),
                    decoration: InputDecoration(
                      hintText: 'Rechercher un article',
                      filled: true,
                      fillColor: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
                      contentPadding: const EdgeInsets.symmetric(vertical: 16),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: BimColors.black, width: 1.5)),
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: query.q.isEmpty
                          ? IconButton(
                              key: const ValueKey('bimshop-photo-search'),
                              tooltip: 'Rechercher avec une photo',
                              icon: const Icon(Icons.photo_camera_outlined),
                              onPressed: () => showBimSnack(context, 'La recherche avec une photo arrive dans une prochaine version.'),
                            )
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
                const SizedBox(width: BimSpacing.sm),
                // Filtres : tri et rubriques.
                Material(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    key: const ValueKey('bimshop-filter'),
                    onTap: () => _filters(query),
                    child: const SizedBox(width: 58, height: 58, child: Tooltip(message: 'Trier et filtrer', child: Icon(Icons.tune_rounded))),
                  ),
                ),
              ],
            ),
            const SizedBox(height: BimSpacing.md),
            // Rubriques en pastilles : « Pour toi » (tout), puis les rubriques.
            SizedBox(
              height: 46,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  _Pill(key: const ValueKey('rubrique-all'), label: 'Pour toi', selected: query.category == null, onTap: () => _setQuery(query.copyWith(clearCategory: true))),
                  for (final r in rubriques)
                    _Pill(
                      key: ValueKey('rubrique-pill-${r.code}'),
                      label: r.label,
                      selected: query.category == r.code || r.children.any((c) => c.code == query.category),
                      onTap: () => _setQuery(query.copyWith(category: r.code, categoryLabel: r.label)),
                    ),
                ],
              ),
            ),
            if (query.categoryLabel != null && !rubriques.any((r) => r.code == query.category)) ...[
              const SizedBox(height: BimSpacing.sm),
              Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text(query.categoryLabel!, style: theme.textTheme.titleMedium)),
            ],
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
/// Pastille de rubrique (maquette 32) : noire si choisie, grise sinon.
class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: BimSpacing.sm),
      child: Semantics(
        selected: selected,
        button: true,
        child: Material(
          color: selected ? scheme.onSurface : scheme.surfaceContainerHighest.withValues(alpha: 0.6),
          shape: const StadiumBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Center(child: Text(label, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: selected ? scheme.surface : scheme.onSurface))),
            ),
          ),
        ),
      ),
    );
  }
}

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
