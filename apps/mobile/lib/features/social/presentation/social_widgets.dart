import 'package:flutter/material.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../data/social_models.dart';

/// Photo de profil ronde, ou initiales sur fond doux quand la personne n'a pas de photo (lot 4).
class PersonAvatar extends StatelessWidget {
  const PersonAvatar({super.key, required this.person, this.size = 40, this.ring = false});

  final PersonRef person;
  final double size;

  /// Anneau rouge (profil, écran 52).
  final bool ring;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fallback = Container(
      color: BimColors.redSoft,
      alignment: Alignment.center,
      child: Text(person.initials, style: TextStyle(color: BimColors.red, fontWeight: FontWeight.w700, fontSize: size * 0.36)),
    );
    final circle = ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: person.avatarUrl == null
            ? fallback
            : Image.network(person.avatarUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => fallback),
      ),
    );
    return Semantics(
      label: 'Photo de ${person.fullName}',
      image: true,
      child: ring
          ? Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: BimColors.red, width: 3)),
              child: Container(padding: const EdgeInsets.all(2), decoration: BoxDecoration(shape: BoxShape.circle, color: scheme.surface), child: circle),
            )
          : circle,
    );
  }
}

/// Image réseau d'une publication, avec un fond neutre pendant le chargement et en cas d'erreur.
class PostImage extends StatelessWidget {
  const PostImage({super.key, required this.media, this.grey = false, this.fit = BoxFit.cover});

  final PostMedia media;
  final bool grey;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final placeholder = ColoredBox(
      color: scheme.surfaceContainerHighest,
      child: Center(child: Icon(Icons.image_outlined, color: scheme.onSurfaceVariant)),
    );
    if (media.url == null) return placeholder;
    final img = Image.network(
      media.url!,
      fit: fit,
      errorBuilder: (_, __, ___) => placeholder,
      loadingBuilder: (_, child, progress) => progress == null ? child : placeholder,
    );
    return grey
        ? ColorFiltered(colorFilter: const ColorFilter.matrix([0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0, 0, 0, 1, 0]), child: img)
        : img;
  }
}

/// Étiquette « Avant · J1 » / « Après · 13 oct. » posée sur une photo.
class PhotoTag extends StatelessWidget {
  const PhotoTag({super.key, required this.text, this.red = false});

  final String text;
  final bool red;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: red ? BimColors.red : BimColors.black.withValues(alpha: 0.72), borderRadius: BorderRadius.circular(10)),
        child: Text(text, style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w700, fontSize: 13)),
      );
}

String _tag(String label, PostMedia m) => m.takenDay == null ? label : '$label · ${shortDay(m.takenDay!)}';

/// Écran 11 : comparaison avant / après avec un curseur que l'on fait glisser (avant en noir et blanc, comme l'écran 31).
class BeforeAfterCompare extends StatefulWidget {
  const BeforeAfterCompare({super.key, required this.before, required this.after});

  final PostMedia before;
  final PostMedia after;

  @override
  State<BeforeAfterCompare> createState() => _BeforeAfterCompareState();
}

class _BeforeAfterCompareState extends State<BeforeAfterCompare> {
  double _split = 0.5;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(BimRadius.card),
      child: AspectRatio(
        aspectRatio: 0.78,
        child: LayoutBuilder(
          builder: (context, c) {
            final x = c.maxWidth * _split;
            return GestureDetector(
              onHorizontalDragUpdate: (d) => setState(() => _split = ((x + d.delta.dx) / c.maxWidth).clamp(0.05, 0.95)),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  PostImage(media: widget.after),
                  ClipRect(clipper: _LeftClip(x), child: PostImage(media: widget.before, grey: true)),
                  Positioned(left: x - 1, top: 0, bottom: 0, child: const ColoredBox(color: BimColors.white, child: SizedBox(width: 2))),
                  Positioned(
                    left: x - 22,
                    top: c.maxHeight / 2 - 22,
                    child: Semantics(
                      label: 'Faire glisser pour comparer avant et après',
                      slider: true,
                      child: Container(
                        width: 44,
                        height: 44,
                        decoration: const BoxDecoration(color: BimColors.white, shape: BoxShape.circle, boxShadow: [BoxShadow(blurRadius: 6, color: Color(0x33000000))]),
                        child: const Icon(Icons.compare_arrows_rounded, color: BimColors.black),
                      ),
                    ),
                  ),
                  Positioned(left: BimSpacing.md, top: BimSpacing.md, child: PhotoTag(text: _tag('Avant', widget.before))),
                  Positioned(right: BimSpacing.md, top: BimSpacing.md, child: PhotoTag(text: _tag('Après', widget.after), red: true)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _LeftClip extends CustomClipper<Rect> {
  _LeftClip(this.x);
  final double x;

  @override
  Rect getClip(Size size) => Rect.fromLTWH(0, 0, x, size.height);

  @override
  bool shouldReclip(_LeftClip old) => old.x != x;
}

/// Avant / après côte à côte (carte du fil, écran 10).
class BeforeAfterSideBySide extends StatelessWidget {
  const BeforeAfterSideBySide({super.key, required this.before, required this.after});

  final PostMedia before;
  final PostMedia after;

  @override
  Widget build(BuildContext context) => AspectRatio(
        aspectRatio: 1.1,
        child: Row(
          children: [
            Expanded(
              child: Stack(fit: StackFit.expand, children: [
                PostImage(media: before, grey: true),
                Positioned(left: BimSpacing.sm, bottom: BimSpacing.sm, child: PhotoTag(text: _tag('Avant', before))),
              ],),
            ),
            const SizedBox(width: 2),
            Expanded(
              child: Stack(fit: StackFit.expand, children: [
                PostImage(media: after),
                Positioned(right: BimSpacing.sm, bottom: BimSpacing.sm, child: PhotoTag(text: _tag('Après', after), red: true)),
              ],),
            ),
          ],
        ),
      );
}

/// Photos d'une publication simple : une seule en grand, ou plusieurs que l'on fait défiler.
class PostGallery extends StatefulWidget {
  const PostGallery({super.key, required this.media});

  final List<PostMedia> media;

  @override
  State<PostGallery> createState() => _PostGalleryState();
}

class _PostGalleryState extends State<PostGallery> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final first = widget.media.first;
    final ratio = (first.width / first.height).clamp(0.75, 1.6);
    if (widget.media.length == 1) return AspectRatio(aspectRatio: ratio, child: PostImage(media: first));
    return AspectRatio(
      aspectRatio: ratio,
      child: Stack(
        children: [
          PageView(
            onPageChanged: (i) => setState(() => _page = i),
            children: [for (final m in widget.media) PostImage(media: m)],
          ),
          Positioned(
            right: BimSpacing.sm,
            top: BimSpacing.sm,
            child: PhotoTag(text: '${_page + 1}/${widget.media.length}'),
          ),
        ],
      ),
    );
  }
}

/// Badge « J'ai fait mon BIM » (écran 10).
class BimBadge extends StatelessWidget {
  const BimBadge({super.key});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: BimColors.black.withValues(alpha: 0.72), borderRadius: BorderRadius.circular(10)),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.auto_awesome, size: 14, color: BimColors.white),
            SizedBox(width: 4),
            Text('J’ai fait mon BIM', style: TextStyle(color: BimColors.white, fontWeight: FontWeight.w700, fontSize: 13)),
          ],
        ),
      );
}

/// Ligne « ♥ 10,2 k  💬 214 » d'une publication (pièces : lot 9).
class PostActions extends StatelessWidget {
  const PostActions({super.key, required this.post, required this.onLike, required this.onComments});

  final FeedPost post;
  final VoidCallback onLike;
  final VoidCallback onComments;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final style = TextStyle(fontWeight: FontWeight.w600, color: scheme.onSurface);
    return Row(
      children: [
        Semantics(
          button: true,
          label: post.likedByMe ? 'Je n’aime plus' : 'J’aime',
          child: InkWell(
            key: ValueKey('like-${post.id}'),
            borderRadius: BorderRadius.circular(BimRadius.chip),
            onTap: onLike,
            child: Padding(
              padding: const EdgeInsets.all(BimSpacing.sm),
              child: Row(children: [
                Icon(post.likedByMe ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: post.likedByMe ? BimColors.red : scheme.onSurface, size: 26),
                const SizedBox(width: 6),
                Text(compactCount(post.likeCount), style: style),
              ],),
            ),
          ),
        ),
        const SizedBox(width: BimSpacing.sm),
        Semantics(
          button: true,
          label: 'Commentaires',
          child: InkWell(
            key: ValueKey('comments-${post.id}'),
            borderRadius: BorderRadius.circular(BimRadius.chip),
            onTap: onComments,
            child: Padding(
              padding: const EdgeInsets.all(BimSpacing.sm),
              child: Row(children: [
                Icon(Icons.chat_bubble_outline_rounded, color: scheme.onSurface, size: 24),
                const SizedBox(width: 6),
                Text(compactCount(post.commentCount), style: style),
              ],),
            ),
          ),
        ),
      ],
    );
  }
}
