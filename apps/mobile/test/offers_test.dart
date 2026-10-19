import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/bimshop/data/bimshop_api.dart';
import 'package:bim/features/merchant/data/shop_api.dart';
import 'package:bim/features/offers/data/offers_api.dart';
import 'package:bim/features/offers/presentation/project_offers_screen.dart';
import 'package:bim/features/offers/presentation/shop_requests_screen.dart';
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

const _kalia = ShopRef(id: 's1', name: 'Kalia Sport', slug: 'kalia-sport', verified: true, city: 'Abidjan');

/// API simulée des offres (les règles — anonymat, mineurs, limites — sont testées côté API).
class _FakeOffers extends OffersApi {
  _FakeOffers() : super(_client());

  final calls = <String>[];
  bool receive = true;
  bool declined = false;

  @override
  Future<({bool receiveOffers, List<ProjectOffer> items})> projectOffers(String projectId) async => (
        receiveOffers: receive,
        items: declined
            ? <ProjectOffer>[]
            : [
                ProjectOffer(
                  id: 'o1',
                  message: 'Nos leggings tiennent bien pendant les séances.',
                  shop: _kalia,
                  products: const [ShopCard(id: 'x1', kind: 'product', title: 'Legging respirant', priceFcfa: 8500, available: true, shop: _kalia)],
                  createdAt: DateTime(2026, 10, 16),
                ),
              ],
      );

  @override
  Future<void> decline(String projectId, String offerId) async {
    calls.add('decline $projectId $offerId');
    declined = true;
  }

  @override
  Future<void> setReceive(String projectId, bool receive) async {
    calls.add('receive $projectId $receive');
    this.receive = receive;
  }

  @override
  Future<({List<ProjectRequest> items, String? hint})> requests() async => (
        items: [ProjectRequest(id: 'r1', category: 'Sport', title: 'Renforcer mes abdos', goal: 'Abdos', mode: 'premium', durationDays: 30, offerStatus: calls.any((c) => c.startsWith('offer')) ? 'sent' : null)],
        hint: null,
      );

  @override
  Future<void> sendOffer(String projectId, {required String message, required List<String> productIds}) async => calls.add('offer $projectId ${productIds.join(',')} $message');
}

class _FakeShop extends ShopApi {
  _FakeShop() : super(_client());

  @override
  Future<List<ProductSummary>> products({required String status}) async =>
      const [ProductSummary(id: 'x1', kind: 'product', title: 'Legging respirant', priceFcfa: 8500, status: 'published', stock: 4)];
}

Future<void> _pump(WidgetTester tester, _FakeOffers api, Widget screen) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [GoRoute(path: '/', builder: (_, __) => screen)]);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), offersApiProvider.overrideWithValue(api), shopApiProvider.overrideWithValue(_FakeShop())],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('écran 49 : offre avec ses articles ; refuser la retire ; ne plus recevoir d’offres', (tester) async {
    final api = _FakeOffers();
    await _pump(tester, api, const ProjectOffersScreen(projectId: 'p1'));
    expect(find.text('Kalia Sport'), findsOneWidget);
    expect(find.text('Nos leggings tiennent bien pendant les séances.'), findsOneWidget);
    expect(find.text('Legging respirant'), findsOneWidget);
    // V1 : les articles s'affichent en grandes photos (mosaïque) ; le bouton est amené à l'écran avant d'être touché.
    await tester.ensureVisible(find.byKey(const ValueKey('decline-o1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('decline-o1')));
    await tester.pumpAndSettle();
    expect(api.calls, ['decline p1 o1']);
    expect(find.text('Kalia Sport'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('receive-offers')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'receive p1 false');
    expect(find.text('Tu ne reçois pas d’offres pour ce projet.'), findsOneWidget);
  });

  testWidgets('demandes (marchand) : demande anonymisée, offre avec un article joint', (tester) async {
    final api = _FakeOffers();
    await _pump(tester, api, const ShopRequestsScreen());
    expect(find.text('Renforcer mes abdos'), findsOneWidget);
    expect(find.text('Sport · Premium'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('offer-r1')));
    await tester.pumpAndSettle();
    FilledButton send() => tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('send-offer')), matching: find.byType(FilledButton)));
    expect(send().onPressed, isNull);
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('offer-message')), matching: find.byType(TextField)), 'Nos leggings pour tes séances.');
    await tester.tap(find.byKey(const ValueKey('offer-product-x1')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('send-offer')));
    await tester.pumpAndSettle();
    expect(api.calls, ['offer r1 x1 Nos leggings pour tes séances.']);
    expect(find.text('Offre envoyée'), findsWidgets);
  });
}
