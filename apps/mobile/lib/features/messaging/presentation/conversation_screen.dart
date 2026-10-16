import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../merchant/data/shop_api.dart' show formatFcfa;
import '../../projects/application/photo_source.dart';
import '../../social/presentation/moderation_sheets.dart';
import '../../social/presentation/social_widgets.dart';
import '../data/messaging_api.dart';

/// Délai entre deux mises à jour de la conversation ouverte (pas de notification sur le téléphone en 6-A).
const conversationRefresh = Duration(seconds: 5);

/// Lot 6-A — Une conversation : messages (texte, photo), « Vu », demande à accepter ou refuser, signalement.
/// Lot 6-B — Aussi avec une boutique (écran 48) : côté cliente (bandeau de l'article, « Commander » annoncé pour le
/// lot 7) ou côté boutique (`asShop`, depuis l'espace boutique, avec les réponses rapides).
class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key, required this.conversationId, this.refreshEvery = conversationRefresh, this.asShop = false});

  final String conversationId;
  final Duration? refreshEvery;
  /// Répondre au nom de la boutique active (espace boutique).
  final bool asShop;

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _input = TextEditingController();
  ConversationSummary? _conversation;
  List<ChatMessage> _messages = const [];
  String? _older;
  bool _loading = true;
  bool _sending = false;
  Object? _error;
  Timer? _timer;

  ConversationBackend get _api => widget.asShop ? ref.read(shopInboxApiProvider) : ref.read(messagingApiProvider);

  void _invalidateLists() {
    if (widget.asShop) {
      ref
        ..invalidate(shopInboxProvider)
        ..invalidate(shopInboxUnreadProvider);
    } else {
      ref
        ..invalidate(conversationsProvider)
        ..invalidate(messagesUnreadProvider);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
    final every = widget.refreshEvery;
    if (every != null) _timer = Timer.periodic(every, (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _input.dispose();
    super.dispose();
  }

  /// Première page + résumé (personne, statut de demande) ; la conversation est marquée lue.
  Future<void> _load() async {
    try {
      final summary = await _api.conversation(widget.conversationId);
      final page = await _api.messages(widget.conversationId);
      if (!mounted) return;
      setState(() {
        _messages = page.items;
        _older = page.nextBefore;
        _conversation = summary;
        _loading = false;
        _error = null;
      });
      await _markRead();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  /// Nouveaux messages et statuts « Vu » ; erreurs silencieuses (nouvel essai au tour suivant).
  Future<void> _refresh() async {
    if (_loading || _sending) return;
    try {
      final page = await _api.messages(widget.conversationId);
      if (!mounted) return;
      final latestIds = page.items.map((m) => m.id).toSet();
      setState(() => _messages = [...page.items, ..._messages.where((m) => !latestIds.contains(m.id))]);
      await _markRead();
    } catch (_) {}
  }

  Future<void> _markRead() async {
    if (_conversation?.isRequest ?? false) return; // lire une demande ne prévient pas son auteur
    try {
      await _api.read(widget.conversationId);
      ref.invalidate(widget.asShop ? shopInboxUnreadProvider : messagesUnreadProvider);
    } catch (_) {}
  }

  Future<void> _more() async {
    final before = _older;
    if (before == null) return;
    try {
      final page = await _api.messages(widget.conversationId, before: before);
      if (!mounted) return;
      setState(() {
        _messages = [..._messages, ...page.items];
        _older = page.nextBefore;
      });
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _send({List<int>? photo}) async {
    final text = _input.text.trim();
    if (photo == null && text.isEmpty) return;
    setState(() => _sending = true);
    try {
      final m = photo != null ? await _api.sendPhoto(widget.conversationId, photo) : await _api.sendText(widget.conversationId, text);
      if (!mounted) return;
      if (photo == null) _input.clear();
      setState(() => _messages = [m, ..._messages]);
      // Répondre à une demande vaut acceptation : statut mis à jour.
      if (_conversation?.isRequest ?? false) {
        final updated = await _api.conversation(widget.conversationId);
        if (mounted) setState(() => _conversation = updated);
      }
      ref.invalidate(widget.asShop ? shopInboxProvider : conversationsProvider);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickPhoto() async {
    final bytes = await ref.read(photoSourceProvider).pick(camera: false);
    if (bytes != null) await _send(photo: bytes);
  }

  Future<void> _answerRequest(bool accept) async {
    try {
      final api = ref.read(messagingApiProvider);
      if (accept) {
        await api.accept(widget.conversationId);
        await _load();
      } else {
        await api.decline(widget.conversationId);
        if (mounted) context.canPop() ? context.pop() : context.go('/home');
      }
      _invalidateLists();
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _messageMenu(ChatMessage m) async {
    if (!m.visible) return;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (m.mine)
              ListTile(key: const ValueKey('message-delete'), leading: const Icon(Icons.delete_outline), title: const Text('Supprimer pour tout le monde'), onTap: () => Navigator.pop(ctx, 'delete'))
            else
              ListTile(key: const ValueKey('message-report'), leading: const Icon(Icons.flag_outlined), title: const Text('Signaler ce message'), onTap: () => Navigator.pop(ctx, 'report')),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'report') {
      await showReportContentSheet(context, ref, targetType: 'message', targetId: m.id);
      return;
    }
    try {
      await _api.deleteMessage(m.id);
      if (mounted) setState(() => _messages = [for (final x in _messages) x.id == m.id ? ChatMessage(id: x.id, mine: true, kind: x.kind, status: 'deleted', createdAt: x.createdAt) : x]);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = _conversation;
    final lastMineRead = _messages.where((m) => m.mine && m.visible).firstOrNull;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.sm, BimSpacing.sm, BimSpacing.screen, BimSpacing.sm),
              child: Row(
                children: [
                  const BimBackButton(),
                  const SizedBox(width: BimSpacing.sm),
                  if (c != null) ...[
                    InkWell(
                      key: const ValueKey('conversation-counterpart'),
                      onTap: () => c.shop != null ? context.push('/bimshop/shops/${c.shop!.slug}') : (c.person != null ? context.push('/people/${c.person!.username}') : null),
                      child: c.shop != null ? ShopAvatar(shop: c.shop!) : (c.person != null ? PersonAvatar(person: c.person!) : const SizedBox(width: 40, height: 40)),
                    ),
                    const SizedBox(width: BimSpacing.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(child: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleMedium)),
                              if (c.shop?.verified ?? false) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: BimColors.red)),
                            ],
                          ),
                          Text(widget.asShop ? 'Client · @${c.person?.username ?? ''}' : c.subtitle, style: theme.textTheme.bodySmall),
                        ],
                      ),
                    ),
                  ] else
                    const Spacer(),
                ],
              ),
            ),
            const Divider(height: 1),
            if (c?.context != null) _ContextBanner(info: c!.context!, asShop: widget.asShop),
            if (c?.pendingForOther ?? false)
              Container(
                width: double.infinity,
                color: theme.colorScheme.surfaceContainerLow,
                padding: const EdgeInsets.all(BimSpacing.md),
                child: Text('Cette personne ne te suit pas : ton message arrive dans ses demandes.', style: theme.textTheme.bodySmall),
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(BimSpacing.xl),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(_error is ApiException ? (_error! as ApiException).message : ApiException.unknown.message, textAlign: TextAlign.center),
                                const SizedBox(height: BimSpacing.md),
                                BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _load),
                              ],
                            ),
                          ),
                        )
                      : ListView.builder(
                          key: const ValueKey('messages-list'),
                          reverse: true,
                          padding: const EdgeInsets.all(BimSpacing.md),
                          itemCount: _messages.length + (_older != null ? 1 : 0),
                          itemBuilder: (_, i) {
                            if (i == _messages.length) {
                              return Center(child: TextButton(key: const ValueKey('messages-older'), onPressed: _more, child: const Text('Messages précédents')));
                            }
                            final m = _messages[i];
                            return _Bubble(message: m, showRead: identical(m, lastMineRead) && (m.read ?? false), onLongPress: () => _messageMenu(m));
                          },
                        ),
            ),
            if (c?.isRequest ?? false)
              Padding(
                padding: const EdgeInsets.all(BimSpacing.md),
                child: Column(
                  children: [
                    Text('${c!.title} veut t’envoyer un message.', textAlign: TextAlign.center),
                    const SizedBox(height: BimSpacing.sm),
                    Row(
                      children: [
                        Expanded(child: BimButton(key: const ValueKey('request-decline'), label: 'Refuser', variant: BimButtonVariant.outline, onPressed: () => _answerRequest(false))),
                        const SizedBox(width: BimSpacing.sm),
                        Expanded(child: BimButton(key: const ValueKey('request-accept'), label: 'Accepter', onPressed: () => _answerRequest(true))),
                      ],
                    ),
                  ],
                ),
              )
            else ...[
              if (widget.asShop) _QuickReplies(onPick: (t) => setState(() => _input.text = t)),
              Padding(
                padding: EdgeInsets.fromLTRB(BimSpacing.sm, BimSpacing.xs, BimSpacing.sm, BimSpacing.sm + MediaQuery.viewInsetsOf(context).bottom),
                child: Row(
                  children: [
                    IconButton(key: const ValueKey('message-photo'), tooltip: 'Envoyer une photo', icon: const Icon(Icons.photo_outlined), onPressed: _sending ? null : _pickPhoto),
                    Expanded(
                      child: TextField(
                        key: const ValueKey('message-input'),
                        controller: _input,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 2000,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(hintText: 'Message…', counterText: ''),
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('message-send'),
                      tooltip: 'Envoyer',
                      icon: _sending ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, color: BimColors.red),
                      onPressed: _sending ? null : _send,
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.showRead, required this.onLongPress});

  final ChatMessage message;
  final bool showRead;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final m = message;
    final bg = m.mine ? BimColors.red : scheme.surfaceContainerHighest;
    final fg = m.mine ? Colors.white : scheme.onSurface;
    final Widget content = switch (m.status) {
      'deleted' => Text('Message supprimé', style: TextStyle(color: fg, fontStyle: FontStyle.italic)),
      'hidden' => Text('Message masqué par la modération', style: TextStyle(color: fg, fontStyle: FontStyle.italic)),
      // Type à venir (cartes de commande, lot 7) : jamais de bulle vide.
      _ when !m.supported => Text('Ce message s’affiche dans une version plus récente de BIM.', key: const ValueKey('message-unsupported'), style: TextStyle(color: fg, fontStyle: FontStyle.italic)),
      _ => m.kind == 'photo'
          ? ClipRRect(
              borderRadius: BorderRadius.circular(BimRadius.chip),
              child: m.photoUrl == null
                  ? const SizedBox(width: 180, height: 180, child: Icon(Icons.image_outlined))
                  : Image.network(m.photoUrl!, width: 220, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined)),
            )
          : Text(m.text ?? '', style: TextStyle(color: fg, fontSize: 16)),
    };
    return Align(
      alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: m.mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          GestureDetector(
            key: ValueKey('message-${m.id}'),
            onLongPress: onLongPress,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 280),
              margin: const EdgeInsets.symmetric(vertical: 3),
              padding: m.kind == 'photo' && m.visible ? const EdgeInsets.all(4) : const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(BimRadius.card)),
              child: content,
            ),
          ),
          if (showRead) Text('Vu', key: const ValueKey('message-read'), style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// Avatar d'une boutique (logo, sinon icône).
class ShopAvatar extends StatelessWidget {
  const ShopAvatar({super.key, required this.shop, this.size = 40});

  final ChatShop shop;
  final double size;

  @override
  Widget build(BuildContext context) => CircleAvatar(
        radius: size / 2,
        backgroundColor: BimColors.redSoft,
        foregroundImage: shop.logoUrl == null ? null : NetworkImage(shop.logoUrl!),
        child: Icon(Icons.storefront_outlined, color: BimColors.red, size: size * 0.5),
      );
}

/// Bandeau de l'écran 48 : l'article dont on parle (prix, disponible ou épuisé, jamais le stock) ou l'offre de projet.
/// « Commander » annonce les commandes (lot 7) : aucune commande ni paiement ici.
class _ContextBanner extends StatelessWidget {
  const _ContextBanner({required this.info, required this.asShop});

  final ChatContext info;
  final bool asShop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final p = info.product;
    return Container(
      key: const ValueKey('conversation-context'),
      width: double.infinity,
      color: theme.colorScheme.surfaceContainerLow,
      padding: const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
      child: p == null
          ? Row(
              children: [
                const Icon(Icons.assignment_outlined, size: 20),
                const SizedBox(width: BimSpacing.sm),
                Expanded(
                  child: Text(
                    asShop ? 'Réponse à ton offre de projet' : 'À propos de l’offre pour ton projet « ${info.offerProjectTitle ?? ''} »',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            )
          : InkWell(
              onTap: asShop ? null : () => context.push('/bimshop/products/${p.id}'),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(BimRadius.chip),
                    child: SizedBox(
                      width: 48,
                      height: 48,
                      child: p.imageUrl == null ? const Icon(Icons.image_outlined) : Image.network(p.imageUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.image_outlined)),
                    ),
                  ),
                  const SizedBox(width: BimSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall),
                        Text('${formatFcfa(p.priceFcfa)} · ${p.available ? (p.kind == 'service' ? 'disponible' : 'en stock') : 'épuisé'}', style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                  if (!asShop)
                    FilledButton(
                      key: const ValueKey('chat-order'),
                      style: FilledButton.styleFrom(backgroundColor: BimColors.red, foregroundColor: Colors.white),
                      onPressed: p.available ? () => showComingSoon(context, feature: p.kind == 'service' ? 'La réservation' : 'La commande') : null,
                      child: Text(p.kind == 'service' ? 'Réserver' : 'Commander'),
                    ),
                ],
              ),
            ),
    );
  }
}

/// Réponses rapides de la boutique (écran 51), au-dessus de la saisie : un appui remplit le message.
class _QuickReplies extends ConsumerWidget {
  const _QuickReplies({required this.onPick});

  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(shopQuickRepliesProvider).valueOrNull ?? const [];
    if (items.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 44,
      child: ListView(
        key: const ValueKey('quick-replies'),
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm),
        children: [
          for (final q in items)
            Padding(
              padding: const EdgeInsets.only(right: BimSpacing.xs),
              child: ActionChip(key: ValueKey('quick-reply-${q.id}'), label: Text(q.text), onPressed: () => onPick(q.text)),
            ),
        ],
      ),
    );
  }
}
