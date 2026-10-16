import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/merchant/data/shop_api.dart';
import 'package:bim/features/merchant/presentation/merchant_space_screen.dart';
import 'package:bim/features/merchant/presentation/product_editor_screen.dart';
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

ProductDetail _detail({String status = 'draft', List<ProductPhoto> photos = const []}) => ProductDetail(
      id: 'x1',
      kind: 'product',
      title: 'Robe soirée à plumes',
      categoryCode: 'vetements_soiree',
      priceFcfa: 45000,
      status: status,
      photos: photos,
      variants: const [ProductVariant(id: 'v1', label: 'Unique', stock: 0)],
    );

/// API simulée de l'espace marchand (les règles sont testées côté API).
class _FakeShop extends ShopApi {
  _FakeShop({this.publishError}) : super(_client());

  final ApiException? publishError;
  final calls = <String>[];
  ProductDetail? current;

  @override
  Future<ShopDashboard> dashboard() async =>
      const ShopDashboard(id: 's1', name: 'Boutique Élégance', status: 'active', verified: true, city: 'Abidjan', commune: 'Cocody', published: 1, drafts: 0, followers: 0);

  @override
  Future<List<ProductSummary>> products({required String status}) async => status == 'published'
      ? const [ProductSummary(id: 'x1', kind: 'product', title: 'Robe soirée à plumes', priceFcfa: 45000, compareAtFcfa: 60000, status: 'published', stock: 3)]
      : const [];

  @override
  Future<List<ShopCategory>> categories() async => const [
        ShopCategory(code: 'vetements', label: 'Vêtements', children: [ShopCategory(code: 'vetements_soiree', label: 'Soirée')]),
        ShopCategory(code: 'services', label: 'Services'),
      ];

  @override
  Future<ProductDetail> product(String id) async => current!;

  @override
  Future<ProductDetail> create(ProductInput input) async {
    calls.add('create ${input.kind} ${input.title} ${input.categoryCode} ${input.priceFcfa}');
    return current = _detail();
  }

  @override
  Future<ProductDetail> publish(String id) async {
    calls.add('publish $id');
    if (publishError != null) throw publishError!;
    return current = _detail(status: 'published', photos: const [ProductPhoto(id: 'm1', url: null)]);
  }
}

Future<void> _pump(WidgetTester tester, _FakeShop api, String location) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: location, routes: [
    GoRoute(path: '/shop', builder: (_, __) => const MerchantSpaceScreen()),
    GoRoute(path: '/shop/products/new', builder: (_, __) => const ProductEditorScreen()),
    GoRoute(path: '/shop/products/:id', builder: (_, s) => ProductEditorScreen(productId: s.pathParameters['id'])),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), shopApiProvider.overrideWithValue(api)],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  test('prix en FCFA avec séparateur des milliers', () {
    expect(formatFcfa(45000), '45 000 FCFA');
    expect(formatFcfa(1500000), '1 500 000 FCFA');
    expect(formatFcfa(500), '500 FCFA');
  });

  testWidgets('écran 55 : boutique, compteurs réels, articles en ligne ; ventes et commandes annoncées sans chiffre inventé', (tester) async {
    await _pump(tester, _FakeShop(), '/shop');
    expect(find.text('Boutique Élégance'), findsOneWidget);
    expect(find.text('Espace marchand · Cocody, Abidjan'), findsOneWidget);
    expect(find.text('En ligne'), findsOneWidget); // compteur
    expect(find.text('Robe soirée à plumes'), findsOneWidget);
    expect(find.text('Stock : 3'), findsOneWidget);
    expect(find.text('Ventes du jour et commandes à traiter : bientôt, avec les commandes.'), findsOneWidget);
    await tester.tap(find.text('Live'));
    await tester.pumpAndSettle();
    expect(find.text('Bientôt disponible'), findsOneWidget);
  });

  testWidgets('le « + » ouvre un nouvel article ; brouillon enregistré avec rubrique et prix', (tester) async {
    final api = _FakeShop();
    await _pump(tester, api, '/shop');
    await tester.tap(find.byKey(const ValueKey('add-product')));
    await tester.pumpAndSettle();
    expect(find.text('Nouvel article'), findsOneWidget);
    FilledButton save() => tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('save-product')), matching: find.byType(FilledButton)));
    final list = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.byKey(const ValueKey('save-product')), 200, scrollable: list);
    expect(save().onPressed, isNull);
    await tester.drag(list, const Offset(0, 2000));
    await tester.pumpAndSettle();
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('product-title')), matching: find.byType(TextField)), 'Robe soirée à plumes');
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('product-price')), matching: find.byType(TextField)), '45000');
    await tester.tap(find.byKey(const ValueKey('product-category')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vêtements · Soirée').last);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byKey(const ValueKey('save-product')), 200, scrollable: find.byType(Scrollable).first);
    expect(save().onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('save-product')));
    await tester.pumpAndSettle();
    expect(api.calls, ['create product Robe soirée à plumes vetements_soiree 45000']);
    expect(find.text('Tailles, couleurs et stock'), findsOneWidget);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    expect(find.text('Brouillon'), findsOneWidget);
  });

  testWidgets('publication refusée sans photo : le motif s’affiche ; avec photo : « En ligne »', (tester) async {
    final refused = _FakeShop(
      publishError: const ApiException(code: 'VALIDATION_FAILED', message: 'Données invalides.', status: 400, details: {
        'fields': {
          'photos': ['Ajoute au moins une photo avant de publier.'],
        },
      },),
    );
    refused.current = _detail();
    await _pump(tester, refused, '/shop/products/x1');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('publish-product')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('publish-product')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('publish-error'))).data, 'Ajoute au moins une photo avant de publier.');

    final ok = _FakeShop()..current = _detail();
    await _pump(tester, ok, '/shop/products/x1');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('publish-product')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('publish-product')));
    await tester.pumpAndSettle();
    expect(ok.calls, ['publish x1']);
    expect(find.text('Retirer du BimShop (brouillon)'), findsOneWidget);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    expect(find.text('En ligne'), findsOneWidget);
  });
}
