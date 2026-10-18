import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/feedback.dart';
import '../data/social_api.dart';
import '../../wallet/presentation/gift_sheet.dart';
import '../data/social_models.dart';
import 'comments_sheet.dart';
import 'moderation_sheets.dart';
import 'social_widgets.dart';

/// Publication dans le fil (écran 10). Les changements (j'aime, abonnement, commentaires) remontent par [onChanged] ;
/// une publication supprimée ou dont l'auteur est bloqué disparaît par [onGone].
class PostCard extends ConsumerWidget {
  const PostCard({super.key, required this.post, required this.onChanged, required this.onGone, this.readOnlyAction});

  final FeedPost post;
  final ValueChanged<FeedPost> onChanged;
  final VoidCallback onGone;

  /// Visiteur sans compte : toute action (j'aime, commentaires, suivre, ouvrir, menu) appelle ceci à la place.
  final VoidCallback? readOnlyAction;

  Future<void> _like(BuildContext context, WidgetRef ref) async {
    final on = !post.likedByMe;
    onChanged(post.copyWith(likedByMe: on, likeCount: post.likeCount + (on ? 1 : -1)));
    try {
      final r = await ref.read(socialApiProvider).like(post.id, on: on);
      onChanged(post.copyWith(likedByMe: r.likedByMe, likeCount: r.likeCount));
    } on ApiException catch (e) {
      onChanged(post);
      if (context.mounted) showApiError(context, e);
    }
  }

  Future<void> _follow(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(socialApiProvider).follow(post.author.username, on: true);
      onChanged(post.copyWith(followingAuthor: true));
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  Future<void> _comments(BuildContext context) async {
    final total = await showCommentsSheet(context, post.id);
    if (total != null && total != post.commentCount) onChanged(post.copyWith(commentCount: total));
  }

  Future<void> _coins(BuildContext context) async {
    if (!post.canGift) return showDonorsSheet(context, post.id);
    final total = await showGiftSheet(context, targetType: 'post', targetId: post.id, recipientName: post.author.fullName);
    if (total != null) onChanged(post.copyWith(coinCount: total));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final gate = readOnlyAction;
    void open(String location) {
      if (gate != null) {
        gate();
      } else {
        context.push(location);
      }
    }
    final before = post.before;
    final after = post.after;
    return Padding(
      padding: const EdgeInsets.only(bottom: BimSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
            child: Row(
              children: [
                GestureDetector(onTap: () => open('/people/${post.author.username}'), child: PersonAvatar(person: post.author, size: 44)),
                const SizedBox(width: BimSpacing.md),
                Expanded(
                  child: InkWell(
                    onTap: () => open('/people/${post.author.username}'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(post.author.fullName, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text(
                          '${post.isBim ? 'a partagé un Bim' : 'a publié'} · ${timeAgo(post.createdAt)}${post.visibility == 'public' ? '' : ' · ${visibilityLabel(post.visibility)}'}',
                          style: theme.textTheme.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
                if (!post.isMine && !post.followingAuthor)
                  FilledButton(
                    key: ValueKey('follow-${post.id}'),
                    onPressed: gate ?? () => _follow(context, ref),
                    style: FilledButton.styleFrom(
                      backgroundColor: BimColors.red,
                      foregroundColor: BimColors.white,
                      minimumSize: const Size(0, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.chip)),
                    ),
                    child: const Text('Suivre'),
                  ),
                IconButton(
                  key: ValueKey('post-menu-${post.id}'),
                  tooltip: 'Plus d’options',
                  icon: const Icon(Icons.more_horiz_rounded),
                  onPressed: gate ??
                      () async {
                        final r = await showPostMenu(context, ref, post);
                        if (r != null) onGone();
                      },
                ),
              ],
            ),
          ),
          const SizedBox(height: BimSpacing.md),
          if (post.media.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
              child: GestureDetector(
                onTap: () => open('/posts/${post.id}'),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(BimRadius.card),
                  child: Stack(
                    children: [
                      if (post.isBim && before != null && after != null)
                        BeforeAfterSideBySide(before: before, after: after)
                      else
                        PostGallery(media: post.media),
                      if (post.isBim) const Positioned(left: BimSpacing.md, top: BimSpacing.md, child: BimBadge()),
                    ],
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(BimSpacing.md, BimSpacing.xs, BimSpacing.screen, 0),
            child: PostActions(
              post: post,
              onLike: gate ?? () => _like(context, ref),
              onComments: gate ?? () => _comments(context),
              onCoins: gate ?? () => _coins(context),
            ),
          ),
          if (post.isBim && post.journey != null && post.journey!.subject.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
              child: Text('🏆 ${post.journey!.subject}${post.journey!.summary.isEmpty ? '' : ' · ${post.journey!.summary}'}', style: theme.textTheme.bodySmall),
            ),
          if ((post.text ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.xs, BimSpacing.screen, 0),
              child: GestureDetector(
                onTap: () => open('/posts/${post.id}'),
                child: Text.rich(
                  TextSpan(children: [
                    TextSpan(text: '${post.author.fullName} ', style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: post.text),
                  ],),
                  maxLines: post.media.isEmpty ? 8 : 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
