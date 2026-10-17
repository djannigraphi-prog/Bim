import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 7-E — Livreurs. Demande vérifiée par l'équipe BIM (pièces chiffrées), profil de travail, relations avec les
/// boutiques. Lot 7-F — missions proposées, courses et historique : seulement ce qui concerne ce livreur, jamais les
/// commandes privées d'une boutique.

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

/// Course vue par le livreur avant acceptation : départ, commune d'arrivée, frais, nombre d'articles. Ni adresse, ni client.
class Mission {
  const Mission({required this.id, required this.deliveryId, required this.mode, required this.fromShop, required this.itemsCount, this.fromPlace, this.toPlace, this.feeFcfa, this.estimatedMinutes, this.expiresAt, this.status, this.number});
  /// Identifiant de la proposition (missions) ; vide pour une course.
  final String id;
  final String deliveryId;
  final String? mode;
  final String fromShop;
  final String? fromPlace;
  final String? toPlace;
  final int? feeFcfa;
  final int? estimatedMinutes;
  final int itemsCount;
  final DateTime? expiresAt;
  final String? status;
  final String? number;
  factory Mission.fromJson(Map<String, dynamic> j) {
    final f = j['from'] as Map<String, dynamic>;
    final t = j['to'] as Map<String, dynamic>?;
    String? place(Map<String, dynamic>? m) => m == null ? null : [m['commune'], m['city']].whereType<String>().where((x) => x.isNotEmpty).join(', ');
    return Mission(
      id: (j['offerId'] as String?) ?? '',
      deliveryId: j['deliveryId'] as String,
      mode: j['mode'] as String?,
      fromShop: f['shop'] as String,
      fromPlace: place(f),
      toPlace: place(t),
      feeFcfa: j['feeFcfa'] as int?,
      estimatedMinutes: j['estimatedMinutes'] as int?,
      itemsCount: j['itemsCount'] as int,
      expiresAt: j['expiresAt'] == null ? null : DateTime.parse(j['expiresAt'] as String),
      status: j['status'] as String?,
      number: j['number'] as String?,
    );
  }
}

/// Détail d'une course attribuée : contact et adresse du client seulement pendant la course ; jamais le code.
class CourseDetail {
  const CourseDetail({required this.mission, required this.status, required this.items, required this.actions, this.category, this.clientName, this.clientPhone, this.address, this.paymentMethod, this.amountToCollectFcfa, this.declaredByCustomer = false, this.cashReceived = false, this.reviewId, this.reviewRating, this.reviewComment});
  final Mission mission;
  final String status;
  final String? category;
  final String? clientName;
  final String? clientPhone;
  final String? address;
  final List<({String title, String variant, int quantity})> items;
  final String? paymentMethod;
  final int? amountToCollectFcfa;
  final bool declaredByCustomer;
  final bool cashReceived;
  final String? reviewId;
  final int? reviewRating;
  final String? reviewComment;
  final List<String> actions;
  bool can(String a) => actions.contains(a);
  factory CourseDetail.fromJson(Map<String, dynamic> j) {
    final c = j['client'] as Map<String, dynamic>?;
    final p = j['payment'] as Map<String, dynamic>?;
    final r = j['review'] as Map<String, dynamic>?;
    return CourseDetail(
      mission: Mission.fromJson(j),
      status: j['status'] as String,
      category: j['category'] as String?,
      clientName: c?['firstName'] as String?,
      clientPhone: c?['phone'] as String?,
      address: c?['address'] as String?,
      items: [for (final i in (j['items'] as List<dynamic>).cast<Map<String, dynamic>>()) (title: i['title'] as String, variant: i['variantLabel'] as String, quantity: i['quantity'] as int)],
      paymentMethod: p?['method'] as String?,
      amountToCollectFcfa: p?['amountToCollectFcfa'] as int?,
      declaredByCustomer: (p?['declaredByCustomer'] ?? false) as bool,
      cashReceived: (p?['cashReceived'] ?? false) as bool,
      reviewId: r?['id'] as String?,
      reviewRating: r?['rating'] as int?,
      reviewComment: r?['comment'] as String?,
      actions: (j['actions'] as List<dynamic>).cast<String>(),
    );
  }
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

  List<Mission> _missions(Map<String, dynamic> r) => [for (final m in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) Mission.fromJson(m)];

  Future<List<Mission>> missions() async => _missions(await _api.get('/v1/courier/missions'));
  /// Accepter : le serveur revérifie l'éligibilité (disponibilité, capacité, priorité) à cet instant.
  Future<void> accept(String offerId) => _api.post('/v1/courier/missions/$offerId/accept');
  Future<void> decline(String offerId) => _api.post('/v1/courier/missions/$offerId/decline');
  Future<List<Mission>> courses({bool history = false}) async => _missions(await _api.get('/v1/courier/courses${history ? '?box=history' : ''}'));
  Future<CourseDetail> course(String deliveryId) async => CourseDetail.fromJson(await _api.get('/v1/courier/courses/$deliveryId'));

  /// `step` : picked-up, arrived, close.
  Future<CourseDetail> step(String deliveryId, String step) async => CourseDetail.fromJson(await _api.post('/v1/courier/courses/$deliveryId/$step'));
  Future<CourseDetail> code(String deliveryId, String code) async => CourseDetail.fromJson(await _api.post('/v1/courier/courses/$deliveryId/code', body: {'code': code}));
  Future<CourseDetail> cash(String deliveryId, int amountFcfa) async => CourseDetail.fromJson(await _api.post('/v1/courier/courses/$deliveryId/cash', body: {'amountFcfa': amountFcfa}));
  Future<void> clientAbsent(String deliveryId, {String? note}) => _api.post('/v1/courier/courses/$deliveryId/client-absent', body: {if (note != null && note.isNotEmpty) 'note': note});
  /// Désistement avant la prise en charge (motif obligatoire) : la boutique choisit un autre livreur.
  Future<void> release(String deliveryId, String reason) => _api.post('/v1/courier/courses/$deliveryId/release', body: {'reason': reason});
  Future<void> incident(String deliveryId, String reason, {String? description}) =>
      _api.post('/v1/courier/courses/$deliveryId/incidents', body: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description});
  Future<void> reportReview(String reviewId, String reason) => _api.post('/v1/courier/reviews/$reviewId/report', body: {'reason': reason});
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
final missionsProvider = FutureProvider.autoDispose<List<Mission>>((ref) => ref.watch(courierApiProvider).missions());
final coursesProvider = FutureProvider.autoDispose.family<List<Mission>, bool>((ref, history) => ref.watch(courierApiProvider).courses(history: history));
final courseProvider = FutureProvider.autoDispose.family<CourseDetail, String>((ref, id) => ref.watch(courierApiProvider).course(id));
final shopCouriersProvider = FutureProvider.autoDispose<List<ShopCourier>>((ref) => ref.watch(shopCouriersApiProvider).list());
