import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 5-B — Espace marchand (écran 55) : boutique et catalogue. Aucun paiement : prix affichés en FCFA.

class ShopDashboard {
  const ShopDashboard({
    required this.id,
    required this.name,
    required this.status,
    required this.verified,
    required this.published,
    required this.drafts,
    required this.followers,
    this.city,
    this.commune,
    this.description,
    this.logoUrl,
  });

  final String id;
  final String name;
  final String status;
  final bool verified;
  final String? city;
  final String? commune;
  final String? description;
  final String? logoUrl;
  final int published;
  final int drafts;
  final int followers;

  factory ShopDashboard.fromJson(Map<String, dynamic> j) {
    final c = (j['counts'] ?? const <String, dynamic>{}) as Map<String, dynamic>;
    return ShopDashboard(
      id: j['id'] as String,
      name: j['name'] as String,
      status: j['status'] as String,
      verified: (j['verified'] ?? false) as bool,
      city: j['city'] as String?,
      commune: j['commune'] as String?,
      description: j['description'] as String?,
      logoUrl: j['logoUrl'] as String?,
      published: (c['published'] ?? 0) as int,
      drafts: (c['drafts'] ?? 0) as int,
      followers: (c['followers'] ?? 0) as int,
    );
  }
}

class ProductSummary {
  const ProductSummary({required this.id, required this.kind, required this.title, required this.priceFcfa, required this.status, this.compareAtFcfa, this.imageUrl, this.stock});

  final String id;
  final String kind;
  final String title;
  final int priceFcfa;
  final int? compareAtFcfa;
  final String status;
  final String? imageUrl;
  /// null pour une prestation.
  final int? stock;

  factory ProductSummary.fromJson(Map<String, dynamic> j) => ProductSummary(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        priceFcfa: j['priceFcfa'] as int,
        compareAtFcfa: j['compareAtFcfa'] as int?,
        status: j['status'] as String,
        imageUrl: j['imageUrl'] as String?,
        stock: j['stock'] as int?,
      );
}

class ProductPhoto {
  const ProductPhoto({required this.id, required this.url});
  final String id;
  final String? url;
}

class ProductVariant {
  const ProductVariant({required this.id, required this.label, this.stock});
  final String id;
  final String label;
  final int? stock;
}

class ProductDetail {
  const ProductDetail({
    required this.id,
    required this.kind,
    required this.title,
    required this.priceFcfa,
    required this.status,
    required this.photos,
    required this.variants,
    this.description,
    this.categoryCode,
    this.compareAtFcfa,
    this.durationMinutes,
  });

  final String id;
  final String kind;
  final String title;
  final String? description;
  final String? categoryCode;
  final int priceFcfa;
  final int? compareAtFcfa;
  final int? durationMinutes;
  final String status;
  final List<ProductPhoto> photos;
  final List<ProductVariant> variants;

  bool get isService => kind == 'service';

  factory ProductDetail.fromJson(Map<String, dynamic> j) => ProductDetail(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        description: j['description'] as String?,
        categoryCode: j['categoryCode'] as String?,
        priceFcfa: j['priceFcfa'] as int,
        compareAtFcfa: j['compareAtFcfa'] as int?,
        durationMinutes: j['durationMinutes'] as int?,
        status: j['status'] as String,
        photos: [
          for (final p in (j['photos'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) ProductPhoto(id: p['id'] as String, url: p['url'] as String?),
        ],
        variants: [
          for (final v in (j['variants'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
            ProductVariant(id: v['id'] as String, label: v['label'] as String, stock: v['stock'] as int?),
        ],
      );
}

class ShopCategory {
  const ShopCategory({required this.code, required this.label, this.children = const []});
  final String code;
  final String label;
  final List<ShopCategory> children;

  factory ShopCategory.fromJson(Map<String, dynamic> j) => ShopCategory(
        code: j['code'] as String,
        label: j['label'] as String,
        children: [for (final c in (j['children'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) ShopCategory.fromJson(c)],
      );
}

/// Champs d'un article ou d'une prestation.
class ProductInput {
  const ProductInput({required this.kind, required this.title, required this.categoryCode, required this.priceFcfa, this.description, this.compareAtFcfa, this.durationMinutes});
  final String kind;
  final String title;
  final String categoryCode;
  final int priceFcfa;
  final String? description;
  final int? compareAtFcfa;
  final int? durationMinutes;

  Map<String, dynamic> toJson({bool create = true}) => {
        if (create) 'kind': kind,
        'title': title,
        'categoryCode': categoryCode,
        'priceFcfa': priceFcfa,
        'description': description ?? '',
        if (create && compareAtFcfa != null) 'compareAtFcfa': compareAtFcfa,
        if (!create) 'compareAtFcfa': compareAtFcfa,
        if (create && durationMinutes != null) 'durationMinutes': durationMinutes,
        if (!create) 'durationMinutes': durationMinutes,
      };
}

class ShopApi {
  ShopApi(this._api);
  final ApiClient _api;

  Future<ShopDashboard> dashboard() async => ShopDashboard.fromJson(await _api.get('/v1/shop'));

  Future<List<ProductSummary>> products({required String status}) async {
    final r = await _api.get('/v1/shop/products', query: {'status': status});
    return [for (final p in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ProductSummary.fromJson(p)];
  }

  Future<List<ShopCategory>> categories() async {
    final r = await _api.get('/v1/shop-categories');
    return [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ShopCategory.fromJson(c)];
  }

  Future<ProductDetail> product(String id) async => ProductDetail.fromJson(await _api.get('/v1/shop/products/$id'));
  Future<ProductDetail> create(ProductInput input) async => ProductDetail.fromJson(await _api.post('/v1/shop/products', body: input.toJson()));
  Future<ProductDetail> update(String id, ProductInput input) async => ProductDetail.fromJson(await _api.patch('/v1/shop/products/$id', body: input.toJson(create: false)));
  Future<ProductDetail> publish(String id) async => ProductDetail.fromJson(await _api.post('/v1/shop/products/$id/publish'));
  Future<ProductDetail> unpublish(String id) async => ProductDetail.fromJson(await _api.post('/v1/shop/products/$id/unpublish'));
  Future<void> archive(String id) => _api.delete('/v1/shop/products/$id');
  Future<ProductDetail> addPhotos(String id, List<List<int>> files) async =>
      ProductDetail.fromJson(await _api.postFiles('/v1/shop/products/$id/photos', fields: const {}, fileField: 'photos', files: files));
  Future<ProductDetail> removePhoto(String id, String photoId) async => ProductDetail.fromJson(await _api.delete('/v1/shop/products/$id/photos/$photoId'));
  Future<ProductDetail> setVariants(String id, List<String> labels) async => ProductDetail.fromJson(await _api.put('/v1/shop/products/$id/variants', body: {'labels': labels}));
  Future<ProductDetail> setStock(String id, String variantId, int quantity) async =>
      ProductDetail.fromJson(await _api.put('/v1/shop/products/$id/variants/$variantId/stock', body: {'quantity': quantity}));
}

final shopApiProvider = Provider<ShopApi>((ref) => ShopApi(ref.watch(apiClientProvider)));
final shopDashboardProvider = FutureProvider.autoDispose<ShopDashboard>((ref) => ref.watch(shopApiProvider).dashboard());
final shopProductsProvider = FutureProvider.autoDispose.family<List<ProductSummary>, String>((ref, status) => ref.watch(shopApiProvider).products(status: status));
final shopCategoriesProvider = FutureProvider.autoDispose<List<ShopCategory>>((ref) => ref.watch(shopApiProvider).categories());

/// « 45 000 FCFA ».
String formatFcfa(int amount) {
  final s = amount.toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(' ');
    b.write(s[i]);
  }
  return '$b FCFA';
}
