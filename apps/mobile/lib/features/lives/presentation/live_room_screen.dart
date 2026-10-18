import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../wallet/data/wallet_api.dart' show coinsLabel;
import '../../wallet/presentation/gift_sheet.dart';
import '../data/lives_api.dart';

/// Écrans 40, 43 et 44 — Live en cours : spectateurs, commentaires, cœurs, cadeaux animés (visibles par tous), article
/// épinglé avec « Commander » (Live vente). Prototype : aucune vidéo, l'état est relu toutes les 2 secondes.
class LiveRoomScreen extends ConsumerStatefulWidget {
  const LiveRoomScreen({super.key, required this.liveId, this.pollEvery});

  final String liveId;

  /// Tests : fréquence de lecture imposée (sinon celle donnée par l'API).
  final Duration? pollEvery;

  @override
  ConsumerState<LiveRoomScreen> createState() => _LiveRoomScreenState();
}

class _LiveRoomScreenState extends ConsumerState<LiveRoomScreen> {
  LiveSummary? _live;
  final _comments = <LiveComment>[];
  String? _after;
  String? _giftsAfter;
  LiveGiftEvent? _shownGift;
  final _seenGifts = <String>{};
  Timer? _poll;
  Timer? _giftTimer;
  Object? _error;
  final _input = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _giftTimer?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final s = await ref.read(livesApiProvider).state(widget.liveId, after: _after, giftsAfter: _giftsAfter);
      if (!mounted) return;
      setState(() {
        _error = null;
        _live = s.live;
        _comments.addAll(s.comments.where((c) => !_comments.any((x) => x.id == c.id)));
        if (_comments.length > 60) _comments.removeRange(0, _comments.length - 60);
        _after = s.nextAfter;
        _giftsAfter = s.nextGiftsAfter;
        // Les lectures se recouvrent un peu : un cadeau déjà montré ne s'affiche pas deux fois.
        final fresh = s.gifts.where((g) => _seenGifts.add(g.id)).toList();
        if (fresh.isNotEmpty) _showGift(fresh.last);
      });
      _poll?.cancel();
      _poll = Timer(widget.pollEvery ?? Duration(seconds: s.pollSeconds), () => unawaited(_refresh()));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
      // Une erreur passagère (réseau, trop de lectures) n'arrête pas le Live : nouvel essai un peu plus tard.
      _poll?.cancel();
      _poll = Timer(widget.pollEvery ?? const Duration(seconds: 5), () => unawaited(_refresh()));
    }
  }

  /// Animation du cadeau, visible par tous les spectateurs (écran 43).
  void _showGift(LiveGiftEvent g) {
    _shownGift = g;
    _giftTimer?.cancel();
    _giftTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _shownGift = null);
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      await ref.read(livesApiProvider).comment(widget.liveId, text);
      _input.clear();
      await _refresh();
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// L'hôte retire un commentaire (appui long).
  Future<void> _removeComment(LiveComment c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Retirer ce commentaire ?'),
        content: Text('« ${c.text} »'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Annuler')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Retirer')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(livesApiProvider).hideComment(widget.liveId, c.id);
      if (mounted) setState(() => _comments.removeWhere((x) => x.id == c.id));
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _heart() async {
    final l = _live;
    if (l == null) return;
    setState(() => _live = l.copyWith(heartCount: l.heartCount + 1));
    try {
      await ref.read(livesApiProvider).hearts(widget.liveId, 1);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _gift() async {
    final l = _live;
    if (l == null) return;
    final total = await showGiftSheet(context, targetType: 'live', targetId: l.id, recipientName: l.displayName);
    if (total != null) await _refresh();
  }

  Future<void> _hostAction(Future<LiveSummary> Function(String id) call) async {
    try {
      final l = await call(widget.liveId);
      if (mounted) setState(() => _live = l);
      await _refresh();
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = _live;
    final api = ref.read(livesApiProvider);
    return Scaffold(
      backgroundColor: BimColors.black,
      body: SafeArea(
        child: l == null
            ? Center(
                child: _error == null
                    ? const CircularProgressIndicator()
                    : Text(_error is ApiException ? (_error! as ApiException).message : ApiException.unknown.message, style: const TextStyle(color: BimColors.white)),
              )
            : Stack(
                children: [
                  // Pas de service vidéo dans le prototype : une scène neutre à la place de l'image.
                  const Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [BimColors.grey900, BimColors.black])),
                    ),
                  ),
                  const Align(
                    alignment: Alignment(0, -0.35),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Peni(pose: PeniPose.wave, size: 96),
                        SizedBox(height: BimSpacing.sm),
                        Text('Vidéo en direct : bientôt (mode démo)', key: ValueKey('live-no-video'), style: TextStyle(color: BimColors.grey200)),
                      ],
                    ),
                  ),
                  Column(
                    children: [
                      _TopBar(live: l),
                      const Spacer(),
                      if (l.pinnedProduct != null) _PinnedCard(product: l.pinnedProduct!),
                      _CommentsList(comments: _comments, onRemove: l.isMine ? _removeComment : null),
                      if (l.isLive) _BottomBar(input: _input, sending: _sending, live: l, onSend: _send, onHeart: _heart, onGift: _gift),
                      if (l.isMine && l.status == 'scheduled')
                        Padding(
                          padding: const EdgeInsets.all(BimSpacing.md),
                          child: FilledButton(key: const ValueKey('live-start'), onPressed: () => _hostAction(api.start), child: const Text('Commencer le Live')),
                        ),
                      if (l.status == 'ended')
                        const Padding(
                          padding: EdgeInsets.all(BimSpacing.lg),
                          child: Text('Ce Live est terminé.', key: ValueKey('live-ended'), style: TextStyle(color: BimColors.white, fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                  Positioned(
                    top: BimSpacing.sm,
                    right: BimSpacing.sm,
                    child: Row(
                      children: [
                        if (l.isMine && l.status != 'ended')
                          TextButton(
                            key: const ValueKey('live-end'),
                            onPressed: () => _hostAction(api.end),
                            child: Text(l.isLive ? 'Terminer' : 'Annuler', style: const TextStyle(color: BimColors.white)),
                          ),
                        IconButton(tooltip: 'Fermer', icon: const Icon(Icons.close_rounded, color: BimColors.white), onPressed: () => context.pop()),
                      ],
                    ),
                  ),
                  if (_shownGift != null)
                    Align(
                      alignment: const Alignment(0, 0.1),
                      child: Container(
                        key: const ValueKey('live-gift-anim'),
                        padding: const EdgeInsets.all(BimSpacing.md),
                        decoration: BoxDecoration(color: BimColors.white.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(BimRadius.card)),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            GiftArt(code: _shownGift!.giftCode, size: 72),
                            Text('${_shownGift!.from ?? 'Quelqu’un'} · ${coinsLabel(_shownGift!.coins)} pièces', style: const TextStyle(fontWeight: FontWeight.w800)),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.live});

  final LiveSummary live;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.md, BimSpacing.sm, 120, BimSpacing.sm),
        child: Row(
          children: [
            if (live.isLive)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: BimColors.red, borderRadius: BorderRadius.circular(6)),
                child: const Text('EN DIRECT', style: TextStyle(color: BimColors.white, fontSize: 11, fontWeight: FontWeight.w800)),
              ),
            const SizedBox(width: BimSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(live.displayName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w700)),
                  Text(live.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: BimColors.grey200, fontSize: 12)),
                ],
              ),
            ),
            const Icon(Icons.visibility_outlined, color: BimColors.white, size: 16),
            const SizedBox(width: 4),
            Text('${live.viewers}', key: const ValueKey('live-viewers'), style: const TextStyle(color: BimColors.white)),
            const SizedBox(width: BimSpacing.sm),
            const Icon(Icons.favorite_rounded, color: BimColors.red, size: 16),
            const SizedBox(width: 4),
            Text(coinsLabel(live.heartCount), key: const ValueKey('live-hearts'), style: const TextStyle(color: BimColors.white)),
          ],
        ),
      );
}

class _PinnedCard extends StatelessWidget {
  const _PinnedCard({required this.product});

  final PinnedProduct product;

  @override
  Widget build(BuildContext context) => Container(
        key: const ValueKey('live-pinned'),
        margin: const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
        padding: const EdgeInsets.all(BimSpacing.sm),
        decoration: BoxDecoration(color: BimColors.white, borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: Row(
          children: [
            const Icon(Icons.push_pin_rounded, color: BimColors.red),
            const SizedBox(width: BimSpacing.sm),
            Expanded(
              child: Text('${product.title} · ${coinsLabel(product.displayPrice)} F', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: BimColors.black, fontWeight: FontWeight.w700)),
            ),
            FilledButton(
              onPressed: () => context.push('/bimshop/products/${product.id}'),
              style: FilledButton.styleFrom(backgroundColor: BimColors.red, foregroundColor: BimColors.white),
              child: const Text('Commander'),
            ),
          ],
        ),
      );
}

class _CommentsList extends StatelessWidget {
  const _CommentsList({required this.comments, this.onRemove});

  final List<LiveComment> comments;

  /// Hôte seulement : appui long pour retirer un commentaire.
  final ValueChanged<LiveComment>? onRemove;

  @override
  Widget build(BuildContext context) {
    final last = comments.length > 8 ? comments.sublist(comments.length - 8) : comments;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: BimSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final c in last)
            GestureDetector(
              key: ValueKey('live-comment-${c.id}'),
              onLongPress: onRemove == null ? null : () => onRemove!(c),
              child: Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: '${c.author}  ', style: const TextStyle(fontWeight: FontWeight.w700, color: BimColors.grey200)),
                      TextSpan(text: c.text, style: const TextStyle(color: BimColors.white)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.input, required this.sending, required this.live, required this.onSend, required this.onHeart, required this.onGift});

  final TextEditingController input;
  final bool sending;
  final LiveSummary live;
  final VoidCallback onSend;
  final VoidCallback onHeart;
  final VoidCallback onGift;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(BimSpacing.md, BimSpacing.sm, BimSpacing.sm, BimSpacing.sm + MediaQuery.viewInsetsOf(context).bottom),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                key: const ValueKey('live-comment-input'),
                controller: input,
                maxLength: 300,
                style: const TextStyle(color: BimColors.white),
                decoration: const InputDecoration(hintText: 'Commenter…', counterText: '', hintStyle: TextStyle(color: BimColors.grey400)),
                onSubmitted: (_) => onSend(),
              ),
            ),
            IconButton(key: const ValueKey('live-comment-send'), tooltip: 'Envoyer', onPressed: sending ? null : onSend, icon: const Icon(Icons.send_rounded, color: BimColors.white)),
            IconButton(key: const ValueKey('live-heart'), tooltip: 'Envoyer un cœur', onPressed: onHeart, icon: const Icon(Icons.favorite_rounded, color: BimColors.red)),
            if (live.canGift)
              IconButton(key: const ValueKey('live-gift'), tooltip: 'Envoyer un cadeau', onPressed: onGift, icon: const Icon(Icons.card_giftcard_rounded, color: BimColors.coin)),
          ],
        ),
      );
}
