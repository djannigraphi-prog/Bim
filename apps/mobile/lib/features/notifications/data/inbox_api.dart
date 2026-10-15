import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Une notification du centre de notifications (écran 17), texte produit par l'API.
class InboxItem {
  const InboxItem({
    required this.id,
    required this.type,
    required this.category,
    required this.sender,
    required this.text,
    required this.at,
    required this.unread,
    required this.link,
  });

  final String id;

  /// chest_opened, report_answered, task_reminder.
  final String type;

  /// projects ou support.
  final String category;

  /// peni ou bim.
  final String sender;
  final String text;
  final DateTime at;
  final bool unread;

  /// Écran de l'app à ouvrir (ex. « /projects/… »), ou null.
  final String? link;

  factory InboxItem.fromJson(Map<String, dynamic> j) => InboxItem(
        id: j['id'] as String,
        type: j['type'] as String,
        category: j['category'] as String,
        sender: j['sender'] as String,
        text: j['text'] as String,
        at: DateTime.parse(j['at'] as String),
        unread: j['unread'] == true,
        link: j['link'] as String?,
      );
}

class InboxPage {
  const InboxPage({required this.items, required this.nextBefore});
  final List<InboxItem> items;

  /// Curseur de la page suivante (null = fin).
  final String? nextBefore;

  factory InboxPage.fromJson(Map<String, dynamic> j) => InboxPage(
        items: [for (final i in (j['items'] as List<dynamic>? ?? const [])) InboxItem.fromJson(i as Map<String, dynamic>)],
        nextBefore: j['nextBefore'] as String?,
      );
}

class InboxApi {
  InboxApi(this._api);
  final ApiClient _api;

  /// [category] : null = Tout, « projects » = Projets.
  Future<InboxPage> page({String? category, String? before}) async => InboxPage.fromJson(
        await _api.get('/v1/me/notifications', query: {if (category != null) 'category': category, if (before != null) 'before': before}),
      );

  Future<int> unreadCount() async => ((await _api.get('/v1/me/notifications/unread-count'))['count'] as num?)?.toInt() ?? 0;

  Future<void> markSeen() => _api.post('/v1/me/notifications/seen');
}

final inboxApiProvider = Provider<InboxApi>((ref) => InboxApi(ref.watch(apiClientProvider)));

/// Pastille de la cloche (écran d'accueil) : nombre de notifications pas encore vues.
final inboxUnreadProvider = FutureProvider.autoDispose<int>((ref) => ref.watch(inboxApiProvider).unreadCount());
