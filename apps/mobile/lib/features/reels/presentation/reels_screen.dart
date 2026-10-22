import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/certified_badge.dart';
import '../../social/presentation/moderation_sheets.dart';
import '../../social/data/social_models.dart' show compactCount;
import '../../wallet/presentation/gift_sheet.dart';
import '../data/reels_api.dart';

/// Lecteur d'un Reel : remplaçable dans les tests (le lecteur vidéo du téléphone n'existe pas dans un test).
typedef ReelPlayerBuilder = Widget Function(BuildContext context, Reel reel, bool active);

final reelPlayerBuilderProvider = Provider<ReelPlayerBuilder>(
  (ref) => (context, reel, active) => NetworkReelPlayer(
        reel: reel,
        active: active,
        // Lien de la vidéo expiré : l'écran des Reels redemande des liens neufs.
        onRetry: context.findAncestorStateOfType<_ReelsScreenState>()?._refreshUrls,
      ),
);

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
      // Les Reels déjà affichés (publiés entre-temps en tête de liste) ne sont pas ajoutés deux fois.
      final known = {for (final r in _items) r.id};
      setState(() {
        _items.addAll(page.items.where((r) => !known.contains(r.id)));
        _cursor = page.nextCursor;
        _end = page.nextCursor == null;
        _loading = false;
        _error = null;
      });
      if (_items.isNotEmpty) _markViewed(_items[_index.clamp(0, _items.length - 1)]);
    } catch (e) {
      // Toute erreur (même inattendue) est affichée ; le chargement suivant reste possible.
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e;
        });
      }
    } finally {
      _fetching = false;
    }
  }

  /// Liens temporaires des vidéos renouvelés (première page du fil) ; les Reels affichés gardent leur place.
  Future<void> _refreshUrls() async {
    final page = await ref.read(reelsApiProvider).feed();
    if (!mounted) return;
    final fresh = {for (final r in page.items) r.id: r};
    setState(() {
      for (var i = 0; i < _items.length; i++) {
        final f = fresh[_items[i].id];
        if (f != null) _items[i] = f;
      }
    });
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
      if (mounted) _replace(r.copyWith(likedByMe: res.likedByMe, likeCount: res.likeCount));
    } on ApiException catch (e) {
      if (mounted) _replace(r);
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _coins(Reel r) async {
    final total = await showGiftSheet(context, targetType: 'reel', targetId: r.id, recipientName: r.author.fullName);
    if (total != null && mounted) _replace(r.copyWith(coinCount: total));
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
        if (!mounted) return;
        setState(() {
          _items.removeWhere((x) => x.id == r.id);
          if (_index >= _items.length) _index = _items.isEmpty ? 0 : _items.length - 1;
        });
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
    // Un autre écran par-dessus (profil, publication, signalement) : la vidéo se met en pause.
    final routeVisible = ModalRoute.of(context)?.isCurrent ?? true;
    return Scaffold(
      backgroundColor: BimColors.black,
      body: SafeArea(
        child: Stack(
          children: [
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null && _items.isEmpty)
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
                // Chaque page est liée à l'identifiant de son Reel : après un ajout ou une suppression, le lecteur d'une
                // vidéo n'est jamais réutilisé pour une autre.
                findChildIndexCallback: (key) {
                  final id = key is ValueKey<String> ? key.value.replaceFirst('reel-page-', '') : null;
                  final i = _items.indexWhere((x) => x.id == id);
                  return i >= 0 ? i : null;
                },
                itemBuilder: (context, i) {
                  final r = _items[i];
                  return Stack(
                    key: ValueKey('reel-page-${r.id}'),
                    fit: StackFit.expand,
                    children: [
                      KeyedSubtree(key: ValueKey('reel-player-${r.id}'), child: builder(context, r, i == _index && routeVisible)),
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
                      // Le nouveau Reel prend la première page (celle affichée si on était en haut du fil) ;
                      // grâce aux clés, chaque lecteur garde sa propre vidéo.
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
                  child: NameWithBadge(certified: reel.author.certified, name: Text('@${reel.author.username}', style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w800, shadows: shadow))),
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
/// Vidéo illisible (lien expiré, réseau) : « Réessayer » redemande des liens neufs ([onRetry]) puis relance la lecture.
class NetworkReelPlayer extends StatefulWidget {
  const NetworkReelPlayer({super.key, required this.reel, required this.active, this.onRetry});

  final Reel reel;
  final bool active;
  final Future<void> Function()? onRetry;

  @override
  State<NetworkReelPlayer> createState() => _NetworkReelPlayerState();
}

class _NetworkReelPlayerState extends State<NetworkReelPlayer> {
  VideoPlayerController? _c;
  bool _failed = false;
  bool _retrying = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  void _init() {
    final old = _c;
    _c = null;
    if (old != null) unawaited(old.dispose());
    final url = widget.reel.videoUrl;
    if (url == null) {
      _failed = true;
      return;
    }
    _failed = false;
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _c = c;
    // Erreur pendant la lecture (lien expiré en cours de route) : même écran « Réessayer ».
    c.addListener(() {
      if (c.value.hasError && identical(_c, c) && !_failed && mounted) setState(() => _failed = true);
    });
    unawaited(
      c.initialize().then((_) async {
        if (!identical(_c, c)) return;
        await c.setLooping(true);
        if (widget.active) await c.play();
        if (mounted) setState(() {});
      }).catchError((Object _) {
        if (mounted && identical(_c, c)) setState(() => _failed = true);
      }),
    );
  }

  Future<void> _retry() async {
    setState(() => _retrying = true);
    try {
      await widget.onRetry?.call();
    } catch (_) {
      // Liens non renouvelés : on réessaie quand même avec le lien actuel.
    }
    if (!mounted) return;
    setState(() {
      _retrying = false;
      // Si de nouveaux liens sont arrivés, didUpdateWidget a déjà relancé la lecture.
      if (_failed) _init();
    });
  }

  @override
  void didUpdateWidget(NetworkReelPlayer old) {
    super.didUpdateWidget(old);
    if (old.reel.id != widget.reel.id || old.reel.videoUrl != widget.reel.videoUrl) {
      _init();
      return;
    }
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
    if (_failed) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Vidéo indisponible', style: TextStyle(color: BimColors.white)),
            const SizedBox(height: BimSpacing.sm),
            TextButton(
              key: ValueKey('reel-retry-${widget.reel.id}'),
              onPressed: _retrying ? null : _retry,
              child: const Text('Réessayer', style: TextStyle(color: BimColors.white)),
            ),
          ],
        ),
      );
    }
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
    final bytes = await pickWithFeedback(context, () async {
      final b = await ref.read(videoSourceProvider).pick();
      // Vidéo trop lourde : refusée tout de suite, sans attendre un long envoi que le serveur rejetterait.
      if (b != null) checkVideoSize(b.length);
      return b;
    });
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
      if (mounted) showApiError(context, e);
    } finally {
      // Réponse inattendue comprise : le bouton « Publier » ne reste jamais bloqué.
      if (mounted) setState(() => _busy = false);
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
