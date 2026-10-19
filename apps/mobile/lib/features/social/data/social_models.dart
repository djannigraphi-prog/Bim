/// Modèles du social (lot 4). Lecture tolérante : un champ absent ne fait pas planter l'écran.
library;

class PersonRef {
  const PersonRef({required this.id, required this.username, required this.fullName, this.avatarUrl, this.certified = false});

  final String id;
  final String username;
  final String fullName;
  final String? avatarUrl;

  /// V1-1910-C : compte Premium, badge de certification.
  final bool certified;

  factory PersonRef.fromJson(Map<String, dynamic> j) => PersonRef(
        id: j['id'] as String,
        username: (j['username'] ?? '') as String,
        fullName: (j['fullName'] ?? '') as String,
        avatarUrl: j['avatarUrl'] as String?,
        certified: (j['certified'] ?? false) as bool,
      );

  /// Initiales affichées quand la personne n'a pas de photo.
  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return username.isEmpty ? '?' : username[0].toUpperCase();
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }
}

class PostMedia {
  const PostMedia({required this.id, required this.kind, required this.width, required this.height, this.url, this.takenDay});

  final String id;

  /// image · before · after
  final String kind;
  final int width;
  final int height;
  final String? url;
  final String? takenDay;

  factory PostMedia.fromJson(Map<String, dynamic> j) => PostMedia(
        id: j['id'] as String,
        kind: (j['kind'] ?? 'image') as String,
        width: (j['width'] ?? 1) as int,
        height: (j['height'] ?? 1) as int,
        url: j['url'] as String?,
        takenDay: j['takenDay'] as String?,
      );
}

/// Résumé du parcours d'un « J'ai fait mon BIM » (figé à la publication, rien de privé).
class Journey {
  const Journey({this.category, this.goal, this.days, this.stepsDone});

  final String? category;
  final String? goal;
  final int? days;
  final int? stepsDone;

  factory Journey.fromJson(Map<String, dynamic> j) =>
      Journey(category: j['category'] as String?, goal: j['goal'] as String?, days: j['days'] as int?, stepsDone: j['stepsDone'] as int?);

  /// « Sport · Abdos »
  String get subject => [category, goal].whereType<String>().where((s) => s.isNotEmpty).join(' · ');

  /// « 30 jours · 24 étapes validées »
  String get summary => [
        if (days != null) '$days jours',
        if (stepsDone != null) '$stepsDone étape${stepsDone == 1 ? '' : 's'} validée${stepsDone == 1 ? '' : 's'}',
      ].join(' · ');
}

/// 5-E — « Produits et services utilisés » (écran 11) : lien vers la fiche du BimShop, jamais d'achat (règle E2).
class UsedProduct {
  const UsedProduct({required this.id, required this.title, required this.shopName, this.kind = 'product', this.imageUrl, this.available = true});
  final String id;
  final String kind;
  final String title;
  final String shopName;
  final String? imageUrl;
  final bool available;
  factory UsedProduct.fromJson(Map<String, dynamic> j) => UsedProduct(
        id: j['id'] as String,
        kind: (j['kind'] ?? 'product') as String,
        title: j['title'] as String,
        shopName: ((j['shop'] as Map<String, dynamic>?)?['name'] ?? '') as String,
        imageUrl: j['imageUrl'] as String?,
        available: (j['available'] ?? true) as bool,
      );
}

class FeedPost {
  const FeedPost({
    required this.id,
    required this.kind,
    required this.visibility,
    required this.createdAt,
    required this.author,
    required this.media,
    required this.likeCount,
    required this.commentCount,
    required this.likedByMe,
    required this.isMine,
    required this.followingAuthor,
    this.text,
    this.journey,
    this.usedProducts = const [],
    this.coinCount = 0,
    this.canGift = false,
  });

  final String id;

  /// post · bim
  final String kind;
  final String? text;

  /// public · followers · private
  final String visibility;
  final DateTime createdAt;
  final PersonRef author;
  final List<PostMedia> media;
  final Journey? journey;
  final int likeCount;
  final int commentCount;
  final bool likedByMe;
  final bool isMine;
  final bool followingAuthor;
  /// 5-E : fiches associées, seulement dans le détail (les fils n'en contiennent pas).
  final List<UsedProduct> usedProducts;

  /// Lot 9 : pièces reçues ; « Encourager » possible (auteur Premium, pas moi, mode démonstration).
  final int coinCount;
  final bool canGift;

  bool get isBim => kind == 'bim';
  PostMedia? get before => media.where((m) => m.kind == 'before').firstOrNull;
  PostMedia? get after => media.where((m) => m.kind == 'after').firstOrNull;

  FeedPost copyWith({int? likeCount, bool? likedByMe, int? commentCount, bool? followingAuthor, int? coinCount}) => FeedPost(
        id: id,
        kind: kind,
        text: text,
        visibility: visibility,
        createdAt: createdAt,
        author: author,
        media: media,
        journey: journey,
        likeCount: likeCount ?? this.likeCount,
        commentCount: commentCount ?? this.commentCount,
        likedByMe: likedByMe ?? this.likedByMe,
        isMine: isMine,
        followingAuthor: followingAuthor ?? this.followingAuthor,
        usedProducts: usedProducts,
        coinCount: coinCount ?? this.coinCount,
        canGift: canGift,
      );

  factory FeedPost.fromJson(Map<String, dynamic> j) => FeedPost(
        id: j['id'] as String,
        kind: (j['kind'] ?? 'post') as String,
        text: j['text'] as String?,
        visibility: (j['visibility'] ?? 'public') as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        author: PersonRef.fromJson(j['author'] as Map<String, dynamic>),
        media: ((j['media'] ?? const <dynamic>[]) as List<dynamic>).map((e) => PostMedia.fromJson(e as Map<String, dynamic>)).toList(),
        journey: j['journey'] is Map<String, dynamic> ? Journey.fromJson(j['journey'] as Map<String, dynamic>) : null,
        likeCount: (j['likeCount'] ?? 0) as int,
        commentCount: (j['commentCount'] ?? 0) as int,
        likedByMe: (j['likedByMe'] ?? false) as bool,
        isMine: (j['isMine'] ?? false) as bool,
        followingAuthor: (j['followingAuthor'] ?? false) as bool,
        usedProducts: [for (final u in ((j['usedProducts'] ?? const <dynamic>[]) as List<dynamic>).cast<Map<String, dynamic>>()) UsedProduct.fromJson(u)],
        coinCount: (j['coinCount'] ?? 0) as int,
        canGift: (j['canGift'] ?? false) as bool,
      );
}

class FeedPage {
  const FeedPage({required this.items, this.nextCursor});

  final List<FeedPost> items;
  final String? nextCursor;

  factory FeedPage.fromJson(Map<String, dynamic> j) => FeedPage(
        items: ((j['items'] ?? const <dynamic>[]) as List<dynamic>).map((e) => FeedPost.fromJson(e as Map<String, dynamic>)).toList(),
        nextCursor: j['nextCursor'] as String?,
      );
}

class PostComment {
  const PostComment({
    required this.id,
    required this.text,
    required this.createdAt,
    required this.author,
    required this.likeCount,
    required this.likedByMe,
    required this.canDelete,
    required this.isMine,
    this.parentId,
    this.coinCount = 0,
    this.canGift = false,
  });

  final String id;
  final String? parentId;
  final String text;
  final DateTime createdAt;
  final PersonRef author;
  final int likeCount;
  final bool likedByMe;
  final bool canDelete;
  final bool isMine;
  final int coinCount;
  final bool canGift;

  bool get isReply => parentId != null;

  PostComment copyWith({int? likeCount, bool? likedByMe, int? coinCount}) => PostComment(
        id: id,
        parentId: parentId,
        text: text,
        createdAt: createdAt,
        author: author,
        likeCount: likeCount ?? this.likeCount,
        likedByMe: likedByMe ?? this.likedByMe,
        canDelete: canDelete,
        isMine: isMine,
        coinCount: coinCount ?? this.coinCount,
        canGift: canGift,
      );

  factory PostComment.fromJson(Map<String, dynamic> j) => PostComment(
        id: j['id'] as String,
        parentId: j['parentId'] as String?,
        text: (j['text'] ?? '') as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        author: PersonRef.fromJson(j['author'] as Map<String, dynamic>),
        likeCount: (j['likeCount'] ?? 0) as int,
        likedByMe: (j['likedByMe'] ?? false) as bool,
        canDelete: (j['canDelete'] ?? false) as bool,
        isMine: (j['isMine'] ?? false) as bool,
        coinCount: (j['coinCount'] ?? 0) as int,
        canGift: (j['canGift'] ?? false) as bool,
      );
}

class CommentsPage {
  const CommentsPage({required this.total, required this.items, this.nextCursor});

  final int total;
  final List<PostComment> items;
  final String? nextCursor;

  factory CommentsPage.fromJson(Map<String, dynamic> j) => CommentsPage(
        total: (j['total'] ?? 0) as int,
        items: ((j['items'] ?? const <dynamic>[]) as List<dynamic>).map((e) => PostComment.fromJson(e as Map<String, dynamic>)).toList(),
        nextCursor: j['nextCursor'] as String?,
      );
}

class PublicProfile {
  const PublicProfile({
    required this.person,
    required this.bims,
    required this.followers,
    required this.following,
    required this.isMe,
    required this.followedByMe,
    required this.followsMe,
    required this.blockedByMe,
    this.projects,
    this.city,
  });

  final PersonRef person;
  final int bims;
  final int followers;
  final int following;

  /// Seulement sur son propre profil (privé).
  final int? projects;
  final String? city;
  final bool isMe;
  final bool followedByMe;
  final bool followsMe;
  final bool blockedByMe;

  factory PublicProfile.fromJson(Map<String, dynamic> j) {
    final c = (j['counts'] ?? const <String, dynamic>{}) as Map<String, dynamic>;
    return PublicProfile(
      person: PersonRef.fromJson(j),
      bims: (c['bims'] ?? 0) as int,
      followers: (c['followers'] ?? 0) as int,
      following: (c['following'] ?? 0) as int,
      projects: c['projects'] as int?,
      city: j['city'] as String?,
      isMe: (j['isMe'] ?? false) as bool,
      followedByMe: (j['followedByMe'] ?? false) as bool,
      followsMe: (j['followsMe'] ?? false) as bool,
      blockedByMe: (j['blockedByMe'] ?? false) as bool,
    );
  }
}

class PersonResult {
  const PersonResult({required this.person, required this.followedByMe});

  final PersonRef person;
  final bool followedByMe;

  factory PersonResult.fromJson(Map<String, dynamic> j) => PersonResult(person: PersonRef.fromJson(j), followedByMe: (j['followedByMe'] ?? false) as bool);
}

/// V1 — Personne suggérée (« Personnes à suivre ») : abonnements en commun, objectifs proches ou publications appréciées.
class PersonSuggestion {
  const PersonSuggestion({required this.person, required this.reason, this.mutualCount = 0});

  final PersonRef person;
  /// followed_by_friends · same_goals · popular
  final String reason;
  final int mutualCount;

  String get reasonLabel => switch (reason) {
        'followed_by_friends' => mutualCount > 1 ? 'Suivie par $mutualCount de tes abonnements' : 'Suivie par un de tes abonnements',
        'same_goals' => 'Mêmes objectifs que toi',
        _ => 'Appréciée sur BIM',
      };

  factory PersonSuggestion.fromJson(Map<String, dynamic> j) =>
      PersonSuggestion(person: PersonRef.fromJson(j), reason: (j['reason'] ?? 'popular') as String, mutualCount: (j['mutualCount'] ?? 0) as int);
}

/// Motifs de signalement d'un contenu (identiques à l'API).
const contentReportReasons = <(String, String)>[
  ('spam', 'Spam ou publicité'),
  ('harassment', 'Harcèlement'),
  ('nudity', 'Nudité'),
  ('violence', 'Violence'),
  ('hate', 'Propos haineux'),
  ('self_harm', 'Automutilation ou suicide'),
  ('false_info', 'Fausse information'),
  ('other', 'Autre chose'),
];

/// Signaler une boutique (le marchand) : BIM ne rembourse pas, l'équipe examine et peut suspendre la boutique.
const shopReportReasons = <(String, String)>[
  ('fraud', 'Arnaque ou fraude'),
  ('false_info', 'Article différent de l’annonce'),
  ('harassment', 'Comportement irrespectueux'),
  ('spam', 'Spam ou publicité'),
  ('other', 'Autre problème'),
];

/// Visibilité d'une publication (écran 16).
const postVisibilities = <(String, String, String)>[
  ('public', 'Tout le monde', 'Visible par toutes les personnes de BIM'),
  ('followers', 'Mes abonnés', 'Visible seulement par les personnes qui te suivent'),
  ('private', 'Moi seul', 'Gardée pour toi'),
];

String visibilityLabel(String v) => postVisibilities.where((x) => x.$1 == v).map((x) => x.$2).firstOrNull ?? 'Tout le monde';

/// « à l'instant », « il y a 3 h », « il y a 2 j », puis la date.
String timeAgo(DateTime t, {DateTime? now}) {
  final d = (now ?? DateTime.now()).difference(t);
  if (d.inMinutes < 1) return 'à l’instant';
  if (d.inMinutes < 60) return 'il y a ${d.inMinutes} min';
  if (d.inHours < 24) return 'il y a ${d.inHours} h';
  if (d.inDays < 7) return 'il y a ${d.inDays} j';
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  final l = t.toLocal();
  return '${l.day} ${months[l.month - 1]}';
}

/// 950 → « 950 », 10 200 → « 10,2 k », 2 800 000 → « 2,8 M ».
String compactCount(int n) {
  String one(double v) => (v >= 100 ? v.toStringAsFixed(0) : v.toStringAsFixed(1)).replaceAll(RegExp(r'[.,]0$'), '').replaceAll('.', ',');
  // Maquettes 10 et 52 : abrégé dès 1 000 (« 2,8 k »).
  if (n < 1000) return '$n';
  if (n < 1000000) return '${one(n / 1000)} k';
  return '${one(n / 1000000)} M';
}

/// Story (lot 4-B) : une photo visible 24 heures par la personne et ses abonnés.
class StoryItem {
  const StoryItem({required this.id, required this.url, required this.createdAt, required this.seen});

  final String id;
  final String url;
  final DateTime createdAt;
  final bool seen;

  factory StoryItem.fromJson(Map<String, dynamic> j) => StoryItem(
        id: j['id'] as String,
        url: (j['url'] ?? '') as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        seen: (j['seen'] ?? false) as bool,
      );
}

class StoryGroup {
  const StoryGroup({required this.author, required this.items, required this.allSeen});

  final PersonRef author;
  final List<StoryItem> items;
  final bool allSeen;

  factory StoryGroup.fromJson(Map<String, dynamic> j) => StoryGroup(
        author: PersonRef.fromJson(j['author'] as Map<String, dynamic>),
        items: ((j['items'] ?? const <dynamic>[]) as List<dynamic>).map((e) => StoryItem.fromJson(e as Map<String, dynamic>)).toList(),
        allSeen: (j['allSeen'] ?? false) as bool,
      );
}

class StoryTray {
  const StoryTray({required this.items, this.mine});

  /// Mes stories (null : aucune en cours).
  final StoryGroup? mine;

  /// Personnes suivies, non vues d'abord.
  final List<StoryGroup> items;

  factory StoryTray.fromJson(Map<String, dynamic> j) => StoryTray(
        mine: j['mine'] is Map<String, dynamic> ? StoryGroup.fromJson(j['mine'] as Map<String, dynamic>) : null,
        items: ((j['items'] ?? const <dynamic>[]) as List<dynamic>).map((e) => StoryGroup.fromJson(e as Map<String, dynamic>)).toList(),
      );
}
