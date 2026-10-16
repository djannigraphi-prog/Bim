import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../bimshop/data/bimshop_api.dart';

/// Lot 5-D — Demandes et offres de projet (écrans 21, 49, 55) et « Recommandé pour toi » (écran 24, Premium).
/// Aucune commande ni paiement : une offre présente des articles du BimShop.

class ProjectOffer {
  const ProjectOffer({required this.id, required this.message, required this.shop, required this.products, required this.createdAt});

  final String id;
  final String message;
  final ShopRef shop;
  final List<ShopCard> products;
  final DateTime createdAt;

  factory ProjectOffer.fromJson(Map<String, dynamic> j) => ProjectOffer(
        id: j['id'] as String,
        message: j['message'] as String,
        shop: ShopRef.fromJson(j['shop'] as Map<String, dynamic>),
        products: [for (final p in (j['products'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) ShopCard.fromJson(p)],
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

/// Demande de projet telle qu'une boutique la voit : anonymisée.
class ProjectRequest {
  const ProjectRequest({required this.id, required this.category, required this.title, required this.mode, required this.durationDays, this.goal, this.city, this.targetQuantity, this.offerStatus});

  final String id;
  final String category;
  final String title;
  final String? goal;
  final String mode;
  final int durationDays;
  final int? targetQuantity;
  final String? city;
  /// null : pas encore d'offre ; sent · withdrawn.
  final String? offerStatus;

  factory ProjectRequest.fromJson(Map<String, dynamic> j) => ProjectRequest(
        id: j['id'] as String,
        category: j['category'] as String,
        title: j['title'] as String,
        goal: j['goal'] as String?,
        mode: j['mode'] as String,
        durationDays: j['durationDays'] as int,
        targetQuantity: j['targetQuantity'] as int?,
        city: j['city'] as String?,
        offerStatus: j['offerStatus'] as String?,
      );
}

class OffersApi {
  OffersApi(this._api);
  final ApiClient _api;

  Future<({bool receiveOffers, List<ProjectOffer> items})> projectOffers(String projectId) async {
    final r = await _api.get('/v1/projects/$projectId/offers');
    return (
      receiveOffers: (r['receiveOffers'] ?? false) as bool,
      items: [for (final o in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ProjectOffer.fromJson(o)],
    );
  }

  Future<void> decline(String projectId, String offerId) => _api.post('/v1/projects/$projectId/offers/$offerId/decline');
  Future<void> setReceive(String projectId, bool receive) => _api.put('/v1/projects/$projectId/merchant-offers', body: {'receive': receive});

  Future<({bool premiumOnly, List<ShopCard> items})> recommendations(String projectId) async {
    final r = await _api.get('/v1/projects/$projectId/recommendations');
    return (
      premiumOnly: (r['premiumOnly'] ?? false) as bool,
      items: [for (final p in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ShopCard.fromJson(p)],
    );
  }

  Future<({List<ProjectRequest> items, String? hint})> requests() async {
    final r = await _api.get('/v1/shop/project-requests');
    return (items: [for (final p in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ProjectRequest.fromJson(p)], hint: r['hint'] as String?);
  }

  Future<void> sendOffer(String projectId, {required String message, required List<String> productIds}) =>
      _api.post('/v1/shop/project-requests/$projectId/offers', body: {'message': message, 'productIds': productIds});
}

final offersApiProvider = Provider<OffersApi>((ref) => OffersApi(ref.watch(apiClientProvider)));
final projectOffersProvider = FutureProvider.autoDispose.family<({bool receiveOffers, List<ProjectOffer> items}), String>((ref, id) => ref.watch(offersApiProvider).projectOffers(id));
final recommendationsProvider = FutureProvider.autoDispose.family<({bool premiumOnly, List<ShopCard> items}), String>((ref, id) => ref.watch(offersApiProvider).recommendations(id));
final projectRequestsProvider = FutureProvider.autoDispose<({List<ProjectRequest> items, String? hint})>((ref) => ref.watch(offersApiProvider).requests());
