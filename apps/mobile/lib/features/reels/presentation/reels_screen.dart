import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../social/presentation/moderation_sheets.dart';
import '../../social/data/social_models.dart' show compactCount;
import '../../wallet/presentation/gift_sheet.dart';
import '../data/reels_api.dart';

/// Lecteur d'un Reel : remplaçable dans les tests (le lecteur vidéo du téléphone n'existe pas dans un test).
typedef ReelPlayerBuilder = Widget Function(BuildContext context, Reel reel, bool active);

final reelPlayerBuilderProvider = Provider<ReelPlayerBuilder>((ref) => (context, reel, active) => NetworkReelPlayer(reel: reel, active: active));

/// Écran 15 — Reels : vidéos verticales, une par page ; j'aime, pièces, vues, signalement. Prototype : vidéos lues
/// depuis le stockage de BIM, sans service vidéo payant.
class ReelsScreen extends ConsumerStatefulWidget {
  const ReelsScreen({super.key});

  @override
  ConsumerState<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends ConsumerState<ReelsScreen> {
  final _items = <Reel>[];
  String? _cursor;
  bool _loading = true;
  bool _end = false;
  int _index = 0;
  final _viewed = <String>{};
  Object? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  bool _fetching = false;

  Future<void> _load() async {
    // Une seule page à la fois : deux défilements rapides ne chargent pas deux fois la même page.
    if (_fetching) return;
    _fetching = true;
    try {
      final page = await ref.read(reelsApiProvider).feed(cursor: _cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _end = page.nextCursor == null;
        _loading = false;
        _error = null;
      });
      if (_items.isNotEmpty) _markViewed(_items[_index]);
      _fetching = false;
    } on ApiException catch (e) {
      _fetching = false;
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e;
        });
      }
    }
  }

  void _markViewed(Reel r) {
    if (r.isMine || !_viewed.add(r.id)) return;
    unawaited(ref.read(reelsApiProvider).view(r.id).catchError((_) {}));
  }

  void _replace(Reel r) => setState(() {
        final i = _items.indexWhere((x) => x.id == r.id);
        if (i >= 0) _items[i] = r;
      });

  Future<void> _like(Reel r) async {
    final on = !r.likedByMe;
    _replace(r.copyWith(likedByMe: on, likeCount: r.likeCount + (on ? 1 : -1)));
    try {
      final res = await ref.read(reelsApiProvider).like(r.id, on: on);
      _replace(r.copyWith(likedByMe: res.likedByMe, likeCount: res.likeCount));
    } on ApiException catch (e) {
      _replace(r);
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _coins(Reel r) async {
    final total = await showGiftSheet(context, targetType: 'reel', targetId: r.id, recipientName: r.author.fullName);
    if (total != null) _replace(r.copyWith(coinCount: total));
  }

  Future<void> _more(Reel r) async {
    if (r.isMine) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Supprimer ce Reel ?'),
          content: const Text('La vidéo sera effacée.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Annuler')),
            TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Supprimer')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
      try {
        await ref.read(reelsApiProvider).remove(r.id);
        setState(() => _items.removeWhere((x) => x.id == r.id));
      } on ApiException catch (e) {
        if (mounted) showApiError(context, e);
      }
      return;
    }
    await showReportContentSheet(context, ref, targetType: 'reel', targetId: r.id);
  }

  @override
  Widget build(BuildContext context) {
    final builder = ref.watch(reelPlayerBuilderProvider);
    return Scaffold(
      backgroundColor: BimColors.black,
      body: SafeArea(
        child: Stack(
          children: [
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null)
              Center(child: Text(_error is ApiException ? (_error! as ApiException).message : ApiException.unknown.message, style: const TextStyle(color: BimColors.white)))
            else if (_items.isEmpty)
              const Center(child: Text('Pas encore de Reels. Publie le premier !', key: ValueKey('reels-empty'), style: TextStyle(color: BimColors.white)))
            else
              PageView.builder(
                key: const ValueKey('reels-pages'),
                scrollDirection: Axis.vertical,
                itemCount: _items.length,
                onPageChanged: (i) {
                  setState(() => _index = i);
                  _markViewed(_items[i]);
                  if (!_end && i >= _items.length - 2) unawaited(_load());
                },
                itemBuilder: (context, i) {
                  final r = _items[i];
                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      builder(context, r, i == _index),
                      _ReelOverlay(reel: r, onLike: () => _like(r), onCoins: () => _coins(r), onMore: () => _more(r)),
                    ],
                  );
                },
              ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Row(
                children: [
                  IconButton(tooltip: 'Retour', icon: const Icon(Icons.arrow_back_ios_new_rounded, color: BimColors.white), onPressed: () => context.pop()),
                  const Text('Reels', style: TextStyle(color: BimColors.white, fontSize: 20, fontWeight: FontWeight.w800)),
                  const Spacer(),
                  IconButton(
                    key: const ValueKey('reel-new'),
                    tooltip: 'Publier un Reel',
                    icon: const Icon(Icons.add_circle_outline_rounded, color: BimColors.white),
                    onPressed: () async {
                      final created = await context.push<Reel>('/reels/new');
                      if (created != null && mounted) setState(() => _items.insert(0, created));
                    },
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

class _ReelOverlay extends StatelessWidget {
  const _ReelOverlay({required this.reel, required this.onLike, required this.onCoins, required this.onMore});

  final Reel reel;
  final VoidCallback onLike;
  final VoidCallback onCoins;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    const shadow = [Shadow(blurRadius: 6, color: Color(0x99000000))];
    Widget action({required Key key, required IconData icon, required String label, Color color = BimColors.white, VoidCallback? onTap}) => Padding(
          padding: const EdgeInsets.only(bottom: BimSpacing.md),
          child: InkWell(
            key: key,
            onTap: onTap,
            child: Column(
              children: [
                Icon(icon, color: color, size: 32, shadows: shadow),
                Text(label, style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w700, shadows: shadow)),
              ],
            ),
          ),
        );
    return Padding(
      padding: const EdgeInsets.fromLTRB(BimSpacing.md, 0, BimSpacing.sm, BimSpacing.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onTap: () => context.push('/people/${reel.author.username}'),
                  child: Text('@${reel.author.username}', style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w800, shadows: shadow)),
                ),
                if ((reel.caption ?? '').isNotEmpty)
                  Text(reel.caption!, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: BimColors.white, shadows: shadow)),
                Text('${compactCount(reel.viewCount)} vues', key: ValueKey('reel-views-${reel.id}'), style: const TextStyle(color: BimColors.grey200, fontSize: 12, shadows: shadow)),
              ],
            ),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              action(
                key: ValueKey('reel-like-${reel.id}'),
                icon: reel.likedByMe ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                color: reel.likedByMe ? BimColors.red : BimColors.white,
                label: compactCount(reel.likeCount),
                onTap: onLike,
              ),
              if (reel.canGift || reel.coinCount > 0)
                action(
                  key: ValueKey('reel-coins-${reel.id}'),
                  icon: Icons.monetization_on_outlined,
                  color: reel.canGift ? BimColors.coin : BimColors.white,
                  label: compactCount(reel.coinCount),
                  onTap: reel.canGift ? onCoins : null,
                ),
              action(key: ValueKey('reel-more-${reel.id}'), icon: Icons.more_horiz_rounded, label: '', onTap: onMore),
            ],
          ),
        ],
      ),
    );
  }
}

/// Lecture de la vidéo (lien temporaire), en boucle ; en pause quand la page n'est pas affichée ; toucher = pause.
class NetworkReelPlayer extends StatefulWidget {
  const NetworkReelPlayer({super.key, required this.reel, required this.active});

  final Reel reel;
  final bool active;

  @override
  State<NetworkReelPlayer> createState() => _NetworkReelPlayerState();
}

class _NetworkReelPlayerState extends State<NetworkReelPlayer> {
  VideoPlayerController? _c;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final url = widget.reel.videoUrl;
    if (url == null) {
      _failed = true;
      return;
    }
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _c = c;
    unawaited(
      c.initialize().then((_) async {
        await c.setLooping(true);
        if (widget.active) await c.play();
        if (mounted) setState(() {});
      }).catchError((Object _) {
        if (mounted) setState(() => _failed = true);
      }),
    );
  }

  @override
  void didUpdateWidget(NetworkReelPlayer old) {
    super.didUpdateWidget(old);
    final c = _c;
    if (c == null || !c.value.isInitialized) return;
    if (widget.active && !c.value.isPlaying) unawaited(c.play());
    if (!widget.active && c.value.isPlaying) unawaited(c.pause());
  }

  @override
  void dispose() {
    unawaited(_c?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    if (_failed) return const Center(child: Text('Vidéo indisponible', style: TextStyle(color: BimColors.white)));
    if (c == null || !c.value.isInitialized) return const Center(child: CircularProgressIndicator());
    return GestureDetector(
      onTap: () {
        if (c.value.isPlaying) {
          unawaited(c.pause());
        } else {
          unawaited(c.play());
        }
        setState(() {});
      },
      child: Center(child: AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c))),
    );
  }
}

/// Publier un Reel : vidéo de la galerie (60 s au plus), légende, visibilité.
class ReelComposerScreen extends ConsumerStatefulWidget {
  const ReelComposerScreen({super.key});

  @override
  ConsumerState<ReelComposerScreen> createState() => _ReelComposerScreenState();
}

class _ReelComposerScreenState extends ConsumerState<ReelComposerScreen> {
  final _caption = TextEditingController();
  List<int>? _video;
  String _visibility = 'public';
  bool _busy = false;

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final bytes = await ref.read(videoSourceProvider).pick();
    if (bytes != null && mounted) setState(() => _video = bytes);
  }

  Future<void> _publish() async {
    final v = _video;
    if (v == null) return;
    setState(() => _busy = true);
    try {
      final r = await ref.read(reelsApiProvider).upload(v, caption: _caption.text, visibility: _visibility);
      if (!mounted) return;
      showBimSnack(context, 'Reel publié !');
      context.pop(r);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final v = _video;
    return Scaffold(
      appBar: AppBar(title: const Text('Nouveau Reel')),
      body: ListView(
        padding: const EdgeInsets.all(BimSpacing.screen),
        children: [
          BimButton(
            key: const ValueKey('reel-pick'),
            label: v == null ? 'Choisir une vidéo' : 'Changer de vidéo',
            variant: BimButtonVariant.outline,
            icon: Icons.video_library_outlined,
            onPressed: _busy ? null : _pick,
          ),
          if (v != null) ...[
            const SizedBox(height: BimSpacing.sm),
            Text('Vidéo choisie (${(v.length / (1024 * 1024)).toStringAsFixed(1)} Mo)', key: const ValueKey('reel-picked')),
          ],
          const SizedBox(height: BimSpacing.sm),
          Text('MP4, 60 secondes au plus. La position et les informations de l’appareil sont effacées.', style: theme.textTheme.bodySmall),
          const SizedBox(height: BimSpacing.md),
          TextField(key: const ValueKey('reel-caption'), controller: _caption, maxLength: 300, maxLines: 3, decoration: const InputDecoration(labelText: 'Légende')),
          Wrap(
            spacing: BimSpacing.sm,
            children: [
              ChoiceChip(label: const Text('Tout le monde'), selected: _visibility == 'public', onSelected: (_) => setState(() => _visibility = 'public')),
              ChoiceChip(label: const Text('Mes abonnés'), selected: _visibility == 'followers', onSelected: (_) => setState(() => _visibility = 'followers')),
            ],
          ),
          const SizedBox(height: BimSpacing.lg),
          BimButton(key: const ValueKey('reel-publish'), label: 'Publier', loading: _busy, onPressed: v == null || _busy ? null : _publish),
        ],
      ),
    );
  }
}
