import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/projects/data/projects_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/social/data/social_api.dart';
import 'package:bim/features/social/data/social_models.dart';
import 'package:bim/features/social/presentation/composer_screen.dart';
import 'package:bim/features/social/presentation/feed_view.dart';
import 'package:bim/features/social/presentation/post_detail_screen.dart';
import 'package:bim/features/social/presentation/profile_screen.dart';
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

const _awa = PersonRef(id: 'u1', username: 'awa.k', fullName: 'Awa Koné');
const _me = PersonRef(id: 'u0', username: 'moi', fullName: 'Yannick Doho');

FeedPost _post(String id, {String kind = 'post', String? text, bool mine = false, int likes = 0, bool liked = false, List<PostMedia> media = const [], Journey? journey}) => FeedPost(
      id: id,
      kind: kind,
      text: text,
      visibility: 'public',
      createdAt: DateTime.now().subtract(const Duration(hours: 3)),
      author: mine ? _me : _awa,
      media: media,
      journey: journey,
      likeCount: likes,
      commentCount: 2,
      likedByMe: liked,
      isMine: mine,
      followingAuthor: false,
    );

/// API simulée du social : garde les appels ; les règles (visibilité, blocages) sont testées côté API.
class _FakeSocial extends SocialApi {
  _FakeSocial() : super(_client());

  final calls = <String>[];
  List<FeedPost> forYou = [_post('p1', text: 'Premier mois terminé 💪', likes: 9)];
  List<FeedPost> following = [];

  @override
  Future<FeedPage> feed({required String tab, String? cursor}) async => FeedPage(items: tab == 'following' ? following : forYou);

  @override
  Future<({int likeCount, bool likedByMe})> like(String id, {required bool on}) async {
    calls.add('like $id $on');
    return (likeCount: on ? 10 : 9, likedByMe: on);
  }

  @override
  Future<FeedPost> create({String? text, required String visibility, List<List<int>> images = const []}) async {
    calls.add('create "$text" $visibility ${images.length}');
    return _post('new', text: text, mine: true);
  }

  @override
  Future<FeedPost> createBim({required String projectId, String? text, required String visibility}) async {
    calls.add('bim $projectId $visibility');
    return _post('newbim', kind: 'bim', mine: true);
  }

  @override
  Future<FeedPost> post(String id) async => _post(
        id,
        kind: 'bim',
        text: 'De 90 kg à 65 kg',
        media: const [
          PostMedia(id: 'b', kind: 'before', width: 800, height: 1000, takenDay: '2026-09-14'),
          PostMedia(id: 'a', kind: 'after', width: 800, height: 1000, takenDay: '2026-10-13'),
        ],
        journey: const Journey(category: 'Sport', goal: 'Abdos', days: 30, stepsDone: 24),
      );

  @override
  Future<PublicProfile> profile(String username) async => username == 'moi'
      ? const PublicProfile(person: _me, bims: 1, followers: 2800, following: 3, projects: 3, isMe: true, followedByMe: false, followsMe: false, blockedByMe: false, city: 'Abidjan')
      : PublicProfile(person: _awa, bims: 4, followers: 12, following: 7, isMe: false, followedByMe: followed, followsMe: true, blockedByMe: false);

  bool followed = false;

  @override
  Future<FeedPage> personPosts(String username, {String? cursor}) async => FeedPage(items: [_post('g1', text: 'Juste du texte')]);

  @override
  Future<void> follow(String username, {required bool on}) async {
    calls.add('follow $username $on');
    followed = on;
  }
}

class _FakeProjects extends ProjectsApi {
  _FakeProjects({this.empty = true}) : super(_client());

  final bool empty;

  @override
  Future<ProjectList> list() async => ProjectList(
        items: empty
            ? const []
            : const [
                ProjectSummary(
                  id: 'pr1', title: 'Renforcer mes abdos', categoryLabel: 'Sport', icon: 'dumbbell', mode: 'eco', status: 'active', isPublic: false,
                  durationDays: 30, currentDay: 12, progress: 40, streak: 3, plannedEndDate: '2026-11-12',
                ),
              ],
        activeCount: empty ? 0 : 1,
        today: '2026-10-15',
      );
}

Future<GoRouter> _pump(WidgetTester tester, Widget screen, _FakeSocial social, {bool emptyProjects = true}) async {
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => screen),
    GoRoute(path: '/posts/:id', builder: (_, s) => Scaffold(body: Text('détail ${s.pathParameters['id']}'))),
    GoRoute(path: '/people/:u', builder: (_, s) => Scaffold(body: Text('profil ${s.pathParameters['u']}'))),
    GoRoute(path: '/social/new', builder: (_, __) => const Scaffold(body: Text('composer'))),
    GoRoute(path: '/projects', builder: (_, __) => const Scaffold(body: Text('écran 18'))),
    GoRoute(path: '/projects/new', builder: (_, __) => const Scaffold(body: Text('nouveau projet'))),
    GoRoute(path: '/search', builder: (_, __) => const Scaffold(body: Text('recherche'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      socialApiProvider.overrideWithValue(social),
      projectsApiProvider.overrideWithValue(_FakeProjects(empty: emptyProjects)),
    ],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  return router;
}

void main() {
  test('compteurs abrégés, durée écoulée et résumé du parcours', () {
    expect(compactCount(950), '950');
    expect(compactCount(10200), '10,2 k');
    expect(compactCount(12000), '12 k');
    expect(compactCount(2800000), '2,8 M');
    final now = DateTime(2026, 10, 15, 12);
    expect(timeAgo(now.subtract(const Duration(seconds: 20)), now: now), 'à l’instant');
    expect(timeAgo(now.subtract(const Duration(hours: 3)), now: now), 'il y a 3 h');
    expect(timeAgo(now.subtract(const Duration(days: 2)), now: now), 'il y a 2 j');
    expect(const Journey(category: 'Sport', goal: 'Abdos', days: 30, stepsDone: 24).summary, '30 jours · 24 étapes validées');
    expect(const Journey(category: 'Sport', days: 30, stepsDone: 1).summary, '30 jours · 1 étape validée');
    expect(const PersonRef(id: 'x', username: 'a', fullName: 'Awa Koné').initials, 'AK');
  });

  testWidgets('écran 10 : fil, j’aime confirmé par l’API, onglet « Abonnés » vide ; invitation au premier projet conservée', (tester) async {
    final social = _FakeSocial();
    await _pump(tester, const Scaffold(body: FeedView()), social);
    expect(find.text('Pour toi'), findsOneWidget);
    expect(find.text('Partage un Bim…'), findsOneWidget);
    // Parcours existant : sans projet, l'Accueil invite toujours à créer le premier.
    expect(find.text('Ton premier projet t’attend'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Nouveau projet'), findsOneWidget);
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(find.text('9'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('like-p1')));
    await tester.pump();
    expect(social.calls, ['like p1 true']);
    expect(find.text('10'), findsOneWidget);

    await tester.tap(find.text('Abonnés'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Suis des personnes pour voir leurs Bims ici.'), findsOneWidget);
  });

  testWidgets('écran 10 avec un projet en cours : carte du jour et accès à « Mes projets »', (tester) async {
    await _pump(tester, const Scaffold(body: FeedView()), _FakeSocial(), emptyProjects: false);
    expect(find.text('Ton premier projet t’attend'), findsNothing);
    expect(find.text('Mes projets'), findsOneWidget);
    expect(find.text('1 en cours'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('my-projects')));
    await tester.pumpAndSettle();
    expect(find.text('écran 18'), findsOneWidget);
  });

  testWidgets('écran 16 : « Publier » inactif tant que rien n’est écrit ; visibilité choisie et envoyée', (tester) async {
    final social = _FakeSocial();
    await _pump(tester, const ComposerScreen(), social);
    FilledButton publish() => tester.widget<FilledButton>(find.byKey(const ValueKey('composer-publish')));
    expect(publish().onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('composer-text')), 'Premier mois terminé');
    await tester.pump();
    expect(publish().onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('composer-visibility')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('visibility-followers')));
    await tester.pumpAndSettle();
    expect(find.text('Mes abonnés'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('composer-publish')));
    await tester.pump();
    expect(social.calls, ['create "Premier mois terminé" followers 0']);
  });

  testWidgets('écran 16 depuis l’écran 31 : projet lié, format « J’ai fait mon BIM », publiable sans texte', (tester) async {
    final social = _FakeSocial();
    await _pump(tester, const ComposerScreen(projectId: 'pr1'), social, emptyProjects: false);
    expect(find.textContaining('Tes photos avant / après de « Renforcer mes abdos » seront publiées'), findsOneWidget);
    expect(find.byKey(const ValueKey('composer-add-photo')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('composer-publish')));
    await tester.pump();
    expect(social.calls, ['bim pr1 public']);
  });

  testWidgets('écran 11 : comparaison avant / après et résumé du parcours', (tester) async {
    await _pump(tester, const PostDetailScreen(postId: 'p9'), _FakeSocial());
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Avant · 14 sept.'), findsOneWidget);
    expect(find.text('Après · 13 oct.'), findsOneWidget);
    expect(find.text('Le parcours'), findsOneWidget);
    expect(find.text('Sport · Abdos · 30 jours · 24 étapes validées'), findsOneWidget);
    expect(find.text('🏆 30 jours'), findsOneWidget);
    expect(find.bySemanticsLabel('Faire glisser pour comparer avant et après'), findsOneWidget);
  });

  testWidgets('écran 52 : mon profil (projets, photo) ; profil d’une autre personne (s’abonner)', (tester) async {
    final social = _FakeSocial();
    await _pump(tester, const ProfileScreen(username: 'moi'), social);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Projets'), findsOneWidget);
    expect(find.text('2,8 k'), findsNothing); // 2 800 < 10 000 : nombre entier
    expect(find.text('2800'), findsOneWidget);
    expect(find.text('Changer ma photo'), findsOneWidget);
    expect(find.text('Abidjan'), findsOneWidget);

    await _pump(tester, const ProfileScreen(username: 'awa.k'), social);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Abonnements'), findsOneWidget);
    expect(find.text('Projets'), findsNothing);
    expect(find.text('Te suit'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('profile-follow')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(social.calls, ['follow awa.k true']);
    expect(find.text('Abonné·e'), findsOneWidget);
  });
}
