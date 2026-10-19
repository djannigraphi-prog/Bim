import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/core/theme/tokens.dart';
import 'package:bim/features/auth/application/session_controller.dart';
import 'package:bim/features/auth/data/models.dart';
import 'package:bim/features/bimshop/data/bimshop_api.dart';
import 'package:bim/features/bimshop/presentation/bimshop_view.dart';
import 'package:bim/features/bimshop/presentation/bimshop_widgets.dart';
import 'package:bim/features/bimshop/presentation/product_screen.dart';
import 'package:bim/features/bimshop/presentation/share_sheet.dart';
import 'package:bim/features/orders/data/orders_api.dart';
import 'package:bim/features/orders/presentation/checkout_screen.dart';
import 'package:bim/features/bimshop/presentation/shop_profile_screen.dart';
import 'package:bim/features/messaging/data/messaging_api.dart';
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

ShopCard _card(String id, String title, int price, {int? compare, bool available = true, int? w, int? h, ShopCounts counts = const ShopCounts()}) =>
    ShopCard(id: id, kind: 'product', title: title, priceFcfa: price, compareAtFcfa: compare, available: available, shop: _shop, imageWidth: w, imageHeight: h, counts: counts);

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
        shop: const ShopRef(id: 's1', name: 'Maison Plumes', slug: 'maison-plumes', verified: true, city: 'Abidjan', commune: 'Cocody', rating: ShopRating(average: 4.6, reviews: 32)),
        moreFromShop: [_card('p2', 'Sac Kalia', 15000)],
        counts: const ShopCounts(recommendations: 218, likes: 1600, reviews: 18),
      );

  @override
  Future<({bool favorite, bool followingShop, bool recommended})> productState(String id) async => (favorite: false, followingShop: false, recommended: false);

  @override
  Future<void> setFavorite(String id, bool on) async => calls.add('favorite $id $on');

  @override
  Future<List<ShopCard>> favorites() async => const [];

  @override
  Future<ShopCounts> setRecommendation(String id, bool on) async {
    calls.add('recommend $id $on');
    return ShopCounts(recommendations: on ? 219 : 218, likes: 1600, reviews: 18);
  }

  @override
  Future<PublicShop> shop(String slug, {String? cursor}) async => cursor == null
      ? PublicShop(shop: const ShopRef(id: 's1', name: 'Maison Plumes', slug: 'maison-plumes', verified: true, city: 'Abidjan', commune: 'Cocody', rating: ShopRating(average: null, reviews: 1)), description: 'Robes de soirée', followers: 1, productCount: 2, items: [_card('p1', 'Robe Plumes', 45000)], nextCursor: 'c2')
      : PublicShop(shop: _shop, followers: 1, productCount: 2, items: [_card('p9', 'Robe Lumière', 52000)]);

  @override
  Future<({bool following, bool own})> shopState(String slug) async => (following: false, own: false);

  @override
  Future<void> setFollow(String slug, bool on) async => calls.add('follow $slug $on');
}

/// V1-1910-C : boutique dont le propriétaire est Premium.
class _CertifiedShop extends _FakeBimShop {
  static const _ref = ShopRef(id: 's1', name: 'Maison Plumes', slug: 'maison-plumes', verified: true, certified: true, city: 'Abidjan', commune: 'Cocody', rating: ShopRating(average: 4.6, reviews: 32));

  @override
  Future<ShopProduct> product(String id) async {
    final p = await super.product(id);
    return ShopProduct(
      id: p.id,
      kind: p.kind,
      title: p.title,
      description: p.description,
      priceFcfa: p.priceFcfa,
      compareAtFcfa: p.compareAtFcfa,
      categoryLabel: p.categoryLabel,
      available: p.available,
      photos: p.photos,
      variants: p.variants,
      shop: _ref,
      moreFromShop: p.moreFromShop,
      counts: p.counts,
    );
  }

  @override
  Future<PublicShop> shop(String slug, {String? cursor}) async => PublicShop(shop: _ref, followers: 1, productCount: 1, items: [_card('p1', 'Robe Plumes', 45000)]);
}

/// Textes envoyés à la feuille de partage du téléphone (simulée).
final _shared = <String>[];

/// Mosaïque : un portrait 2:3, un carré, un paysage reçu (affiché en carré), un article sans réaction.
class _MosaicShop extends _FakeBimShop {
  @override
  Future<({List<ShopCard> items, String? nextCursor})> browse(BimShopQuery query, {String? cursor}) async => (
        items: [
          _card('m1', 'Ensemble wax créatif', 32000, compare: 40000, w: 800, h: 1200, counts: const ShopCounts(recommendations: 2400, likes: 986, reviews: 12)),
          _card('m2', 'Soin éclat visage', 15000, w: 1000, h: 1000),
          _card('m3', 'Sac paysage', 9000, w: 1200, h: 800),
          _card('m4', 'Robe à plumes', 45000, w: 900, h: 1200),
        ],
        nextCursor: null,
      );
}

/// Messagerie simulée : « Discuter » ouvre la conversation avec la boutique (6-B).
class _FakeMessaging extends MessagingApi {
  _FakeMessaging() : super(_client());

  final started = <String>[];

  @override
  Future<ConversationSummary> startWithShop(String shopSlug, {String? productId, String? offerId}) async {
    started.add('$shopSlug|$productId|$offerId');
    return const ConversationSummary(id: 'c9', kind: 'shop', status: 'active', pendingForOther: false, unread: 0, shop: ChatShop(id: 's1', name: 'Maison Plumes', slug: 'maison-plumes'));
  }
}

/// 7-H : avis publics d'un article (notes individuelles, aucune moyenne).
class _FakeOrders extends OrdersApi {
  _FakeOrders() : super(_client());
  @override
  Future<List<PublicReview>> productReviews(String productId) async => [PublicReview(rating: 4, comment: 'Belle robe', authorName: 'Koffi Yao', createdAt: DateTime.utc(2026, 10, 16))];
}

class _SignedIn extends SessionController {
  @override
  SessionState build() => SessionSignedIn(Me.fromJson(const {'id': 'u1', 'fullName': 'Awa Koné', 'username': 'awa.kone', 'city': 'Cocody', 'contacts': <dynamic>[]}));
}

class _Visitor extends SessionController {
  @override
  SessionState build() => const SessionSignedOut(visitor: true);
}

Future<void> _pump(WidgetTester tester, _FakeBimShop api, String location, {bool signedIn = true, _FakeMessaging? messaging}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: location, routes: [
    GoRoute(path: '/home', builder: (_, __) => const Scaffold(body: BimShopView())),
    GoRoute(path: '/bimshop/categories', builder: (_, __) => const RubriquesScreen()),
    GoRoute(path: '/bimshop/products/:id', builder: (_, s) => ShopProductScreen(productId: s.pathParameters['id']!)),
    GoRoute(path: '/bimshop/shops/:slug', builder: (_, s) => ShopProfileScreen(slug: s.pathParameters['slug']!)),
    GoRoute(path: '/messages/:id', builder: (_, s) => Scaffold(body: Text('conversation ${s.pathParameters['id']}'))),
    GoRoute(
      path: '/orders/checkout',
      builder: (_, s) {
        final a = s.extra! as CheckoutArgs;
        final l = a.lines.single;
        return Scaffold(body: Text('checkout ${a.shopId} ${l.line.productId} ${l.line.variantId} ${l.line.quantity} ${l.unitPriceFcfa}'));
      },
    ),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      bimShopApiProvider.overrideWithValue(api),
      messagingApiProvider.overrideWithValue(messaging ?? _FakeMessaging()),
      ordersApiProvider.overrideWithValue(_FakeOrders()),
      sessionProvider.overrideWith(signedIn ? _SignedIn.new : _Visitor.new),
      systemShareProvider.overrideWithValue((text) async => _shared.add(text)),
    ],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('écran 32 (maquette) : en-tête BimShop, prix barré, épuisé ; recherche, tri et rubrique relancent la liste', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/home');
    expect(find.text('BimShop'), findsOneWidget);
    expect(find.text('Pour toi'), findsOneWidget);
    expect(find.byKey(const ValueKey('shop-mosaic')), findsOneWidget);
    // V1 (19/10/2026) : rien sous les photos de la mosaïque (nom et prix dans la fiche) ; le lecteur d'écran les lit.
    final semantics = tester.ensureSemantics();
    expect(find.text('Robe Plumes'), findsNothing);
    expect(find.text(formatPriceF(60000)), findsNothing);
    expect(find.bySemanticsLabel(RegExp('Robe Plumes')), findsOneWidget);
    semantics.dispose();
    expect(find.text('Épuisé'), findsOneWidget);
    expect(find.textContaining('★'), findsNothing); // jamais d'étoiles sur les cartes (A17)
    expect(api.queries, ['null||recent']);

    await tester.enterText(find.byKey(const ValueKey('bimshop-search')), 'introuvable');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(api.queries.last, 'null|introuvable|recent');
    expect(find.text('Aucun article ne correspond pour l’instant.'), findsOneWidget);

    await tester.tap(find.byTooltip('Effacer'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('bimshop-filter')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('sort-price_asc')));
    await tester.pumpAndSettle();
    expect(api.queries.last, 'null||price_asc');

    // Pastille de rubrique, puis écran 33 : une sous-rubrique filtre l'écran 32.
    await tester.tap(find.byKey(const ValueKey('rubrique-pill-vetements')));
    await tester.pumpAndSettle();
    expect(api.queries.last, 'vetements||price_asc');
    await tester.tap(find.byKey(const ValueKey('bimshop-filter')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rubriques')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vêtements').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Soirée'));
    await tester.pumpAndSettle();
    expect(api.queries.last, 'vetements_soiree||price_asc');
    expect(find.text('Vêtements · Soirée'), findsOneWidget);
  });

  testWidgets('V1 mosaïque façon Pinterest : grandes photos carrées ou portrait, compteurs, cœur et panier', (tester) async {
    final api = _MosaicShop();
    await _pump(tester, api, '/home');
    // Portrait (2:3) plus haut que le carré, à largeur égale ; un paysage reçu est affiché en carré.
    Size media(String id) => tester.getSize(find.descendant(of: find.byKey(ValueKey('shop-card-$id')), matching: find.byType(AspectRatio)).first);
    final portrait = media('m1');
    final square = media('m2');
    final wide = media('m3');
    expect(portrait.width, closeTo(square.width, 0.5));
    expect(portrait.width, greaterThan(170)); // deux colonnes, marges fines : grandes photos
    expect(portrait.height, closeTo(portrait.width * 1.5, 1));
    expect(square.height, closeTo(square.width, 1));
    expect(wide.height, closeTo(wide.width, 1));
    // Deux colonnes décalées : la carte suivante va sous la plus courte.
    expect(tester.getTopLeft(find.byKey(const ValueKey('shop-card-m3'))).dx, closeTo(tester.getTopLeft(find.byKey(const ValueKey('shop-card-m2'))).dx, 0.5));
    // Sur la photo : seulement les cœurs et les avis (les recommandations restent dans la fiche) ; rien sans réaction.
    expect(find.text('2,4 k'), findsNothing);
    expect(find.text('986'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
    expect(find.byKey(const ValueKey('count-likes')), findsNWidgets(1));
    // Cœur : mis de côté, compteur de j'aime mis à jour.
    await tester.tap(find.byKey(const ValueKey('shop-card-favorite-m1')));
    await tester.pumpAndSettle();
    expect(api.calls, ['favorite m1 true']);
    expect(find.text('987'), findsOneWidget);
    // Petite icône « Partager » (à la place du panier) : dans BIM ou vers une autre application.
    expect(find.byKey(const ValueKey('shop-card-bag-m2')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('shop-card-share-m2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('share-in-bim')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('share-system')));
    await tester.pumpAndSettle();
    expect(_shared.single, startsWith('Soin éclat visage · ${formatPriceF(15000)}'));
    // Toucher la photo ouvre la fiche : toutes les infos et « Commander ».
    await tester.tap(find.byKey(const ValueKey('shop-card-m2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('order')), findsOneWidget);
  });

  testWidgets('V1 écran 34 : recommandations, j’aime, avis ; recommander met à jour le compteur', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/bimshop/products/p1');
    expect(find.text('218 recommandations'), findsOneWidget);
    // Étoiles de la boutique (pas de l'article) à côté de son nom.
    expect(find.text('4,6 (32 avis)'), findsOneWidget);
    expect(find.byKey(const ValueKey('shop-stars')), findsOneWidget);
    // V1-1910-C : boutique non Premium → étoiles grises, pas de badge.
    final star = tester.widget<Icon>(find.descendant(of: find.byKey(const ValueKey('shop-stars')), matching: find.byIcon(Icons.star_rounded)).first);
    expect(star.color, BimColors.grey600);
    expect(find.byKey(const ValueKey('certified-badge')), findsNothing);
    expect(find.text('18 avis'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('product-recommend')));
    await tester.pumpAndSettle();
    expect(api.calls, ['recommend p1 true']);
    expect(find.text('219 recommandations'), findsOneWidget);
    expect(find.text('1,6 k'), findsOneWidget);
    expect(find.byIcon(Icons.thumb_up), findsOneWidget);
  });

  testWidgets('V1-1910-C : boutique Premium → badge de certification, sans étoiles (fiche et profil)', (tester) async {
    final api = _CertifiedShop();
    await _pump(tester, api, '/bimshop/products/p1');
    expect(find.byKey(const ValueKey('certified-badge')), findsOneWidget);
    expect(find.byKey(const ValueKey('shop-stars')), findsNothing);
  });

  testWidgets('V1-1910-C : profil d’une boutique Premium → badge, sans étoiles ni « Nouvelle boutique »', (tester) async {
    await _pump(tester, _CertifiedShop(), '/bimshop/shops/maison-plumes');
    expect(find.byKey(const ValueKey('certified-badge')), findsWidgets);
    expect(find.byKey(const ValueKey('shop-stars')), findsNothing);
    expect(find.text('Nouvelle boutique'), findsNothing);
  });

  testWidgets('écran 34 : taille épuisée non choisissable ; cœur ; « Commander » demande la taille puis ouvre le récapitulatif', (tester) async {
    final api = _FakeBimShop();
    await _pump(tester, api, '/bimshop/products/p1');
    expect(find.text('Robe Plumes'), findsOneWidget);
    expect(find.text('Disponible'), findsOneWidget);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'M')).onSelected, isNull);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'S')).onSelected, isNotNull);
    await tester.tap(find.byKey(const ValueKey('favorite')));
    await tester.pump();
    expect(api.calls, ['favorite p1 true']);
    expect(find.descendant(of: find.byKey(const ValueKey('favorite')), matching: find.byIcon(Icons.favorite)), findsOneWidget);
    // 7-B : sans taille choisie, rien ne part ; avec la taille S, le récapitulatif s'ouvre (aucun paiement ici).
    await tester.tap(find.byKey(const ValueKey('order')));
    await tester.pump();
    expect(find.text('Choisis d’abord la taille ou le modèle.'), findsOneWidget);
    // Les messages temporaires (« Mis de côté », puis celui-ci) couvrent le bas de l'écran : on les retire avant de
    // toucher de nouveau « Commander ».
    ScaffoldMessenger.of(tester.element(find.byKey(const ValueKey('order')))).clearSnackBars();
    await tester.pumpAndSettle();
    // La fiche est plus haute (photo en portrait, compteurs) : la taille est amenée à l'écran avant d'être touchée.
    await tester.ensureVisible(find.widgetWithText(ChoiceChip, 'S'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ChoiceChip, 'S'));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('order')));
    await tester.pumpAndSettle();
    expect(find.textContaining('checkout '), findsOneWidget);
    expect(find.textContaining(' p1 v1 1 '), findsOneWidget);
  });

  testWidgets('7-H écran 34 : avis des clients, notes individuelles, sans moyenne', (tester) async {
    await _pump(tester, _FakeBimShop(), '/bimshop/products/p1');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('product-reviews')), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Avis des clients (1)'), findsOneWidget);
    expect(find.text('★★★★☆  Koffi Yao'), findsOneWidget);
    expect(find.textContaining('moyenne'), findsNothing);
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
    expect(find.text('Nouvelle boutique'), findsOneWidget); // moins de 3 avis : pas encore d'étoiles
    await tester.tap(find.byKey(const ValueKey('follow-shop')));
    await tester.pumpAndSettle();
    expect(api.calls, ['follow maison-plumes true']);
    expect(tester.widget<Text>(find.byKey(const ValueKey('shop-counts'))).data, '2 articles · 2 abonnés');
    expect(find.text('Abonné'), findsOneWidget);
    // « Voir plus » : page suivante des articles, puis plus de bouton (audit du 18/10).
    await tester.scrollUntilVisible(find.byKey(const ValueKey('shop-more')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('shop-more')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('shop-card-p9')), findsOneWidget);
    expect(find.byKey(const ValueKey('shop-more')), findsNothing);
  });

  testWidgets('6-B : « Discuter » sur la fiche article et « Écrire » sur le profil ouvrent la conversation avec la boutique', (tester) async {
    final api = _FakeBimShop();
    final messaging = _FakeMessaging();
    await _pump(tester, api, '/bimshop/products/p1', messaging: messaging);
    // Maquette 34 : « Contacter » est dans la carte de la boutique, plus bas sur la fiche.
    await tester.ensureVisible(find.byKey(const ValueKey('product-chat')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('product-chat')));
    await tester.pumpAndSettle();
    expect(messaging.started, ['maison-plumes|p1|null']);
    expect(find.text('conversation c9'), findsOneWidget);
  });

  testWidgets('6-B : profil de boutique, « Écrire » ouvre la conversation', (tester) async {
    final messaging = _FakeMessaging();
    await _pump(tester, _FakeBimShop(), '/bimshop/shops/maison-plumes', messaging: messaging);
    await tester.tap(find.byKey(const ValueKey('shop-chat')));
    await tester.pumpAndSettle();
    expect(messaging.started, ['maison-plumes|null|null']);
    expect(find.text('conversation c9'), findsOneWidget);
  });

  testWidgets('6-B : visiteur, « Discuter » invite à créer un compte sans rien envoyer', (tester) async {
    final messaging = _FakeMessaging();
    await _pump(tester, _FakeBimShop(), '/bimshop/products/p1', signedIn: false, messaging: messaging);
    // Maquette 34 : « Contacter » est dans la carte de la boutique, plus bas sur la fiche.
    await tester.ensureVisible(find.byKey(const ValueKey('product-chat')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('product-chat')));
    await tester.pumpAndSettle();
    expect(find.text('Rejoins BIM pour réagir'), findsOneWidget);
    expect(messaging.started, isEmpty);
  });
}
