import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/bimshop/data/bimshop_api.dart';
import 'package:bim/features/projects/data/projects_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/social/application/social_providers.dart';
import 'package:bim/features/social/data/social_api.dart';
import 'package:bim/features/social/data/social_models.dart';
import 'package:bim/features/social/presentation/composer_screen.dart';
import 'package:bim/features/social/presentation/feed_view.dart';
import 'package:bim/features/social/presentation/post_detail_screen.dart';
import 'package:bim/features/social/presentation/profile_screen.dart';
import 'package:bim/features/social/presentation/stories.dart';
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

FeedPost _post(String id, {String kind = 'post', String? text, bool mine = false, int likes = 0, bool liked = false, List<PostMedia> media = const [], Journey? journey, List<UsedProduct> used = const []}) => FeedPost(
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
      usedProducts: used,
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
  Future<FeedPage> publicFeed({String? cursor}) async {
    calls.add('public');
    return FeedPage(items: forYou);
  }

  @override
  Future<void> viewStory(String id) async => calls.add('view $id');

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
  Future<FeedPage> personPosts(String username, {String? cursor}) async => username != 'long.profil'
      ? FeedPage(items: [_post('g1', text: 'Juste du texte')])
      : cursor == null
          ? FeedPage(items: [_post('g1', text: 'Première page')], nextCursor: 'n2')
          : FeedPage(items: [_post('g1', text: 'Première page'), _post('g2', text: 'Deuxième page')]);

  @override
  Future<void> follow(String username, {required bool on}) async {
    calls.add('follow $username $on');
    followed = on;
  }
}

/// 5-E : publication « J'ai fait mon BIM » avec des produits et services utilisés ; recherche du BimShop simulée.
const _gourde = UsedProduct(id: 'x1', title: 'Gourde isotherme', shopName: 'Boutique Élégance');
const _tapis = UsedProduct(id: 'x2', title: 'Tapis de yoga', shopName: 'Maison Awa', available: false);

class _FakeUsedSocial extends _FakeSocial {
  _FakeUsedSocial({this.mine = false});
  final bool mine;
  List<UsedProduct> used = const [_gourde, _tapis];

  @override
  Future<FeedPost> post(String id) async => _post(id, kind: 'bim', mine: mine, text: 'Mon parcours', used: used);

  @override
  Future<FeedPost> setUsedProducts(String postId, List<String> productIds) async {
    calls.add('used ${productIds.join(',')}');
    used = [for (final id in productIds) id == 'x1' ? _gourde : UsedProduct(id: id, title: 'Bandeau', shopName: 'Maison Awa')];
    return post(postId);
  }
}

class _FakeBimShop extends BimShopApi {
  _FakeBimShop() : super(_client());
  final queries = <String>[];
  @override
  Future<({List<ShopCard> items, String? nextCursor})> browse(BimShopQuery query, {String? cursor}) async {
    queries.add(query.q);
    return (
      items: const [
        ShopCard(id: 'x3', kind: 'product', title: 'Bandeau', priceFcfa: 3000, available: true, shop: ShopRef(id: 's2', name: 'Maison Awa', slug: 'maison-awa', verified: false)),
      ],
      nextCursor: null,
    );
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

Future<GoRouter> _pump(WidgetTester tester, Widget screen, _FakeSocial social, {bool emptyProjects = true, BimShopApi? bimshop}) async {
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, __) => screen),
    GoRoute(path: '/posts/:id', builder: (_, s) => Scaffold(body: Text('détail ${s.pathParameters['id']}'))),
    GoRoute(path: '/people/:u', builder: (_, s) => Scaffold(body: Text('profil ${s.pathParameters['u']}'))),
    GoRoute(path: '/social/new', builder: (_, __) => const Scaffold(body: Text('composer'))),
    GoRoute(path: '/projects', builder: (_, __) => const Scaffold(body: Text('écran 18'))),
    GoRoute(path: '/projects/new', builder: (_, __) => const Scaffold(body: Text('nouveau projet'))),
    GoRoute(path: '/search', builder: (_, __) => const Scaffold(body: Text('recherche'))),
    GoRoute(path: '/home', builder: (_, __) => const Scaffold(body: Text('accueil'))),
    GoRoute(path: '/bimshop/products/:id', builder: (_, s) => Scaffold(body: Text('fiche ${s.pathParameters['id']}'))),
  ],);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      socialApiProvider.overrideWithValue(social),
      projectsApiProvider.overrideWithValue(_FakeProjects(empty: emptyProjects)),
      if (bimshop != null) bimShopApiProvider.overrideWithValue(bimshop),
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
    // Taille d'un téléphone (390 × 844) : le résumé du parcours est sous la grande photo.
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pump(tester, const PostDetailScreen(postId: 'p9'), _FakeSocial());
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Avant · 14 sept.'), findsOneWidget);
    expect(find.text('Après · 13 oct.'), findsOneWidget);
    expect(find.text('Le parcours'), findsOneWidget);
    expect(find.text('Sport · Abdos · 30 jours · 24 étapes validées'), findsOneWidget);
    expect(find.text('🏆 30 jours'), findsOneWidget);
    expect(find.byIcon(Icons.compare_arrows_rounded), findsOneWidget); // poignée du curseur avant / après
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

  test('profil : « Voir plus » charge la page suivante, sans doublon (audit du 18/10)', () async {
    final container = ProviderContainer(overrides: [apiClientProvider.overrideWithValue(_client()), socialApiProvider.overrideWithValue(_FakeSocial())]);
    addTearDown(container.dispose);
    final sub = container.listen(personPostsProvider('long.profil'), (_, __) {});
    addTearDown(sub.close);
    var s = await container.read(personPostsProvider('long.profil').future);
    expect(s.hasMore, isTrue);
    await container.read(personPostsProvider('long.profil').notifier).loadMore();
    s = container.read(personPostsProvider('long.profil')).value!;
    expect(s.items.map((p) => p.id), ['g1', 'g2']);
    expect(s.hasMore, isFalse);
  });

  testWidgets('écran 06 : un visiteur voit le fil public ; réagir ouvre l’invitation à créer un compte, sans appel', (tester) async {
    final social = _FakeSocial();
    await _pump(tester, const Scaffold(body: FeedView(visitor: true)), social);
    expect(social.calls, ['public']);
    expect(find.text('Awa Koné'), findsOneWidget);
    expect(find.text('Partage un Bim…'), findsNothing); // pas de publication sans compte
    expect(find.text('Suivre'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('like-p1')));
    await tester.pumpAndSettle();
    expect(find.text('Rejoins BIM pour réagir'), findsOneWidget);
    expect(social.calls, ['public']); // aucun j'aime envoyé
  });

  testWidgets('lecteur de stories : auteur, avancée au toucher, vue enregistrée, fermeture à la fin', (tester) async {
    final social = _FakeSocial();
    final groups = [
      StoryGroup(author: _awa, allSeen: false, items: [
        StoryItem(id: 's1', url: 'http://127.0.0.1:9/s1.jpg', createdAt: DateTime.now().subtract(const Duration(hours: 2)), seen: false),
        StoryItem(id: 's2', url: 'http://127.0.0.1:9/s2.jpg', createdAt: DateTime.now().subtract(const Duration(hours: 1)), seen: true),
      ],),
    ];
    await _pump(
      tester,
      Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => StoryViewer(groups: groups))),
            child: const Text('ouvrir'),
          ),
        ),
      ),
      social,
    );
    await tester.tap(find.text('ouvrir'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.textContaining('Awa Koné · il y a 2 h'), findsOneWidget);
    expect(social.calls, ['view s1']);
    await tester.tapAt(const Offset(700, 300)); // à droite : story suivante (déjà vue : rien n'est renvoyé)
    await tester.pump();
    expect(find.textContaining('Awa Koné · il y a 1 h'), findsOneWidget);
    expect(social.calls, ['view s1']);
    await tester.pump(const Duration(seconds: 6)); // fin de la dernière story : retour
    await tester.pumpAndSettle();
    expect(find.text('ouvrir'), findsOneWidget);
  });

  testWidgets('5-E écran 11 (lecteur) : produits et services utilisés, lien vers la fiche, aucun prix ni achat', (tester) async {
    tester.view.physicalSize = const Size(1170, 3600);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pump(tester, const PostDetailScreen(postId: 'p9'), _FakeUsedSocial());
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Produits et services utilisés'), findsOneWidget);
    expect(find.text('Boutique Élégance'), findsOneWidget);
    expect(find.text('Maison Awa · épuisé'), findsOneWidget);
    expect(find.byKey(const ValueKey('used-products-edit')), findsNothing); // pas l'auteur
    expect(find.textContaining(RegExp('Acheter|Commander|Réserver|F CFA|FCFA')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('used-product-x1')));
    await tester.pumpAndSettle();
    expect(find.text('fiche x1'), findsOneWidget);
  });

  testWidgets('5-E écran 11 (auteur) : chercher dans le BimShop, ajouter, retirer, enregistrer', (tester) async {
    tester.view.physicalSize = const Size(1170, 3600);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final social = _FakeUsedSocial(mine: true);
    final shop = _FakeBimShop();
    await _pump(tester, const PostDetailScreen(postId: 'p9'), social, bimshop: shop);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const ValueKey('used-products-edit')));
    await tester.pumpAndSettle();
    // Retirer le tapis, chercher et ajouter un bandeau.
    await tester.tap(find.byKey(const ValueKey('used-remove-x2')));
    await tester.pump();
    await tester.enterText(find.byKey(const ValueKey('used-search')), 'bandeau');
    await tester.tap(find.byKey(const ValueKey('used-search-go')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('used-result-x3')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('used-save')));
    await tester.pumpAndSettle();
    expect(shop.queries, ['bandeau']);
    expect(social.calls.last, 'used x1,x3');
    expect(find.byKey(const ValueKey('used-product-x3')), findsOneWidget);
    expect(find.byKey(const ValueKey('used-product-x2')), findsNothing);
  });

  testWidgets('5-E règle E2 : l’Accueil n’affiche aucun produit utilisé ni bouton d’achat', (tester) async {
    final social = _FakeSocial()
      ..forYou = [
        _post(
          'b1',
          kind: 'bim',
          text: 'Mon BIM',
          media: const [
            PostMedia(id: 'b', kind: 'before', width: 800, height: 1000, takenDay: '2026-09-14'),
            PostMedia(id: 'a', kind: 'after', width: 800, height: 1000, takenDay: '2026-10-13'),
          ],
          used: const [_gourde],
        ),
      ];
    await _pump(tester, const Scaffold(body: FeedView()), social);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Mon BIM', findRichText: true), findsWidgets);
    expect(find.text('Gourde isotherme'), findsNothing);
    expect(find.textContaining(RegExp('Acheter|Commander')), findsNothing);
  });
}
