import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/merchant/data/shop_api.dart';
import 'package:bim/features/merchant/presentation/merchant_space_screen.dart';
import 'package:bim/features/merchant/presentation/product_editor_screen.dart';
import 'package:bim/features/orders/data/orders_api.dart';
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

  /// Comme le serveur (L7-04) : seules la promotion (et la rubrique, la durée avant publication) changent ;
  /// référence, version du contenu et réputation sont conservées.
  @override
  Future<ProductDetail> update(String id, ProductChanges changes) async {
    final c = current!;
    final body = changes.toJson();
    calls.add('update $id ${body.entries.map((e) => '${e.key}=${e.value}').join(' ')}');
    final promo = changes.promoPriceFcfa;
    return current = ProductDetail(
      id: id,
      reference: c.reference,
      everPublished: c.everPublished,
      contentVersion: c.contentVersion,
      activeFavorites: c.activeFavorites,
      kind: c.kind,
      title: c.title,
      categoryCode: (body['categoryCode'] as String?) ?? c.categoryCode,
      priceFcfa: promo ?? c.normalPrice,
      normalPriceFcfa: c.normalPrice,
      promoPriceFcfa: promo,
      compareAtFcfa: promo != null ? c.normalPrice : null,
      status: c.status,
      photos: c.photos,
      variants: c.variants,
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

Future<void> _pump(WidgetTester tester, _FakeShop api, String location, {double height = 2532}) async {
  tester.view.physicalSize = Size(1170, height);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: location, routes: [
    GoRoute(path: '/shop', builder: (_, __) => const MerchantSpaceScreen()),
    GoRoute(path: '/shop/products/new', builder: (_, __) => const ProductEditorScreen()),
    GoRoute(path: '/shop/products/:id', builder: (_, s) => ProductEditorScreen(productId: s.pathParameters['id'])),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), shopApiProvider.overrideWithValue(api), shopOrdersApiProvider.overrideWithValue(_FakeShopOrders())],
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

  testWidgets('écran 55 : boutique, compteurs réels, articles en ligne, commandes à traiter', (tester) async {
    await _pump(tester, _FakeShop(), '/shop');
    expect(find.text('Boutique Élégance'), findsOneWidget);
    expect(find.text('Espace marchand · Cocody, Abidjan'), findsOneWidget);
    expect(find.text('En ligne'), findsOneWidget); // compteur
    expect(find.text('Robe soirée à plumes'), findsOneWidget);
    expect(find.text('Stock : 3'), findsOneWidget);
    // 7-B : commandes à traiter, compteurs réels.
    expect(find.text('2 à confirmer · 1 à préparer · 1 paiement à confirmer'), findsOneWidget);
    // Lot 10 (prototype) : « Live » ouvre le lancement d'un Live vente (mode démo) ; « Promo » reste à venir.
    await tester.tap(find.text('Promo'));
    await tester.pumpAndSettle();
    expect(find.text('Bientôt disponible'), findsOneWidget);
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Live'));
    await tester.pumpAndSettle();
    expect(find.text('Live vente'), findsOneWidget);
    expect(find.byKey(const ValueKey('live-submit')), findsOneWidget);
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
    // Fiche créée : un encart « nouvelle fiche » apparaît au-dessus ; la section des variantes est plus bas.
    await tester.scrollUntilVisible(find.text('Tailles, couleurs et stock'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Tailles, couleurs et stock'), findsOneWidget);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    expect(find.text('Brouillon'), findsOneWidget);
    expect(find.byKey(const ValueKey('identity-locked')), findsOneWidget);
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

  testWidgets('audit M-8 : publier enregistre d’abord les changements du formulaire (promotion)', (tester) async {
    final api = _FakeShop()..current = _detail();
    await _pump(tester, api, '/shop/products/x1');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('product-promo')), 200, scrollable: find.byType(Scrollable).first);
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('product-promo')), matching: find.byType(TextField)), '39000');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('publish-product')), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('publish-product')));
    await tester.pumpAndSettle();
    expect(api.calls, ['update x1 promoPriceFcfa=39000 categoryCode=vetements_soiree', 'publish x1']);
  });

  testWidgets('audit M-9 : article introuvable : message et « Réessayer », jamais un formulaire de création', (tester) async {
    final api = _MissingShop();
    await _pump(tester, api, '/shop/products/x9');
    expect(find.byKey(const ValueKey('product-load-error')), findsOneWidget);
    expect(find.text('Nouvel article'), findsNothing);
    expect(api.calls, isEmpty);
  });

  testWidgets('L7-04 : nom, description et prix normal en lecture seule ; promotion modifiée, réputation conservée', (tester) async {
    final api = _FakeShop()..current = _detail(status: 'published', everPublished: true, hearts: 3, photos: const [ProductPhoto(id: 'm1', url: null)]);
    // Écran haut : tout le formulaire est construit d'un coup.
    await _pump(tester, api, '/shop/products/x1', height: 7200);
    expect(tester.widget<Text>(find.byKey(const ValueKey('product-reference'))).data, 'Réf. BIM-000123');
    // Une nouvelle fiche est proposée pour changer le nom, la description ou le prix normal.
    expect(find.byKey(const ValueKey('identity-locked')), findsOneWidget);
    expect(find.byKey(const ValueKey('new-sheet')), findsOneWidget);
    TextField field(String key) => tester.widget<TextField>(find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(TextField)));
    for (final k in ['product-title', 'product-price', 'product-description']) {
      expect(field(k).readOnly, isTrue, reason: k);
    }
    expect(field('product-promo').readOnly, isFalse);
    // Rubrique et variantes figées depuis la publication ; le stock reste modifiable.
    expect(tester.widget<DropdownButtonFormField<String>>(find.byKey(const ValueKey('product-category'))).onChanged, isNull);
    expect(find.byKey(const ValueKey('variants-frozen')), findsOneWidget);
    expect(find.text('Mettre à jour les variantes'), findsNothing);

    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('product-promo')), matching: find.byType(TextField)), '39000');
    await tester.tap(find.byKey(const ValueKey('save-product')));
    await tester.pumpAndSettle();
    // Seule la promotion part ; ni le nom ni le prix normal, ni la rubrique d'une fiche publiée.
    expect(api.calls, ['update x1 promoPriceFcfa=39000']);
    expect(api.current!.activeFavorites, 3);
    expect(api.current!.contentVersion, 1);
    expect(api.current!.normalPrice, 45000);
    expect(api.current!.priceFcfa, 39000);
    expect(find.text('Remettre la réputation à zéro ?'), findsNothing);
  });

  testWidgets('L7-04 : refus du serveur (PRODUCT_CONTENT_LOCKED) affiché, rien n’est modifié', (tester) async {
    final api = _LockedShop()..current = _detail();
    await _pump(tester, api, '/shop/products/x1');
    // V1 : la zone vidéo allonge la fiche ; le champ de promotion est amené à l'écran avant la saisie.
    await tester.scrollUntilVisible(find.byKey(const ValueKey('product-promo')), 200, scrollable: find.byType(Scrollable).first);
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('product-promo')), matching: find.byType(TextField)), '40000');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('save-product')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const ValueKey('save-product')));
    await tester.pumpAndSettle();
    expect(find.text('Ce champ ne se modifie plus : crée une nouvelle fiche.'), findsOneWidget);
    expect(api.current!.title, 'Robe soirée à plumes');
  });

  testWidgets('7-A : masquer puis republier sans avertissement ni remise à zéro', (tester) async {
    final api = _FakeShop()..current = _detail(status: 'published', everPublished: true, hearts: 2, photos: const [ProductPhoto(id: 'm1', url: null)]);
    await _pump(tester, api, '/shop/products/x1');
    await tester.scrollUntilVisible(find.byKey(const ValueKey('product-visibility')), 300, scrollable: find.byType(Scrollable).first);
    // V1 : la fiche est plus longue (vidéo) ; l'interrupteur est amené entièrement à l'écran.
    await tester.ensureVisible(find.byKey(const ValueKey('product-visibility')));
    await tester.pumpAndSettle();
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
    expect(find.byKey(const ValueKey('shop-orders')), findsNothing);
    expect(find.text('Live'), findsNothing); // Live vente : propriétaire seulement (lot 10)
    // Le propriétaire voit tout.
    await _pump(tester, _FakeShop(), '/shop');
    expect(find.byKey(const ValueKey('add-product')), findsOneWidget);
    expect(find.byKey(const ValueKey('action-team')), findsOneWidget);
  });
}

/// Compteurs de commandes simulés (7-B).
class _FakeShopOrders extends ShopOrdersApi {
  _FakeShopOrders() : super(_client());
  @override
  Future<({int toConfirm, int toPrepare, int ready, int payments})> counts() async => (toConfirm: 2, toPrepare: 1, ready: 0, payments: 1);
}

class _LockedShop extends _FakeShop {
  @override
  Future<ProductDetail> update(String id, ProductChanges changes) async => throw const ApiException(
        code: 'PRODUCT_CONTENT_LOCKED',
        message: 'Ce champ ne se modifie plus : crée une nouvelle fiche.',
        status: 409,
        details: {'fields': ['title']},
      );
}

class _MissingShop extends _FakeShop {
  @override
  Future<ProductDetail> product(String id) async => throw const ApiException(code: 'NOT_FOUND', message: 'Article introuvable.', status: 404);
}