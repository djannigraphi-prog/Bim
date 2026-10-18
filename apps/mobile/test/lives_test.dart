import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/lives/data/lives_api.dart';
import 'package:bim/features/lives/presentation/live_room_screen.dart';
import 'package:bim/features/lives/presentation/lives_view.dart';
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

LiveSummary _live({String id = 'l1', String status = 'live', bool mine = false, bool sale = false, int hearts = 4, bool premium = false, String? message, String theme = 'classic'}) => LiveSummary(
      id: id,
      kind: sale ? 'sale' : 'simple',
      title: sale ? 'Soldes de la semaine' : 'Routine du matin',
      status: status,
      hostName: 'Awa Koné',
      hostUsername: 'awa',
      shopName: sale ? 'Maison Awa' : null,
      scheduledAt: status == 'scheduled' ? DateTime(2026, 10, 19, 18) : null,
      pinnedProduct: sale ? const PinnedProduct(id: 'p1', title: 'Robe de Live', priceFcfa: 25000, promoPriceFcfa: 20000) : null,
      heartCount: hearts,
      viewers: 12,
      isMine: mine,
      canGift: !mine,
      hostPremium: premium,
      pinnedMessage: message,
      theme: theme,
    );

/// API simulée : garde les appels ; les règles (hôte, statut, Premium) sont testées côté API.
class _FakeLives extends LivesApi {
  _FakeLives({this.available = true, this.current}) : super(_client());

  final bool available;
  LiveSummary? current;
  final calls = <String>[];
  int polls = 0;

  @override
  Future<LiveSummary> gadgets(String id, {String? pinnedMessage, required String theme}) async {
    calls.add('gadgets $id ${pinnedMessage ?? '-'} $theme');
    return current = _live(mine: true, premium: true, message: pinnedMessage, theme: theme);
  }

  @override
  Future<LivesList> list() async => LivesList(available: available, live: available ? [_live()] : const [], upcoming: available ? [_live(id: 'l2', status: 'scheduled')] : const []);

  @override
  Future<LiveState> state(String id, {String? after, String? giftsAfter}) async {
    polls += 1;
    return LiveState(
      live: current ?? _live(),
      comments: after == null ? const [LiveComment(id: 'c1', text: 'Bravo Awa !', author: 'Koffi Yao')] : const [],
      gifts: giftsAfter == null ? const [LiveGiftEvent(id: 'g1', giftCode: 'safe', coins: 1000, from: 'Koffi Yao')] : const [],
      pollSeconds: 2,
      nextAfter: 'c1',
      nextGiftsAfter: 'g1',
    );
  }

  @override
  Future<void> comment(String id, String text) async => calls.add('comment $id $text');

  @override
  Future<int> hearts(String id, int count) async {
    calls.add('hearts $id $count');
    return 5;
  }

  @override
  Future<LiveSummary> end(String id) async {
    calls.add('end $id');
    current = _live(status: 'ended', mine: true);
    return current!;
  }

  @override
  Future<LiveSummary> create({required String title, DateTime? scheduledAt, bool asShop = false, String? productId}) async {
    calls.add('create "$title" later=${scheduledAt != null} shop=$asShop');
    return _live(id: 'new', mine: true);
  }
}

Future<void> _pump(WidgetTester tester, Widget screen, _FakeLives api) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => screen),
    GoRoute(path: '/lives/:id', builder: (_, s) => Scaffold(body: Text('salle ${s.pathParameters['id']}'))),
    GoRoute(path: '/bimshop/products/:id', builder: (_, s) => Scaffold(body: Text('fiche ${s.pathParameters['id']}'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), livesApiProvider.overrideWithValue(api)],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('écran 39 : Lives en cours et programmés ; « Lancer un Live » maintenant', (tester) async {
    final api = _FakeLives();
    await _pump(tester, const Scaffold(body: LivesView()), api);
    expect(find.text('En direct'), findsOneWidget);
    expect(find.text('Awa Koné · 12 en ce moment'), findsOneWidget);
    expect(find.text('EN DIRECT'), findsOneWidget);
    expect(find.text('Awa Koné · 19/10 à 18 h 00'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('live-new')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('live-title')), 'Mon premier Live');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('live-submit')));
    await tester.pumpAndSettle();
    expect(api.calls, ['create "Mon premier Live" later=false shop=false']);
    expect(find.text('salle new'), findsOneWidget);
  });

  testWidgets('hors mode démo : « prochaine version », aucun lancement', (tester) async {
    await _pump(tester, const Scaffold(body: LivesView()), _FakeLives(available: false));
    expect(find.byKey(const ValueKey('lives-closed')), findsOneWidget);
    expect(find.byKey(const ValueKey('live-new')), findsNothing);
  });

  testWidgets('salle du Live : sans vidéo (démo), commentaires, cœur, cadeau animé, article épinglé à commander', (tester) async {
    final api = _FakeLives(current: _live(sale: true));
    await _pump(tester, const LiveRoomScreen(liveId: 'l1', pollEvery: Duration(minutes: 5)), api);
    expect(find.byKey(const ValueKey('live-no-video')), findsOneWidget);
    expect(find.text('Maison Awa'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('live-viewers'))).data, '12');
    expect(find.textContaining('Bravo Awa !', findRichText: true), findsOneWidget);
    expect(find.byKey(const ValueKey('live-gift-anim')), findsOneWidget);
    expect(find.text('Koffi Yao · 1 000 pièces'), findsOneWidget);
    expect(find.text('Robe de Live · 20 000 F'), findsOneWidget);
    expect(find.byKey(const ValueKey('live-gift')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('live-heart')));
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const ValueKey('live-hearts'))).data, '5');
    expect(api.calls, ['hearts l1 1']);

    await tester.enterText(find.byKey(const ValueKey('live-comment-input')), 'Trop belle !');
    await tester.tap(find.byKey(const ValueKey('live-comment-send')));
    await tester.pump();
    expect(api.calls.last, 'comment l1 Trop belle !');

    await tester.pump(const Duration(seconds: 4)); // l'animation du cadeau disparaît
    expect(find.byKey(const ValueKey('live-gift-anim')), findsNothing);

    await tester.tap(find.text('Commander'));
    await tester.pumpAndSettle();
    expect(find.text('fiche p1'), findsOneWidget);
  });

  testWidgets('V1 gadgets Premium : l’hôte épingle un message et choisit une ambiance, visibles par tous', (tester) async {
    final api = _FakeLives(current: _live(mine: true, premium: true));
    await _pump(tester, const LiveRoomScreen(liveId: 'l1', pollEvery: Duration(minutes: 5)), api);
    await tester.pump(const Duration(seconds: 4));
    expect(find.byKey(const ValueKey('live-pinned-message')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('live-gadgets')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('gadgets-message')), 'Code promo BIM10');
    await tester.tap(find.byKey(const ValueKey('gadgets-theme-gold')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('gadgets-save')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('gadgets l1 Code promo BIM10 gold'));
    expect(find.text('Code promo BIM10'), findsOneWidget);
    expect(find.byKey(const ValueKey('live-theme-gold')), findsOneWidget);
  });

  testWidgets('V1 gadgets sans Premium : ambiances verrouillées', (tester) async {
    final api = _FakeLives(current: _live(mine: true));
    await _pump(tester, const LiveRoomScreen(liveId: 'l1', pollEvery: Duration(minutes: 5)), api);
    await tester.pump(const Duration(seconds: 4));
    await tester.tap(find.byKey(const ValueKey('live-gadgets')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Réservés aux membres Premium. Tu peux seulement'), findsOneWidget);
    expect(tester.widget<ChoiceChip>(find.byKey(const ValueKey('gadgets-theme-ocean'))).onSelected, isNull);
  });

  testWidgets('l’hôte termine son Live : « Ce Live est terminé », plus de commentaires', (tester) async {
    final api = _FakeLives(current: _live(mine: true));
    await _pump(tester, const LiveRoomScreen(liveId: 'l1', pollEvery: Duration(minutes: 5)), api);
    expect(find.byKey(const ValueKey('live-gift')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('live-end')));
    await tester.pump();
    await tester.pump();
    expect(api.calls, ['end l1']);
    expect(find.byKey(const ValueKey('live-ended')), findsOneWidget);
    expect(find.byKey(const ValueKey('live-comment-input')), findsNothing);
  });
}
