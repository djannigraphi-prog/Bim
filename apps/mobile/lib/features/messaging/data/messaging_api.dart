import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../social/data/social_models.dart' show PersonRef;

/// Lot 6-A — Messagerie entre personnes (écran 47). Pas de notification sur le téléphone (Firebase non activé) :
/// la pastille de l'onglet Messages et la conversation ouverte se mettent à jour régulièrement.

class ConversationSummary {
  const ConversationSummary({
    required this.id,
    required this.status,
    required this.pendingForOther,
    required this.person,
    required this.unread,
    this.lastPreview,
    this.lastFromMe = false,
    this.lastAt,
  });

  final String id;
  /// active · request (demande reçue, à accepter)
  final String status;
  /// Ma demande n'a pas encore été acceptée par l'autre personne.
  final bool pendingForOther;
  final PersonRef person;
  final int unread;
  final String? lastPreview;
  final bool lastFromMe;
  final DateTime? lastAt;

  bool get isRequest => status == 'request';

  factory ConversationSummary.fromJson(Map<String, dynamic> j) {
    final last = j['lastMessage'] as Map<String, dynamic>?;
    return ConversationSummary(
      id: j['id'] as String,
      status: j['status'] as String,
      pendingForOther: (j['pendingForOther'] ?? false) as bool,
      person: PersonRef.fromJson(j['person'] as Map<String, dynamic>),
      unread: (j['unread'] ?? 0) as int,
      lastPreview: last?['preview'] as String?,
      lastFromMe: (last?['senderIsMe'] ?? false) as bool,
      lastAt: last == null ? null : DateTime.parse(last['createdAt'] as String),
    );
  }
}

class ChatMessage {
  const ChatMessage({required this.id, required this.mine, required this.kind, required this.status, required this.createdAt, this.text, this.photoUrl, this.read});

  final String id;
  final bool mine;
  final String kind;
  /// published · deleted · hidden
  final String status;
  final DateTime createdAt;
  final String? text;
  final String? photoUrl;
  /// Mes messages : lus par l'autre personne.
  final bool? read;

  bool get visible => status == 'published';

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: j['id'] as String,
        mine: (j['senderIsMe'] ?? false) as bool,
        kind: j['kind'] as String,
        status: j['status'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        text: j['text'] as String?,
        photoUrl: j['photoUrl'] as String?,
        read: j['read'] as bool?,
      );
}

class MessagingApi {
  MessagingApi(this._api);
  final ApiClient _api;

  Future<({List<ConversationSummary> items, String? nextCursor})> conversations({bool requests = false, String? cursor}) async {
    final r = await _api.get('/v1/conversations', query: {'box': requests ? 'requests' : 'inbox', if (cursor != null) 'cursor': cursor});
    return (
      items: [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ConversationSummary.fromJson(c)],
      nextCursor: r['nextCursor'] as String?,
    );
  }

  Future<({int conversations, int requests})> unreadCount() async {
    final r = await _api.get('/v1/conversations/unread-count');
    return (conversations: (r['conversations'] ?? 0) as int, requests: (r['requests'] ?? 0) as int);
  }

  Future<ConversationSummary> conversation(String id) async => ConversationSummary.fromJson(await _api.get('/v1/conversations/$id'));

  Future<ConversationSummary> start(String username) async => ConversationSummary.fromJson(await _api.post('/v1/conversations', body: {'username': username}));

  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async {
    final r = await _api.get('/v1/conversations/$conversationId/messages', query: {if (before != null) 'before': before});
    return (
      items: [for (final m in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ChatMessage.fromJson(m)],
      nextBefore: r['nextBefore'] as String?,
    );
  }

  Future<ChatMessage> sendText(String conversationId, String text) async =>
      ChatMessage.fromJson(await _api.post('/v1/conversations/$conversationId/messages', body: {'text': text}));

  Future<ChatMessage> sendPhoto(String conversationId, List<int> bytes) async => ChatMessage.fromJson(
        await _api.upload('/v1/conversations/$conversationId/messages', field: 'photo', bytes: bytes, filename: 'photo.jpg', contentType: 'image/jpeg'),
      );

  Future<void> read(String conversationId) => _api.post('/v1/conversations/$conversationId/read');
  Future<void> accept(String conversationId) => _api.post('/v1/conversations/$conversationId/accept');
  Future<void> decline(String conversationId) => _api.post('/v1/conversations/$conversationId/decline');
  Future<void> deleteMessage(String id) => _api.delete('/v1/messages/$id');
}

final messagingApiProvider = Provider<MessagingApi>((ref) => MessagingApi(ref.watch(apiClientProvider)));
final conversationsProvider = FutureProvider.autoDispose.family<({List<ConversationSummary> items, String? nextCursor}), bool>(
  (ref, requests) => ref.watch(messagingApiProvider).conversations(requests: requests),
);
final messagesUnreadProvider = FutureProvider.autoDispose<({int conversations, int requests})>((ref) => ref.watch(messagingApiProvider).unreadCount());
