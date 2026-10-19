import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../bimshop/data/bimshop_api.dart' show ShopCard;
import '../../social/data/social_models.dart' show PersonRef;

/// Lot 6-A — Messagerie entre personnes (écran 47). Pas de notification sur le téléphone (Firebase non activé) :
/// la pastille de l'onglet Messages et la conversation ouverte se mettent à jour régulièrement.

/// Boutique dans une conversation (6-B).
class ChatShop {
  const ChatShop({required this.id, required this.name, required this.slug, this.logoUrl, this.verified = false, this.certified = false});

  final String id;
  final String name;
  final String slug;
  final String? logoUrl;
  final bool verified;

  /// V1-1910-C : badge de certification (propriétaire Premium).
  final bool certified;

  factory ChatShop.fromJson(Map<String, dynamic> j) => ChatShop(
        id: j['id'] as String,
        name: (j['name'] ?? '') as String,
        slug: (j['slug'] ?? '') as String,
        logoUrl: j['logoUrl'] as String?,
        verified: (j['verified'] ?? false) as bool,
        certified: (j['certified'] ?? false) as bool,
      );
}

/// Ce dont on parle (bandeau de l'écran 48) : un article (disponible ou non, jamais le stock) ou une offre de projet.
class ChatContext {
  const ChatContext({this.product, this.offerId, this.offerProjectTitle});

  final ShopCard? product;
  final String? offerId;
  final String? offerProjectTitle;

  static ChatContext? fromJson(Map<String, dynamic>? j) {
    if (j == null) return null;
    final p = j['product'] as Map<String, dynamic>?;
    final o = j['offer'] as Map<String, dynamic>?;
    if (p == null && o == null) return null;
    return ChatContext(product: p == null ? null : ShopCard.fromJson(p), offerId: o?['id'] as String?, offerProjectTitle: o?['projectTitle'] as String?);
  }
}

class ConversationSummary {
  const ConversationSummary({
    required this.id,
    required this.status,
    required this.pendingForOther,
    required this.unread,
    this.kind = 'direct',
    this.person,
    this.shop,
    this.context,
    this.archived = false,
    this.marked = false,
    this.lastPreview,
    this.lastFromMe = false,
    this.lastAt,
    this.groupTitle,
    this.memberCount = 0,
    this.myRole,
  });

  final String id;
  /// direct (avec une personne) · shop (avec une boutique, 6-B)
  final String kind;
  /// active · request (demande reçue, à accepter)
  final String status;
  /// Ma demande n'a pas encore été acceptée par l'autre personne.
  final bool pendingForOther;
  /// L'autre personne ; côté boutique, la cliente. Absente quand je parle à une boutique.
  final PersonRef? person;
  /// La boutique, quand je lui écris (côté cliente).
  final ChatShop? shop;
  final ChatContext? context;
  /// Côté boutique : rangée dans « Archivés », marquée.
  final bool archived;
  final bool marked;
  final int unread;
  final String? lastPreview;
  final bool lastFromMe;
  final DateTime? lastAt;
  /// V1 : groupe (nom, membres actifs, mon rôle : admin ou member).
  final String? groupTitle;
  final int memberCount;
  final String? myRole;

  bool get isRequest => status == 'request';
  bool get withShop => kind == 'shop';
  bool get isGroup => kind == 'group';
  bool get isGroupAdmin => isGroup && myRole == 'admin';
  String get title => groupTitle ?? shop?.name ?? person?.fullName ?? '';
  String get subtitle => isGroup ? '$memberCount membre${memberCount > 1 ? 's' : ''}' : (shop != null ? 'Boutique' : '@${person?.username ?? ''}');

  factory ConversationSummary.fromJson(Map<String, dynamic> j) {
    final last = j['lastMessage'] as Map<String, dynamic>?;
    final person = j['person'] as Map<String, dynamic>?;
    final shop = j['shop'] as Map<String, dynamic>?;
    final group = j['group'] as Map<String, dynamic>?;
    return ConversationSummary(
      groupTitle: group?['title'] as String?,
      memberCount: (group?['memberCount'] ?? 0) as int,
      myRole: group?['myRole'] as String?,
      id: j['id'] as String,
      kind: (j['kind'] ?? 'direct') as String,
      status: (j['status'] ?? 'active') as String,
      pendingForOther: (j['pendingForOther'] ?? false) as bool,
      person: person == null ? null : PersonRef.fromJson(person),
      shop: shop == null ? null : ChatShop.fromJson(shop),
      context: ChatContext.fromJson(j['context'] as Map<String, dynamic>?),
      archived: (j['archived'] ?? false) as bool,
      marked: (j['marked'] ?? false) as bool,
      unread: (j['unread'] ?? 0) as int,
      lastPreview: last?['preview'] as String?,
      lastFromMe: (last?['senderIsMe'] ?? false) as bool,
      lastAt: last == null ? null : DateTime.parse(last['createdAt'] as String),
    );
  }
}

/// 7-B : carte d'une proposition de commande dans la conversation (l'état réel se lit dans la commande).
class OrderCard {
  const OrderCard({required this.id, required this.number, required this.status, required this.itemsTotalFcfa, this.title});
  final String id;
  final String number;
  final String status;
  final int itemsTotalFcfa;
  final String? title;
  factory OrderCard.fromJson(Map<String, dynamic> j) =>
      OrderCard(id: j['id'] as String, number: j['number'] as String, status: j['status'] as String, itemsTotalFcfa: j['itemsTotalFcfa'] as int, title: j['title'] as String?);
}

/// V1 — Membre d'un groupe : administrateur ou membre ; invité tant qu'il n'a pas accepté.
class GroupMember {
  const GroupMember({required this.username, required this.fullName, required this.role, this.avatarUrl, this.invited = false, this.isMe = false});
  final String username;
  final String fullName;
  final String role;
  final String? avatarUrl;
  final bool invited;
  final bool isMe;
  bool get isAdmin => role == 'admin';
  factory GroupMember.fromJson(Map<String, dynamic> j) => GroupMember(
        username: j['username'] as String,
        fullName: (j['fullName'] ?? '') as String,
        role: (j['role'] ?? 'member') as String,
        avatarUrl: j['avatarUrl'] as String?,
        invited: (j['invited'] ?? false) as bool,
        isMe: (j['isMe'] ?? false) as bool,
      );
}

/// 6-C — Réactions proposées (liste fermée, la même que celle du serveur).
const messageReactions = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

/// 6-C — Message cité dans une réponse : aperçu actuel (« Message supprimé » si l'original l'est).
class QuotedMessage {
  const QuotedMessage({required this.id, required this.mine, required this.preview, this.status = 'published'});
  final String id;
  final bool mine;
  final String preview;
  final String status;
  factory QuotedMessage.fromJson(Map<String, dynamic> j) =>
      QuotedMessage(id: j['id'] as String, mine: (j['senderIsMe'] ?? false) as bool, preview: (j['preview'] ?? '') as String, status: (j['status'] ?? 'published') as String);
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.mine,
    required this.kind,
    required this.status,
    required this.createdAt,
    this.text,
    this.photoUrl,
    this.read,
    this.order,
    this.replyTo,
    this.reactions = const [],
    this.myReaction,
    this.voiceUrl,
    this.durationMs,
    this.senderName,
    this.senderUsername,
    this.blockedSender = false,
    this.product,
  });

  final String id;
  final bool mine;
  /// text · photo · order · voice (V1) · system (V1 : groupe)
  final String kind;
  /// published · deleted · hidden
  final String status;
  final DateTime createdAt;
  final String? text;
  final String? photoUrl;
  /// Mes messages : lus par l'autre personne.
  final bool? read;
  final OrderCard? order;
  /// 6-C : message cité.
  final QuotedMessage? replyTo;
  /// 6-C : réactions par émoji (ordre de la liste) et la mienne (ou celle de ma boutique).
  final List<({String emoji, int count})> reactions;
  final String? myReaction;
  /// V1 : message vocal (lien temporaire) et sa durée.
  final String? voiceUrl;
  final int? durationMs;
  /// V1 : groupe — auteur d'un message reçu ; message d'une personne bloquée (non affiché).
  final String? senderName;
  final String? senderUsername;
  final bool blockedSender;

  /// V1 : article partagé (null s'il n'est plus en ligne).
  final ShopCard? product;

  bool get visible => status == 'published' && !blockedSender;
  bool get isSystem => kind == 'system';
  /// Types connus de cette version. Les types à venir s'affichent avec un texte neutre au lieu d'une bulle vide.
  bool get supported => kind == 'text' || kind == 'photo' || kind == 'voice' || kind == 'system' || kind == 'product' || (kind == 'order' && order != null);

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: j['id'] as String,
        mine: (j['senderIsMe'] ?? false) as bool,
        kind: j['kind'] as String,
        status: j['status'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        text: j['text'] as String?,
        photoUrl: j['photoUrl'] as String?,
        read: j['read'] as bool?,
        order: j['order'] == null ? null : OrderCard.fromJson(j['order'] as Map<String, dynamic>),
        replyTo: j['replyTo'] == null ? null : QuotedMessage.fromJson(j['replyTo'] as Map<String, dynamic>),
        reactions: [
          for (final r in ((j['reactions'] as Map<String, dynamic>?)?['items'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>()) (emoji: r['emoji'] as String, count: r['count'] as int),
        ],
        myReaction: (j['reactions'] as Map<String, dynamic>?)?['mine'] as String?,
        voiceUrl: j['voiceUrl'] as String?,
        durationMs: j['durationMs'] as int?,
        senderName: (j['sender'] as Map<String, dynamic>?)?['fullName'] as String?,
        senderUsername: (j['sender'] as Map<String, dynamic>?)?['username'] as String?,
        blockedSender: (j['blockedSender'] ?? false) as bool,
        product: j['product'] == null ? null : ShopCard.fromJson(j['product'] as Map<String, dynamic>),
      );

  /// Aperçu court (bandeau « Réponse à »).
  String get preview => switch (status) {
        'deleted' => 'Message supprimé',
        'hidden' => 'Message masqué par la modération',
        _ => switch (kind) {
            'photo' => 'Photo',
            'voice' => 'Message vocal',
            'order' => 'Proposition de commande',
            'product' => 'Article partagé',
            _ => text ?? '',
          },
      };
}

/// Opérations d'une conversation ouverte : côté personne (6-A, et cliente d'une boutique) ou côté boutique (6-B).
abstract class ConversationBackend {
  Future<ConversationSummary> conversation(String id);
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before});
  Future<ChatMessage> sendText(String conversationId, String text, {String? replyToId});
  Future<ChatMessage> sendPhoto(String conversationId, List<int> bytes);
  /// V1 : message vocal (M4A, 2 minutes au plus).
  Future<ChatMessage> sendVoice(String conversationId, List<int> bytes);
  Future<void> read(String conversationId);
  Future<void> deleteMessage(String id);
  /// 6-C : poser ou changer (`emoji`) ou retirer (`null`) ma réaction ; renvoie le message à jour.
  Future<ChatMessage> react(String messageId, String? emoji);
}

class MessagingApi implements ConversationBackend {
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

  @override
  Future<ConversationSummary> conversation(String id) async => ConversationSummary.fromJson(await _api.get('/v1/conversations/$id'));

  Future<ConversationSummary> start(String username) async => ConversationSummary.fromJson(await _api.post('/v1/conversations', body: {'username': username}));

  /// 6-B — « Discuter » avec une boutique, depuis un article, une offre ou son profil.
  Future<ConversationSummary> startWithShop(String shopSlug, {String? productId, String? offerId}) async => ConversationSummary.fromJson(
        await _api.post('/v1/conversations/shop', body: {'shopSlug': shopSlug, if (productId != null) 'productId': productId, if (offerId != null) 'offerId': offerId}),
      );

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async {
    final r = await _api.get('/v1/conversations/$conversationId/messages', query: {if (before != null) 'before': before});
    return (
      items: [for (final m in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ChatMessage.fromJson(m)],
      nextBefore: r['nextBefore'] as String?,
    );
  }

  @override
  Future<ChatMessage> sendText(String conversationId, String text, {String? replyToId}) async =>
      ChatMessage.fromJson(await _api.post('/v1/conversations/$conversationId/messages', body: {'text': text, if (replyToId != null) 'replyToId': replyToId}));

  /// V1 : partager un article du BimShop dans une conversation (carte cliquable).
  Future<ChatMessage> sendProduct(String conversationId, String productId) async =>
      ChatMessage.fromJson(await _api.post('/v1/conversations/$conversationId/messages', body: {'productId': productId}));

  @override
  Future<ChatMessage> react(String messageId, String? emoji) async => ChatMessage.fromJson(
        emoji == null ? await _api.delete('/v1/messages/$messageId/reaction') : await _api.put('/v1/messages/$messageId/reaction', body: {'emoji': emoji}),
      );

  @override
  Future<ChatMessage> sendPhoto(String conversationId, List<int> bytes) async => ChatMessage.fromJson(
        await _api.upload('/v1/conversations/$conversationId/messages', field: 'photo', bytes: bytes, filename: 'photo.jpg', contentType: 'image/jpeg'),
      );

  @override
  Future<ChatMessage> sendVoice(String conversationId, List<int> bytes) async => ChatMessage.fromJson(
        await _api.upload('/v1/conversations/$conversationId/messages', field: 'voice', bytes: bytes, filename: 'vocal.m4a', contentType: 'audio/mp4'),
      );

  // ---------------------------------------------------------------- Groupes (V1)

  /// Créer un groupe (18 ans et plus) ; renvoie aussi les personnes non ajoutées (sans motif).
  Future<({ConversationSummary conversation, List<String> notAdded})> createGroup(String title, List<String> usernames) async {
    final r = await _api.post('/v1/conversations/groups', body: {'title': title, 'usernames': usernames});
    return (conversation: ConversationSummary.fromJson(r['conversation'] as Map<String, dynamic>), notAdded: (r['notAdded'] as List<dynamic>).cast<String>());
  }

  Future<({List<GroupMember> items, String myRole, int maxMembers})> groupMembers(String id) async {
    final r = await _api.get('/v1/conversations/$id/members');
    return (
      items: [for (final m in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) GroupMember.fromJson(m)],
      myRole: (r['myRole'] ?? 'member') as String,
      maxMembers: (r['maxMembers'] ?? 32) as int,
    );
  }

  Future<List<String>> addGroupMembers(String id, List<String> usernames) async {
    final r = await _api.post('/v1/conversations/$id/members', body: {'usernames': usernames});
    return (r['notAdded'] as List<dynamic>).cast<String>();
  }

  Future<void> removeGroupMember(String id, String username) => _api.delete('/v1/conversations/$id/members/${Uri.encodeComponent(username)}');
  Future<void> leaveGroup(String id) => _api.post('/v1/conversations/$id/leave');
  Future<void> renameGroup(String id, String title) => _api.patch('/v1/conversations/$id', body: {'title': title});

  @override
  Future<void> read(String conversationId) => _api.post('/v1/conversations/$conversationId/read');
  Future<void> accept(String conversationId) => _api.post('/v1/conversations/$conversationId/accept');
  Future<void> decline(String conversationId) => _api.post('/v1/conversations/$conversationId/decline');
  @override
  Future<void> deleteMessage(String id) => _api.delete('/v1/messages/$id');
}

/// Lot 6-B — Boîte de la boutique (écran 51), depuis l'espace boutique. La boutique ne démarche personne : elle
/// répond aux conversations ouvertes par ses clientes.
class ShopInboxApi implements ConversationBackend {
  ShopInboxApi(this._api);
  final ApiClient _api;

  /// box : all · unread · archived · marked
  Future<({List<ConversationSummary> items, String? nextCursor})> conversations({String box = 'all', String? cursor}) async {
    final r = await _api.get('/v1/shop/inbox', query: {'box': box, if (cursor != null) 'cursor': cursor});
    return (
      items: [for (final c in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ConversationSummary.fromJson(c)],
      nextCursor: r['nextCursor'] as String?,
    );
  }

  Future<({int unread, int all})> unreadCount() async {
    final r = await _api.get('/v1/shop/inbox/unread-count');
    return (unread: (r['unread'] ?? 0) as int, all: (r['all'] ?? 0) as int);
  }

  @override
  Future<ConversationSummary> conversation(String id) async => ConversationSummary.fromJson(await _api.get('/v1/shop/inbox/$id'));

  @override
  Future<({List<ChatMessage> items, String? nextBefore})> messages(String conversationId, {String? before}) async {
    final r = await _api.get('/v1/shop/inbox/$conversationId/messages', query: {if (before != null) 'before': before});
    return (
      items: [for (final m in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) ChatMessage.fromJson(m)],
      nextBefore: r['nextBefore'] as String?,
    );
  }

  @override
  Future<ChatMessage> sendText(String conversationId, String text, {String? replyToId}) async =>
      ChatMessage.fromJson(await _api.post('/v1/shop/inbox/$conversationId/messages', body: {'text': text, if (replyToId != null) 'replyToId': replyToId}));

  @override
  Future<ChatMessage> react(String messageId, String? emoji) async => ChatMessage.fromJson(
        emoji == null ? await _api.delete('/v1/shop/inbox/messages/$messageId/reaction') : await _api.put('/v1/shop/inbox/messages/$messageId/reaction', body: {'emoji': emoji}),
      );

  @override
  Future<ChatMessage> sendPhoto(String conversationId, List<int> bytes) async => ChatMessage.fromJson(
        await _api.upload('/v1/shop/inbox/$conversationId/messages', field: 'photo', bytes: bytes, filename: 'photo.jpg', contentType: 'image/jpeg'),
      );

  @override
  Future<ChatMessage> sendVoice(String conversationId, List<int> bytes) async => ChatMessage.fromJson(
        await _api.upload('/v1/shop/inbox/$conversationId/messages', field: 'voice', bytes: bytes, filename: 'vocal.m4a', contentType: 'audio/mp4'),
      );

  @override
  Future<void> read(String conversationId) => _api.post('/v1/shop/inbox/$conversationId/read');

  @override
  Future<void> deleteMessage(String id) => _api.delete('/v1/shop/inbox/messages/$id');

  Future<ConversationSummary> setArchived(String id, bool on) async =>
      ConversationSummary.fromJson(on ? await _api.put('/v1/shop/inbox/$id/archive') : await _api.delete('/v1/shop/inbox/$id/archive'));

  Future<ConversationSummary> setMarked(String id, bool on) async =>
      ConversationSummary.fromJson(on ? await _api.put('/v1/shop/inbox/$id/mark') : await _api.delete('/v1/shop/inbox/$id/mark'));

  Future<List<({String id, String text})>> quickReplies() async {
    final r = await _api.get('/v1/shop/inbox/quick-replies');
    return [for (final q in (r['items'] as List<dynamic>).cast<Map<String, dynamic>>()) (id: q['id'] as String, text: q['text'] as String)];
  }

  Future<void> addQuickReply(String text) => _api.post('/v1/shop/inbox/quick-replies', body: {'text': text});
  Future<void> removeQuickReply(String id) => _api.delete('/v1/shop/inbox/quick-replies/$id');
}

final messagingApiProvider = Provider<MessagingApi>((ref) => MessagingApi(ref.watch(apiClientProvider)));
final conversationsProvider = FutureProvider.autoDispose.family<({List<ConversationSummary> items, String? nextCursor}), bool>(
  (ref, requests) => ref.watch(messagingApiProvider).conversations(requests: requests),
);
final shopInboxApiProvider = Provider<ShopInboxApi>((ref) => ShopInboxApi(ref.watch(apiClientProvider)));
final shopInboxProvider = FutureProvider.autoDispose.family<({List<ConversationSummary> items, String? nextCursor}), String>(
  (ref, box) => ref.watch(shopInboxApiProvider).conversations(box: box),
);
final shopInboxUnreadProvider = FutureProvider.autoDispose<({int unread, int all})>((ref) => ref.watch(shopInboxApiProvider).unreadCount());
final shopQuickRepliesProvider = FutureProvider.autoDispose<List<({String id, String text})>>((ref) => ref.watch(shopInboxApiProvider).quickReplies());
final messagesUnreadProvider = FutureProvider.autoDispose<({int conversations, int requests})>((ref) => ref.watch(messagingApiProvider).unreadCount());
