import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/notifications/data/inbox_api.dart';
import 'package:bim/features/notifications/presentation/notifications_screen.dart';
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

final _now = DateTime(2026, 10, 15, 18);

InboxItem _item(String id, String type, String text, Duration ago, {bool unread = true, String? link}) => InboxItem(
      id: id,
      type: type,
      category: type == 'report_answered' ? 'support' : 'projects',
      sender: type == 'report_answered' ? 'bim' : 'peni',
      text: text,
      at: _now.subtract(ago),
      unread: unread,
      link: link,
    );

/// API simulée : garde les appels pour vérifier filtres, pages et « vu ».
class _FakeInbox extends InboxApi {
  _FakeInbox() : super(ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9'));

  final calls = <String>[];
  List<InboxItem> items = [
    _item('reminder:1', 'task_reminder', 'Petit rappel : Séance t’attend encore aujourd’hui.', const Duration(minutes: 5), link: '/projects/p1/day/2026-10-15'),
    _item('report:1', 'report_answered', 'L’équipe BIM a répondu à ton signalement.', const Duration(hours: 2), link: '/reports'),
    _item('chest:1', 'chest_opened', 'Coffre de la semaine 1 ouvert pour « Abdos ». Continue comme ça !', const Duration(days: 2), unread: false, link: '/projects/p1'),
  ];
  String? next;
  String? nextId;
  final beforeIds = <String?>[];
  int failures = 0;

  @override
  Future<InboxPage> page({String? category, String? before, String? beforeId}) async {
    calls.add('page ${category ?? 'tout'} ${before ?? ''}'.trim());
    beforeIds.add(beforeId);
    if (failures > 0) {
      failures--;
      throw ApiException.network;
    }
    if (before != null) {
      return InboxPage(items: [_item('chest:0', 'chest_opened', 'Coffre ancien', const Duration(days: 20), unread: false)], nextBefore: null);
    }
    final list = category == null ? items : items.where((i) => i.category == category).toList();
    return InboxPage(items: list, nextBefore: next, nextBeforeId: nextId);
  }

  @override
  Future<void> markSeen() async => calls.add('seen');

  @override
  Future<int> unreadCount() async => 0;
}

Future<void> _open(WidgetTester tester, _FakeInbox api, {List<String>? opened}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: '/notifications', routes: [
    GoRoute(path: '/notifications', builder: (_, __) => NotificationsScreen(now: _now)),
    GoRoute(path: '/projects/:id/day/:day', builder: (_, s) {
      opened?.add(s.uri.path);
      return const Scaffold(body: Text('Journée'));
    },),
    GoRoute(path: '/reports', builder: (_, __) => const Scaffold(body: Text('Mes signalements'))),
    GoRoute(path: '/projects/:id', builder: (_, __) => const Scaffold(body: Text('Carte'))),
    GoRoute(path: '/account/reminders', builder: (_, __) => const Scaffold(body: Text('Réglages des rappels'))),
  ],);
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [inboxApiProvider.overrideWithValue(api)],
      child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
    ),
  );
  await tester.pump();
  await tester.pump();
}

Finder _rich(String text) => find.textContaining(text, findRichText: true);

void main() {
  testWidgets('affiche les notifications par période, avec l’expéditeur, puis les marque vues une seule fois', (tester) async {
    final api = _FakeInbox();
    await _open(tester, api);
    expect(find.text('AUJOURD’HUI'), findsOneWidget);
    expect(find.text('CETTE SEMAINE'), findsOneWidget);
    expect(_rich('Peni : Petit rappel : Séance'), findsOneWidget);
    expect(_rich('BIM : L’équipe BIM a répondu'), findsOneWidget);
    expect(_rich('Coffre de la semaine 1'), findsOneWidget);
    expect(find.text('il y a 5 min'), findsOneWidget);
    expect(find.text('il y a 2 h'), findsOneWidget);
    // Maquette 17 : Tout, Projets, Pièces, Commandes, Live (filtres du serveur).
    expect(find.text('Tout'), findsOneWidget);
    expect(find.text('Projets'), findsOneWidget);
    expect(find.text('Pièces'), findsOneWidget);
    expect(find.text('Commandes'), findsOneWidget);
    expect(api.calls, ['page tout', 'seen']);

    await tester.tap(find.text('Projets'));
    await tester.pump();
    await tester.pump();
    expect(api.calls, ['page tout', 'seen', 'page projects']);
    expect(_rich('L’équipe BIM a répondu'), findsNothing);
    expect(_rich('Petit rappel'), findsOneWidget);
  });

  testWidgets('toucher une notification ouvre l’écran lié (journée du projet pour un rappel)', (tester) async {
    final opened = <String>[];
    await _open(tester, _FakeInbox(), opened: opened);
    await tester.tap(find.byKey(const ValueKey('inbox-reminder:1')));
    await tester.pumpAndSettle();
    expect(opened, ['/projects/p1/day/2026-10-15']);
    expect(find.text('Journée'), findsOneWidget);
  });

  testWidgets('page suivante avec « Voir plus »', (tester) async {
    final api = _FakeInbox()..next = '2026-10-13T18:00:00.000Z';
    await _open(tester, api);
    await tester.ensureVisible(find.text('Voir plus'));
    await tester.pump();
    await tester.tap(find.text('Voir plus'));
    await tester.pump();
    await tester.pump();
    expect(api.calls.last, 'page tout 2026-10-13T18:00:00.000Z');
    expect(_rich('Coffre ancien'), findsOneWidget);
    expect(find.text('PLUS ANCIEN'), findsOneWidget);
    expect(find.text('Voir plus'), findsNothing);
  });

  testWidgets('audit défaut 4 : « Voir plus » renvoie aussi l’identifiant du dernier élément (aucune notification sautée)', (tester) async {
    final api = _FakeInbox()
      ..next = '2026-10-13T18:00:00.000Z'
      ..nextId = 'chest:1';
    await _open(tester, api);
    await tester.ensureVisible(find.text('Voir plus'));
    await tester.pump();
    await tester.tap(find.text('Voir plus'));
    await tester.pump();
    await tester.pump();
    expect(api.calls.last, 'page tout 2026-10-13T18:00:00.000Z');
    expect(api.beforeIds.last, 'chest:1');
  });

  testWidgets('aucune notification : message de Peni ; erreur réseau : message et nouvel essai', (tester) async {
    final api = _FakeInbox()
      ..items = []
      ..failures = 1;
    await _open(tester, api);
    expect(find.text(ApiException.network.message), findsOneWidget);
    expect(api.calls, ['page tout']); // rien n'est marqué « vu » sans affichage
    await tester.tap(find.text('Réessayer'));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const ValueKey('inbox-empty')), findsOneWidget);
    expect(api.calls, ['page tout', 'page tout', 'seen']);
  });

  testWidgets('petit téléphone (320 dp) : aucun débordement', (tester) async {
    tester.view.physicalSize = const Size(960, 1704);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final router = GoRouter(initialLocation: '/n', routes: [GoRoute(path: '/n', builder: (_, __) => NotificationsScreen(now: _now))]);
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [inboxApiProvider.overrideWithValue(_FakeInbox())],
        child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
