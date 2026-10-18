import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/feedback.dart';
import '../data/social_api.dart';
import '../../wallet/presentation/gift_sheet.dart';
import '../data/social_models.dart';
import 'moderation_sheets.dart';
import 'social_widgets.dart';

/// Écran 12 — Commentaires, dans une feuille qui monte du bas. Réponses sur un niveau, j'aime, suppression par
/// l'auteur du commentaire ou de la publication, signalement. Pièces et « Encourager » : lot 9.
/// Renvoie le nombre de commentaires à jour (pour la carte de la publication).
Future<int?> showCommentsSheet(BuildContext context, String postId) => showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => FractionallySizedBox(heightFactor: 0.88, child: CommentsPanel(postId: postId)),
    );

class CommentsPanel extends ConsumerStatefulWidget {
  const CommentsPanel({super.key, required this.postId});

  final String postId;

  @override
  ConsumerState<CommentsPanel> createState() => _CommentsPanelState();
}

class _CommentsPanelState extends ConsumerState<CommentsPanel> {
  final _input = TextEditingController();
  final _focus = FocusNode();
  CommentsPage? _page;
  Object? _error;
  PostComment? _replyTo;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// Première page ; `pages` > 1 recharge aussi les suivantes (après un envoi, pour voir son commentaire
  /// même au-delà des 30 premiers, audit M-6).
  Future<void> _load({int pages = 1}) async {
    try {
      final api = ref.read(socialApiProvider);
      var p = await api.comments(widget.postId);
      for (var i = 1; i < pages && p.nextCursor != null; i++) {
        final next = await api.comments(widget.postId, cursor: p.nextCursor);
        p = CommentsPage(total: next.total, nextCursor: next.nextCursor, items: [...p.items, ...next.items]);
      }
      if (mounted) {
        setState(() {
          _page = p;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      final created = await ref.read(socialApiProvider).comment(widget.postId, text, parentId: _replyTo?.id);
      if (!mounted) return;
      _input.clear();
      final page = _page;
      if (created != null && page != null) {
        // Ajout local, à sa place (réponse sous son commentaire, sinon à la fin) : visible même au-delà des
        // 30 premiers, sans recharger toutes les pages (audit, M-6).
        final items = [...page.items];
        var at = items.length;
        if (created.parentId != null) {
          final i = items.lastIndexWhere((c) => c.id == created.parentId || c.parentId == created.parentId);
          if (i >= 0) at = i + 1;
        }
        items.insert(at, created);
        setState(() {
          _replyTo = null;
          _page = CommentsPage(total: page.total + 1, nextCursor: page.nextCursor, items: items);
        });
      } else {
        setState(() => _replyTo = null);
        await _load();
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  bool _loadingMore = false;

  Future<void> _more() async {
    final page = _page;
    if (page?.nextCursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ref.read(socialApiProvider).comments(widget.postId, cursor: page!.nextCursor);
      if (mounted) {
        setState(() {
          // Toujours à partir de la liste actuelle ; un commentaire ajouté localement n'apparaît pas deux fois.
          final current = _page ?? page;
          final known = current.items.map((c) => c.id).toSet();
          _page = CommentsPage(total: next.total, nextCursor: next.nextCursor, items: [...current.items, ...next.items.where((c) => !known.contains(c.id))]);
        });
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _like(PostComment c) async {
    try {
      final r = await ref.read(socialApiProvider).likeComment(c.id, on: !c.likedByMe);
      if (!mounted) return;
      setState(() {
        _page = CommentsPage(
          total: _page!.total,
          nextCursor: _page!.nextCursor,
          items: [for (final x in _page!.items) x.id == c.id ? x.copyWith(likeCount: r.likeCount, likedByMe: r.likedByMe) : x],
        );
      });
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  /// Lot 9 : pièces sur un commentaire (auteur Premium).
  Future<void> _coins(PostComment c) async {
    final total = await showGiftSheet(context, targetType: 'comment', targetId: c.id, recipientName: c.author.fullName);
    if (total == null || !mounted) return;
    setState(() {
      _page = CommentsPage(
        total: _page!.total,
        nextCursor: _page!.nextCursor,
        items: [for (final x in _page!.items) x.id == c.id ? x.copyWith(coinCount: total) : x],
      );
    });
  }

  Future<void> _menu(PostComment c) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (c.canDelete)
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded, color: BimColors.red),
                title: const Text('Supprimer le commentaire', style: TextStyle(color: BimColors.red)),
                onTap: () => Navigator.pop(ctx, 'delete'),
              ),
            if (!c.isMine) ListTile(leading: const Icon(Icons.flag_outlined), title: const Text('Signaler le commentaire'), onTap: () => Navigator.pop(ctx, 'report')),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (choice == 'report') await showReportContentSheet(context, ref, targetType: 'comment', targetId: c.id);
    if (choice == 'delete') {
      try {
        await ref.read(socialApiProvider).deleteComment(c.id);
        await _load();
      } on ApiException catch (e) {
        if (mounted) showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final page = _page;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, page?.total);
      },
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.md, BimSpacing.sm, BimSpacing.sm),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    page == null ? 'Commentaires' : '${page.total} commentaire${page.total > 1 ? 's' : ''}',
                    style: theme.textTheme.titleLarge,
                  ),
                ),
                IconButton(tooltip: 'Fermer', icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context, page?.total)),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _error != null
                ? Center(
                    child: TextButton(
                      onPressed: _load,
                      child: Text(_error is ApiException ? (_error! as ApiException).message : ApiException.unknown.message),
                    ),
                  )
                : page == null
                    ? const Center(child: CircularProgressIndicator())
                    : page.items.isEmpty
                        ? Center(child: Text('Sois la première personne à commenter 💬', style: theme.textTheme.bodyMedium))
                        : ListView(
                            padding: const EdgeInsets.symmetric(vertical: BimSpacing.sm),
                            children: [
                              for (final c in page.items) _CommentTile(comment: c, onLike: () => _like(c), onReply: () => _reply(c), onMore: () => _menu(c), onCoins: () => _coins(c)),
                              if (page.nextCursor != null)
                                Center(
                                  child: TextButton(
                                    key: const ValueKey('comments-more'),
                                    onPressed: _loadingMore ? null : _more,
                                    child: const Text('Voir plus de commentaires'),
                                  ),
                                ),
                            ],
                          ),
          ),
          if (_replyTo != null)
            Container(
              color: theme.colorScheme.surfaceContainerLow,
              padding: const EdgeInsets.only(left: BimSpacing.screen),
              child: Row(
                children: [
                  Expanded(child: Text('Réponse à @${_replyTo!.author.username}', style: theme.textTheme.bodySmall)),
                  IconButton(tooltip: 'Annuler la réponse', icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => _replyTo = null)),
                ],
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.sm, BimSpacing.sm + MediaQuery.viewInsetsOf(context).bottom),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const ValueKey('comment-input'),
                      controller: _input,
                      focusNode: _focus,
                      maxLength: 1000,
                      minLines: 1,
                      maxLines: 4,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(hintText: 'Ajoute un commentaire…', counterText: ''),
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('comment-send'),
                    tooltip: 'Envoyer',
                    icon: _sending
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.send_rounded, color: BimColors.red),
                    onPressed: _sending ? null : _send,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _reply(PostComment c) {
    setState(() => _replyTo = c);
    _focus.requestFocus();
  }
}

class _CommentTile extends StatelessWidget {
  const _CommentTile({required this.comment, required this.onLike, required this.onReply, required this.onMore, required this.onCoins});

  final PostComment comment;
  final VoidCallback onLike;
  final VoidCallback onReply;
  final VoidCallback onMore;
  final VoidCallback onCoins;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = comment;
    return Padding(
      padding: EdgeInsets.fromLTRB(c.isReply ? BimSpacing.screen + 44 : BimSpacing.screen, BimSpacing.sm, BimSpacing.sm, BimSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => context.push('/people/${c.author.username}'),
            child: PersonAvatar(person: c.author, size: c.isReply ? 30 : 40),
          ),
          const SizedBox(width: BimSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(text: c.author.fullName, style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: '  ${timeAgo(c.createdAt)}', style: theme.textTheme.bodySmall),
                  ],),
                ),
                const SizedBox(height: 2),
                Text(c.text),
                Row(
                  children: [
                    TextButton(onPressed: onReply, style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 36)), child: const Text('Répondre')),
                    const SizedBox(width: BimSpacing.sm),
                    IconButton(tooltip: 'Plus d’options', icon: const Icon(Icons.more_horiz_rounded, size: 20), onPressed: onMore),
                  ],
                ),
              ],
            ),
          ),
          Column(
            children: [
              IconButton(
                tooltip: c.likedByMe ? 'Je n’aime plus ce commentaire' : 'J’aime ce commentaire',
                icon: Icon(c.likedByMe ? Icons.favorite_rounded : Icons.favorite_border_rounded, size: 20, color: c.likedByMe ? BimColors.red : null),
                onPressed: onLike,
              ),
              Text(compactCount(c.likeCount), style: theme.textTheme.bodySmall),
              if (c.canGift || c.coinCount > 0)
                CoinButton(key: ValueKey('comment-coins-${c.id}'), count: c.coinCount, canGift: c.canGift, compact: true, onTap: c.canGift ? onCoins : null),
            ],
          ),
        ],
      ),
    );
  }
}
