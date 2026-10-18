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
  const ModeQuote({required this.mode, required this.available, this.feeFcfa, this.minutes, this.reason, this.cashOnDelivery = false});
  final String mode;
  /// L7-07 : espèces possibles en livraison (la boutique a un livreur employé ; la course lui est réservée).
  final bool cashOnDelivery;
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
        cashOnDelivery: (j['cashOnDelivery'] ?? false) as bool,
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
  const OrderPayment({required this.method, required this.amountFcfa, required this.status, this.deliveryFeeIncludedFcfa = 0, this.declaredReference, this.contestReason, this.payoutPhone, this.payoutOperator});
  final String method;
  final int amountFcfa;
  /// Frais d'un livreur employé encaissés avec l'article, pour la boutique (compris dans [amountFcfa]).
  final int deliveryFeeIncludedFcfa;
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
      deliveryFeeIncludedFcfa: (j['deliveryFeeIncludedFcfa'] as int?) ?? 0,
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
      'confirmed_by_provider' => 'Paiement vérifié par le prestataire — à confirmer par la boutique',
      'confirmed_by_shop' => 'Confirmé par la boutique',
      'contested_by_shop' => 'Contesté par la boutique',
      'cancelled' => 'Annulé',
      'failed' => 'Échoué',
      _ => '—',
    };

String operatorLabel(String? o) => switch (o) { 'wave' => 'Wave', 'orange' => 'Orange Money', 'mtn' => 'MTN MoMo', 'moov' => 'Moov Money', _ => 'Mobile Money' };

/// 7-H — Évaluations d'une commande par son client : une par ligne et une pour la boutique.
class OrderReviews {
  const OrderReviews({required this.open, required this.itemRatings, this.shopRating, this.reason});
  final bool open;
  /// Note donnée à chaque ligne (null = pas encore évaluée).
  final List<int?> itemRatings;
  final int? shopRating;
  final String? reason;
  factory OrderReviews.fromJson(Map<String, dynamic> j) => OrderReviews(
        open: j['open'] as bool,
        reason: j['reason'] as String?,
        itemRatings: [for (final i in (j['items'] as List<dynamic>).cast<Map<String, dynamic>>()) (i['review'] as Map<String, dynamic>?)?['rating'] as int?],
        shopRating: (j['shop'] as Map<String, dynamic>?)?['rating'] as int?,
      );
}

class PublicReview {
  const PublicReview({required this.rating, required this.authorName, required this.createdAt, this.comment, this.aboutCurrentVersion = true});
  final int rating;
  final String? comment;
  final String authorName;
  final DateTime createdAt;
  final bool aboutCurrentVersion;
  factory PublicReview.fromJson(Map<String, dynamic> j) => PublicReview(
        rating: j['rating'] as int,
        comment: j['comment'] as String?,
        authorName: (j['author'] as Map<String, dynamic>)['fullName'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        aboutCurrentVersion: (j['aboutCurrentVersion'] ?? true) as bool,
      );
}

/// 7-F — Suivi de la livraison d'une commande (le livreur : prénom pour le client, nom pour la boutique).
class DeliveryTracking {
  const DeliveryTracking({required this.status, this.courierName, this.vehicle, this.category, this.requestExpiresAt, this.reviewRating, this.refusalReason});
  /// searching · offered · accepted · picked_up · arrived · code_validated · closed · refused_by_client · client_absent · cancelled
  final String status;
  final String? courierName;
  final String? vehicle;
  final String? category;
  final DateTime? requestExpiresAt;
  final int? reviewRating;
  final String? refusalReason;
  factory DeliveryTracking.fromJson(Map<String, dynamic> j) {
    final c = j['courier'] as Map<String, dynamic>?;
    return DeliveryTracking(
      status: j['status'] as String,
      courierName: c?['firstName'] as String?,
      vehicle: c?['vehicle'] as String?,
      category: c?['category'] as String?,
      requestExpiresAt: j['requestExpiresAt'] == null ? null : DateTime.parse(j['requestExpiresAt'] as String),
      reviewRating: (j['review'] as Map<String, dynamic>?)?['rating'] as int?,
      refusalReason: j['refusalReason'] as String?,
    );
  }
}

String deliveryStatusLabel(String s) => switch (s) {
      'searching' => 'Recherche d’un livreur',
      'offered' => 'Livreur sollicité, en attente de sa réponse',
      'accepted' => 'Livreur en route vers la boutique',
      'picked_up' => 'Colis pris en charge, en route',
      'arrived' => 'Livreur arrivé',
      'code_validated' => 'Code validé',
      'closed' => 'Livraison terminée',
      'refused_by_client' => 'Remise refusée',
      'client_absent' => 'Client absent',
      'cancelled' => 'Livraison annulée',
      _ => s,
    };

/// Statut des frais payés au livreur indépendant.
String deliveryFeeStatusLabelFr(String s) => const {
      'to_pay': 'à payer au livreur',
      'declared_by_customer': 'paiement indiqué, en attente du livreur',
      'confirmed_by_courier': 'reçus par le livreur',
      'contested_by_courier': 'non reçus selon le livreur',
      'cancelled': 'annulés',
    }[s] ??
    s;

/// A3-b — Frais de livraison payés directement par le client au livreur indépendant (Mobile Money).
class DeliveryFeePayment {
  const DeliveryFeePayment({required this.amountFcfa, required this.status, this.payToName, this.payToPhone, this.payToOperator, this.actions = const []});

  factory DeliveryFeePayment.fromJson(Map<String, dynamic> j) {
    final to = j['payTo'] as Map<String, dynamic>?;
    return DeliveryFeePayment(
      amountFcfa: j['amountFcfa'] as int,
      status: j['status'] as String,
      payToName: to?['firstName'] as String?,
      payToPhone: to?['phone'] as String?,
      payToOperator: to?['operator'] as String?,
      actions: [for (final a in (j['actions'] as List<dynamic>? ?? const [])) a as String],
    );
  }

  final int amountFcfa;
  /// to_pay · declared_by_customer · confirmed_by_courier · contested_by_courier · cancelled
  final String status;
  final String? payToName;
  final String? payToPhone;
  final String? payToOperator;
  final List<String> actions;
}

class IncidentSummary {
  const IncidentSummary({required this.id, required this.status, required this.reason, this.afterDelivery = false, this.photoUrls = const [], this.canAddPhoto = false});
  final String id;
  final String status;
  final String reason;
  /// Signalé après la remise : à régler entre le client et la boutique (L7-08), sans le support.
  final bool afterDelivery;
  /// Photos jointes (liens temporaires, privés) ; 3 au plus.
  final List<String> photoUrls;
  final bool canAddPhoto;
  factory IncidentSummary.fromJson(Map<String, dynamic> j) => IncidentSummary(
        id: j['id'] as String,
        status: j['status'] as String,
        reason: j['reason'] as String,
        afterDelivery: j['afterDelivery'] == true,
        photoUrls: [
          for (final p in (j['photos'] as List<dynamic>? ?? const []))
            if (p is Map<String, dynamic> && p['url'] is String) p['url'] as String,
        ],
        canAddPhoto: j['canAddPhoto'] == true,
      );
}

String incidentReasonLabel(String r) => const {
      'item_incorrect': 'Article incorrect',
      'item_damaged': 'Article endommagé',
      'item_incomplete': 'Article incomplet',
      'client_absent': 'Client absent',
      'courier_absent': 'Livreur absent',
      'courier_not_there': 'Le livreur n’est pas là',
      'delay': 'Retard',
      'payment': 'Paiement',
      'behaviour': 'Comportement',
      'other': 'Autre',
    }[r] ??
    r;

String incidentStatusLabel(String s) => const {'open': 'Ouvert', 'with_support': 'Transmis au support', 'resolved': 'Résolu'}[s] ?? s;

/// Livreur éligible proposé à la boutique (calculé par le serveur).
class CourierCandidate {
  const CourierCandidate({required this.courierId, required this.fullName, required this.category, required this.selectable, required this.reasonRequired, this.vehicle});
  final String courierId;
  final String fullName;
  final String category;
  final bool selectable;
  final bool reasonRequired;
  final String? vehicle;
  factory CourierCandidate.fromJson(Map<String, dynamic> j) => CourierCandidate(
        courierId: j['courierId'] as String,
        fullName: j['fullName'] as String,
        category: j['category'] as String,
        selectable: j['selectable'] as bool,
        reasonRequired: j['reasonRequired'] as bool,
        vehicle: j['vehicle'] as String?,
      );
}

String courierCategoryLabel(String c) => const {'employee': 'Employé de la boutique', 'partner': 'Partenaire', 'independent': 'Indépendant'}[c] ?? c;

/// Lot 8 — Paiement en ligne de l'article (prestataire) : proposé seulement s'il est réellement ouvert pour la commande.
class OnlinePayment {
  const OnlinePayment({required this.available, this.operators = const [], this.lastStatus, this.lastFailure});
  final bool available;
  /// Opérateurs que le prestataire prend réellement en charge (jamais un moyen inactif).
  final List<String> operators;
  /// pending · succeeded · failed · expired
  final String? lastStatus;
  final String? lastFailure;
  factory OnlinePayment.fromJson(Map<String, dynamic> j) {
    final last = j['last'] as Map<String, dynamic>?;
    return OnlinePayment(
      available: (j['available'] ?? false) as bool,
      operators: ((j['operators'] ?? const <dynamic>[]) as List<dynamic>).cast<String>(),
      lastStatus: last?['status'] as String?,
      lastFailure: last?['failureReason'] as String?,
    );
  }
}

String operatorsLabel(List<String> ops) => ops.map((o) => const {'orange': 'Orange Money', 'mtn': 'MTN Mobile Money', 'wave': 'Wave', 'moov': 'Moov Money'}[o] ?? o).join(', ');

String onlineStatusLabel(String s) => const {
      'pending': 'Paiement en ligne en attente de ta validation',
      'succeeded': 'Paiement vérifié par le prestataire',
      'failed': 'Paiement en ligne échoué',
      'expired': 'Paiement en ligne expiré',
    }[s] ??
    s;

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
    this.reviews,
    this.tracking,
    this.incidents = const [],
    this.onlinePayment,
    this.disputeUntil,
    this.deliveryFee,
    this.disputeOpen = true,
    this.inDispute = false,
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
  final OrderReviews? reviews;
  final DeliveryTracking? tracking;
  final List<IncidentSummary> incidents;
  final OnlinePayment? onlinePayment;
  /// 7-G : fin du délai de contestation après la remise (null avant la remise).
  final DateTime? disputeUntil;
  /// A3-b : frais à payer au livreur indépendant (null sinon).
  final DeliveryFeePayment? deliveryFee;
  /// Faux une fois le délai dépassé : plus d'incident possible (le support reste joignable par « Aide »).
  final bool disputeOpen;
  /// Commande remise avec un incident non résolu ouvert depuis : « en litige ».
  final bool inDispute;
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
      reviews: j['reviews'] == null ? null : OrderReviews.fromJson(j['reviews'] as Map<String, dynamic>),
      tracking: j['tracking'] == null ? null : DeliveryTracking.fromJson(j['tracking'] as Map<String, dynamic>),
      incidents: [for (final i in (j['incidents'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) IncidentSummary.fromJson(i)],
      onlinePayment: j['onlinePayment'] == null ? null : OnlinePayment.fromJson(j['onlinePayment'] as Map<String, dynamic>),
      disputeUntil: DateTime.tryParse((j['dispute'] as Map<String, dynamic>?)?['until'] as String? ?? '')?.toLocal(),
      disputeOpen: ((j['dispute'] as Map<String, dynamic>?)?['until'] == null) || ((j['dispute'] as Map<String, dynamic>?)?['open'] == true),
      inDispute: (j['dispute'] as Map<String, dynamic>?)?['inDispute'] == true,
      deliveryFee: j['deliveryFeePayment'] == null ? null : DeliveryFeePayment.fromJson(j['deliveryFeePayment'] as Map<String, dynamic>),
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
      'in_delivery' => 'En livraison',
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
      'courier_assigned' => 'Livreur attribué',
      'courier_released' => 'Livreur désisté : nouvelle recherche',
      'picked_up' => 'Colis pris en charge',
      'courier_arrived' => 'Livreur arrivé',
      'delivered' => 'Livrée',
      'delivery_refused' => 'Remise refusée par le client',
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
    // L7-07 : l'indication « espèces possibles en livraison » vaut pour toute la boutique.
    final cash = (r['cashOnDelivery'] ?? false) as bool;
    return [for (final q in (r['quotes'] as List<dynamic>).cast<Map<String, dynamic>>()) ModeQuote.fromJson({...q, 'cashOnDelivery': cash})];
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

  /// A3-b : « J'ai payé le livreur » (frais d'un livreur indépendant, Mobile Money).
  Future<OrderDetail> declareDeliveryFee(String id, {String? reference}) async =>
      OrderDetail.fromJson(await _api.post('/v1/orders/$id/payment/delivery-fee/declare', body: {if (reference != null && reference.isNotEmpty) 'reference': reference}));

  Future<OrderDetail> declarePayment(String id, {String? reference}) async =>
      OrderDetail.fromJson(await _api.post('/v1/orders/$id/payment/declare', body: {if (reference != null && reference.isNotEmpty) 'reference': reference}));

  /// `position` : ligne évaluée ; null = la boutique.
  Future<OrderDetail> review(String id, {int? position, required int rating, String? comment}) async => OrderDetail.fromJson(
        await _api.post(position == null ? '/v1/orders/$id/reviews/shop' : '/v1/orders/$id/reviews/items/$position', body: {'rating': rating, if (comment != null && comment.isNotEmpty) 'comment': comment}),
      );

  Future<List<PublicReview>> productReviews(String productId) async {
    final r = await _api.get('/v1/bimshop/products/$productId/reviews');
    return [for (final x in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) PublicReview.fromJson(x)];
  }

  Future<OrderDetail> refuseDelivery(String id, String reason, {String? details}) async =>
      OrderDetail.fromJson(await _api.post('/v1/orders/$id/delivery/refuse', body: {'reason': reason, if (details != null && details.isNotEmpty) 'details': details}));

  Future<OrderDetail> reviewDelivery(String id, {required int rating, String? comment}) async =>
      OrderDetail.fromJson(await _api.post('/v1/orders/$id/delivery/review', body: {'rating': rating, if (comment != null && comment.isNotEmpty) 'comment': comment}));

  Future<void> openIncident(String orderId, String reason, {String? description}) =>
      _api.post('/v1/orders/$orderId/incidents', body: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description});

  Future<void> incidentToSupport(String incidentId) => _api.post('/v1/incidents/$incidentId/support');
  /// Photo jointe au problème signalé (ré-encodée et stockée en privé par le serveur).
  Future<void> addIncidentPhoto(String incidentId, List<int> bytes) =>
      _api.upload('/v1/incidents/$incidentId/photos', field: 'photo', bytes: bytes, filename: 'photo.jpg', contentType: 'image/jpeg');

  /// Lot 8 : lancer le paiement en ligne ; renvoie la page du prestataire à ouvrir.
  Future<({String? redirectUrl, String status})> startOnlinePayment(String orderId) async {
    final r = await _api.post('/v1/orders/$orderId/payment/online');
    return (redirectUrl: r['redirectUrl'] as String?, status: r['status'] as String);
  }

  /// Lot 8 : vérification auprès du prestataire après la validation sur le téléphone.
  Future<({String status, String? failureReason})> checkOnlinePayment(String orderId) async {
    final r = await _api.post('/v1/orders/$orderId/payment/online/check');
    return (status: r['status'] as String, failureReason: r['failureReason'] as String?);
  }

  /// Code de remise bloqué après trop d'essais : nouveau code (l'ancien ne vaut plus rien).
  Future<OrderDetail> renewHandoverCode(String id) async => OrderDetail.fromJson(await _api.post('/v1/orders/$id/handover-code/renew'));

  Future<OrderDetail> cancel(String id, {String? reason}) async => OrderDetail.fromJson(await _api.post('/v1/orders/$id/cancel', body: {if (reason != null) 'reason': reason}));
}

/// Commandes reçues par la boutique (espace boutique ; permissions contrôlées par le serveur).
/// Lot 8 (L8-02) — Paiement en ligne vu par la boutique : frais du prestataire à sa charge, aucune commission de BIM.
class ShopOnlineTerms {
  const ShopOnlineTerms({required this.open, required this.operators, required this.bimCommissionPercent, this.feeTerms, required this.accountActive});

  factory ShopOnlineTerms.fromJson(Map<String, dynamic> j) => ShopOnlineTerms(
        open: j['open'] == true,
        operators: [for (final o in (j['operators'] as List<dynamic>? ?? const [])) o as String],
        bimCommissionPercent: (j['bimCommissionPercent'] as num?) ?? 0,
        feeTerms: j['feeTerms'] as String?,
        accountActive: j['accountActive'] == true,
      );

  final bool open;
  final List<String> operators;
  final num bimCommissionPercent;
  /// Frais applicables publiés par BIM avant l'activation ; null tant qu'ils ne le sont pas.
  final String? feeTerms;
  final bool accountActive;
}

class ShopOrdersApi {
  ShopOrdersApi(this._api);
  final ApiClient _api;

  Future<ShopOnlineTerms> onlineTerms() async => ShopOnlineTerms.fromJson(await _api.get('/v1/shop/online-payments'));

  Future<List<OrderSummary>> list(String box) async {
    final r = await _api.get('/v1/shop/orders', query: {'box': box});
    return [for (final o in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) OrderSummary.fromJson(o)];
  }

  Future<({int toConfirm, int toPrepare, int ready, int payments})> counts() async {
    final r = await _api.get('/v1/shop/orders/counts');
    return (toConfirm: r['toConfirm'] as int, toPrepare: r['toPrepare'] as int, ready: r['ready'] as int, payments: (r['paymentsToConfirm'] ?? 0) as int);
  }

  Future<OrderDetail> order(String id) async => OrderDetail.fromJson(await _api.get('/v1/shop/orders/$id'));

  /// `action` : confirm, decline, prepare, ready, handover, cancel, payment/cash, payment/confirm, payment/contest,
  /// delivery/start, delivery/withdraw, delivery/returned.
  Future<OrderDetail> act(String id, String action, {String? reason, String? code, int? amountFcfa}) async => OrderDetail.fromJson(
        await _api.post('/v1/shop/orders/$id/$action', body: {if (reason != null) 'reason': reason, if (code != null) 'code': code, if (amountFcfa != null) 'amountFcfa': amountFcfa}),
      );

  Future<List<CourierCandidate>> candidates(String id) async {
    final r = await _api.get('/v1/shop/orders/$id/delivery/candidates');
    return [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) CourierCandidate.fromJson(c)];
  }

  Future<void> openIncident(String orderId, String reason, {String? description}) =>
      _api.post('/v1/shop/orders/$orderId/incidents', body: {'reason': reason, if (description != null && description.isNotEmpty) 'description': description});

  Future<void> incidentToSupport(String incidentId) => _api.post('/v1/shop/incidents/$incidentId/support');
  Future<void> addIncidentPhoto(String incidentId, List<int> bytes) =>
      _api.upload('/v1/shop/incidents/$incidentId/photos', field: 'photo', bytes: bytes, filename: 'photo.jpg', contentType: 'image/jpeg');

  Future<OrderDetail> offer(String id, String courierId, {String? reason}) async =>
      OrderDetail.fromJson(await _api.post('/v1/shop/orders/$id/delivery/offer', body: {'courierId': courierId, if (reason != null && reason.isNotEmpty) 'reason': reason}));

  Future<OrderDetail> propose(String conversationId, List<OrderLine> lines, {required String idempotencyKey}) async => OrderDetail.fromJson(
        await _api.post('/v1/shop/orders/proposals', body: {'conversationId': conversationId, 'items': [for (final l in lines) l.toJson()], 'idempotencyKey': idempotencyKey}),
      );
}

final ordersApiProvider = Provider<OrdersApi>((ref) => OrdersApi(ref.watch(apiClientProvider)));
final shopOrdersApiProvider = Provider<ShopOrdersApi>((ref) => ShopOrdersApi(ref.watch(apiClientProvider)));
final productReviewsProvider = FutureProvider.autoDispose.family<List<PublicReview>, String>((ref, id) => ref.watch(ordersApiProvider).productReviews(id));
final communesProvider = FutureProvider.autoDispose<List<Commune>>((ref) => ref.watch(ordersApiProvider).communes());
final myOrdersProvider = FutureProvider.autoDispose<List<OrderSummary>>((ref) => ref.watch(ordersApiProvider).mine());
final shopOrdersProvider = FutureProvider.autoDispose.family<List<OrderSummary>, String>((ref, box) => ref.watch(shopOrdersApiProvider).list(box));
final shopOrderCountsProvider = FutureProvider.autoDispose<({int toConfirm, int toPrepare, int ready, int payments})>((ref) => ref.watch(shopOrdersApiProvider).counts());
