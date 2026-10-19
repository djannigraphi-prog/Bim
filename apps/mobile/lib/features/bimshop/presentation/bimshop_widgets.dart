import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/certified_badge.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../data/bimshop_api.dart';
import 'share_sheet.dart';

/// Prix comme sur la maquette 32 : « 45 000 F ».
String formatPriceF(int amount) {
  final s = amount.toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(' ');
    b.write(s[i]);
  }
  return '$b F';
}

/// Rayon des photos de la mosaïque (maquette 32).
const _mediaRadius = 22.0;

/// Carte d'un article dans la mosaïque (écrans 32 et 54, maquette 32) : grande photo ou vidéo au format carré ou
/// portrait, cœur « mettre de côté », compteurs (recommandations, j'aime, avis), bouton panier ; nom et prix dessous.
/// Jamais de note moyenne (A17).
class ShopCardTile extends ConsumerStatefulWidget {
  const ShopCardTile({super.key, required this.card, this.showShop = false, this.details = false, this.aspect});

  final ShopCard card;
  /// Forme imposée (listes horizontales de hauteur fixe) ; sinon celle de la photo.
  final double? aspect;
  /// Nom de la boutique sous le prix (listes hors du BimShop : offres, recommandations).
  final bool showShop;

  /// Nom et prix sous la photo : seulement hors de la mosaïque du BimShop (offres reçues, articles mis de côté).
  final bool details;

  @override
  ConsumerState<ShopCardTile> createState() => _ShopCardTileState();
}

class _ShopCardTileState extends ConsumerState<ShopCardTile> {
  bool? _favorite;
  int _likesDelta = 0;
  bool _busy = false;

  bool get _signedIn => ref.read(sessionProvider) is SessionSignedIn;

  Future<void> _toggleFavorite(bool current) async {
    if (!_signedIn) {
      await showVisitorGate(context, ref);
      return;
    }
    if (_busy) return;
    setState(() {
      _busy = true;
      _favorite = !current;
      _likesDelta += current ? -1 : 1;
    });
    try {
      await ref.read(bimShopApiProvider).setFavorite(widget.card.id, !current);
      ref.invalidate(shopFavoritesProvider);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _favorite = current;
        _likesDelta += current ? 1 : -1;
      });
      showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = widget.card;
    final signedIn = ref.watch(sessionProvider) is SessionSignedIn;
    final saved = signedIn ? ref.watch(shopFavoritesProvider).valueOrNull : null;
    final favorite = _favorite ?? (saved?.any((f) => f.id == c.id) ?? false);
    final counts = c.counts.copyWith(likes: (c.counts.likes + _likesDelta).clamp(0, 1 << 31));
    void open() => context.push('/bimshop/products/${c.id}');
    return Semantics(
      button: true,
      label: '${c.title}, ${formatPriceF(c.priceFcfa)}',
      child: GestureDetector(
        key: ValueKey('shop-card-${c.id}'),
        behavior: HitTestBehavior.opaque,
        onTap: open,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: widget.aspect ?? c.mediaAspect,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(_mediaRadius),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    _CardImage(url: c.imageUrl),
                    if (c.video?.url != null) _CardVideo(key: ValueKey('shop-card-video-${c.id}'), url: c.video!.url!),
                    if (!c.available)
                      const Positioned(left: 10, top: 10, child: _Badge(text: 'Épuisé', color: BimColors.grey800))
                    else if (c.video != null)
                      const Positioned(left: 10, top: 10, child: _Badge(text: '▶ Vidéo', color: Color(0x99000000))),
                    Positioned(
                      right: 8,
                      top: 8,
                      child: _RoundButton(
                        key: ValueKey('shop-card-favorite-${c.id}'),
                        tooltip: favorite ? 'Retirer des articles mis de côté' : 'Mettre de côté',
                        color: Colors.white.withValues(alpha: 0.92),
                        shape: const CircleBorder(),
                        onPressed: () => _toggleFavorite(favorite),
                        child: Icon(favorite ? Icons.favorite : Icons.favorite_border, size: 22, color: favorite ? BimColors.red : BimColors.black),
                      ),
                    ),
                    // V1 (19/10/2026) : sur la photo, seulement les cœurs et les avis ; tout le reste est dans la fiche.
                    if (counts.likes > 0 || counts.reviews > 0)
                      Positioned(left: 8, bottom: 8, right: 52, child: Align(alignment: Alignment.bottomLeft, child: _CountsPill(counts: counts))),
                    Positioned(
                      right: 4,
                      bottom: 4,
                      child: _RoundButton(
                        key: ValueKey('shop-card-share-${c.id}'),
                        tooltip: 'Partager',
                        color: Colors.white.withValues(alpha: 0.85),
                        shape: const CircleBorder(),
                        visual: 32,
                        onPressed: () => showShareProductSheet(context, ref, c),
                        child: const Icon(Icons.share_outlined, size: 16, color: BimColors.black),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Mosaïque du BimShop : rien sous la photo (les images avant tout, décision du 19/10/2026).
            // Nom et prix restent dans les listes hors mosaïque (articles mis de côté, offres).
            if (widget.details || widget.showShop)
            Padding(
              padding: const EdgeInsets.fromLTRB(6, 8, 4, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleMedium?.copyWith(fontSize: 16, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 2),
                  Wrap(
                    spacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.end,
                    children: [
                      Text(formatPriceF(c.priceFcfa), style: theme.textTheme.titleMedium?.copyWith(fontSize: 16, fontWeight: FontWeight.w700)),
                      if (c.compareAtFcfa != null)
                        Text(
                          formatPriceF(c.compareAtFcfa!),
                          style: theme.textTheme.bodyMedium?.copyWith(color: BimColors.grey600, decoration: TextDecoration.lineThrough, fontWeight: FontWeight.w600),
                        ),
                    ],
                  ),
                  if (widget.showShop)
                    Row(
                      children: [
                        Flexible(child: Text(c.shop.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall)),
                        if (c.shop.certified) const Padding(padding: EdgeInsets.only(left: 2), child: CertifiedBadge(size: 14)),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CardImage extends StatelessWidget {
  const _CardImage({required this.url});
  final String? url;

  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(color: Theme.of(context).colorScheme.surfaceContainerHighest, child: const Center(child: Icon(Icons.image_outlined, size: 36)));
    if (url == null) return placeholder;
    return Image.network(url!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => placeholder);
  }
}

/// Bouton rond ou carré posé sur la photo, avec une zone de toucher d'au moins 44 px.
class _RoundButton extends StatelessWidget {
  const _RoundButton({super.key, required this.tooltip, required this.color, required this.shape, required this.onPressed, required this.child, this.visual = 44});

  final String tooltip;
  final Color color;
  final ShapeBorder shape;
  final VoidCallback onPressed;
  final Widget child;

  /// Taille dessinée ; la zone de toucher garde 44 px.
  final double visual;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Semantics(
          button: true,
          label: tooltip,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onPressed,
            child: SizedBox(
              width: 44,
              height: 44,
              child: Center(
                child: Material(color: color, shape: shape, clipBehavior: Clip.antiAlias, child: SizedBox(width: visual, height: visual, child: Center(child: child))),
              ),
            ),
          ),
        ),
      );
}

/// Pastille des compteurs sur la photo : cœurs (j'aime) et avis ; seuls les compteurs non nuls s'affichent.
class _CountsPill extends StatelessWidget {
  const _CountsPill({required this.counts});
  final ShopCounts counts;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(color: BimColors.black, fontWeight: FontWeight.w600, fontSize: 14);
    Widget item(IconData icon, Color color, int n, String key, String label) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Semantics(
            label: '$n $label',
            excludeSemantics: true,
            child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 17, color: color), const SizedBox(width: 3), Text(shopCount(n), key: ValueKey(key), style: style)]),
          ),
        );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(20)),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (counts.likes > 0) item(Icons.favorite, BimColors.red, counts.likes, 'count-likes', 'j’aime'),
            if (counts.reviews > 0) item(Icons.chat_bubble_outline_rounded, BimColors.black, counts.reviews, 'count-reviews', 'avis'),
          ],
        ),
      ),
    );
  }
}

/// Vidéo d'un article dans la mosaïque : muette, en boucle, lue seulement quand elle est bien visible à l'écran et que
/// sa page est au premier plan. Hors de l'écran, le lecteur est libéré (mémoire et décodeurs du téléphone) ; la photo
/// reste dessous tant que la vidéo n'est pas prête.
class _CardVideo extends StatefulWidget {
  const _CardVideo({super.key, required this.url});
  final String url;

  @override
  State<_CardVideo> createState() => _CardVideoState();
}

class _CardVideoState extends State<_CardVideo> {
  VideoPlayerController? _controller;
  final _positions = <ScrollPosition>[];
  bool _visible = false;
  bool _routeCurrent = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Toutes les listes qui défilent autour (verticale et, pour une rangée horizontale, horizontale).
    for (final p in _positions) {
      p.removeListener(_check);
    }
    _positions.clear();
    var state = Scrollable.maybeOf(context);
    while (state != null) {
      _positions.add(state.position..addListener(_check));
      state = Scrollable.maybeOf(state.context);
    }
    // Une autre page ouverte par-dessus (fiche article…) : la vidéo s'arrête.
    _routeCurrent = ModalRoute.of(context)?.isCurrent ?? true;
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  void _check() {
    if (!mounted) return;
    final box = context.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize || !box.attached) return;
    var visible = _routeCurrent;
    if (visible) {
      final rect = box.localToGlobal(Offset.zero) & box.size;
      final screen = Offset.zero & MediaQuery.sizeOf(context);
      final shown = rect.intersect(screen);
      visible = !shown.isEmpty && shown.width * shown.height >= rect.width * rect.height * 0.6;
    }
    if (visible == _visible) return;
    _visible = visible;
    if (visible) {
      _play();
    } else {
      _release();
    }
  }

  Future<void> _play() async {
    if (_controller != null) return;
    final c = VideoPlayerController.networkUrl(Uri.parse(widget.url), videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true));
    _controller = c;
    try {
      await c.initialize();
      await c.setVolume(0);
      await c.setLooping(true);
      if (!mounted || _controller != c || !_visible) return;
      await c.play();
      setState(() {});
    } catch (_) {
      // La photo reste affichée.
    }
  }

  void _release() {
    final c = _controller;
    if (c == null) return;
    _controller = null;
    if (mounted) setState(() {});
    c.dispose();
  }

  @override
  void dispose() {
    for (final p in _positions) {
      p.removeListener(_check);
    }
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return const SizedBox.shrink();
    return FittedBox(fit: BoxFit.cover, clipBehavior: Clip.hardEdge, child: SizedBox(width: c.value.size.width, height: c.value.size.height, child: VideoPlayer(c)));
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm, vertical: 3),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: Text(text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
      );
}

/// Mosaïque à deux colonnes façon Pinterest (maquette 32) : chaque carte garde la forme de sa photo (carré ou
/// portrait) et va dans la colonne la moins haute. Dans une liste qui défile déjà.
class ShopCardGrid extends StatelessWidget {
  const ShopCardGrid({super.key, required this.cards, this.showShop = false, this.details = false, this.gap = 10});

  final List<ShopCard> cards;
  final bool showShop;
  /// Nom et prix sous les photos (hors mosaïque du BimShop).
  final bool details;
  final double gap;

  /// Hauteur du texte sous la photo (nom, prix et, si demandé, boutique).
  double get _textHeight => showShop ? 76 : 58;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, box) {
          final width = (box.maxWidth - gap) / 2;
          final columns = [<ShopCard>[], <ShopCard>[]];
          final heights = [0.0, 0.0];
          for (final c in cards) {
            final i = heights[0] <= heights[1] ? 0 : 1;
            columns[i].add(c);
            heights[i] += width / c.mediaAspect + _textHeight + gap * 1.6;
          }
          return Row(
            key: const ValueKey('shop-mosaic'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < 2; i++) ...[
                if (i == 1) SizedBox(width: gap),
                Expanded(
                  child: Column(
                    children: [
                      for (final c in columns[i])
                        Padding(padding: EdgeInsets.only(bottom: gap * 1.6), child: ShopCardTile(card: c, showShop: showShop, details: details)),
                    ],
                  ),
                ),
              ],
            ],
          );
        },
      );
}

/// V1 — Étoiles grises de la boutique (V1-1910-C) : « ★ 4,6 (32 avis) », ou « Nouvelle boutique » avant 3 avis.
/// Jamais pour une boutique certifiée (Premium) : elle a son badge à la place.
class ShopStars extends StatelessWidget {
  const ShopStars({super.key, required this.rating});
  final ShopRating rating;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final avg = rating.average;
    if (avg == null) {
      return Text('Nouvelle boutique', key: const ValueKey('shop-stars-new'), style: theme.textTheme.bodySmall);
    }
    final label = avg.toStringAsFixed(1).replaceAll('.', ',');
    return Semantics(
      label: 'Boutique notée $label sur 5, ${rating.reviews} avis',
      excludeSemantics: true,
      // Réduit plutôt que de déborder quand la place manque (carte de la boutique avec « Contacter »).
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Row(
        key: const ValueKey('shop-stars'),
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 1; i <= 5; i++)
            Icon(avg >= i - 0.25 ? Icons.star_rounded : (avg >= i - 0.75 ? Icons.star_half_rounded : Icons.star_outline_rounded), size: 16, color: BimColors.grey600),
          const SizedBox(width: 4),
          Text('$label (${rating.reviews} avis)', style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
      ),
    );
  }
}
