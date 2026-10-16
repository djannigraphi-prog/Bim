import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 7-B — Commandes. Le serveur calcule tout (prix, frais, délai) et contrôle chaque action ; l'app affiche ce qu'il
/// renvoie. Aucun paiement dans l'app : le moyen de paiement est seulement « prévu ».

/// Clé anti-doublon d'une commande (une par écran de confirmation : un double appui ne crée qu'une commande).
String newIdempotencyKey() {
  final r = Random.secure();
  return List.generate(32, (_) => r.nextInt(16).toRadixString(16)).join();
}

class Commune {
  const Commune({required this.code, required this.city, required this.name});
  final String code;
  final String city;
  final String name;
  String get label => '$name ($city)';
  factory Commune.fromJson(Map<String, dynamic> j) => Commune(code: j['code'] as String, city: j['city'] as String, name: j['name'] as String);
}

/// Devis d'un mode : disponible avec ses frais, ou indisponible.
class ModeQuote {
  const ModeQuote({required this.mode, required this.available, this.feeFcfa, this.minutes, this.reason});
  final String mode;
  final bool available;
  final int? feeFcfa;
  final int? minutes;
  final String? reason;
  factory ModeQuote.fromJson(Map<String, dynamic> j) => ModeQuote(
        mode: j['mode'] as String,
        available: j['available'] as bool,
        feeFcfa: j['feeFcfa'] as int?,
        minutes: j['minutes'] as int?,
        reason: j['reason'] as String?,
      );
}

class OrderLine {
  const OrderLine({required this.productId, required this.variantId, required this.quantity, this.appliedPriceFcfa});
  final String productId;
  final String variantId;
  final int quantity;
  final int? appliedPriceFcfa;
  Map<String, dynamic> toJson() => {'productId': productId, 'variantId': variantId, 'quantity': quantity, if (appliedPriceFcfa != null) 'appliedPriceFcfa': appliedPriceFcfa};
}

class Fulfilment {
  const Fulfilment({required this.mode, required this.paymentMethod, this.communeCode, this.address});
  /// pickup · express · economy
  final String mode;
  /// mobile_money · cash
  final String paymentMethod;
  final String? communeCode;
  final String? address;
  Map<String, dynamic> toJson() => {
        'deliveryMode': mode,
        'paymentMethod': paymentMethod,
        if (mode != 'pickup' && communeCode != null) 'communeCode': communeCode,
        if (mode != 'pickup' && address != null) 'address': address,
      };
}

class WaitRule {
  const WaitRule({required this.freeMinutes, required this.perMinuteFcfa, required this.capMinutes, required this.billed});
  final int freeMinutes;
  final int perMinuteFcfa;
  final int capMinutes;
  final bool billed;
  factory WaitRule.fromJson(Map<String, dynamic> j) => WaitRule(
        freeMinutes: (j['freeMinutes'] ?? 0) as int,
        perMinuteFcfa: (j['perMinuteFcfa'] ?? 0) as int,
        capMinutes: (j['capMinutes'] ?? 0) as int,
        billed: (j['billed'] ?? false) as bool,
      );
  String get text => billed
      ? 'Attente gratuite $freeMinutes min, puis $perMinuteFcfa F la minute (au plus $capMinutes min).'
      : 'Attente gratuite $freeMinutes min ; au-delà, l’attente est notée mais pas facturée pour le moment.';
}

class OrderPreview {
  const OrderPreview({required this.itemsTotalFcfa, required this.totalFcfa, this.deliveryFeeFcfa, this.estimatedMinutes, this.waitRule, this.canOrder = true});
  final int itemsTotalFcfa;
  final int? deliveryFeeFcfa;
  final int totalFcfa;
  final int? estimatedMinutes;
  final WaitRule? waitRule;
  final bool canOrder;
  factory OrderPreview.fromJson(Map<String, dynamic> j) {
    final d = j['delivery'] as Map<String, dynamic>?;
    return OrderPreview(
      itemsTotalFcfa: j['itemsTotalFcfa'] as int,
      deliveryFeeFcfa: j['deliveryFeeFcfa'] as int?,
      totalFcfa: j['totalFcfa'] as int,
      estimatedMinutes: d?['estimatedMinutes'] as int?,
      waitRule: d?['waitRule'] == null ? null : WaitRule.fromJson(d!['waitRule'] as Map<String, dynamic>),
      canOrder: (j['canOrder'] ?? true) as bool,
    );
  }
}

class OrderItem {
  const OrderItem({required this.reference, required this.title, required this.variantLabel, required this.quantity, required this.unitPriceFcfa, required this.catalogPriceFcfa, required this.lineTotalFcfa, this.photoUrl});
  final String reference;
  final String title;
  final String variantLabel;
  final int quantity;
  final int unitPriceFcfa;
  final int catalogPriceFcfa;
  final int lineTotalFcfa;
  final String? photoUrl;
  factory OrderItem.fromJson(Map<String, dynamic> j) => OrderItem(
        reference: j['reference'] as String,
        title: j['title'] as String,
        variantLabel: j['variantLabel'] as String,
        quantity: j['quantity'] as int,
        unitPriceFcfa: j['unitPriceFcfa'] as int,
        catalogPriceFcfa: j['catalogPriceFcfa'] as int,
        lineTotalFcfa: j['lineTotalFcfa'] as int,
        photoUrl: j['photoUrl'] as String?,
      );
}

class OrderEvent {
  const OrderEvent({required this.type, required this.actorType, required this.at, this.reason});
  final String type;
  final String actorType;
  final DateTime at;
  final String? reason;
  factory OrderEvent.fromJson(Map<String, dynamic> j) => OrderEvent(type: j['type'] as String, actorType: j['actorType'] as String, at: DateTime.parse(j['at'] as String), reason: j['reason'] as String?);
}

/// 7-C — Paiement de l'article : cinq informations distinctes ; le statut affiché est calculé par le serveur.
class OrderPayment {
  const OrderPayment({required this.method, required this.amountFcfa, required this.status, this.declaredReference, this.contestReason, this.payoutPhone, this.payoutOperator});
  final String method;
  final int amountFcfa;
  /// not_paid · declared_by_customer · cash_received_to_confirm · confirmed_by_shop · contested_by_shop · cancelled · failed
  final String status;
  final String? declaredReference;
  final String? contestReason;
  /// Numéro Mobile Money confirmé de la boutique, montré au client seulement au moment de payer.
  final String? payoutPhone;
  final String? payoutOperator;

  factory OrderPayment.fromJson(Map<String, dynamic> j) {
    final payout = j['shopPayout'] as Map<String, dynamic>?;
    return OrderPayment(
      method: j['method'] as String,
      amountFcfa: j['amountFcfa'] as int,
      status: j['status'] as String,
      declaredReference: j['declaredReference'] as String?,
      contestReason: j['contestReason'] as String?,
      payoutPhone: payout?['phone'] as String?,
      payoutOperator: payout?['operator'] as String?,
    );
  }
}

/// Libellés honnêtes (§5) : jamais « payé » sans décision de la boutique, jamais « confirmé par le prestataire ».
String paymentStatusLabel(String s) => switch (s) {
      'not_paid' => 'À payer à la remise',
      'declared_by_customer' => 'Déclaré par le client — à confirmer par la boutique',
      'cash_received_to_confirm' => 'Espèces reçues par la boutique — à confirmer',
      'confirmed_by_shop' => 'Confirmé par la boutique',
      'contested_by_shop' => 'Contesté par la boutique',
      'cancelled' => 'Annulé',
      'failed' => 'Échoué',
      _ => '—',
    };

String operatorLabel(String? o) => switch (o) { 'wave' => 'Wave', 'orange' => 'Orange Money', 'mtn' => 'MTN MoMo', 'moov' => 'Moov Money', _ => 'Mobile Money' };

class OrderDetail {
  const OrderDetail({
    required this.id,
    required this.number,
    required this.status,
    required this.source,
    required this.shopName,
    required this.items,
    required this.itemsTotalFcfa,
    required this.totalFcfa,
    required this.events,
    required this.actions,
    this.shopSlug,
    this.customerName,
    this.conversationId,
    this.deliveryMode,
    this.paymentMethod,
    this.deliveryFeeFcfa,
    this.commune,
    this.address,
    this.estimatedMinutes,
    this.waitRule,
    this.handoverCode,
    this.handoverCodeStatus,
    this.expiresAt,
    this.endedBy,
    this.endReason,
    this.payment,
  });

  final String id;
  final String number;
  final String status;
  final String source;
  final String shopName;
  final String? shopSlug;
  final String? customerName;
  final String? conversationId;
  final List<OrderItem> items;
  final String? deliveryMode;
  final String? paymentMethod;
  final int itemsTotalFcfa;
  final int? deliveryFeeFcfa;
  final int totalFcfa;
  final String? commune;
  final String? address;
  final int? estimatedMinutes;
  final WaitRule? waitRule;
  /// Code de remise : au client seulement, tant qu'il peut servir.
  final String? handoverCode;
  final String? handoverCodeStatus;
  final DateTime? expiresAt;
  final String? endedBy;
  final String? endReason;
  final OrderPayment? payment;
  final List<OrderEvent> events;
  /// Actions possibles maintenant, calculées par le serveur.
  final List<String> actions;

  bool can(String action) => actions.contains(action);

  factory OrderDetail.fromJson(Map<String, dynamic> j) {
    final d = j['delivery'] as Map<String, dynamic>?;
    final shop = j['shop'] as Map<String, dynamic>;
    final ended = j['ended'] as Map<String, dynamic>?;
    return OrderDetail(
      id: j['id'] as String,
      number: j['number'] as String,
      status: j['status'] as String,
      source: j['source'] as String,
      shopName: shop['name'] as String,
      shopSlug: shop['slug'] as String?,
      customerName: (j['customer'] as Map<String, dynamic>?)?['fullName'] as String?,
      conversationId: j['conversationId'] as String?,
      items: [for (final i in (j['items'] as List<dynamic>).cast<Map<String, dynamic>>()) OrderItem.fromJson(i)],
      deliveryMode: j['deliveryMode'] as String?,
      paymentMethod: j['paymentMethod'] as String?,
      itemsTotalFcfa: j['itemsTotalFcfa'] as int,
      deliveryFeeFcfa: j['deliveryFeeFcfa'] as int?,
      totalFcfa: j['totalFcfa'] as int,
      commune: d?['commune'] as String?,
      address: d?['address'] as String?,
      estimatedMinutes: d?['estimatedMinutes'] as int?,
      waitRule: d?['waitRule'] == null ? null : WaitRule.fromJson(d!['waitRule'] as Map<String, dynamic>),
      handoverCode: j['handoverCode'] as String?,
      handoverCodeStatus: j['handoverCodeStatus'] as String?,
      expiresAt: j['expiresAt'] == null ? null : DateTime.parse(j['expiresAt'] as String),
      endedBy: ended?['byType'] as String?,
      endReason: ended?['reason'] as String?,
      payment: j['payment'] == null ? null : OrderPayment.fromJson(j['payment'] as Map<String, dynamic>),
      events: [for (final e in (j['events'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) OrderEvent.fromJson(e)],
      actions: [for (final a in (j['actions'] as List<dynamic>? ?? const [])) a as String],
    );
  }
}

class OrderSummary {
  const OrderSummary({required this.id, required this.number, required this.status, required this.totalFcfa, required this.createdAt, this.title, this.shopName, this.customerName, this.photoUrl, this.deliveryMode});
  final String id;
  final String number;
  final String status;
  final int totalFcfa;
  final DateTime createdAt;
  final String? title;
  final String? shopName;
  final String? customerName;
  final String? photoUrl;
  final String? deliveryMode;
  factory OrderSummary.fromJson(Map<String, dynamic> j) => OrderSummary(
        id: j['id'] as String,
        number: j['number'] as String,
        status: j['status'] as String,
        totalFcfa: j['totalFcfa'] as int,
        createdAt: DateTime.parse(j['createdAt'] as String),
        title: j['title'] as String?,
        shopName: j['shopName'] as String?,
        customerName: j['customerName'] as String?,
        photoUrl: j['photoUrl'] as String?,
        deliveryMode: j['deliveryMode'] as String?,
      );
}

/// Libellés honnêtes des statuts (§4).
String orderStatusLabel(String status) => switch (status) {
      'proposed' => 'Proposition à accepter',
      'pending_shop' => 'En attente de la boutique',
      'confirmed' => 'Confirmée',
      'preparing' => 'En préparation',
      'ready' => 'Prête',
      'delivered' => 'Remise',
      'completed' => 'Terminée',
      'declined' => 'Refusée',
      'expired' => 'Expirée',
      'cancelled' => 'Annulée',
      _ => 'Mise à jour',
    };

String deliveryModeLabel(String? mode) => switch (mode) {
      'pickup' => 'Retrait en boutique',
      'express' => 'Livraison rapide',
      'economy' => 'Livraison économique (2 jours au plus)',
      _ => 'Mode à choisir',
    };

String paymentMethodLabel(String? m) => switch (m) {
      'cash' => 'Espèces à la boutique',
      'mobile_money' => 'Mobile Money au numéro de la boutique, à la remise',
      _ => '—',
    };

String orderEventLabel(OrderEvent e) => switch (e.type) {
      'created' => 'Commande passée',
      'proposed' => 'Proposée par la boutique',
      'accepted' => 'Proposition acceptée',
      'confirmed' => 'Confirmée par la boutique',
      'declined' => 'Refusée par la boutique',
      'preparing' => 'Préparation commencée',
      'ready' => 'Prête',
      'code_failed' => 'Code incorrect saisi',
      'code_blocked' => 'Code bloqué (trop d’essais)',
      'code_validated' => 'Code validé',
      'handed_over' => 'Remise au client',
      'cancelled' => e.actorType == 'customer' ? 'Annulée par le client' : 'Annulée par la boutique',
      'proposal_declined' => 'Proposition refusée',
      'proposal_withdrawn' => 'Proposition retirée',
      'expired' => 'Expirée sans réponse',
      'payment_declared' => 'Paiement déclaré par le client',
      'cash_received' => 'Espèces reçues par la boutique',
      'payment_confirmed' => 'Paiement confirmé par la boutique',
      'payment_contested' => 'Paiement contesté par la boutique',
      'payment_review_queued' => 'Paiement à vérifier par le support',
      'payment_reviewed' => 'Vérifié par le support',
      'completed' => 'Commande terminée',
      _ => 'Mise à jour',
    };

class OrdersApi {
  OrdersApi(this._api);
  final ApiClient _api;

  Future<List<Commune>> communes() async {
    final r = await _api.get('/v1/communes');
    return [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) Commune.fromJson(c)];
  }

  Future<List<ModeQuote>> quote(String shopId, String communeCode) async {
    final r = await _api.get('/v1/shops/$shopId/delivery-quote', query: {'commune': communeCode});
    return [for (final q in (r['quotes'] as List<dynamic>).cast<Map<String, dynamic>>()) ModeQuote.fromJson(q)];
  }

  Future<OrderPreview> preview(String shopId, List<OrderLine> lines, Fulfilment f) async =>
      OrderPreview.fromJson(await _api.post('/v1/orders/preview', body: {'shopId': shopId, 'items': [for (final l in lines) l.toJson()], ...f.toJson()}));

  Future<OrderDetail> create(String shopId, List<OrderLine> lines, Fulfilment f, {required int expectedTotalFcfa, required String idempotencyKey}) async => OrderDetail.fromJson(
        await _api.post('/v1/orders', body: {'shopId': shopId, 'items': [for (final l in lines) l.toJson()], ...f.toJson(), 'expectedTotalFcfa': expectedTotalFcfa, 'idempotencyKey': idempotencyKey}),
      );

  Future<List<OrderSummary>> mine() async {
    final r = await _api.get('/v1/orders');
    return [for (final o in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) OrderSummary.fromJson(o)];
  }

  Future<OrderDetail> order(String id) async => OrderDetail.fromJson(await _api.get('/v1/orders/$id'));

  Future<OrderDetail> accept(String id, Fulfilment f, {required int expectedTotalFcfa}) async =>
      OrderDetail.fromJson(await _api.post('/v1/orders/$id/accept', body: {...f.toJson(), 'expectedTotalFcfa': expectedTotalFcfa}));

  Future<OrderDetail> declarePayment(String id, {String? reference}) async =>
      OrderDetail.fromJson(await _api.post('/v1/orders/$id/payment/declare', body: {if (reference != null && reference.isNotEmpty) 'reference': reference}));

  Future<OrderDetail> cancel(String id, {String? reason}) async => OrderDetail.fromJson(await _api.post('/v1/orders/$id/cancel', body: {if (reason != null) 'reason': reason}));
}

/// Commandes reçues par la boutique (espace boutique ; permissions contrôlées par le serveur).
class ShopOrdersApi {
  ShopOrdersApi(this._api);
  final ApiClient _api;

  Future<List<OrderSummary>> list(String box) async {
    final r = await _api.get('/v1/shop/orders', query: {'box': box});
    return [for (final o in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) OrderSummary.fromJson(o)];
  }

  Future<({int toConfirm, int toPrepare, int ready, int payments})> counts() async {
    final r = await _api.get('/v1/shop/orders/counts');
    return (toConfirm: r['toConfirm'] as int, toPrepare: r['toPrepare'] as int, ready: r['ready'] as int, payments: (r['paymentsToConfirm'] ?? 0) as int);
  }

  Future<OrderDetail> order(String id) async => OrderDetail.fromJson(await _api.get('/v1/shop/orders/$id'));

  /// `action` : confirm, decline, prepare, ready, handover, cancel, payment/cash, payment/confirm, payment/contest.
  Future<OrderDetail> act(String id, String action, {String? reason, String? code, int? amountFcfa}) async => OrderDetail.fromJson(
        await _api.post('/v1/shop/orders/$id/$action', body: {if (reason != null) 'reason': reason, if (code != null) 'code': code, if (amountFcfa != null) 'amountFcfa': amountFcfa}),
      );

  Future<OrderDetail> propose(String conversationId, List<OrderLine> lines, {required String idempotencyKey}) async => OrderDetail.fromJson(
        await _api.post('/v1/shop/orders/proposals', body: {'conversationId': conversationId, 'items': [for (final l in lines) l.toJson()], 'idempotencyKey': idempotencyKey}),
      );
}

final ordersApiProvider = Provider<OrdersApi>((ref) => OrdersApi(ref.watch(apiClientProvider)));
final shopOrdersApiProvider = Provider<ShopOrdersApi>((ref) => ShopOrdersApi(ref.watch(apiClientProvider)));
final communesProvider = FutureProvider.autoDispose<List<Commune>>((ref) => ref.watch(ordersApiProvider).communes());
final myOrdersProvider = FutureProvider.autoDispose<List<OrderSummary>>((ref) => ref.watch(ordersApiProvider).mine());
final shopOrdersProvider = FutureProvider.autoDispose.family<List<OrderSummary>, String>((ref, box) => ref.watch(shopOrdersApiProvider).list(box));
final shopOrderCountsProvider = FutureProvider.autoDispose<({int toConfirm, int toPrepare, int ready, int payments})>((ref) => ref.watch(shopOrdersApiProvider).counts());
