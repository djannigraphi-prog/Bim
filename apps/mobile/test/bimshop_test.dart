import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/bimshop/data/bimshop_api.dart';
import 'package:bim/features/bimshop/presentation/bimshop_view.dart';
import 'package:bim/features/bimshop/presentation/product_screen.dart';
import 'package:bim/features/bimshop/presentation/shop_profile_screen.dart';
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

const _shop = ShopRef(id: 's1', name: 'Maison Plumes', slug: 'maison-plumes', verified: true, city: 'Abidjan', commune: 'Cocody');

ShopCard _card(String id, String title, int price, {int? compare, bool available = true}) =>
    ShopCard(id: id, kind: 'product', title: title, priceFcfa: price, compareAtFcfa: compare, available: available, shop: _shop);

/// API simulée du BimShop (les règles sont testées côté API).
class _FakeBimShop extends BimShopApi {
  _FakeBimShop() : super(_client());

  final queries = <String>[];
  final calls = <String>[];

  @override
  Future<({List<ShopCard> items, String? nextCursor})> browse(BimShopQuery query, {String? cursor}) async {
    queries.add('${query.category}|${query.q}|${query.sort}');
    if (query.q == 'introuvable') return (items: <ShopCard>[], nextCursor: null);
    return (items: [_card('p1', 'Robe Plumes', 45000, compare: 60000), _card('p2', 'Sac Kalia', 15000, available: false)], nextCursor: null);
  }

  @override
  Future<List<Rubrique>> categories() async => const [
        Rubrique(code: 'vetements', label: 'Vêtements', products: 1, children: [Rubrique(code: 'vetements_soiree', label: 'Soirée', products: 1)]),
        Rubrique(code: 'services', label: 'Services', products: 0),
      ];

  @override
  Future<ShopProduct> product(String id) async => ShopProduct(
        id: 'p1',
        kind: 'product',
        title: 'Robe Plumes',
        description: 'Plumes cousues main.',
        priceFcfa: 45000,
        compareAtFcfa: 60000,
        categoryLabel: 'Soirée',
        available: true,
        photos: const [null],
        variants: const [(id: 'v1', label: 'S', available: true), (id: 'v2', label: 'M', available: false)],
        shop: _shop,
        moreFromShop: [_card('p2', 'Sac Kalia', 15000)],
      );

  @override
  Future<({bool favorite, bool followingShop})> productState(String id) async => (favorite: false, followingShop: false);

  @override
  Future<void> setFavorite(String id, bool on) async => calls.add('favorite $id $on');

  @override
  Future<PublicShop> shop(String slug) async => PublicShop(shop: _shop, description: 'Robes de soirée', followers: 1, productCount: 2, items: [_card('p1', 'Robe Plumes', 45000)]);

  @override
  Future<({bool following, bool own})> shopState(String slug) async => (following: false, own: false);

  @override
  Future<void> setFollow(String slug, bool on) async => calls.add('follow $slug $on');
}

class _SignedIn extends SessionController {
  @override
  SessionState build() => SessionSignedIn(Me.fromJson(const {'id': 'u1', 'fullName': 'Awa Koné', 'username': 'awa.kone', 'city': 'Cocody', 'contacts': <dynamic>[]}));
}

class _Visitor extends SessionController {
  @override
  SessionState build() => const SessionSignedOut(visitor: true);
}

Future<void> _pump(WidgetTester tester, _FakeBimShop api, String location, {bool signedIn = true}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: location, routes: [
    GoRoute(path: '/home', builder: (_, __) => const Scaffold(body: BimShopView())),
    GoRoute(path: '/bimshop/categories', builder: (_, __) => const RubriquesScreen()),
    GoRoute(path: '/bimshop/products/:id', builder: (_, s) => ShopProductScreen(productId: s.pathParameters['id']!)),
    GoRoute(path: '/bimshop/shops/:slug', builder: (_, s) => ShopProfileScreen(slug: s.pathParameters['slug']!)),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      bimShopApiProvider.overrideWithValue(api),
      sessionProvider.overrideWith(signedIn ? _SignedIn.new : _Visitor.new),
    ],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('écran 32 : grille, prix barré et remise, épuisé ; recherche, tri et rubrique relancent la liste', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/home');
    expect(find.text('Nouveautés'), findsOneWidget);
    expect(find.text('Robe Plumes'), findsOneWidget);
    expect(find.text('-25 %'), findsOneWidget);
    expect(find.text('Épuisé'), findsOneWidget);
    expect(api.queries, ['null||recent']);

    await tester.enterText(find.byKey(const ValueKey('bimshop-search')), 'introuvable');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(api.queries.last, 'null|introuvable|recent');
    expect(find.text('Aucun article ne correspond pour l’instant.'), findsOneWidget);

    await tester.tap(find.byTooltip('Effacer'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('bimshop-sort')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Prix croissant').last);
    await tester.pumpAndSettle();
    expect(api.queries.last, 'null||price_asc');

    // Écran 33 : une sous-rubrique filtre l'écran 32.
    await tester.tap(find.byKey(const ValueKey('rubriques')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vêtements').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Soirée'));
    await tester.pumpAndSettle();
    expect(api.queries.last, 'vetements_soiree||price_asc');
    expect(find.text('Vêtements · Soirée'), findsOneWidget);
  });

  testWidgets('écran 34 : taille épuisée non choisissable ; cœur ; « Commander » annonce la commande sans paiement', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/bimshop/products/p1');
    expect(find.text('Robe Plumes'), findsOneWidget);
    expect(find.text('Disponible'), findsOneWidget);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'M')).onSelected, isNull);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'S')).onSelected, isNotNull);
    await tester.tap(find.byKey(const ValueKey('favorite')));
    await tester.pump();
    expect(api.calls, ['favorite p1 true']);
    expect(find.byIcon(Icons.favorite), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('order')));
    await tester.pumpAndSettle();
    expect(find.text('Bientôt disponible'), findsOneWidget);
  });

  testWidgets('visiteur : le cœur invite à créer un compte, rien n’est envoyé', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/bimshop/products/p1', signedIn: false);
    await tester.tap(find.byKey(const ValueKey('favorite')));
    await tester.pumpAndSettle();
    expect(find.text('Rejoins BIM pour réagir'), findsOneWidget);
    expect(api.calls, isEmpty);
  });

  testWidgets('écran 54 : profil de boutique, « Suivre » met à jour les abonnés', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/bimshop/shops/maison-plumes');
    expect(find.text('Maison Plumes'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('shop-counts'))).data, '2 articles · 1 abonné');
    await tester.tap(find.byKey(const ValueKey('follow-shop')));
    await tester.pumpAndSettle();
    expect(api.calls, ['follow maison-plumes true']);
    expect(tester.widget<Text>(find.byKey(const ValueKey('shop-counts'))).data, '2 articles · 2 abonnés');
    expect(find.text('Abonné'), findsOneWidget);
  });
}
