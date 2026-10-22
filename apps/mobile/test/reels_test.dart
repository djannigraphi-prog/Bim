import 'dart:collection';

import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/reels/data/reels_api.dart';
import 'package:bim/features/reels/presentation/reels_screen.dart';
import 'package:bim/features/social/data/social_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

Reel _reel(String id, {bool canGift = false, int coins = 0, bool mine = false}) => Reel(
      id: id,
      author: const PersonRef(id: 'u1', username: 'awa.k', fullName: 'Awa Koné'),
      videoUrl: 'http://127.0.0.1:9/v1/media/x',
      durationMs: 15000,
      caption: 'Ma routine $id',
      likeCount: 3,
      viewCount: 41,
      coinCount: coins,
      canGift: canGift,
      isMine: mine,
    );

/// API simulée : garde les appels ; format, durée, visibilité et blocages sont testés côté API.
class _FakeReels extends ReelsApi {
  _FakeReels() : super(_client());

  final calls = <String>[];

  @override
  Future<ReelsPage> feed({String? cursor}) async => ReelsPage(items: [_reel('r1', canGift: true, coins: 10), _reel('r2')]);

  @override
  Future<({int likeCount, bool likedByMe})> like(String id, {required bool on}) async {
    calls.add('like $id $on');
    return (likeCount: on ? 4 : 3, likedByMe: on);
  }

  @override
  Future<void> view(String id) async => calls.add('view $id');

  @override
  Future<Reel> upload(List<int> bytes, {String? caption, required String visibility}) async {
    calls.add('upload ${bytes.length} "$caption" $visibility');
    return _reel('new', mine: true);
  }
}

class _FakeVideo implements VideoSource {
  @override
  Future<List<int>?> pick() async => List<int>.filled(2048, 1);
}

/// Comme le vrai sélecteur quand l'accès à la galerie a été refusé.
class _DeniedVideo implements VideoSource {
  @override
  Future<List<int>?> pick() async => throw PlatformException(code: 'photo_access_denied', message: 'The user did not allow photo access.');
}

/// Vidéo de plus de 100 Mo (sans allouer 100 Mo en mémoire).
class _HugeBytes extends ListBase<int> {
  @override
  int get length => kMaxVideoBytes + 1;
  @override
  set length(int _) => throw UnsupportedError('fixe');
  @override
  int operator [](int i) => 0;
  @override
  void operator []=(int i, int v) => throw UnsupportedError('fixe');
}

class _HugeVideo implements VideoSource {
  @override
  Future<List<int>?> pick() async => _HugeBytes();
}

Future<void> _pump(WidgetTester tester, _FakeReels api, {VideoSource? video}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => const ReelsScreen()),
    GoRoute(path: '/reels/new', builder: (_, __) => const ReelComposerScreen()),
    GoRoute(path: '/people/:u', builder: (_, s) => Scaffold(body: Text('profil ${s.pathParameters['u']}'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      reelsApiProvider.overrideWithValue(api),
      videoSourceProvider.overrideWithValue(video ?? _FakeVideo()),
      reelPlayerBuilderProvider.overrideWithValue((context, reel, active) => ColoredBox(color: Colors.black, child: Text('lecteur ${reel.id} ${active ? 'actif' : 'pause'}'))),
    ],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('écran 15 : un Reel par page, lecture de la page affichée, vue comptée, j’aime, pièces', (tester) async {
    final api = _FakeReels();
    await _pump(tester, api);
    expect(find.text('lecteur r1 actif'), findsOneWidget);
    expect(find.text('@awa.k'), findsOneWidget);
    expect(find.text('Ma routine r1'), findsOneWidget);
    expect(find.text('41 vues'), findsOneWidget);
    expect(api.calls, ['view r1']);
    expect(find.byKey(const ValueKey('reel-coins-r1')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('reel-like-r1')));
    await tester.pump();
    expect(api.calls.last, 'like r1 true');
    expect(find.text('4'), findsOneWidget);

    await tester.drag(find.byKey(const ValueKey('reels-pages')), const Offset(0, -700));
    await tester.pumpAndSettle();
    expect(find.text('lecteur r2 actif'), findsOneWidget);
    expect(api.calls.last, 'view r2');
    expect(find.byKey(const ValueKey('reel-coins-r2')), findsNothing); // l'auteur n'est pas Premium, aucune pièce
  });

  testWidgets('publier un Reel : vidéo choisie, légende, visibilité « abonnés »', (tester) async {
    final api = _FakeReels();
    await _pump(tester, api);
    await tester.tap(find.byKey(const ValueKey('reel-new')));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('reel-publish')), matching: find.byType(FilledButton))).onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('reel-pick')));
    await tester.pump();
    expect(find.byKey(const ValueKey('reel-picked')), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('reel-caption')), 'Ma routine');
    await tester.tap(find.text('Mes abonnés'));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('reel-publish')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'upload 2048 "Ma routine" followers');
    // Retour aux Reels : le nouveau est en tête, avec son propre lecteur, lu.
    expect(find.text('Ma routine new'), findsOneWidget);
    expect(find.text('lecteur new actif'), findsOneWidget);
  });

  testWidgets('un autre écran par-dessus les Reels : la vidéo se met en pause, puis reprend au retour', (tester) async {
    await _pump(tester, _FakeReels());
    expect(find.text('lecteur r1 actif'), findsOneWidget);
    await tester.tap(find.text('@awa.k'));
    await tester.pumpAndSettle();
    expect(find.text('profil awa.k'), findsOneWidget);
    expect(find.text('lecteur r1 pause', skipOffstage: false), findsOneWidget);
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    expect(find.text('lecteur r1 actif'), findsOneWidget);
  });

  testWidgets('galerie refusée : message clair, rien n’est choisi', (tester) async {
    await _pump(tester, _FakeReels(), video: _DeniedVideo());
    await tester.tap(find.byKey(const ValueKey('reel-new')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reel-pick')));
    await tester.pump();
    expect(find.text('Autorise l’appareil photo et la galerie dans les réglages du téléphone.'), findsOneWidget);
    expect(find.byKey(const ValueKey('reel-picked')), findsNothing);
  });

  testWidgets('vidéo de plus de 100 Mo : refusée avant l’envoi, avec la marche à suivre', (tester) async {
    final api = _FakeReels();
    await _pump(tester, api, video: _HugeVideo());
    await tester.tap(find.byKey(const ValueKey('reel-new')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('reel-pick')));
    await tester.pump();
    expect(find.text('Vidéo trop lourde : 100 Mo au plus. Raccourcis-la ou filme en qualité plus basse.'), findsOneWidget);
    expect(find.byKey(const ValueKey('reel-picked')), findsNothing);
    expect(api.calls.where((c) => c.startsWith('upload')), isEmpty);
  });
}
