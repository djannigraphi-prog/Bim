import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/social/data/social_api.dart';
import 'package:bim/features/social/data/social_models.dart';
import 'package:bim/features/social/presentation/comments_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

ApiClient _client() => ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');

const _awa = PersonRef(id: 'u1', username: 'awa.kone', fullName: 'Awa Koné');
const _moi = PersonRef(id: 'u2', username: 'moi', fullName: 'Moi');

PostComment _c(String id, String text, {String? parentId, PersonRef author = _awa}) =>
    PostComment(id: id, parentId: parentId, text: text, createdAt: DateTime(2026, 10, 16), author: author, likeCount: 0, likedByMe: false, canDelete: false, isMine: false);

/// Publication avec 30 commentaires déjà affichés et une page suivante (le serveur en a plus de 30).
class _FakeSocial extends SocialApi {
  _FakeSocial() : super(_client());
  final calls = <String>[];

  @override
  Future<CommentsPage> comments(String postId, {String? cursor}) async {
    calls.add('comments ${cursor ?? 'page1'}');
    if (cursor != null) return CommentsPage(total: 31, items: [_c('c31', 'Commentaire 31')]);
    return CommentsPage(total: 31, nextCursor: 'c30', items: [for (var i = 1; i <= 30; i++) _c('c$i', 'Commentaire $i')]);
  }

  @override
  Future<PostComment?> comment(String postId, String text, {String? parentId}) async {
    calls.add('comment $text ${parentId ?? '-'}');
    return PostComment(id: 'new', parentId: parentId, text: text, createdAt: DateTime(2026, 10, 16, 6), author: _moi, likeCount: 0, likedByMe: false, canDelete: true, isMine: true);
  }
}

Future<void> _pump(WidgetTester tester, _FakeSocial api) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), socialApiProvider.overrideWithValue(api)],
    child: MaterialApp(theme: BimTheme.light(), home: const Scaffold(body: CommentsPanel(postId: 'p1'))),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  testWidgets('audit point 4 : un commentaire publié au-delà des 30 premiers apparaît tout de suite, sans recharger les pages', (tester) async {
    final api = _FakeSocial();
    await _pump(tester, api);
    expect(find.text('31 commentaires'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('comment-input')), 'Mon nouveau commentaire');
    await tester.tap(find.byKey(const ValueKey('comment-send')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    // Un seul envoi, aucun rechargement : la liste vient de l'écran, complétée localement.
    expect(api.calls, ['comments page1', 'comment Mon nouveau commentaire -']);
    expect(find.text('32 commentaires'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Mon nouveau commentaire'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Mon nouveau commentaire'), findsOneWidget);

    // « Voir plus » ajoute la page suivante sans doublon.
    await tester.scrollUntilVisible(find.byKey(const ValueKey('comments-more')), 300, scrollable: find.byType(Scrollable).first);
    // Le bouton peut être construit juste sous le bord de la liste : on l'amène entièrement à l'écran avant de le toucher.
    await tester.ensureVisible(find.byKey(const ValueKey('comments-more')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('comments-more')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(api.calls.last, 'comments c30');
    expect(find.text('Mon nouveau commentaire'), findsOneWidget);
  });
}
