import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
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

OrderDetail _detail({String status = 'pending_shop', List<String> actions = const ['cancel'], String? code, String? mode = 'pickup', String? customer}) => OrderDetail(
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
    );

/// API simulée (les règles — montant, stock, code, permissions — sont testées côté serveur).
class _FakeOrders extends OrdersApi {
  _FakeOrders() : super(_client());
  final calls = <String>[];
  OrderDetail current = _detail();

  @override
  Future<List<Commune>> communes() async => const [Commune(code: 'abidjan-yopougon', city: 'Abidjan', name: 'Yopougon')];

  @override
  Future<List<ModeQuote>> quote(String shopId, String communeCode) async {
    calls.add('quote $communeCode');
    return const [ModeQuote(mode: 'express', available: true, feeFcfa: 1700, minutes: 30), ModeQuote(mode: 'economy', available: false, reason: 'NO_TARIFF')];
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
  Future<OrderDetail> act(String id, String action, {String? reason, String? code}) async {
    calls.add('$action ${code ?? reason ?? ''}'.trim());
    if (action == 'handover' && code != '4821') {
      throw const ApiException(code: 'HANDOVER_CODE_INVALID', message: 'Code incorrect.', status: 400, details: {'remaining': 4});
    }
    return current = _detail(status: 'delivered', actions: const [], customer: 'Awa Koné');
  }
}

Future<void> _pump(WidgetTester tester, Widget home, {_FakeOrders? orders, _FakeShopOrders? shop}) async {
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
    expect(_total(tester), '20 000 FCFA');
    await tester.tap(find.byKey(const ValueKey('qty-plus-0')));
    await tester.pumpAndSettle();
    expect(_total(tester), '40 000 FCFA');
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
    expect(find.text('Frais : 1 700 FCFA · trajet estimé 30 min'), findsOneWidget);
    expect(_total(tester), '21 700 FCFA');
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
}
