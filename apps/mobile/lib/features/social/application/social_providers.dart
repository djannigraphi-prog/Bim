import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/social_api.dart';
import '../data/social_models.dart';

/// État d'un fil : publications chargées et curseur de la page suivante.
class FeedState {
  const FeedState({required this.items, this.nextCursor, this.loadingMore = false, this.pageError = false});

  final List<FeedPost> items;
  final String? nextCursor;
  final bool loadingMore;
  /// La page suivante a échoué : on attend un « Réessayer » au lieu de relancer en boucle (audit, M-5).
  final bool pageError;

  bool get hasMore => nextCursor != null;

  FeedState copyWith({List<FeedPost>? items, String? nextCursor, bool clearCursor = false, bool? loadingMore, bool? pageError}) => FeedState(
        items: items ?? this.items,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        loadingMore: loadingMore ?? this.loadingMore,
        pageError: pageError ?? this.pageError,
      );
}

/// Fil « Pour toi » (`for_you`) ou « Abonnés » (`following`), écran 10.
class FeedController extends AutoDisposeFamilyAsyncNotifier<FeedState, String> {
  @override
  Future<FeedState> build(String tab) async {
    final page = await ref.watch(socialApiProvider).feed(tab: tab);
    return FeedState(items: page.items, nextCursor: page.nextCursor);
  }

  /// Page suivante ; `retry` après un échec signalé à l'écran.
  Future<void> loadMore({bool retry = false}) async {
    final s = state.valueOrNull;
    if (s == null || !s.hasMore || s.loadingMore || (s.pageError && !retry)) return;
    state = AsyncData(s.copyWith(loadingMore: true, pageError: false));
    try {
      final page = await ref.read(socialApiProvider).feed(tab: arg, cursor: s.nextCursor);
      // « Pour toi » est classé (V1) : une publication déjà affichée n'est jamais répétée.
      final known = {for (final p in s.items) p.id};
      state = AsyncData(FeedState(items: [...s.items, ...page.items.where((p) => !known.contains(p.id))], nextCursor: page.nextCursor));
    } catch (_) {
      state = AsyncData(s.copyWith(loadingMore: false, pageError: true));
    }
  }

  void replace(FeedPost post) {
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncData(s.copyWith(items: [for (final p in s.items) p.id == post.id ? post : p]));
  }

  void remove(String postId) {
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncData(s.copyWith(items: s.items.where((p) => p.id != postId).toList()));
  }

  void insertFirst(FeedPost post) {
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncData(s.copyWith(items: [post, ...s.items.where((p) => p.id != post.id)]));
  }
}

final feedProvider = AsyncNotifierProvider.autoDispose.family<FeedController, FeedState, String>(FeedController.new);

/// Fil des visiteurs (écran 06), une page.
final publicFeedProvider = FutureProvider.autoDispose<FeedPage>((ref) => ref.watch(socialApiProvider).publicFeed());

/// Bandeau des stories (écran 10).
final storiesProvider = FutureProvider.autoDispose<StoryTray>((ref) => ref.watch(socialApiProvider).stories());

final postProvider = FutureProvider.autoDispose.family<FeedPost, String>((ref, id) => ref.watch(socialApiProvider).post(id));

final profileProvider = FutureProvider.autoDispose.family<PublicProfile, String>((ref, username) => ref.watch(socialApiProvider).profile(username));

/// Publications d'un profil, page par page (« Voir plus », audit du 18/10).
class PersonPostsController extends AutoDisposeFamilyAsyncNotifier<FeedState, String> {
  @override
  Future<FeedState> build(String username) async {
    final page = await ref.watch(socialApiProvider).personPosts(username);
    return FeedState(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final s = state.valueOrNull;
    if (s == null || !s.hasMore || s.loadingMore) return;
    state = AsyncData(s.copyWith(loadingMore: true, pageError: false));
    try {
      final page = await ref.read(socialApiProvider).personPosts(arg, cursor: s.nextCursor);
      final known = {for (final p in s.items) p.id};
      state = AsyncData(FeedState(items: [...s.items, ...page.items.where((p) => !known.contains(p.id))], nextCursor: page.nextCursor));
    } catch (_) {
      state = AsyncData(s.copyWith(loadingMore: false, pageError: true));
    }
  }
}

final personPostsProvider = AsyncNotifierProvider.autoDispose.family<PersonPostsController, FeedState, String>(PersonPostsController.new);

/// V1 — Personnes à suivre, en tête du fil « Pour toi ».
final suggestionsProvider = FutureProvider.autoDispose<List<PersonSuggestion>>((ref) => ref.watch(socialApiProvider).suggestions());
