import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/social/data/social_models.dart';
import 'package:bim/features/social/presentation/social_widgets.dart';
import 'package:bim/features/wallet/data/wallet_api.dart';
import 'package:bim/features/wallet/presentation/gift_sheet.dart';
import 'package:bim/features/wallet/presentation/wallet_screen.dart';
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

const _gifts = [
  GiftOption(code: 'coin1', name: 'Pièce', coins: 1),
  GiftOption(code: 'coin5', name: '5 pièces', coins: 5),
  GiftOption(code: 'purse', name: 'Porte-monnaie', coins: 50),
  GiftOption(code: 'chest_s', name: 'Petit coffre', coins: 100),
  GiftOption(code: 'chest_l', name: 'Grand coffre', coins: 500),
  GiftOption(code: 'safe', name: 'Coffre-fort', coins: 1000),
  GiftOption(code: 'ship', name: 'Bateau pirate', coins: 100000),
  GiftOption(code: 'bank', name: 'Banque', coins: 200000),
];

WalletInfo _wallet({int purchased = 800, int received = 255, bool available = true}) => WalletInfo(
      available: available,
      demo: available,
      balance: WalletBalance(total: purchased + received, purchased: purchased, received: received, withdrawable: received),
      premiumActive: false,
      receivedTotal: 255,
      sentTotal: 200,
      packs: const [100, 500, 1000, 5000, 10000, 50000],
      gifts: _gifts,
      rules: const WithdrawalRules(min: 5000, dailyCap: 5000000, instantMax: 100000, feePercent: 1, operators: ['orange', 'mtn', 'moov', 'wave']),
      history: [LedgerLine(id: 'l1', kind: 'gift_received', delta: 200, at: DateTime(2026, 10, 18))],
      customMin: 100,
      customMax: 1000000,
    );

/// API simulée : garde les appels ; les règles (Premium, soldes, plafonds) sont testées côté API.
class _FakeWallet extends WalletApi {
  _FakeWallet(this.info) : super(_client());

  WalletInfo info;
  final calls = <String>[];

  @override
  Future<WalletInfo> wallet() async => info;

  @override
  Future<GiftResult> gift({required String targetType, required String targetId, required String giftCode, required int quantity, required bool anonymous, required String idempotencyKey}) async {
    calls.add('gift $targetType $targetId $giftCode x$quantity anonymous=$anonymous');
    return GiftResult(targetCoinCount: 200, balance: info.balance);
  }

  @override
  Future<WalletBalance> buy(int coins, {required String idempotencyKey}) async {
    calls.add('buy $coins');
    return info.balance;
  }
}

Future<void> _pump(WidgetTester tester, Widget screen, _FakeWallet api) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => screen),
    GoRoute(path: '/premium', builder: (_, __) => const Scaffold(body: Text('écran premium'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), walletApiProvider.overrideWithValue(api)],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  test('nombres avec espaces, frais de l’opérateur arrondis au franc supérieur', () {
    expect(coinsLabel(100000), '100 000');
    expect(coinsLabel(950), '950');
    const r = WithdrawalRules(min: 5000, dailyCap: 5000000, instantMax: 100000, feePercent: 1, operators: ['wave']);
    expect(r.feeFor(5000), 50);
    expect(r.feeFor(150), 2);
  });

  testWidgets('écran 58 : solde, pièces retirables séparées, mode démo annoncé, historique', (tester) async {
    await _pump(tester, const WalletScreen(), _FakeWallet(_wallet()));
    expect(find.byKey(const ValueKey('demo-notice')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('wallet-total'))).data, '1 055');
    expect(tester.widget<Text>(find.byKey(const ValueKey('wallet-split'))).data, 'Reçues (retirables) : 255 · achetées : 800');
    expect(find.text('Pièces reçues'), findsOneWidget);
    expect(find.text('+200'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('wallet-withdraw')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('withdraw-available'))).data, 'Retirables : 255 pièces (seules les pièces reçues).');
    await tester.enterText(find.byKey(const ValueKey('withdraw-amount')), '5000');
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const ValueKey('withdraw-fee'))).data, 'Frais de l’opérateur : 50 F · tu reçois 4 950 F · commission BIM : 0 F');
  });

  testWidgets('pièces fermées hors mode démo : « bientôt », aucun achat proposé', (tester) async {
    await _pump(tester, const WalletScreen(), _FakeWallet(_wallet(purchased: 0, received: 0, available: false)));
    expect(find.byKey(const ValueKey('wallet-closed')), findsOneWidget);
    expect(find.text('Acheter'), findsNothing);
  });

  testWidgets('écran 13 « Encourager » : cadeau, quantité, envoi ; nouveau total renvoyé', (tester) async {
    final api = _FakeWallet(_wallet());
    int? result;
    await _pump(
      tester,
      Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await showGiftSheet(context, targetType: 'post', targetId: 'p1', recipientName: 'Awa Koné'),
            child: const Text('ouvrir'),
          ),
        ),
      ),
      api,
    );
    await tester.tap(find.text('ouvrir'));
    await tester.pumpAndSettle();
    expect(find.text('Encourager Awa Koné'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('gift-balance'))).data, 'Ton solde : 1 055 pièces');
    await tester.tap(find.byKey(const ValueKey('gift-chest_s')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('gift-plus')));
    await tester.pump();
    expect(find.text('Envoyer 200 pièces'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('gift-send')));
    await tester.pumpAndSettle();
    expect(api.calls, ['gift post p1 chest_s x2 anonymous=false']);
    expect(result, 200);
  });

  testWidgets('écran 60 (maquette) : cases avec image, « Populaire » sur 5 000, choisir puis payer', (tester) async {
    final api = _FakeWallet(_wallet());
    await _pump(tester, Scaffold(body: Builder(builder: (c) => TextButton(onPressed: () => showBuyCoinsSheet(c), child: const Text('acheter')))), api);
    await tester.tap(find.text('acheter'));
    await tester.pumpAndSettle();
    for (final p in [100, 500, 1000, 5000, 10000, 50000]) {
      expect(find.byKey(ValueKey('pack-$p')), findsOneWidget);
    }
    expect(find.descendant(of: find.byKey(const ValueKey('pack-5000')), matching: find.byKey(const ValueKey('pack-popular'))), findsOneWidget);
    expect(find.text('Payer 5 000 F'), findsOneWidget); // le pack populaire est choisi d'avance
    await tester.tap(find.byKey(const ValueKey('pack-1000')));
    await tester.pump();
    expect(find.text('Payer 1 000 F'), findsOneWidget);
    expect(api.calls, isEmpty); // choisir ne paie rien
    await tester.tap(find.byKey(const ValueKey('pay-coins')));
    await tester.pumpAndSettle();
    expect(api.calls, ['buy 1000']);
  });

  testWidgets('V1 écran 60 : « Autre montant », la personne choisit le nombre de pièces (bornes contrôlées)', (tester) async {
    final api = _FakeWallet(_wallet());
    await _pump(tester, Scaffold(body: Builder(builder: (c) => TextButton(onPressed: () => showBuyCoinsSheet(c), child: const Text('acheter')))), api);
    await tester.tap(find.text('acheter'));
    await tester.pumpAndSettle();
    expect(find.text('De 100 à 1 000 000 pièces'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('pack-custom')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('custom-coins')), '50');
    await tester.pump();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('custom-buy'))).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('custom-coins')), '2500');
    await tester.pump();
    expect(find.text('Prix : 2 500 F'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('custom-buy')));
    await tester.pumpAndSettle();
    expect(api.calls, ['buy 2500']);
    expect(find.text('2 500 pièces ajoutées (démo, rien n’a été payé).'), findsOneWidget);
  });

  testWidgets('solde insuffisant : on propose d’acheter des pièces au lieu d’envoyer', (tester) async {
    await _pump(
      tester,
      Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showGiftSheet(context, targetType: 'comment', targetId: 'c1', recipientName: 'Awa'),
            child: const Text('ouvrir'),
          ),
        ),
      ),
      _FakeWallet(_wallet(purchased: 0, received: 10)),
    );
    await tester.tap(find.text('ouvrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('gift-safe')));
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const ValueKey('gift-missing'))).data, 'Il te manque 990 pièces.');
    expect(find.byKey(const ValueKey('gift-send')), findsNothing);
    expect(find.text('Acheter des pièces'), findsOneWidget);
  });

  testWidgets('publication : bouton pièces seulement si l’auteur peut en recevoir ou en a reçu', (tester) async {
    var tapped = 0;
    FeedPost post({required bool canGift, int coins = 0}) => FeedPost(
          id: 'p1',
          kind: 'post',
          visibility: 'public',
          createdAt: DateTime(2026, 10, 18),
          author: const PersonRef(id: 'u1', username: 'awa', fullName: 'Awa Koné'),
          media: const [],
          likeCount: 3,
          commentCount: 1,
          likedByMe: false,
          isMine: false,
          followingAuthor: false,
          coinCount: coins,
          canGift: canGift,
        );
    Future<void> show(FeedPost p) => tester.pumpWidget(
          MaterialApp(
            theme: BimTheme.light(),
            home: Scaffold(body: PostActions(post: p, onLike: () {}, onComments: () {}, onCoins: () => tapped += 1)),
          ),
        );
    await show(post(canGift: false));
    expect(find.byKey(const ValueKey('coins-p1')), findsNothing);
    await show(post(canGift: true, coins: 250));
    expect(find.byKey(const ValueKey('coins-p1')), findsOneWidget);
    expect(find.text('250'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('coins-p1')));
    expect(tapped, 1);
  });
}
