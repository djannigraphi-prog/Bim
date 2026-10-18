import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../application/social_providers.dart';
import '../data/social_api.dart';
import '../data/social_models.dart';
import 'comments_sheet.dart';
import 'moderation_sheets.dart';
import 'social_widgets.dart';
import 'used_products.dart';
import '../../wallet/presentation/gift_sheet.dart';

/// Écran 11 — Publication : avant / après à comparer avec le curseur, résumé du parcours, j'aime et commentaires.
/// 5-E : « Produits et services utilisés » (lien vers la fiche, jamais d'achat : règle E2) ; pièces : lot 9.
class PostDetailScreen extends ConsumerStatefulWidget {
  const PostDetailScreen({super.key, required this.postId});

  final String postId;

  @override
  ConsumerState<PostDetailScreen> createState() => _PostDetailScreenState();
}

class _PostDetailScreenState extends ConsumerState<PostDetailScreen> {
  FeedPost? _local;

  Future<void> _like(FeedPost post) async {
    final on = !post.likedByMe;
    setState(() => _local = post.copyWith(likedByMe: on, likeCount: post.likeCount + (on ? 1 : -1)));
    try {
      final r = await ref.read(socialApiProvider).like(post.id, on: on);
      if (mounted) setState(() => _local = post.copyWith(likedByMe: r.likedByMe, likeCount: r.likeCount));
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _local = post);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(postProvider(widget.postId));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Publication'),
        centerTitle: true,
        actions: [
          if (async.valueOrNull != null)
            IconButton(
              tooltip: 'Plus d’options',
              icon: const Icon(Icons.more_horiz_rounded),
              onPressed: () async {
                final r = await showPostMenu(context, ref, _local ?? async.value!);
                if (r != null && context.mounted) context.pop(r);
              },
            ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(BimSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Peni(pose: PeniPose.sad, size: 90),
                const SizedBox(height: BimSpacing.md),
                Text(
                  e is ApiException && e.status == 404 ? 'Cette publication n’est plus disponible.' : (e is ApiException ? e.message : ApiException.unknown.message),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: BimSpacing.md),
                BimButton(label: 'Retour', variant: BimButtonVariant.outline, onPressed: () => context.pop()),
              ],
            ),
          ),
        ),
        data: (fetched) {
          final post = _local ?? fetched;
          final before = post.before;
          final after = post.after;
          final journey = post.journey;
          return ListView(
            padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
            children: [
              Row(
                children: [
                  GestureDetector(onTap: () => context.push('/people/${post.author.username}'), child: PersonAvatar(person: post.author, size: 48)),
                  const SizedBox(width: BimSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(post.author.fullName, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                        Text(
                          [post.isBim ? 'a fait son BIM' : 'a publié', if (journey != null && journey.subject.isNotEmpty) journey.subject, timeAgo(post.createdAt)].join(' · '),
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  if (journey?.days != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(10)),
                      child: Text('🏆 ${journey!.days} jours', style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
                    ),
                ],
              ),
              const SizedBox(height: BimSpacing.lg),
              if (post.isBim && before != null && after != null)
                BeforeAfterCompare(before: before, after: after)
              else if (post.media.isNotEmpty)
                ClipRRect(borderRadius: BorderRadius.circular(BimRadius.card), child: PostGallery(media: post.media)),
              if (post.isBim && journey != null) ...[
                const SizedBox(height: BimSpacing.lg),
                Container(
                  padding: const EdgeInsets.all(BimSpacing.lg),
                  decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: theme.colorScheme.onSurface, borderRadius: BorderRadius.circular(12)),
                        child: Icon(Icons.route_rounded, color: theme.colorScheme.surface),
                      ),
                      const SizedBox(width: BimSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Le parcours', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                            Text([journey.subject, journey.summary].where((s) => s.isNotEmpty).join(' · '), style: theme.textTheme.bodySmall),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: BimSpacing.sm),
              PostActions(
                post: post,
                onLike: () => _like(post),
                onComments: () async {
                  final total = await showCommentsSheet(context, post.id);
                  if (total != null && mounted) setState(() => _local = post.copyWith(commentCount: total));
                },
                onCoins: () async {
                  if (!post.canGift) return showDonorsSheet(context, post.id);
                  final total = await showGiftSheet(context, targetType: 'post', targetId: post.id, recipientName: post.author.fullName);
                  if (total != null && mounted) setState(() => _local = post.copyWith(coinCount: total));
                },
              ),
              if ((post.text ?? '').isNotEmpty)
                Text.rich(
                  TextSpan(children: [
                    TextSpan(text: '${post.author.fullName} ', style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: post.text),
                  ],),
                ),
              if (post.isBim) UsedProductsSection(post: post, onChanged: (p) => setState(() => _local = p)),
            ],
          );
        },
      ),
    );
  }
}
