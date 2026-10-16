import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 5-C — BimShop (écrans 32, 33, 34, 54). Parcourir est public ; aucune commande ni paiement ici.

class ShopRef {
  const ShopRef({required this.id, required this.name, required this.slug, required this.verified, this.city, this.commune, this.logoUrl});

  final String id;
  final String name;
  final String slug;
  final bool verified;
  final String? city;
  final String? commune;
  final String? logoUrl;

  String get place => [commune, city].whereType<String>().where((s) => s.isNotEmpty).join(', ');

  factory ShopRef.fromJson(Map<String, dynamic> j) => ShopRef(
        id: j['id'] as String,
        name: j['name'] as String,
        slug: j['slug'] as String,
        verified: (j['verified'] ?? false) as bool,
        city: j['city'] as String?,
        commune: j['commune'] as String?,
        logoUrl: j['logoUrl'] as String?,
      );
}

class ShopCard {
  const ShopCard({required this.id, required this.kind, required this.title, required this.priceFcfa, required this.available, required this.shop, this.compareAtFcfa, this.imageUrl});

  final String id;
  final String kind;
  final String title;
  final int priceFcfa;
  final int? compareAtFcfa;
  final String? imageUrl;
  final bool available;
  final ShopRef shop;

  factory ShopCard.fromJson(Map<String, dynamic> j) => ShopCard(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        priceFcfa: j['priceFcfa'] as int,
        compareAtFcfa: j['compareAtFcfa'] as int?,
        imageUrl: j['imageUrl'] as String?,
        available: (j['available'] ?? false) as bool,
        shop: ShopRef.fromJson(j['shop'] as Map<String, dynamic>),
      );
}

class ShopProduct {
  const ShopProduct({
    required this.id,
    required this.kind,
    required this.title,
    required this.priceFcfa,
    required this.available,
    required this.photos,
    required this.variants,
    required this.shop,
    required this.moreFromShop,
    this.description,
    this.compareAtFcfa,
    this.durationMinutes,
    this.categoryLabel,
  });

  final String id;
  final String kind;
  final String title;
  final String? description;
  final int priceFcfa;
  final int? compareAtFcfa;
  final int? durationMinutes;
  final String? categoryLabel;
  final bool available;
  final List<String?> photos;
  final List<({String id, String label, bool available})> variants;
  final ShopRef shop;
  final List<ShopCard> moreFromShop;

  factory ShopProduct.fromJson(Map<String, dynamic> j) => ShopProduct(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        description: j['description'] as String?,
        priceFcfa: j['priceFcfa'] as int,
        compareAtFcfa: j['compareAtFcfa'] as int?,
        durationMinutes: j['durationMinutes'] as int?,
        categoryLabel: (j['category'] as Map<String, dynamic>?)?['label'] as String?,
        available: (j['available'] ?? false) as bool,
        photos: [for (final p in (j['photos'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) p['url'] as String?],
        variants: [
          for (final v in (j['variants'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
            (id: v['id'] as String, label: v['label'] as String, available: (v['available'] ?? false) as bool),
        ],
        shop: ShopRef.fromJson(j['shop'] as Map<String, dynamic>),
        moreFromShop: [for (final c in (j['moreFromShop'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) ShopCard.fromJson(c)],
      );
}

class PublicShop {
  const PublicShop({required this.shop, required this.followers, required this.productCount, required this.items, this.description, this.nextCursor});

  final ShopRef shop;
  final String? description;
  final int followers;
  final int productCount;
  final List<ShopCard> items;
  final String? nextCursor;

  factory PublicShop.fromJson(Map<String, dynamic> j) {
    final c = (j['counts'] ?? const <String, dynamic>{}) as Map<String, dynamic>;
    return PublicShop(
      shop: ShopRef.fromJson(j),
      description: j['description'] as String?,
      followers: (c['followers'] ?? 0) as int,
      productCount: (c['products'] ?? 0) as int,
      items: [for (final p in (j['items'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) ShopCard.fromJson(p)],
      nextCursor: j['nextCursor'] as String?,
    );
  }
}

class Rubrique {
  const Rubrique({required this.code, required this.label, required this.products, this.children = const []});

  final String code;
  final String label;
  final int products;
  final List<Rubrique> children;

  factory Rubrique.fromJson(Map<String, dynamic> j) => Rubrique(
        code: j['code'] as String,
        label: j['label'] as String,
        products: (j['products'] ?? 0) as int,
        children: [for (final c in (j['children'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) Rubrique.fromJson(c)],
      );
}

/// Filtres de l'écran 32 (rubrique, recherche, tri).
class BimShopQuery {
  const BimShopQuery({this.category, this.categoryLabel, this.q = '', this.sort = 'recent'});

  final String? category;
  final String? categoryLabel;
  final String q;
  final String sort;

  BimShopQuery copyWith({String? category, String? categoryLabel, bool clearCategory = false, String? q, String? sort}) => BimShopQuery(
        category: clearCategory ? null : (category ?? this.category),
        categoryLabel: clearCategory ? null : (categoryLabel ?? this.categoryLabel),
        q: q ?? this.q,
        sort: sort ?? this.sort,
      );

  @override
  bool operator ==(Object other) => other is BimShopQuery && other.category == category && other.q == q && other.sort == sort;

  @override
  int get hashCode => Object.hash(category, q, sort);
}

class BimShopApi {
  BimShopApi(this._api);
  final ApiClient _api;

  Future<({List<ShopCard> items, String? nextCursor})> browse(BimShopQuery query, {String? cursor}) async {
    final r = await _api.get('/v1/bimshop/products', query: {
      if (query.category != null) 'category': query.category,
      if (query.q.trim().isNotEmpty) 'q': query.q.trim(),
      'sort': query.sort,
      if (cursor != null) 'cursor': cursor,
    },);
    return (items: [for (final p in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ShopCard.fromJson(p)], nextCursor: r['nextCursor'] as String?);
  }

  Future<List<Rubrique>> categories() async {
    final r = await _api.get('/v1/bimshop/categories');
    return [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) Rubrique.fromJson(c)];
  }

  Future<ShopProduct> product(String id) async => ShopProduct.fromJson(await _api.get('/v1/bimshop/products/$id'));
  Future<PublicShop> shop(String slug) async => PublicShop.fromJson(await _api.get('/v1/bimshop/shops/$slug'));

  Future<({bool favorite, bool followingShop})> productState(String id) async {
    final r = await _api.get('/v1/bimshop/products/$id/me');
    return (favorite: (r['favorite'] ?? false) as bool, followingShop: (r['followingShop'] ?? false) as bool);
  }

  Future<({bool following, bool own})> shopState(String slug) async {
    final r = await _api.get('/v1/bimshop/shops/$slug/me');
    return (following: (r['following'] ?? false) as bool, own: (r['own'] ?? false) as bool);
  }

  Future<void> setFavorite(String id, bool on) => on ? _api.put('/v1/bimshop/products/$id/favorite') : _api.delete('/v1/bimshop/products/$id/favorite');
  Future<void> setFollow(String slug, bool on) => on ? _api.put('/v1/bimshop/shops/$slug/follow') : _api.delete('/v1/bimshop/shops/$slug/follow');

  Future<List<ShopCard>> favorites() async {
    final r = await _api.get('/v1/bimshop/favorites');
    return [for (final p in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ShopCard.fromJson(p)];
  }
}

final bimShopApiProvider = Provider<BimShopApi>((ref) => BimShopApi(ref.watch(apiClientProvider)));
final bimShopQueryProvider = StateProvider<BimShopQuery>((ref) => const BimShopQuery());
final rubriquesProvider = FutureProvider.autoDispose<List<Rubrique>>((ref) => ref.watch(bimShopApiProvider).categories());
final shopProductProvider = FutureProvider.autoDispose.family<ShopProduct, String>((ref, id) => ref.watch(bimShopApiProvider).product(id));
final publicShopProvider = FutureProvider.autoDispose.family<PublicShop, String>((ref, slug) => ref.watch(bimShopApiProvider).shop(slug));
final shopFavoritesProvider = FutureProvider.autoDispose<List<ShopCard>>((ref) => ref.watch(bimShopApiProvider).favorites());

/// Résultats de l'écran 32 : articles chargés et page suivante (mêmes principes que le fil, lot 4).
class BimShopPage {
  const BimShopPage({required this.items, this.nextCursor, this.loadingMore = false, this.pageError = false});

  final List<ShopCard> items;
  final String? nextCursor;
  final bool loadingMore;
  final bool pageError;

  bool get hasMore => nextCursor != null;
}

class BimShopController extends AutoDisposeAsyncNotifier<BimShopPage> {
  @override
  Future<BimShopPage> build() async {
    final page = await ref.watch(bimShopApiProvider).browse(ref.watch(bimShopQueryProvider));
    return BimShopPage(items: page.items, nextCursor: page.nextCursor);
  }

  /// Page suivante ; après un échec, seul un « Réessayer » explicite relance (audit, M-5 / M-17).
  Future<void> loadMore({bool retry = false}) async {
    final s = state.valueOrNull;
    if (s == null || !s.hasMore || s.loadingMore || (s.pageError && !retry)) return;
    state = AsyncData(BimShopPage(items: s.items, nextCursor: s.nextCursor, loadingMore: true));
    try {
      final page = await ref.read(bimShopApiProvider).browse(ref.read(bimShopQueryProvider), cursor: s.nextCursor);
      state = AsyncData(BimShopPage(items: [...s.items, ...page.items], nextCursor: page.nextCursor));
    } catch (_) {
      state = AsyncData(BimShopPage(items: s.items, nextCursor: s.nextCursor, pageError: true));
    }
  }
}

final bimShopResultsProvider = AsyncNotifierProvider.autoDispose<BimShopController, BimShopPage>(BimShopController.new);
