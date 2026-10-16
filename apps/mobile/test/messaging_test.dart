import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/messaging/data/messaging_api.dart';
import 'package:bim/features/messaging/presentation/conversation_screen.dart';
import 'package:bim/features/bimshop/data/bimshop_api.dart';
import 'package:bim/features/messaging/presentation/messages_view.dart';
import 'package:bim/features/messaging/presentation/shop_inbox_screen.dart';
import 'package:bim/features/social/data/social_models.dart';
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

const _awa = PersonRef(id: 'u2', username: 'awa.kone', fullName: 'Awa Koné');

ConversationSummary _conv({String id = 'c1', String status = 'active', int unread = 0, String? preview = 'Salut !'}) =>
    ConversationSummary(id: id, status: status, pendingForOther: false, person: _awa, unread: unread, lastPreview: preview, lastAt: DateTime.now().subtract(const Duration(minutes: 5)));

/// API simulée de la messagerie (les règles d'accès sont testées côté API).
class _FakeMessaging extends MessagingApi {
  _FakeMessaging({this.status = 'active'}) : super(_client());

  String status;
  final calls = <String>[];
  final sent = <ChatMessage>[];

  @override
  Future<({List<ConversationSummary> items, String? nextCursor})> conversations({bool requests = false, String? cursor}) async => (
        items: requests ? [_conv(id: 'r1', status: 'request', preview: 'Bonjour, je suis coach')] : [_conv(unread: 2)],
        nextCursor: null,
      );

  @override
  Future<({int conversations, int requests})> unreadCount() async => (conversations: 1, requests: 1);

  @override
  Future<ConversationSummary> start(String username) async {
    calls.add('start $username');
    return _conv();
  }

  @override
  Future<ConversationSummary> conversation(String id) async => _conv(id: id, status: status);

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [
          ...sent.reversed,
          ChatMessage(id: 'm3', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9, 2), text: 'Et toi ?', read: true),
          ChatMessage(id: 'm2', mine: false, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9, 1), text: 'Ça va bien'),
          ChatMessage(id: 'm1', mine: false, kind: 'text', status: 'deleted', createdAt: DateTime(2026, 10, 16, 9)),
        ],
        nextBefore: null,
      );

  @override
  Future<ChatMessage> sendText(String conversationId, String text) async {
    calls.add('send $text');
    final m = ChatMessage(id: 'm${4 + sent.length}', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 10), text: text, read: false);
    sent.add(m);
    return m;
  }

  @override
  Future<void> read(String conversationId) async => calls.add('read');

  @override
  Future<void> accept(String conversationId) async {
    calls.add('accept');
    status = 'active';
  }
}

const _shop = ChatShop(id: 's1', name: 'Boutique Élégance', slug: 'boutique-elegance', verified: true);
const _robe = ShopCard(
  id: 'x1',
  kind: 'product',
  title: 'Robe soirée à plumes',
  priceFcfa: 45000,
  available: true,
  shop: ShopRef(id: 's1', name: 'Boutique Élégance', slug: 'boutique-elegance', verified: true),
);

/// Côté cliente : la conversation avec une boutique, avec un message d'un type à venir (carte de commande, lot 7).
class _FakeShopChat extends _FakeMessaging {
  @override
  Future<ConversationSummary> conversation(String id) async =>
      const ConversationSummary(id: 'c2', kind: 'shop', status: 'active', pendingForOther: false, shop: _shop, context: ChatContext(product: _robe), unread: 0);

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [
          ChatMessage(id: 'k2', mine: false, kind: 'order', status: 'published', createdAt: DateTime(2026, 10, 16, 14, 21)),
          ChatMessage(id: 'k1', mine: false, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 14, 20), text: 'Il en reste 2 en noir.'),
        ],
        nextBefore: null,
      );
}

/// Boîte de la boutique simulée (écran 51).
class _FakeShopInbox extends ShopInboxApi {
  _FakeShopInbox() : super(_client());

  final calls = <String>[];
  final boxes = <String>[];

  ConversationSummary _c({bool archived = false}) => ConversationSummary(
        id: 's1',
        kind: 'shop',
        status: 'active',
        pendingForOther: false,
        person: _awa,
        unread: 1,
        archived: archived,
        lastPreview: 'Livraison à Yopougon possible ?',
        lastAt: DateTime.now().subtract(const Duration(minutes: 3)),
      );

  @override
  Future<({List<ConversationSummary> items, String? nextCursor})> conversations({String box = 'all', String? cursor}) async {
    boxes.add(box);
    return (items: box == 'all' ? [_c()] : <ConversationSummary>[], nextCursor: null);
  }

  @override
  Future<({int unread, int all})> unreadCount() async => (unread: 1, all: 1);

  @override
  Future<ConversationSummary> setArchived(String id, bool on) async {
    calls.add('archive $id $on');
    return _c(archived: on);
  }

  @override
  Future<ConversationSummary> conversation(String id) async =>
      const ConversationSummary(id: 's1', kind: 'shop', status: 'active', pendingForOther: false, person: _awa, unread: 0);

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [ChatMessage(id: 'm1', mine: false, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 9), text: 'Livraison à Yopougon possible ?')],
        nextBefore: null,
      );

  @override
  Future<ChatMessage> sendText(String conversationId, String text) async {
    calls.add('send $text');
    return ChatMessage(id: 'm2', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 10), text: text, read: false);
  }

  @override
  Future<void> read(String conversationId) async => calls.add('read');

  @override
  Future<List<({String id, String text})>> quickReplies() async => const [(id: 'q1', text: 'Oui, dès demain.')];
}

Future<void> _pump(WidgetTester tester, _FakeMessaging api, Widget home, {_FakeShopInbox? inbox}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => home),
    GoRoute(path: '/messages/:id', builder: (_, s) => ConversationScreen(conversationId: s.pathParameters['id']!, refreshEvery: null)),
    GoRoute(path: '/shop/messages/:id', builder: (_, s) => ConversationScreen(conversationId: s.pathParameters['id']!, refreshEvery: null, asShop: true)),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      messagingApiProvider.overrideWithValue(api),
      shopInboxApiProvider.overrideWithValue(inbox ?? _FakeShopInbox()),
    ],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('écran 47 : conversations, non-lus, demandes ; « Nouveau message » ouvre la conversation', (tester) async {
    final api = _FakeMessaging();
    await _pump(tester, api, const Scaffold(body: MessagesView()));
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(find.text('Salut !'), findsOneWidget);
    expect(find.text('2'), findsOneWidget); // non-lus
    expect(find.text('Demandes (1)'), findsOneWidget);
    await tester.tap(find.text('Demandes (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Bonjour, je suis coach'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('new-message')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('new-message-username')), '@awa.kone');
    await tester.tap(find.byKey(const ValueKey('new-message-go')));
    await tester.pumpAndSettle();
    expect(api.calls.first, 'start awa.kone');
    expect(find.byKey(const ValueKey('message-input')), findsOneWidget);
  });

  testWidgets('conversation : messages, « Message supprimé », « Vu », envoi, lecture marquée', (tester) async {
    final api = _FakeMessaging();
    await _pump(tester, api, const ConversationScreen(conversationId: 'c1', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Ça va bien'), findsOneWidget);
    expect(find.text('Message supprimé'), findsOneWidget);
    expect(find.byKey(const ValueKey('message-read')), findsOneWidget);
    expect(api.calls, contains('read'));
    await tester.enterText(find.byKey(const ValueKey('message-input')), 'On se voit samedi ?');
    await tester.tap(find.byKey(const ValueKey('message-send')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('send On se voit samedi ?'));
    expect(find.text('On se voit samedi ?'), findsOneWidget);
    // Le dernier message envoyé n'est pas encore lu : « Vu » disparaît.
    expect(find.byKey(const ValueKey('message-read')), findsNothing);
  });

  testWidgets('demande reçue : pas de saisie, pas de « lu » envoyé ; « Accepter » ouvre la conversation', (tester) async {
    final api = _FakeMessaging(status: 'request');
    await _pump(tester, api, const ConversationScreen(conversationId: 'r1', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const ValueKey('message-input')), findsNothing);
    expect(api.calls, isNot(contains('read')));
    await tester.tap(find.byKey(const ValueKey('request-accept')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('accept'));
    expect(find.byKey(const ValueKey('message-input')), findsOneWidget);
  });

  testWidgets('6-B, écran 48 côté cliente : la boutique, l’article (« en stock »), « Commander » annoncé ; type de message à venir lisible', (tester) async {
    final api = _FakeShopChat();
    await _pump(tester, api, const ConversationScreen(conversationId: 'c2', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Boutique Élégance'), findsOneWidget);
    expect(find.text('Robe soirée à plumes'), findsOneWidget);
    expect(find.textContaining('en stock'), findsOneWidget);
    expect(find.byKey(const ValueKey('message-unsupported')), findsOneWidget);
    expect(find.text('Il en reste 2 en noir.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('chat-order')));
    await tester.pumpAndSettle();
    expect(find.text('Bientôt disponible'), findsOneWidget);
  });

  testWidgets('6-B, écran 51 : boîte de la boutique, onglet Commandes annoncé, archiver par appui long', (tester) async {
    final inbox = _FakeShopInbox();
    await _pump(tester, _FakeMessaging(), const ShopInboxScreen(), inbox: inbox);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(find.text('Tous · 1'), findsOneWidget);
    expect(find.text('Non lus · 1'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('inbox-tab-orders')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Les commandes reçues arriveront ici'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('inbox-tab-all')));
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(const ValueKey('conversation-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('inbox-archive')));
    await tester.pumpAndSettle();
    expect(inbox.calls, ['archive s1 true']);
  });

  testWidgets('6-B, écran 48 côté boutique : réponse rapide puis envoi au nom de la boutique, lecture marquée', (tester) async {
    final inbox = _FakeShopInbox();
    final api = _FakeMessaging();
    await _pump(tester, api, const ConversationScreen(conversationId: 's1', refreshEvery: null, asShop: true), inbox: inbox);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(inbox.calls, contains('read'));
    await tester.tap(find.byKey(const ValueKey('quick-reply-q1')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('message-send')));
    await tester.pumpAndSettle();
    expect(inbox.calls, contains('send Oui, dès demain.'));
    // Rien n'est passé par la messagerie des personnes.
    expect(api.calls, isEmpty);
    expect(find.text('Oui, dès demain.'), findsWidgets);
  });
}
