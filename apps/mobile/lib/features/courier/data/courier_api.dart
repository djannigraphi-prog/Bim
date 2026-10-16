import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 7-E — Livreurs. Demande vérifiée par l'équipe BIM (pièces chiffrées), profil de travail, relations avec les
/// boutiques. Aucun accès aux commandes d'une boutique : annonces et courses arrivent avec 7-F.

class CourierApplication {
  const CourierApplication({required this.id, required this.stage, required this.identity, required this.selfie, required this.details, this.idDocType, this.vehicle, this.rejectReason});
  final String id;
  /// draft · submitted · to_correct · active · suspended · closed
  final String stage;
  final bool identity;
  final bool selfie;
  final bool details;
  final String? idDocType;
  final String? vehicle;
  final String? rejectReason;
  bool get complete => identity && selfie && details;
  factory CourierApplication.fromJson(Map<String, dynamic> j) {
    final c = j['checklist'] as Map<String, dynamic>;
    return CourierApplication(
      id: j['id'] as String,
      stage: j['stage'] as String,
      identity: c['identity'] as bool,
      selfie: c['selfie'] as bool,
      details: c['details'] as bool,
      idDocType: j['idDocType'] as String?,
      vehicle: j['vehicle'] as String?,
      rejectReason: j['rejectReason'] as String?,
    );
  }
}

class CourierRelation {
  const CourierRelation({required this.id, required this.shopName, required this.relation, required this.status, this.place});
  final String id;
  final String shopName;
  final String? place;
  /// employee · partner
  final String relation;
  /// pending · active
  final String status;
  factory CourierRelation.fromJson(Map<String, dynamic> j) {
    final s = j['shop'] as Map<String, dynamic>;
    return CourierRelation(
      id: j['id'] as String,
      shopName: s['name'] as String,
      place: [s['commune'], s['city']].whereType<String>().where((x) => x.isNotEmpty).join(', '),
      relation: j['relation'] as String,
      status: j['status'] as String,
    );
  }
}

class CourierProfile {
  const CourierProfile({required this.available, required this.capacity, required this.communes, required this.relations, this.vehicle});
  final bool available;
  final int capacity;
  final String? vehicle;
  final List<({String code, String label})> communes;
  final List<CourierRelation> relations;
  factory CourierProfile.fromJson(Map<String, dynamic> j) => CourierProfile(
        available: j['available'] as bool,
        capacity: j['capacity'] as int,
        vehicle: j['vehicle'] as String?,
        communes: [for (final c in (j['communes'] as List<dynamic>).cast<Map<String, dynamic>>()) (code: c['code'] as String, label: '${c['name']} (${c['city']})')],
        relations: [for (final r in (j['relations'] as List<dynamic>).cast<Map<String, dynamic>>()) CourierRelation.fromJson(r)],
      );
}

/// Livreur vu par une boutique : nom, relation, état ; jamais ses pièces.
class ShopCourier {
  const ShopCourier({required this.id, required this.fullName, required this.username, required this.relation, required this.status, this.available});
  final String id;
  final String fullName;
  final String username;
  final String relation;
  final String status;
  final bool? available;
  factory ShopCourier.fromJson(Map<String, dynamic> j) => ShopCourier(
        id: j['id'] as String,
        fullName: j['fullName'] as String,
        username: j['username'] as String,
        relation: j['relation'] as String,
        status: j['status'] as String,
        available: j['available'] as bool?,
      );
}

String relationLabel(String r) => r == 'employee' ? 'Employé' : 'Partenaire';
String vehicleLabel(String? v) => const {'moto': 'Moto', 'velo': 'Vélo', 'voiture': 'Voiture', 'pied': 'À pied'}[v] ?? '—';

class CourierApi {
  CourierApi(this._api);
  final ApiClient _api;

  Future<({CourierApplication? application, bool available})> application() async {
    final r = await _api.get('/v1/courier-application');
    final a = r['application'] as Map<String, dynamic>?;
    return (application: a == null ? null : CourierApplication.fromJson(a), available: (r['available'] ?? false) as bool);
  }

  CourierApplication _app(Map<String, dynamic> r) => CourierApplication.fromJson(r['application'] as Map<String, dynamic>);

  Future<CourierApplication> apply() async => _app(await _api.post('/v1/courier-application'));
  Future<CourierApplication> update({String? idDocType, String? vehicle}) async =>
      _app(await _api.patch('/v1/courier-application', body: {if (idDocType != null) 'idDocType': idDocType, if (vehicle != null) 'vehicle': vehicle}));
  Future<CourierApplication> upload(String kind, List<int> bytes) async {
    final png = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
    return _app(await _api.upload('/v1/courier-application/documents/$kind', field: 'photo', bytes: bytes, filename: png ? '$kind.png' : '$kind.jpg', contentType: png ? 'image/png' : 'image/jpeg', method: 'PUT'));
  }

  Future<CourierApplication> submit() async => _app(await _api.post('/v1/courier-application/submit'));

  Future<CourierProfile> profile() async => CourierProfile.fromJson(await _api.get('/v1/courier/me'));
  Future<CourierProfile> updateProfile({bool? available, int? capacity, List<String>? communes}) async => CourierProfile.fromJson(
        await _api.patch('/v1/courier/me', body: {if (available != null) 'available': available, if (capacity != null) 'capacity': capacity, if (communes != null) 'communes': communes}),
      );
  Future<CourierProfile> relation(String id, String action) async => CourierProfile.fromJson(await _api.post('/v1/courier/relations/$id/$action'));
}

class ShopCouriersApi {
  ShopCouriersApi(this._api);
  final ApiClient _api;

  List<ShopCourier> _list(Map<String, dynamic> r) => [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ShopCourier.fromJson(c)];

  Future<List<ShopCourier>> list() async => _list(await _api.get('/v1/shop/couriers'));
  Future<List<ShopCourier>> invite(String username, String relation) async => _list(await _api.post('/v1/shop/couriers', body: {'username': username, 'relation': relation}));
  Future<List<ShopCourier>> end(String id) async => _list(await _api.post('/v1/shop/couriers/$id/end'));
}

final courierApiProvider = Provider<CourierApi>((ref) => CourierApi(ref.watch(apiClientProvider)));
final shopCouriersApiProvider = Provider<ShopCouriersApi>((ref) => ShopCouriersApi(ref.watch(apiClientProvider)));
final courierProfileProvider = FutureProvider.autoDispose<CourierProfile>((ref) => ref.watch(courierApiProvider).profile());
final shopCouriersProvider = FutureProvider.autoDispose<List<ShopCourier>>((ref) => ref.watch(shopCouriersApiProvider).list());
