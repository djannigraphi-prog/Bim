import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Lot 10 (prototype) — Lives sans service vidéo : programmation, lancement, commentaires, cœurs, cadeaux, article
/// épinglé. Le temps réel passe par une lecture régulière de l'état ; toutes les règles sont appliquées par l'API.

int _int(Object? v) => v is num ? v.toInt() : 0;
DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<Map<String, dynamic>> _list(Object? v) => v is List<dynamic> ? v.whereType<Map<String, dynamic>>().toList() : const [];

class PinnedProduct {
  const PinnedProduct({required this.id, required this.title, required this.priceFcfa, this.promoPriceFcfa});

  final String id;
  final String title;
  final int priceFcfa;
  final int? promoPriceFcfa;

  int get displayPrice => promoPriceFcfa ?? priceFcfa;
}

class LiveSummary {
  const LiveSummary({
    required this.id,
    required this.kind,
    required this.title,
    required this.status,
    required this.hostName,
    required this.hostUsername,
    this.scheduledAt,
    this.startedAt,
    this.shopName,
    this.shopSlug,
    this.pinnedProduct,
    this.heartCount = 0,
    this.coinCount = 0,
    this.viewers = 0,
    this.isMine = false,
    this.canGift = false,
  });

  final String id;

  /// simple · sale
  final String kind;
  final String title;

  /// scheduled · live · ended
  final String status;
  final String hostName;
  final String hostUsername;
  final DateTime? scheduledAt;
  final DateTime? startedAt;
  final String? shopName;
  final String? shopSlug;
  final PinnedProduct? pinnedProduct;
  final int heartCount;
  final int coinCount;
  final int viewers;
  final bool isMine;
  final bool canGift;

  bool get isLive => status == 'live';
  bool get isSale => kind == 'sale';

  /// Nom affiché : la boutique pour un Live vente, sinon la personne.
  String get displayName => shopName ?? hostName;

  LiveSummary copyWith({int? heartCount}) => LiveSummary(
        id: id,
        kind: kind,
        title: title,
        status: status,
        hostName: hostName,
        hostUsername: hostUsername,
        scheduledAt: scheduledAt,
        startedAt: startedAt,
        shopName: shopName,
        shopSlug: shopSlug,
        pinnedProduct: pinnedProduct,
        heartCount: heartCount ?? this.heartCount,
        coinCount: coinCount,
        viewers: viewers,
        isMine: isMine,
        canGift: canGift,
      );

  factory LiveSummary.fromJson(Map<String, dynamic> j) {
    final host = _map(j['host']);
    final shop = j['shop'] is Map<String, dynamic> ? j['shop'] as Map<String, dynamic> : null;
    final p = j['pinnedProduct'] is Map<String, dynamic> ? j['pinnedProduct'] as Map<String, dynamic> : null;
    return LiveSummary(
      id: (j['id'] ?? '') as String,
      kind: (j['kind'] ?? 'simple') as String,
      title: (j['title'] ?? '') as String,
      status: (j['status'] ?? 'ended') as String,
      hostName: (host['fullName'] ?? '') as String,
      hostUsername: (host['username'] ?? '') as String,
      scheduledAt: _date(j['scheduledAt']),
      startedAt: _date(j['startedAt']),
      shopName: shop?['name'] as String?,
      shopSlug: shop?['slug'] as String?,
      pinnedProduct: p == null
          ? null
          : PinnedProduct(id: (p['id'] ?? '') as String, title: (p['title'] ?? '') as String, priceFcfa: _int(p['priceFcfa']), promoPriceFcfa: p['promoPriceFcfa'] is num ? _int(p['promoPriceFcfa']) : null),
      heartCount: _int(j['heartCount']),
      coinCount: _int(j['coinCount']),
      viewers: _int(j['viewers']),
      isMine: (j['isMine'] ?? false) as bool,
      canGift: (j['canGift'] ?? false) as bool,
    );
  }
}

class LiveComment {
  const LiveComment({required this.id, required this.text, required this.author});

  final String id;
  final String text;
  final String author;
}

class LiveGiftEvent {
  const LiveGiftEvent({required this.id, required this.giftCode, required this.coins, this.from});

  final String id;
  final String giftCode;
  final int coins;

  /// null : envoi anonyme.
  final String? from;
}

class LiveState {
  const LiveState({required this.live, required this.comments, required this.gifts, required this.pollSeconds, this.nextAfter, this.nextGiftsAfter});

  final LiveSummary live;
  final List<LiveComment> comments;
  final List<LiveGiftEvent> gifts;
  final int pollSeconds;
  final String? nextAfter;
  final String? nextGiftsAfter;

  factory LiveState.fromJson(Map<String, dynamic> j) => LiveState(
        live: LiveSummary.fromJson(_map(j['live'])),
        comments: [
          for (final c in _list(j['comments'])) LiveComment(id: (c['id'] ?? '') as String, text: (c['text'] ?? '') as String, author: (_map(c['user'])['fullName'] ?? '') as String),
        ],
        gifts: [
          for (final g in _list(j['gifts'])) LiveGiftEvent(id: (g['id'] ?? '') as String, giftCode: (g['giftCode'] ?? '') as String, coins: _int(g['coins']), from: g['from'] as String?),
        ],
        pollSeconds: _int(j['pollSeconds']) == 0 ? 3 : _int(j['pollSeconds']),
        nextAfter: j['nextAfter'] as String?,
        nextGiftsAfter: j['nextGiftsAfter'] as String?,
      );
}

class LivesList {
  const LivesList({required this.available, required this.live, required this.upcoming});

  final bool available;
  final List<LiveSummary> live;
  final List<LiveSummary> upcoming;
}

class LivesApi {
  LivesApi(this._api);
  final ApiClient _api;

  Future<LivesList> list() async {
    final r = await _api.get('/v1/lives');
    return LivesList(
      available: (r['available'] ?? false) as bool,
      live: [for (final l in _list(r['live'])) LiveSummary.fromJson(l)],
      upcoming: [for (final l in _list(r['upcoming'])) LiveSummary.fromJson(l)],
    );
  }

  /// Live simple (personne) ou, avec [asShop], Live vente de la boutique active (article épinglé facultatif).
  Future<LiveSummary> create({required String title, DateTime? scheduledAt, bool asShop = false, String? productId}) async => LiveSummary.fromJson(
        await _api.post(
          asShop ? '/v1/shop/lives' : '/v1/lives',
          body: {'title': title, if (scheduledAt != null) 'scheduledAt': scheduledAt.toUtc().toIso8601String(), if (asShop && productId != null) 'productId': productId},
        ),
      );

  Future<LiveSummary> start(String id) async => LiveSummary.fromJson(await _api.post('/v1/lives/$id/start'));

  Future<LiveSummary> end(String id) async => LiveSummary.fromJson(await _api.post('/v1/lives/$id/end'));

  Future<LiveState> state(String id, {String? after, String? giftsAfter}) async =>
      LiveState.fromJson(await _api.get('/v1/lives/$id/state', query: {if (after != null) 'after': after, if (giftsAfter != null) 'giftsAfter': giftsAfter}));

  Future<void> comment(String id, String text) => _api.post('/v1/lives/$id/comments', body: {'text': text});

  Future<int> hearts(String id, int count) async => _int((await _api.post('/v1/lives/$id/hearts', body: {'count': count}))['heartCount']);
}

final livesApiProvider = Provider<LivesApi>((ref) => LivesApi(ref.watch(apiClientProvider)));
final livesListProvider = FutureProvider.autoDispose<LivesList>((ref) => ref.watch(livesApiProvider).list());
