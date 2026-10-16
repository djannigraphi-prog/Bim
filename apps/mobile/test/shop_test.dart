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

ProductDetail _detail({String status = 'draft', List<ProductPhoto> photos = const [], bool everPublished = false, int version = 1, int hearts = 0}) => ProductDetail(
      id: 'x1',
      reference: 'BIM-000123',
      everPublished: everPublished,
      contentVersion: version,
      activeFavorites: hearts,
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
  _FakeShop({this.publishError, this.dash}) : super(_client());

  final ApiException? publishError;
  final ShopDashboard? dash;
  final calls = <String>[];
  ProductDetail? current;

  @override
  Future<ShopDashboard> dashboard() async =>
      dash ?? const ShopDashboard(id: 's1', name: 'Boutique Élégance', status: 'active', verified: true, city: 'Abidjan', commune: 'Cocody', published: 1, drafts: 0, followers: 0);

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

  /// Comme le serveur (7-A) : un article déjà publié dont le contenu change exige une confirmation.
  @override
  Future<ProductDetail> update(String id, ProductInput input, {bool confirmReset = false}) async {
    final c = current;
    final changed = c != null && (input.title != c.title || input.priceFcfa != c.priceFcfa);
    if ((c?.everPublished ?? false) && changed && !confirmReset) {
      calls.add('refused $id');
      throw const ApiException(code: 'REPUTATION_RESET_REQUIRED', message: 'Confirme', status: 409, details: {'fields': ['title'], 'activeFavorites': 3});
    }
    calls.add('update $id ${input.title} ${input.priceFcfa}${confirmReset ? ' (remise à zéro)' : ''}');
    return current = ProductDetail(
      id: id,
      reference: c?.reference ?? 'BIM-000123',
      everPublished: c?.everPublished ?? false,
      contentVersion: (c?.contentVersion ?? 1) + (confirmReset ? 1 : 0),
      activeFavorites: confirmReset ? 0 : (c?.activeFavorites ?? 0),
      kind: 'product',
      title: input.title,
      categoryCode: input.categoryCode,
      priceFcfa: input.priceFcfa,
      status: c?.status ?? 'draft',
      photos: c?.photos ?? const [],
      variants: c?.variants ?? const [],
    );
  }

  @override
  Future<ProductDetail> hide(String id) async {
    calls.add('hide $id');
    return current = _detail(status: 'hidden', everPublished: true, hearts: current?.activeFavorites ?? 0, photos: const [ProductPhoto(id: 'm1', url: null)]);
  }

  @override
  Future<ProductDetail> show(String id) async {
    calls.add('show $id');
    return current = _detail(status: 'published', everPublished: true, hearts: current?.activeFavorites ?? 0, photos: const [ProductPhoto(id: 'm1', url: null)]);
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
    // 7-A : un article publié se masque (« Visible par moi uniquement ») au lieu de repasser en brouillon.
    expect(find.text('Visible publiquement'), findsOneWidget);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    expect(find.text('En ligne'), findsOneWidget);
  });

  testWidgets('audit M-8 : publier enregistre d’abord les changements du formulaire', (tester) async {
    final api = _FakeShop()..current = _detail();
    await _pump(tester, api, '/shop/products/x1');
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('product-price')), matching: find.byType(TextField)), '39000');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('publish-product')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('publish-product')));
    await tester.pumpAndSettle();
    expect(api.calls, ['update x1 Robe soirée à plumes 39000', 'publish x1']);
  });

  testWidgets('audit M-9 : article introuvable : message et « Réessayer », jamais un formulaire de création', (tester) async {
    final api = _MissingShop();
    await _pump(tester, api, '/shop/products/x9');
    expect(find.byKey(const ValueKey('product-load-error')), findsOneWidget);
    expect(find.text('Nouvel article'), findsNothing);
    expect(api.calls, isEmpty);
  });

  testWidgets('7-A : article publié — avertissement avant de modifier ; annuler garde la fiche ; confirmer remet à zéro', (tester) async {
    final api = _FakeShop()..current = _detail(status: 'published', everPublished: true, hearts: 3, photos: const [ProductPhoto(id: 'm1', url: null)]);
    await _pump(tester, api, '/shop/products/x1');
    expect(tester.widget<Text>(find.byKey(const ValueKey('product-reference'))).data, 'Réf. BIM-000123');
    final title = find.descendant(of: find.byKey(const ValueKey('product-title')), matching: find.byType(TextField));
    await tester.enterText(title, 'Chaussures cuir');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('save-product')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('save-product')));
    await tester.pumpAndSettle();
    expect(find.text('Remettre la réputation à zéro ?'), findsOneWidget);
    expect(find.textContaining('3 personnes l’ont mis de côté'), findsOneWidget);

    // Annuler : rien n'est enregistré, le formulaire revient à la fiche.
    await tester.tap(find.byKey(const ValueKey('reset-cancel')));
    await tester.pumpAndSettle();
    expect(api.calls, ['refused x1']);
    expect(api.current!.title, 'Robe soirée à plumes');
    expect(tester.widget<TextField>(title).controller!.text, 'Robe soirée à plumes');

    // Confirmer : enregistrement avec remise à zéro.
    await tester.enterText(title, 'Chaussures cuir');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('save-product')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('save-product')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reset-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, ['refused x1', 'refused x1', 'update x1 Chaussures cuir 45000 (remise à zéro)']);
    expect(api.current!.activeFavorites, 0);
  });

  testWidgets('7-A : masquer puis republier sans avertissement ni remise à zéro', (tester) async {
    final api = _FakeShop()..current = _detail(status: 'published', everPublished: true, hearts: 2, photos: const [ProductPhoto(id: 'm1', url: null)]);
    await _pump(tester, api, '/shop/products/x1');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('product-visibility')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('product-visibility')));
    await tester.pumpAndSettle();
    expect(find.text('Visible par moi uniquement'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('product-visibility')));
    await tester.pumpAndSettle();
    expect(api.calls, ['hide x1', 'show x1']);
    expect(find.text('Remettre la réputation à zéro ?'), findsNothing);
    expect(api.current!.activeFavorites, 2);
  });

  testWidgets('7-A : employé sans permission — ni « + », ni Messages, ni Demandes, ni Équipe', (tester) async {
    final api = _FakeShop(
      dash: const ShopDashboard(id: 's1', name: 'Boutique Élégance', status: 'active', verified: true, published: 1, drafts: 0, followers: 0, role: 'staff'),
    );
    await _pump(tester, api, '/shop');
    expect(find.byKey(const ValueKey('add-product')), findsNothing);
    expect(find.byKey(const ValueKey('shop-messages')), findsNothing);
    expect(find.byKey(const ValueKey('action-article')), findsNothing);
    expect(find.byKey(const ValueKey('action-requests')), findsNothing);
    expect(find.byKey(const ValueKey('action-team')), findsNothing);
    // Le propriétaire voit tout.
    await _pump(tester, _FakeShop(), '/shop');
    expect(find.byKey(const ValueKey('add-product')), findsOneWidget);
    expect(find.byKey(const ValueKey('action-team')), findsOneWidget);
  });
}

class _MissingShop extends _FakeShop {
  @override
  Future<ProductDetail> product(String id) async => throw const ApiException(code: 'NOT_FOUND', message: 'Article introuvable.', status: 404);
}