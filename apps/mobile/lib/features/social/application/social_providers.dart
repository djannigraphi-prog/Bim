import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/social_api.dart';
import '../data/social_models.dart';

/// État d'un fil : publications chargées et curseur de la page suivante.
class FeedState {
  const FeedState({required this.items, this.nextCursor, this.loadingMore = false});

  final List<FeedPost> items;
  final String? nextCursor;
  final bool loadingMore;

  bool get hasMore => nextCursor != null;

  FeedState copyWith({List<FeedPost>? items, String? nextCursor, bool clearCursor = false, bool? loadingMore}) => FeedState(
        items: items ?? this.items,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        loadingMore: loadingMore ?? this.loadingMore,
      );
}

/// Fil « Pour toi » (`for_you`) ou « Abonnés » (`following`), écran 10.
class FeedController extends AutoDisposeFamilyAsyncNotifier<FeedState, String> {
  @override
  Future<FeedState> build(String tab) async {
    final page = await ref.watch(socialApiProvider).feed(tab: tab);
    return FeedState(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final s = state.valueOrNull;
    if (s == null || !s.hasMore || s.loadingMore) return;
    state = AsyncData(s.copyWith(loadingMore: true));
    try {
      final page = await ref.read(socialApiProvider).feed(tab: arg, cursor: s.nextCursor);
      state = AsyncData(FeedState(items: [...s.items, ...page.items], nextCursor: page.nextCursor));
    } catch (_) {
      state = AsyncData(s.copyWith(loadingMore: false));
      rethrow;
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

final personPostsProvider = FutureProvider.autoDispose.family<FeedPage, String>((ref, username) => ref.watch(socialApiProvider).personPosts(username));
