import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/merchant/data/shop_api.dart' show formatFcfa;
import 'package:bim/features/messaging/application/voice.dart';
import 'package:bim/features/messaging/data/messaging_api.dart';
import 'package:bim/features/messaging/presentation/conversation_screen.dart';
import 'package:bim/features/messaging/presentation/group_screens.dart';
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
  Future<ChatMessage> sendText(String conversationId, String text, {String? replyToId}) async {
    calls.add(replyToId == null ? 'send $text' : 'send $text (réponse à $replyToId)');
    final quoted = replyToId == null ? null : QuotedMessage(id: replyToId, mine: false, preview: 'Ça va bien');
    final m = ChatMessage(id: 'm${4 + sent.length}', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 10), text: text, read: false, replyTo: quoted);
    sent.add(m);
    return m;
  }

  @override
  Future<ChatMessage> react(String messageId, String? emoji) async {
    calls.add('react $messageId ${emoji ?? '-'}');
    return ChatMessage(
      id: messageId,
      mine: false,
      kind: 'text',
      status: 'published',
      createdAt: DateTime(2026, 10, 16, 9, 1),
      text: 'Ça va bien',
      reactions: emoji == null ? const [] : [(emoji: emoji, count: 1)],
      myReaction: emoji,
    );
  }

  @override
  Future<void> read(String conversationId) async => calls.add('read');

  @override
  Future<void> accept(String conversationId) async {
    calls.add('accept');
    status = 'active';
  }
}

/// Enregistreur simulé (le micro du téléphone n'existe pas dans les tests).
class _FakeRecorder implements VoiceRecorder {
  final calls = <String>[];
  bool allowed = true;

  @override
  Future<bool> start() async {
    calls.add('start');
    return allowed;
  }

  /// Comme le vrai : un enregistreur libéré ne peut plus rien rendre.
  bool disposed = false;

  @override
  Future<List<int>?> stop() async {
    if (disposed) throw StateError('enregistreur libéré');
    calls.add('stop');
    return List<int>.filled(2000, 1);
  }

  @override
  Future<void> cancel() async => calls.add('cancel');

  @override
  void dispose() => disposed = true;
}

/// V1 : un groupe, avec un message système, un message d'une autre personne et un message d'une personne bloquée.
class _FakeGroup extends _FakeMessaging {
  final voices = <int>[];

  @override
  Future<ConversationSummary> conversation(String id) async =>
      ConversationSummary(id: id, kind: 'group', status: status, pendingForOther: false, unread: 0, groupTitle: 'Team running', memberCount: 4, myRole: 'admin');

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [
          ChatMessage(id: 'g3', mine: false, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 18, 9, 2), blockedSender: true, senderName: 'Paul Tano'),
          ChatMessage(id: 'g2', mine: false, kind: 'voice', status: 'published', createdAt: DateTime(2026, 10, 18, 9, 1), voiceUrl: 'http://127.0.0.1:9/v.m4a', durationMs: 42000, senderName: 'Koffi Yao', senderUsername: 'koffi'),
          ChatMessage(id: 'g1', mine: false, kind: 'system', status: 'published', createdAt: DateTime(2026, 10, 18, 9), text: 'Awa a créé le groupe « Team running »'),
        ],
        nextBefore: null,
      );

  @override
  Future<ChatMessage> sendVoice(String conversationId, List<int> bytes) async {
    voices.add(bytes.length);
    return ChatMessage(id: 'g9', mine: true, kind: 'voice', status: 'published', createdAt: DateTime(2026, 10, 18, 10), voiceUrl: 'http://127.0.0.1:9/w.m4a', durationMs: 3000);
  }

  @override
  Future<({ConversationSummary conversation, List<String> notAdded})> createGroup(String title, List<String> usernames) async {
    calls.add('group $title ${usernames.join('+')}');
    return (conversation: await conversation('g-new'), notAdded: ['inconnu']);
  }

  @override
  Future<({List<GroupMember> items, String myRole, int maxMembers})> groupMembers(String id) async => (
        items: const [
          GroupMember(username: 'awa.kone', fullName: 'Awa Koné', role: 'admin', isMe: true),
          GroupMember(username: 'koffi', fullName: 'Koffi Yao', role: 'member'),
          GroupMember(username: 'paul', fullName: 'Paul Tano', role: 'member', invited: true),
        ],
        myRole: 'admin',
        maxMembers: 32,
      );

  @override
  Future<void> leaveGroup(String id) async => calls.add('leave $id');
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

/// V1 : articles partagés dans une conversation (l'un est encore en ligne, l'autre non).
class _SharedChat extends _FakeMessaging {
  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [
          ChatMessage(id: 'p2', mine: false, kind: 'product', status: 'published', createdAt: DateTime(2026, 10, 19, 21, 1)),
          ChatMessage(
            id: 'p1',
            mine: true,
            kind: 'product',
            status: 'published',
            createdAt: DateTime(2026, 10, 19, 21),
            product: const ShopCard(id: 'x2', kind: 'product', title: 'Sac Kalia', priceFcfa: 15000, available: true, shop: ShopRef(id: 's2', name: 'Kalia', slug: 'kalia', verified: false)),
          ),
        ],
        nextBefore: null,
      );
}

/// Côté cliente : la conversation avec une boutique, avec un message d'un type à venir (carte de commande, lot 7).
class _FakeShopChat extends _FakeMessaging {
  @override
  Future<ConversationSummary> conversation(String id) async =>
      const ConversationSummary(id: 'c2', kind: 'shop', status: 'active', pendingForOther: false, shop: _shop, context: ChatContext(product: _robe), unread: 0);

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async => (
        items: [
          ChatMessage(id: 'k3', mine: false, kind: 'sticker', status: 'published', createdAt: DateTime(2026, 10, 16, 14, 22)),
          ChatMessage(
            id: 'k2',
            mine: false,
            kind: 'order',
            status: 'published',
            createdAt: DateTime(2026, 10, 16, 14, 21),
            order: const OrderCard(id: 'o9', number: 'CMD-000009', status: 'proposed', itemsTotalFcfa: 18000, title: 'Robe noire (prix convenu)'),
          ),
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
  Future<ChatMessage> sendText(String conversationId, String text, {String? replyToId}) async {
    calls.add('send $text');
    return ChatMessage(id: 'm2', mine: true, kind: 'text', status: 'published', createdAt: DateTime(2026, 10, 16, 10), text: text, read: false);
  }

  @override
  Future<void> read(String conversationId) async => calls.add('read');

  @override
  Future<List<({String id, String text})>> quickReplies() async => const [(id: 'q1', text: 'Oui, dès demain.')];
}

Future<void> _pump(WidgetTester tester, _FakeMessaging api, Widget home, {_FakeShopInbox? inbox, VoiceRecorder? recorder}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => home),
    GoRoute(path: '/messages/new-group', builder: (_, __) => const NewGroupScreen()),
    GoRoute(path: '/messages/:id', builder: (_, s) => ConversationScreen(conversationId: s.pathParameters['id']!, refreshEvery: null)),
    GoRoute(path: '/messages/:id/group', builder: (_, s) => GroupInfoScreen(conversationId: s.pathParameters['id']!)),
    GoRoute(path: '/shop/messages/:id', builder: (_, s) => ConversationScreen(conversationId: s.pathParameters['id']!, refreshEvery: null, asShop: true)),
    GoRoute(path: '/orders/:id', builder: (_, s) => Scaffold(body: Text('commande ${s.pathParameters['id']}'))),
    GoRoute(path: '/bimshop/products/:id', builder: (_, s) => Scaffold(body: Text('fiche ${s.pathParameters['id']}'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      messagingApiProvider.overrideWithValue(api),
      shopInboxApiProvider.overrideWithValue(inbox ?? _FakeShopInbox()),
      // Même cycle de vie que l'app (le vrai fournisseur libère l'enregistreur quand plus personne ne l'écoute) :
      // reproduit le défaut du 22/10/2026 où le vocal ne partait jamais.
      voiceRecorderProvider.overrideWith((ref) {
        final r = recorder ?? _FakeRecorder();
        ref.onDispose(r.dispose);
        return r;
      }),
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
    // Maquette 47 : filtre « Marchands » (Awa est une personne), puis recherche.
    await tester.tap(find.byKey(const ValueKey('messages-filter-shops')));
    await tester.pump();
    expect(find.text('Awa Koné'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('messages-filter-all')));
    await tester.enterText(find.byKey(const ValueKey('messages-search')), 'zzz');
    await tester.pump();
    expect(find.text('Aucune conversation ne correspond.'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('messages-search')), 'awa');
    await tester.pump();
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(find.text('Demandes de messages · 1', findRichText: true), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('messages-requests')));
    await tester.pumpAndSettle();
    expect(find.text('Bonjour, je suis coach'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('new-message')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('new-direct')));
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
    // Maquette 48 : séparateur de jour et heure dans chaque bulle.
    expect(find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('day-')), findsWidgets);
    expect(find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('time-')), findsWidgets);
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

  testWidgets('6-B / 7-B, écran 48 côté cliente : l’article, carte de proposition de commande, type à venir lisible, « Commander » ouvre la fiche', (tester) async {
    final api = _FakeShopChat();
    await _pump(tester, api, const ConversationScreen(conversationId: 'c2', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Boutique Élégance'), findsOneWidget);
    expect(find.text('Robe soirée à plumes'), findsOneWidget);
    expect(find.textContaining('en stock'), findsOneWidget);
    expect(find.byKey(const ValueKey('message-unsupported')), findsOneWidget);
    expect(find.text('Il en reste 2 en noir.'), findsOneWidget);
    // 7-B : carte de la proposition ; un appui ouvre la commande.
    expect(find.text('Proposition CMD-000009'), findsOneWidget);
    expect(find.text('${formatFcfa(18000)} · Proposition à accepter'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('order-card-o9')));
    await tester.pumpAndSettle();
    expect(find.text('commande o9'), findsOneWidget);
  });

  testWidgets('V1 : article partagé — carte cliquable vers la fiche ; article retiré : simple mention', (tester) async {
    await _pump(tester, _SharedChat(), const ConversationScreen(conversationId: 'c1', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Sac Kalia'), findsOneWidget);
    expect(find.text('Article plus disponible'), findsOneWidget);
    expect(find.byKey(const ValueKey('message-unsupported')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('shared-product-p1')));
    await tester.pumpAndSettle();
    expect(find.text('fiche x2'), findsOneWidget);
  });

  testWidgets('7-B, bandeau de l’article : « Commander » ouvre la fiche (taille, quantité, mode)', (tester) async {
    await _pump(tester, _FakeShopChat(), const ConversationScreen(conversationId: 'c2', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const ValueKey('chat-order')));
    await tester.pumpAndSettle();
    expect(find.textContaining('fiche '), findsOneWidget);
  });

  testWidgets('6-B, écran 51 : boîte de la boutique, onglet Commandes annoncé, archiver par appui long', (tester) async {
    final inbox = _FakeShopInbox();
    await _pump(tester, _FakeMessaging(), const ShopInboxScreen(), inbox: inbox);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(find.text('Tous · 1'), findsOneWidget);
    expect(find.text('Non lus · 1'), findsOneWidget);

    // Les onglets défilent horizontalement : on amène chacun à l'écran avant de le toucher.
    await tester.ensureVisible(find.byKey(const ValueKey('inbox-tab-orders')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('inbox-tab-orders')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Les commandes reçues arriveront ici'), findsOneWidget);
    expect(find.byKey(const ValueKey('conversation-s1')), findsNothing);
    await tester.ensureVisible(find.byKey(const ValueKey('inbox-tab-all')));
    await tester.pumpAndSettle();
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

  testWidgets('6-C : réagir par appui long (une réaction, retirée en la touchant de nouveau), répondre en citant', (tester) async {
    final api = _FakeMessaging();
    await _pump(tester, api, const ConversationScreen(conversationId: 'c1', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.longPress(find.byKey(const ValueKey('message-m2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('reaction-picker')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('reaction-0')));
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byKey(const ValueKey('reactions-m2')), matching: find.text('❤️')), findsOneWidget);
    // Même émoji : la réaction est retirée.
    await tester.longPress(find.byKey(const ValueKey('message-m2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reaction-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('reactions-m2')), findsNothing);
    // Répondre : bandeau, envoi avec le message cité, bandeau refermé.
    await tester.longPress(find.byKey(const ValueKey('message-m2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('message-reply')));
    await tester.pumpAndSettle();
    expect(find.text('Réponse à Awa Koné : Ça va bien'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('message-input')), 'Super !');
    await tester.tap(find.byKey(const ValueKey('message-send')));
    await tester.pumpAndSettle();
    expect(api.calls.where((c) => c.startsWith('react') || c.startsWith('send')), ['react m2 ❤️', 'react m2 -', 'send Super ! (réponse à m2)']);
    expect(find.byKey(const ValueKey('reply-banner')), findsNothing);
    expect(find.byKey(const ValueKey('quote-m4')), findsOneWidget);
  });

  testWidgets('6-C : demande reçue, ni réaction ni réponse (l’auteur n’apprend pas qu’elle est lue)', (tester) async {
    final api = _FakeMessaging(status: 'request');
    await _pump(tester, api, const ConversationScreen(conversationId: 'r1', refreshEvery: null));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.longPress(find.byKey(const ValueKey('message-m2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('reaction-picker')), findsNothing);
    expect(find.byKey(const ValueKey('message-reply')), findsNothing);
    expect(find.byKey(const ValueKey('message-report')), findsOneWidget);
  });

  testWidgets('V1 : groupe — auteur des messages, message système, personne bloquée, vocal ; infos et départ', (tester) async {
    final api = _FakeGroup();
    final rec = _FakeRecorder();
    await _pump(tester, api, const ConversationScreen(conversationId: 'g1', refreshEvery: null), recorder: rec);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Team running'), findsOneWidget);
    expect(find.text('4 membres'), findsOneWidget);
    expect(find.text('Awa a créé le groupe « Team running »'), findsOneWidget);
    expect(find.text('Koffi Yao'), findsOneWidget);
    expect(find.byKey(const ValueKey('voice-g2')), findsOneWidget);
    expect(find.text('0:42'), findsOneWidget);
    expect(find.text('Message d’une personne bloquée'), findsOneWidget);

    // Vocal : micro (champ vide), décompte, envoi.
    await tester.tap(find.byKey(const ValueKey('voice-record')));
    await tester.pump();
    expect(find.byKey(const ValueKey('voice-recording')), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('0:03 / 2:00'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('voice-send')));
    await tester.pumpAndSettle();
    expect(rec.calls, ['start', 'stop']);
    expect(api.voices, [2000]);
    expect(find.byKey(const ValueKey('voice-g9')), findsOneWidget);

    // Infos du groupe : membres, invité, départ.
    await tester.tap(find.byKey(const ValueKey('group-info')));
    await tester.pumpAndSettle();
    expect(find.text('Awa Koné (toi)'), findsOneWidget);
    expect(find.text('@paul · invité·e'), findsOneWidget);
    expect(find.byKey(const ValueKey('group-add')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('group-leave')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('group-leave-confirm')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('leave g1'));
  });

  testWidgets('V1 : vocal annulé, micro refusé : rien n’est envoyé', (tester) async {
    final api = _FakeGroup();
    final rec = _FakeRecorder();
    await _pump(tester, api, const ConversationScreen(conversationId: 'g1', refreshEvery: null), recorder: rec);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const ValueKey('voice-record')));
    await tester.pump(const Duration(seconds: 2));
    await tester.tap(find.byKey(const ValueKey('voice-cancel')));
    await tester.pumpAndSettle();
    expect(rec.calls, ['start', 'cancel']);
    rec.allowed = false;
    await tester.tap(find.byKey(const ValueKey('voice-record')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('voice-recording')), findsNothing);
    expect(api.voices, isEmpty);
  });

  testWidgets('V1 : nouveau groupe — nom, personnes, personnes non ajoutées signalées', (tester) async {
    final api = _FakeGroup();
    await _pump(tester, api, const Scaffold(body: MessagesView()));
    await tester.tap(find.byKey(const ValueKey('new-message')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('new-group')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('group-title')), 'Team running');
    await tester.enterText(find.byKey(const ValueKey('group-people')), '@koffi, @Paul inconnu');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('group-create')));
    await tester.pumpAndSettle();
    expect(api.calls, contains('group Team running koffi+paul+inconnu'));
    expect(find.text('Pas ajouté·es : @inconnu'), findsOneWidget);
  });
}
