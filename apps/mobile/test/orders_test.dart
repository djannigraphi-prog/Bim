import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/core/util/url_opener.dart';
import 'package:bim/features/merchant/data/shop_api.dart' show formatFcfa;
import 'package:bim/features/orders/data/orders_api.dart';
import 'package:bim/features/orders/presentation/checkout_screen.dart';
import 'package:bim/features/orders/presentation/order_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

ApiClient _client() => ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');

OrderDetail _detail({String status = 'pending_shop', List<String> actions = const ['cancel'], String? code, String? mode = 'pickup', String? customer, OrderPayment? payment, OrderReviews? reviews, DeliveryTracking? tracking, List<IncidentSummary> incidents = const [], OnlinePayment? online}) => OrderDetail(
      id: 'o1',
      number: 'CMD-000042',
      status: status,
      source: 'bimshop',
      shopName: 'Boutique Élégance',
      customerName: customer,
      items: const [OrderItem(reference: 'BIM-000123', title: 'Robe soirée à plumes', variantLabel: 'M', quantity: 2, unitPriceFcfa: 20000, catalogPriceFcfa: 20000, lineTotalFcfa: 40000)],
      deliveryMode: mode,
      paymentMethod: 'mobile_money',
      itemsTotalFcfa: 40000,
      totalFcfa: 40000,
      handoverCode: code,
      handoverCodeStatus: code == null ? null : 'active',
      events: [OrderEvent(type: 'created', actorType: 'customer', at: DateTime.utc(2026, 10, 16, 9))],
      actions: actions,
      payment: payment,
      reviews: reviews,
      tracking: tracking,
      incidents: incidents,
      onlinePayment: online,
    );

/// API simulée (les règles — montant, stock, code, permissions — sont testées côté serveur).
class _FakeOrders extends OrdersApi {
  _FakeOrders() : super(_client());
  final calls = <String>[];
  OrderDetail current = _detail();
  /// L7-07 : la boutique a un livreur employé (espèces possibles en livraison).
  bool cashOnDelivery = false;

  @override
  Future<List<Commune>> communes() async => const [Commune(code: 'abidjan-yopougon', city: 'Abidjan', name: 'Yopougon')];

  @override
  Future<List<ModeQuote>> quote(String shopId, String communeCode) async {
    calls.add('quote $communeCode');
    return [ModeQuote(mode: 'express', available: true, feeFcfa: 1700, minutes: 30, cashOnDelivery: cashOnDelivery), ModeQuote(mode: 'economy', available: false, reason: 'NO_TARIFF', cashOnDelivery: cashOnDelivery)];
  }

  @override
  Future<OrderPreview> preview(String shopId, List<OrderLine> lines, Fulfilment f) async {
    final items = 20000 * lines.single.quantity;
    final fee = f.mode == 'express' ? 1700 : null;
    calls.add('preview ${f.mode} ${lines.single.quantity}');
    return OrderPreview(
      itemsTotalFcfa: items,
      deliveryFeeFcfa: fee,
      totalFcfa: items + (fee ?? 0),
      estimatedMinutes: fee == null ? null : 30,
      waitRule: fee == null ? null : const WaitRule(freeMinutes: 5, perMinuteFcfa: 50, capMinutes: 15, billed: false),
    );
  }

  @override
  Future<OrderDetail> create(String shopId, List<OrderLine> lines, Fulfilment f, {required int expectedTotalFcfa, required String idempotencyKey}) async {
    calls.add('create ${f.mode} ${f.paymentMethod} ${f.communeCode} ${lines.single.quantity} $expectedTotalFcfa ${idempotencyKey.length}');
    return current;
  }

  @override
  Future<OrderDetail> order(String id) async => current;

  @override
  Future<OrderDetail> declarePayment(String id, {String? reference}) async {
    calls.add('declare $id ${reference ?? '-'}');
    return current = _detail(status: 'delivered', actions: const [], payment: const OrderPayment(method: 'mobile_money', amountFcfa: 40000, status: 'declared_by_customer', declaredReference: 'WV-1'));
  }

  @override
  Future<OrderDetail> review(String id, {int? position, required int rating, String? comment}) async {
    calls.add('review ${position ?? 'shop'} $rating ${comment ?? ''}'.trim());
    return current = _detail(status: 'completed', actions: const [], reviews: OrderReviews(open: true, itemRatings: [position == 0 ? rating : null], shopRating: position == null ? rating : null));
  }

  @override
  Future<OrderDetail> refuseDelivery(String id, String reason, {String? details}) async {
    calls.add('refuse $reason ${details ?? ''}'.trim());
    return current = _detail(
      status: 'in_delivery',
      mode: 'express',
      actions: const [],
      tracking: const DeliveryTracking(status: 'refused_by_client', courierName: 'Koffi', refusalReason: 'damaged'),
      incidents: const [IncidentSummary(id: 'i1', status: 'open', reason: 'item_damaged')],
    );
  }

  @override
  Future<({String? redirectUrl, String status})> startOnlinePayment(String orderId) async {
    calls.add('online start');
    current = _detail(status: 'delivered', actions: const ['declare_payment'], online: const OnlinePayment(available: true, operators: ['orange', 'mtn', 'wave'], lastStatus: 'pending'));
    return (redirectUrl: 'https://checkout.paystack.com/abc', status: 'pending');
  }

  @override
  Future<({String status, String? failureReason})> checkOnlinePayment(String orderId) async {
    calls.add('online check');
    current = _detail(status: 'delivered', actions: const [], online: const OnlinePayment(available: false, lastStatus: 'succeeded'));
    return (status: 'succeeded', failureReason: null);
  }

  @override
  Future<void> incidentToSupport(String incidentId) async {
    calls.add('support $incidentId');
    current = _detail(
      status: 'in_delivery',
      mode: 'express',
      actions: const [],
      tracking: const DeliveryTracking(status: 'refused_by_client', courierName: 'Koffi', refusalReason: 'damaged'),
      incidents: const [IncidentSummary(id: 'i1', status: 'with_support', reason: 'item_damaged')],
    );
  }

  @override
  Future<OrderDetail> reviewDelivery(String id, {required int rating, String? comment}) async {
    calls.add('review delivery $rating');
    return current = _detail(status: 'delivered', mode: 'express', actions: const [], tracking: DeliveryTracking(status: 'closed', courierName: 'Koffi', reviewRating: rating));
  }

  @override
  Future<OrderDetail> cancel(String id, {String? reason}) async {
    calls.add('cancel $id ${reason ?? '-'}');
    return current = _detail(status: 'cancelled', actions: const []);
  }
}

class _FakeShopOrders extends ShopOrdersApi {
  _FakeShopOrders() : super(_client());
  final calls = <String>[];
  OrderDetail current = _detail(status: 'ready', actions: const ['handover', 'cancel'], customer: 'Awa Koné');

  @override
  Future<OrderDetail> order(String id) async => current;

  @override
  Future<OrderDetail> act(String id, String action, {String? reason, String? code, int? amountFcfa}) async {
    calls.add('$action ${code ?? reason ?? amountFcfa ?? ''}'.trim());
    if (action == 'payment/cash') {
      return current = _detail(status: 'delivered', actions: const ['confirm_payment', 'contest_payment'], customer: 'Awa Koné', payment: const OrderPayment(method: 'cash', amountFcfa: 40000, status: 'cash_received_to_confirm'));
    }
    if (action == 'payment/confirm') {
      return current = _detail(status: 'completed', actions: const [], customer: 'Awa Koné', payment: const OrderPayment(method: 'cash', amountFcfa: 40000, status: 'confirmed_by_shop'));
    }
    if (action == 'handover' && code != '4821') {
      throw const ApiException(code: 'HANDOVER_CODE_INVALID', message: 'Code incorrect.', status: 400, details: {'remaining': 4});
    }
    if (action == 'delivery/start') {
      return current = _detail(status: 'ready', mode: 'economy', actions: const ['cancel', 'select_courier'], customer: 'Awa Koné', tracking: const DeliveryTracking(status: 'searching'));
    }
    return current = _detail(status: 'delivered', actions: const [], customer: 'Awa Koné');
  }

  @override
  Future<List<CourierCandidate>> candidates(String id) async => const [
        CourierCandidate(courierId: 'emp', fullName: 'Yao Employé', category: 'employee', selectable: true, reasonRequired: false),
        CourierCandidate(courierId: 'ind', fullName: 'Ibrahim Indépendant', category: 'independent', selectable: true, reasonRequired: true),
      ];

  @override
  Future<OrderDetail> offer(String id, String courierId, {String? reason}) async {
    calls.add('offer $courierId ${reason ?? ''}'.trim());
    return current = _detail(status: 'ready', mode: 'economy', actions: const ['cancel', 'withdraw_request'], customer: 'Awa Koné', tracking: const DeliveryTracking(status: 'offered'));
  }
}

Future<void> _pump(WidgetTester tester, Widget home, {_FakeOrders? orders, _FakeShopOrders? shop, List<Uri>? opened}) async {
  tester.view.physicalSize = const Size(1170, 3600);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: '/start', routes: [
    GoRoute(path: '/start', builder: (_, __) => home),
    GoRoute(path: '/orders/:id', builder: (_, s) => Scaffold(body: Text('commande ${s.pathParameters['id']}'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      ordersApiProvider.overrideWithValue(orders ?? _FakeOrders()),
      shopOrdersApiProvider.overrideWithValue(shop ?? _FakeShopOrders()),
      urlOpenerProvider.overrideWithValue((u) async {
        opened?.add(u);
        return true;
      }),
    ],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

const _args = CheckoutArgs(
  shopId: 's1',
  shopName: 'Boutique Élégance',
  lines: [CheckoutLine(line: OrderLine(productId: 'x1', variantId: 'v1', quantity: 1), title: 'Robe soirée à plumes', variantLabel: 'M', unitPriceFcfa: 20000)],
);

String _total(WidgetTester t) => t.widget<Text>(find.byKey(const ValueKey('checkout-total'))).data!;

void main() {
  testWidgets('7-B récapitulatif : retrait, quantité, total du serveur ; confirmation avec le montant affiché et une clé anti-doublon', (tester) async {
    final api = _FakeOrders();
    await _pump(tester, const CheckoutScreen(args: _args), orders: api);
    await tester.pumpAndSettle();
    expect(_total(tester), formatFcfa(20000));
    await tester.tap(find.byKey(const ValueKey('qty-plus-0')));
    await tester.pumpAndSettle();
    expect(_total(tester), formatFcfa(40000));
    // Espèces possibles au retrait en boutique.
    await tester.tap(find.byKey(const ValueKey('pay-cash')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('checkout-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls.where((c) => c.startsWith('create')), ['create pickup cash null 2 40000 32']);
    expect(find.text('commande o1'), findsOneWidget);
  });

  testWidgets('7-B livraison : commune, frais et délai du serveur, règle d’attente, espèces impossibles, adresse requise', (tester) async {
    final api = _FakeOrders();
    await _pump(tester, const CheckoutScreen(args: _args), orders: api);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('mode-express')));
    await tester.pumpAndSettle();
    // Sans commune : indisponible, rien ne part.
    expect(find.text('Livraison rapide : choisis d’abord ta commune.'), findsOneWidget);
    expect(tester.widget<ChoiceChip>(find.byKey(const ValueKey('pay-cash'))).onSelected, isNull);
    await tester.tap(find.byKey(const ValueKey('checkout-commune')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Yopougon (Abidjan)').last);
    await tester.pumpAndSettle();
    expect(find.text('Frais : ${formatFcfa(1700)} · trajet estimé 30 min'), findsOneWidget);
    expect(_total(tester), formatFcfa(21700));
    expect(find.byKey(const ValueKey('checkout-wait')), findsOneWidget);
    FilledButton confirm() => tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('checkout-confirm')), matching: find.byType(FilledButton)));
    expect(confirm().onPressed, isNull); // adresse manquante
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('checkout-address')), matching: find.byType(TextField)), 'Rue des jardins');
    await tester.pump();
    expect(confirm().onPressed, isNotNull);
    // Économique : pas encore proposé.
    await tester.tap(find.byKey(const ValueKey('mode-economy')));
    await tester.pumpAndSettle();
    expect(find.text('Livraison économique : pas encore proposée.'), findsOneWidget);
    expect(confirm().onPressed, isNull);
  });

  testWidgets('L7-07 livraison payée en espèces si la boutique a un livreur employé', (tester) async {
    final api = _FakeOrders()..cashOnDelivery = true;
    await _pump(tester, const CheckoutScreen(args: _args), orders: api);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('mode-express')));
    await tester.pumpAndSettle();
    // Avant la commune : pas de devis, espèces encore indisponibles.
    expect(tester.widget<ChoiceChip>(find.byKey(const ValueKey('pay-cash'))).onSelected, isNull);
    await tester.tap(find.byKey(const ValueKey('checkout-commune')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Yopougon (Abidjan)').last);
    await tester.pumpAndSettle();
    expect(tester.widget<ChoiceChip>(find.byKey(const ValueKey('pay-cash'))).onSelected, isNotNull);
    await tester.tap(find.byKey(const ValueKey('pay-cash')));
    await tester.pumpAndSettle();
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('checkout-address')), matching: find.byType(TextField)), 'Rue des jardins');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('checkout-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls.where((c) => c.startsWith('create')).single, startsWith('create express cash abidjan-yopougon 1'));
  });

  testWidgets('7-B commande (client) : code de remise affiché, annulation avec motif facultatif', (tester) async {
    final api = _FakeOrders()..current = _detail(status: 'confirmed', code: '4821');
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: api);
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('handover-code'))).data, '4821');
    expect(find.textContaining('n’est pas une preuve de paiement'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('order-cancel')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reason-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['cancel o1 -']);
    expect(find.text('Annulée'), findsOneWidget);
    expect(find.byKey(const ValueKey('handover-code')), findsNothing);
  });

  testWidgets('7-B commande reçue : code incorrect signalé avec les essais restants, puis remise', (tester) async {
    final shop = _FakeShopOrders();
    await _pump(tester, const ShopOrderScreen(orderId: 'o1'), shop: shop);
    await tester.pumpAndSettle();
    expect(find.text('Client : Awa Koné'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('handover-input')), '0000');
    await tester.tap(find.byKey(const ValueKey('shop-order-handover')));
    await tester.pumpAndSettle();
    expect(find.text('Code incorrect. Essais restants : 4.'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('handover-input')), '4821');
    await tester.tap(find.byKey(const ValueKey('shop-order-handover')));
    await tester.pumpAndSettle();
    expect(shop.calls, ['handover 0000', 'handover 4821']);
    expect(find.text('Remise'), findsOneWidget);
    expect(find.byKey(const ValueKey('shop-order-handover')), findsNothing);
  });

  testWidgets('7-C client : numéro Mobile Money confirmé de la boutique, « J’ai payé » = déclaration à confirmer', (tester) async {
    final api = _FakeOrders()
      ..current = _detail(
        status: 'delivered',
        actions: const ['declare_payment'],
        payment: const OrderPayment(method: 'mobile_money', amountFcfa: 40000, status: 'not_paid', payoutPhone: '+2250102030405', payoutOperator: 'wave'),
      );
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: api);
    await tester.pumpAndSettle();
    expect(find.text('Wave de la boutique : +2250102030405'), findsOneWidget);
    expect(find.text('Paiement : À payer à la remise'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('pay-reference')), 'WV-1');
    await tester.tap(find.byKey(const ValueKey('declare-payment')));
    await tester.pumpAndSettle();
    expect(api.calls, ['declare o1 WV-1']);
    expect(find.text('Paiement : Déclaré par le client — à confirmer par la boutique'), findsOneWidget);
    expect(find.byKey(const ValueKey('declare-payment')), findsNothing);
  });

  testWidgets('7-C boutique : espèces reçues au montant attendu, puis confirmation : commande terminée', (tester) async {
    final shop = _FakeShopOrders()
      ..current = _detail(status: 'delivered', actions: const ['cash_received'], customer: 'Awa Koné', payment: const OrderPayment(method: 'cash', amountFcfa: 40000, status: 'not_paid'));
    await _pump(tester, const ShopOrderScreen(orderId: 'o1'), shop: shop);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('shop-cash-received')));
    await tester.pumpAndSettle();
    expect(find.text('Paiement : Espèces reçues par la boutique — à confirmer'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('shop-payment-confirm')));
    await tester.pumpAndSettle();
    expect(shop.calls, ['payment/cash 40000', 'payment/confirm']);
    expect(find.text('Terminée'), findsOneWidget);
    expect(find.text('Paiement : Confirmé par la boutique'), findsOneWidget);
  });

  testWidgets('7-H évaluer un article après la remise : note obligatoire, commentaire facultatif, une seule fois', (tester) async {
    final api = _FakeOrders()..current = _detail(status: 'completed', actions: const [], reviews: const OrderReviews(open: true, itemRatings: [null]));
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: api);
    await tester.pumpAndSettle();
    await tester.tap(find.descendant(of: find.byKey(const ValueKey('review-item-0')), matching: find.text('Évaluer')));
    await tester.pumpAndSettle();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('review-send'))).onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('star-4')));
    await tester.pump();
    await tester.enterText(find.byKey(const ValueKey('review-comment')), 'Belle robe');
    await tester.tap(find.byKey(const ValueKey('review-send')));
    await tester.pumpAndSettle();
    expect(api.calls, ['review 0 4 Belle robe']);
    expect(find.text('★★★★☆'), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('review-item-0')), matching: find.text('Évaluer')), findsNothing);
  });

  testWidgets('7-F boutique : recherche lancée, livreurs éligibles du serveur, passer un prioritaire demande un motif', (tester) async {
    final shop = _FakeShopOrders()..current = _detail(status: 'ready', mode: 'economy', actions: const ['cancel', 'start_delivery'], customer: 'Awa Koné');
    await _pump(tester, const ShopOrderScreen(orderId: 'o1'), shop: shop);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delivery-start')));
    await tester.pumpAndSettle();
    expect(find.text('Livraison : Recherche d’un livreur'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('delivery-select')));
    await tester.pumpAndSettle();
    expect(find.text('Employé de la boutique'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('candidate-ind')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('reason-input')), 'Employé trop loin');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('reason-confirm')));
    await tester.pumpAndSettle();
    expect(shop.calls, ['delivery/start', 'offer ind Employé trop loin']);
    expect(find.text('Livraison : Livreur sollicité, en attente de sa réponse'), findsOneWidget);
    expect(find.byKey(const ValueKey('delivery-withdraw')), findsOneWidget);
  });

  testWidgets('7-F/7-G client : refuser la remise avec un motif ouvre un incident, transmis au support', (tester) async {
    final api = _FakeOrders()
      ..current = _detail(status: 'in_delivery', mode: 'express', code: '4821', actions: const ['refuse_delivery', 'report_incident'], tracking: const DeliveryTracking(status: 'arrived', courierName: 'Koffi', vehicle: 'moto'));
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: api);
    await tester.pumpAndSettle();
    expect(find.text('Livreur : Koffi · Moto'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('delivery-refuse')));
    await tester.pumpAndSettle();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('refuse-send'))).onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('refuse-damaged')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('refuse-send')));
    await tester.pumpAndSettle();
    expect(find.text('Motif du refus : Article endommagé'), findsOneWidget);
    expect(find.text('Ouvert'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('incident-support-i1')));
    await tester.pumpAndSettle();
    expect(api.calls, ['refuse damaged', 'support i1']);
    expect(find.text('Transmis au support'), findsOneWidget);
    expect(find.byKey(const ValueKey('incident-support-i1')), findsNothing);
  });

  testWidgets('7-F évaluation de la livraison : après la clôture, une seule fois', (tester) async {
    final api = _FakeOrders()..current = _detail(status: 'delivered', mode: 'express', actions: const ['review_delivery'], tracking: const DeliveryTracking(status: 'closed', courierName: 'Koffi'));
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: api);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delivery-review')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('star-5')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('review-send')));
    await tester.pumpAndSettle();
    expect(api.calls, ['review delivery 5']);
    expect(find.byKey(const ValueKey('delivery-review')), findsNothing);
    expect(find.text('Ton évaluation de la livraison : ★★★★★'), findsOneWidget);
  });

  testWidgets('lot 8 : paiement en ligne proposé seulement s’il est ouvert ; page du prestataire ouverte ; vérification', (tester) async {
    // Fermé : rien n'est affiché (aucun moyen inactif).
    final closed = _FakeOrders()..current = _detail(status: 'delivered', actions: const ['declare_payment'], payment: const OrderPayment(method: 'mobile_money', amountFcfa: 40000, status: 'not_paid'));
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: closed);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('pay-online')), findsNothing);
    expect(find.textContaining('Moov'), findsNothing);

    final opened = <Uri>[];
    final api = _FakeOrders()
      ..current = _detail(status: 'delivered', actions: const ['declare_payment', 'pay_online'], online: const OnlinePayment(available: true, operators: ['orange', 'mtn', 'wave']));
    await _pump(tester, const OrderScreen(orderId: 'o1'), orders: api, opened: opened);
    await tester.pumpAndSettle();
    expect(find.text('Moyens acceptés : Orange Money, MTN Mobile Money, Wave. L’argent va directement à la boutique.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('pay-online')));
    await tester.pumpAndSettle();
    expect(opened.single.toString(), 'https://checkout.paystack.com/abc');
    expect(find.text('Paiement en ligne en attente de ta validation'), findsOneWidget);
    ScaffoldMessenger.of(tester.element(find.byKey(const ValueKey('online-check')))).clearSnackBars();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('online-check')));
    await tester.pumpAndSettle();
    expect(api.calls.where((c) => c.startsWith('online')), ['online start', 'online check']);
    expect(find.byKey(const ValueKey('online-status')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('online-status')), matching: find.text('Paiement vérifié par le prestataire')), findsOneWidget);
    expect(find.byKey(const ValueKey('pay-online')), findsNothing);
  });
}
