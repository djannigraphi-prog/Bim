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
    this.hidden = 0,
    this.role = 'owner',
    this.permissions = const [],
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
  /// 7-A : articles « visibles par moi uniquement ».
  final int hidden;
  /// 7-A : mon rôle (owner · staff) et mes permissions ; le serveur contrôle chaque action.
  final String role;
  final List<String> permissions;

  bool get isOwner => role == 'owner';
  bool can(String permission) => isOwner || permissions.contains(permission);

  factory ShopDashboard.fromJson(Map<String, dynamic> j) {
    final c = (j['counts'] ?? const <String, dynamic>{}) as Map<String, dynamic>;
    final viewer = (j['viewer'] ?? const <String, dynamic>{'role': 'owner'}) as Map<String, dynamic>;
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
      hidden: (c['hidden'] ?? 0) as int,
      role: (viewer['role'] ?? 'staff') as String,
      permissions: [for (final p in (viewer['permissions'] as List<dynamic>? ?? const [])) p as String],
    );
  }
}

class ProductSummary {
  const ProductSummary({required this.id, required this.kind, required this.title, required this.priceFcfa, required this.status, this.reference = '', this.compareAtFcfa, this.imageUrl, this.stock});

  final String id;
  /// 7-A : référence BIM-… attribuée par le serveur.
  final String reference;
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
        reference: (j['reference'] ?? '') as String,
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
    this.reference = '',
    this.contentVersion = 1,
    this.activeFavorites = 0,
    this.everPublished = false,
    this.normalPriceFcfa,
    this.promoPriceFcfa,
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
  /// 7-A : référence BIM-…, version du contenu, cœurs de la version courante.
  final String reference;
  final int contentVersion;
  final int activeFavorites;
  /// Déjà publié au moins une fois : rubrique, durée et variantes sont alors figées aussi (L7-04).
  final bool everPublished;
  /// L7-04 : prix normal (fixé à la création) et promotion (modifiable). `priceFcfa` = prix payé.
  final int? normalPriceFcfa;
  final int? promoPriceFcfa;

  int get normalPrice => normalPriceFcfa ?? compareAtFcfa ?? priceFcfa;

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
        reference: (j['reference'] ?? '') as String,
        contentVersion: (j['contentVersion'] ?? 1) as int,
        activeFavorites: (j['activeFavorites'] ?? 0) as int,
        everPublished: j['publishedAt'] != null,
        normalPriceFcfa: j['normalPriceFcfa'] as int?,
        promoPriceFcfa: j['promoPriceFcfa'] as int?,
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

/// Champs d'un article ou d'une prestation à la création. L7-04 : nom, description et prix normal ne changent plus
/// ensuite ; seuls la promotion (toujours) et la rubrique, la durée (avant la première publication) se modifient.
class ProductInput {
  const ProductInput({required this.kind, required this.title, required this.categoryCode, required this.priceFcfa, this.description, this.promoPriceFcfa, this.durationMinutes});
  final String kind;
  final String title;
  final String categoryCode;
  /// Prix normal.
  final int priceFcfa;
  final String? description;
  final int? promoPriceFcfa;
  final int? durationMinutes;

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'title': title,
        'categoryCode': categoryCode,
        'priceFcfa': priceFcfa,
        'description': description ?? '',
        if (promoPriceFcfa != null) 'promoPriceFcfa': promoPriceFcfa,
        if (durationMinutes != null) 'durationMinutes': durationMinutes,
      };
}

/// Modifications autorisées d'une fiche existante (L7-04).
class ProductChanges {
  const ProductChanges({this.promoPriceFcfa, this.categoryCode, this.durationMinutes, this.sendCategory = false, this.sendDuration = false});
  /// null = supprimer la promotion.
  final int? promoPriceFcfa;
  final String? categoryCode;
  final int? durationMinutes;
  /// Rubrique et durée : envoyées seulement pour une fiche jamais publiée.
  final bool sendCategory;
  final bool sendDuration;

  Map<String, dynamic> toJson() => {
        'promoPriceFcfa': promoPriceFcfa,
        if (sendCategory && categoryCode != null) 'categoryCode': categoryCode,
        if (sendDuration) 'durationMinutes': durationMinutes,
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
  /// L7-04 : promotion, et rubrique / durée avant la première publication. La réputation est conservée.
  Future<ProductDetail> update(String id, ProductChanges changes) async => ProductDetail.fromJson(await _api.patch('/v1/shop/products/$id', body: changes.toJson()));
  Future<ProductDetail> publish(String id) async => ProductDetail.fromJson(await _api.post('/v1/shop/products/$id/publish'));
  /// 7-A : « Visible par moi uniquement » / « Visible publiquement » ; la réputation est conservée.
  Future<ProductDetail> hide(String id) async => ProductDetail.fromJson(await _api.post('/v1/shop/products/$id/hide'));
  Future<ProductDetail> show(String id) async => ProductDetail.fromJson(await _api.post('/v1/shop/products/$id/show'));
  Future<void> archive(String id) => _api.delete('/v1/shop/products/$id');
  Future<ProductDetail> addPhotos(String id, List<List<int>> files) async =>
      ProductDetail.fromJson(await _api.postFiles('/v1/shop/products/$id/photos', fields: const {}, fileField: 'photos', files: files));
  Future<ProductDetail> removePhoto(String id, String photoId) async => ProductDetail.fromJson(await _api.delete('/v1/shop/products/$id/photos/$photoId'));
  /// Variantes : avant la première publication seulement (ensuite, seul l'ordre change).
  Future<ProductDetail> setVariants(String id, List<String> labels) async => ProductDetail.fromJson(await _api.put('/v1/shop/products/$id/variants', body: {'labels': labels}));
  Future<ProductDetail> setStock(String id, String variantId, int quantity) async =>
      ProductDetail.fromJson(await _api.put('/v1/shop/products/$id/variants/$variantId/stock', body: {'quantity': quantity}));
}

/// 7-A — Membre de l'équipe d'une boutique.
class TeamMember {
  const TeamMember({required this.userId, required this.username, required this.fullName, required this.role, required this.status, required this.permissions, this.avatarUrl});

  final String userId;
  final String username;
  final String fullName;
  final String? avatarUrl;
  /// owner · staff
  final String role;
  /// active · invited
  final String status;
  final List<String> permissions;

  bool get isOwner => role == 'owner';

  factory TeamMember.fromJson(Map<String, dynamic> j) => TeamMember(
        userId: j['userId'] as String,
        username: (j['username'] ?? '') as String,
        fullName: (j['fullName'] ?? '') as String,
        avatarUrl: j['avatarUrl'] as String?,
        role: j['role'] as String,
        status: j['status'] as String,
        permissions: [for (final p in (j['permissions'] as List<dynamic>? ?? const [])) p as String],
      );
}

/// Libellés des permissions (A16), dans l'ordre d'affichage.
const shopPermissionLabels = <String, String>{
  'orders.read': 'Consulter les commandes',
  'orders.prepare': 'Préparer les commandes',
  'products.edit': 'Créer et modifier des articles',
  'products.publish': 'Publier et retirer des articles',
  'products.visibility': 'Masquer ou republier des articles',
  'messages.reply': 'Répondre aux messages des clients',
  'deliveries.select_courier': 'Sélectionner un livreur',
  'deliveries.settings': 'Modifier les paramètres de livraison',
  'payments.decide': 'Confirmer ou contester un paiement',
};

/// 7-A — Équipe (propriétaire) et invitations reçues (personne invitée).
class ShopTeamApi {
  ShopTeamApi(this._api);
  final ApiClient _api;

  static List<TeamMember> _members(Map<String, dynamic> r) => [for (final m in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) TeamMember.fromJson(m)];

  Future<List<TeamMember>> team() async => _members(await _api.get('/v1/shop/team'));
  Future<List<TeamMember>> invite(String username) async => _members(await _api.post('/v1/shop/team', body: {'username': username}));
  Future<List<TeamMember>> setPermissions(String userId, List<String> permissions) async =>
      _members(await _api.put('/v1/shop/team/$userId/permissions', body: {'permissions': permissions}));
  Future<List<TeamMember>> remove(String userId) async => _members(await _api.delete('/v1/shop/team/$userId'));

  Future<List<({String shopId, String name, String? logoUrl})>> invitations() async {
    final r = await _api.get('/v1/shop-invitations');
    return [
      for (final i in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>())
        (shopId: (i['shop'] as Map<String, dynamic>)['id'] as String, name: (i['shop'] as Map<String, dynamic>)['name'] as String, logoUrl: (i['shop'] as Map<String, dynamic>)['logoUrl'] as String?),
    ];
  }

  Future<void> answer(String shopId, {required bool accept}) => _api.post('/v1/shop-invitations/$shopId/${accept ? 'accept' : 'decline'}');
}

final shopTeamApiProvider = Provider<ShopTeamApi>((ref) => ShopTeamApi(ref.watch(apiClientProvider)));
final shopTeamProvider = FutureProvider.autoDispose<List<TeamMember>>((ref) => ref.watch(shopTeamApiProvider).team());
final shopInvitationsProvider = FutureProvider.autoDispose<List<({String shopId, String name, String? logoUrl})>>((ref) => ref.watch(shopTeamApiProvider).invitations());

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
