import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/network/api_client.dart';
import '../../social/data/social_models.dart';

/// Lot 11 (prototype) — Reels : vidéos verticales courtes rangées dans le stockage privé de BIM (aucun service vidéo
/// payant). Format, durée et effacement des métadonnées sont contrôlés par l'API.

int _int(Object? v) => v is num ? v.toInt() : 0;

class Reel {
  const Reel({
    required this.id,
    required this.author,
    required this.videoUrl,
    required this.durationMs,
    this.caption,
    this.likeCount = 0,
    this.likedByMe = false,
    this.viewCount = 0,
    this.coinCount = 0,
    this.canGift = false,
    this.isMine = false,
  });

  final String id;
  final PersonRef author;
  final String? videoUrl;
  final int durationMs;
  final String? caption;
  final int likeCount;
  final bool likedByMe;
  final int viewCount;
  final int coinCount;
  final bool canGift;
  final bool isMine;

  Reel copyWith({int? likeCount, bool? likedByMe, int? coinCount, int? viewCount}) => Reel(
        id: id,
        author: author,
        videoUrl: videoUrl,
        durationMs: durationMs,
        caption: caption,
        likeCount: likeCount ?? this.likeCount,
        likedByMe: likedByMe ?? this.likedByMe,
        viewCount: viewCount ?? this.viewCount,
        coinCount: coinCount ?? this.coinCount,
        canGift: canGift,
        isMine: isMine,
      );

  factory Reel.fromJson(Map<String, dynamic> j) {
    final video = j['video'] is Map<String, dynamic> ? j['video'] as Map<String, dynamic> : const <String, dynamic>{};
    return Reel(
      id: (j['id'] ?? '') as String,
      author: PersonRef.fromJson(j['author'] as Map<String, dynamic>),
      videoUrl: video['url'] as String?,
      durationMs: _int(video['durationMs']),
      caption: j['caption'] as String?,
      likeCount: _int(j['likeCount']),
      likedByMe: (j['likedByMe'] ?? false) as bool,
      viewCount: _int(j['viewCount']),
      coinCount: _int(j['coinCount']),
      canGift: (j['canGift'] ?? false) as bool,
      isMine: (j['isMine'] ?? false) as bool,
    );
  }
}

class ReelsPage {
  const ReelsPage({required this.items, this.nextCursor});

  final List<Reel> items;
  final String? nextCursor;
}

class ReelsApi {
  ReelsApi(this._api);
  final ApiClient _api;

  Future<ReelsPage> feed({String? cursor}) async {
    final r = await _api.get('/v1/reels', query: {if (cursor != null) 'cursor': cursor});
    return ReelsPage(
      items: [for (final x in (r['items'] is List<dynamic> ? r['items'] as List<dynamic> : const <dynamic>[]).whereType<Map<String, dynamic>>()) Reel.fromJson(x)],
      nextCursor: r['nextCursor'] as String?,
    );
  }

  Future<Reel> upload(List<int> bytes, {String? caption, required String visibility}) async => Reel.fromJson(
        await _api.postForm(
          '/v1/reels',
          fields: {if (caption != null && caption.trim().isNotEmpty) 'caption': caption.trim(), 'visibility': visibility},
          fileField: 'video',
          bytes: bytes,
          filename: 'reel.mp4',
          contentType: 'video/mp4',
        ),
      );

  Future<({int likeCount, bool likedByMe})> like(String id, {required bool on}) async {
    final r = on ? await _api.put('/v1/reels/$id/like') : await _api.delete('/v1/reels/$id/like');
    return (likeCount: _int(r['likeCount']), likedByMe: (r['likedByMe'] ?? on) as bool);
  }

  Future<void> view(String id) => _api.post('/v1/reels/$id/view');

  Future<void> remove(String id) => _api.delete('/v1/reels/$id');
}

final reelsApiProvider = Provider<ReelsApi>((ref) => ReelsApi(ref.watch(apiClientProvider)));
final reelsFeedProvider = FutureProvider.autoDispose<ReelsPage>((ref) => ref.watch(reelsApiProvider).feed());

/// Choix d'une vidéo dans la galerie (remplaçable dans les tests).
abstract class VideoSource {
  Future<List<int>?> pick();
}

class DeviceVideoSource implements VideoSource {
  final _picker = ImagePicker();

  @override
  Future<List<int>?> pick() async {
    final file = await _picker.pickVideo(source: ImageSource.gallery, maxDuration: const Duration(seconds: 60));
    return file?.readAsBytes();
  }
}

final videoSourceProvider = Provider<VideoSource>((ref) => DeviceVideoSource());
