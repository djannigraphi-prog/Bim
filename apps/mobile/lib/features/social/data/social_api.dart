import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'social_models.dart';

/// Appels HTTP du social (lot 4). Aucune règle ici : visibilité, blocages et limites sont appliqués par l'API.
class SocialApi {
  SocialApi(this._api);
  final ApiClient _api;

  Future<FeedPage> feed({required String tab, String? cursor}) async =>
      FeedPage.fromJson(await _api.get('/v1/feed', query: {'tab': tab, if (cursor != null) 'cursor': cursor}));

  /// Fil des visiteurs sans compte (écran 06) : publications « Tout le monde », en lecture.
  Future<FeedPage> publicFeed({String? cursor}) async => FeedPage.fromJson(await _api.get('/v1/public/feed', query: {if (cursor != null) 'cursor': cursor}));

  Future<StoryTray> stories() async => StoryTray.fromJson(await _api.get('/v1/stories'));

  Future<void> createStory(List<int> bytes) {
    final png = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
    return _api.upload('/v1/stories', field: 'photo', bytes: bytes, filename: png ? 'story.png' : 'story.jpg', contentType: png ? 'image/png' : 'image/jpeg');
  }

  Future<void> viewStory(String id) => _api.put('/v1/stories/$id/view');

  Future<void> deleteStory(String id) => _api.delete('/v1/stories/$id');

  Future<FeedPost> post(String id) async => FeedPost.fromJson(await _api.get('/v1/posts/$id'));

  /// Publication simple : texte et 4 photos au plus.
  Future<FeedPost> create({String? text, required String visibility, List<List<int>> images = const []}) async {
    final fields = {if (text != null && text.trim().isNotEmpty) 'text': text.trim(), 'visibility': visibility};
    final res = images.isEmpty ? await _api.post('/v1/posts', body: fields) : await _api.postFiles('/v1/posts', fields: fields, fileField: 'images', files: images);
    return FeedPost.fromJson(res);
  }

  /// « J'ai fait mon BIM » : photos avant / après du projet, publiées avec l'accord de la personne.
  Future<FeedPost> createBim({required String projectId, String? text, required String visibility}) async => FeedPost.fromJson(
        await _api.post('/v1/posts/bim', body: {'projectId': projectId, if (text != null && text.trim().isNotEmpty) 'text': text.trim(), 'visibility': visibility}),
      );

  Future<void> delete(String id) => _api.delete('/v1/posts/$id');

  Future<({int likeCount, bool likedByMe})> like(String id, {required bool on}) async {
    final r = on ? await _api.put('/v1/posts/$id/like') : await _api.delete('/v1/posts/$id/like');
    return (likeCount: (r['likeCount'] ?? 0) as int, likedByMe: (r['likedByMe'] ?? on) as bool);
  }

  Future<CommentsPage> comments(String postId, {String? cursor}) async =>
      CommentsPage.fromJson(await _api.get('/v1/posts/$postId/comments', query: {if (cursor != null) 'cursor': cursor}));

  Future<void> comment(String postId, String text, {String? parentId}) =>
      _api.post('/v1/posts/$postId/comments', body: {'text': text, if (parentId != null) 'parentId': parentId});

  Future<void> deleteComment(String id) => _api.delete('/v1/comments/$id');

  Future<({int likeCount, bool likedByMe})> likeComment(String id, {required bool on}) async {
    final r = on ? await _api.put('/v1/comments/$id/like') : await _api.delete('/v1/comments/$id/like');
    return (likeCount: (r['likeCount'] ?? 0) as int, likedByMe: (r['likedByMe'] ?? on) as bool);
  }

  Future<PublicProfile> profile(String username) async => PublicProfile.fromJson(await _api.get('/v1/people/${Uri.encodeComponent(username)}'));

  Future<FeedPage> personPosts(String username, {String? cursor}) async =>
      FeedPage.fromJson(await _api.get('/v1/people/${Uri.encodeComponent(username)}/posts', query: {if (cursor != null) 'cursor': cursor}));

  Future<List<PersonResult>> search(String q) async =>
      ((await _api.get('/v1/people', query: {'q': q}))['items'] as List<dynamic>).map((e) => PersonResult.fromJson(e as Map<String, dynamic>)).toList();

  Future<void> follow(String username, {required bool on}) =>
      on ? _api.put('/v1/people/${Uri.encodeComponent(username)}/follow') : _api.delete('/v1/people/${Uri.encodeComponent(username)}/follow');

  Future<void> block(String username, {required bool on}) =>
      on ? _api.put('/v1/people/${Uri.encodeComponent(username)}/block') : _api.delete('/v1/people/${Uri.encodeComponent(username)}/block');

  Future<List<PersonRef>> blocked() async =>
      ((await _api.get('/v1/me/blocks'))['items'] as List<dynamic>).map((e) => PersonRef.fromJson(e as Map<String, dynamic>)).toList();

  Future<String?> setAvatar(List<int> bytes) async {
    final png = bytes.length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50;
    final r = await _api.upload('/v1/me/avatar', field: 'photo', bytes: bytes, filename: png ? 'avatar.png' : 'avatar.jpg', contentType: png ? 'image/png' : 'image/jpeg', method: 'PUT');
    return r['avatarUrl'] as String?;
  }

  Future<void> removeAvatar() => _api.delete('/v1/me/avatar');

  Future<void> report({required String targetType, required String targetId, required String reason, String? message}) => _api.post(
        '/v1/content-reports',
        body: {'targetType': targetType, 'targetId': targetId, 'reason': reason, if (message != null && message.trim().isNotEmpty) 'message': message.trim()},
      );
}

final socialApiProvider = Provider<SocialApi>((ref) => SocialApi(ref.watch(apiClientProvider)));
