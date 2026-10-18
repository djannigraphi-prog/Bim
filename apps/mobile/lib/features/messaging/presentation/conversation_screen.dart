import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../merchant/data/shop_api.dart';
import '../../orders/data/orders_api.dart';
import '../../projects/application/photo_source.dart';
import '../../social/presentation/moderation_sheets.dart';
import '../../social/presentation/social_widgets.dart';
import '../application/voice.dart';
import '../data/messaging_api.dart';

/// Délai entre deux mises à jour de la conversation ouverte (pas de notification sur le téléphone en 6-A).
const conversationRefresh = Duration(seconds: 5);

/// Lot 6-A — Une conversation : messages (texte, photo), « Vu », demande à accepter ou refuser, signalement.
/// Lot 6-B — Aussi avec une boutique (écran 48) : côté cliente (bandeau de l'article, « Commander » annoncé pour le
/// lot 7) ou côté boutique (`asShop`, depuis l'espace boutique, avec les réponses rapides).
/// Lot 6-C — Réagir à un message (appui long : un émoji, une réaction par personne ou par boutique) et répondre en le
/// citant.
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
  /// 6-C : message auquel je réponds (bandeau au-dessus de la saisie).
  ChatMessage? _replyTo;
  Timer? _timer;
  /// V1 : enregistrement d'un message vocal en cours.
  VoiceRecorder? _recorder;
  Timer? _recTimer;
  Duration _recElapsed = Duration.zero;

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
    _recTimer?.cancel();
    if (_recorder != null) unawaited(_recorder!.cancel());
    _input.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------------ V1 : messages vocaux

  Future<void> _startRecording() async {
    final rec = ref.read(voiceRecorderProvider);
    bool ok;
    try {
      ok = await rec.start();
    } catch (_) {
      ok = false;
    }
    if (!mounted) return;
    if (!ok) {
      showBimSnack(context, 'Autorise le micro dans les réglages du téléphone pour envoyer un vocal.');
      return;
    }
    setState(() {
      _recorder = rec;
      _recElapsed = Duration.zero;
    });
    _recTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _recElapsed += const Duration(seconds: 1));
      // 2 minutes au plus : envoyé automatiquement.
      if (_recElapsed >= voiceMaxDuration) unawaited(_stopRecording(send: true));
    });
  }

  Future<void> _stopRecording({required bool send}) async {
    final rec = _recorder;
    if (rec == null) return;
    _recTimer?.cancel();
    setState(() => _recorder = null);
    if (!send) {
      await rec.cancel();
      return;
    }
    final bytes = await rec.stop();
    if (bytes == null || bytes.isEmpty || _recElapsed < const Duration(seconds: 1)) {
      if (mounted) showBimSnack(context, 'Vocal trop court : garde le micro au moins une seconde.');
      return;
    }
    await _send(voice: bytes);
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

  Future<void> _send({List<int>? photo, List<int>? voice}) async {
    final text = _input.text.trim();
    final media = photo != null || voice != null;
    if (!media && text.isEmpty) return;
    setState(() => _sending = true);
    try {
      final m = photo != null
          ? await _api.sendPhoto(widget.conversationId, photo)
          : voice != null
              ? await _api.sendVoice(widget.conversationId, voice)
              : await _api.sendText(widget.conversationId, text, replyToId: _replyTo?.id);
      if (!mounted) return;
      if (!media) _input.clear();
      setState(() {
        _messages = [m, ..._messages];
        if (!media) _replyTo = null;
      });
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

  Future<void> _propose() async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ProposalSheet(conversationId: widget.conversationId),
    );
    if (sent == true) {
      await _refresh();
      if (mounted) showBimSnack(context, 'Proposition envoyée');
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

  /// 6-C : poser, changer ou retirer (même émoji) ma réaction ; le serveur renvoie le message à jour.
  Future<void> _react(ChatMessage m, String emoji) async {
    try {
      final updated = await _api.react(m.id, m.myReaction == emoji ? null : emoji);
      if (mounted) setState(() => _messages = [for (final x in _messages) x.id == m.id ? updated : x]);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _messageMenu(ChatMessage m) async {
    if (!m.visible || m.isSystem) return;
    // Demande pas encore acceptée : ni réaction ni réponse (lire une demande ne prévient pas son auteur).
    final canAnswer = !(_conversation?.isRequest ?? false);
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (canAnswer) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: BimSpacing.sm),
                child: Wrap(
                  key: const ValueKey('reaction-picker'),
                  alignment: WrapAlignment.center,
                  spacing: BimSpacing.xs,
                  children: [
                    for (final (i, e) in messageReactions.indexed)
                      ChoiceChip(
                        key: ValueKey('reaction-$i'),
                        label: Text(e, style: const TextStyle(fontSize: 22)),
                        selected: m.myReaction == e,
                        onSelected: (_) => Navigator.pop(ctx, 'react:$e'),
                      ),
                  ],
                ),
              ),
              ListTile(key: const ValueKey('message-reply'), leading: const Icon(Icons.reply_outlined), title: const Text('Répondre'), onTap: () => Navigator.pop(ctx, 'reply')),
            ],
            if (m.mine)
              ListTile(key: const ValueKey('message-delete'), leading: const Icon(Icons.delete_outline), title: const Text('Supprimer pour tout le monde'), onTap: () => Navigator.pop(ctx, 'delete'))
            else
              ListTile(key: const ValueKey('message-report'), leading: const Icon(Icons.flag_outlined), title: const Text('Signaler ce message'), onTap: () => Navigator.pop(ctx, 'report')),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice.startsWith('react:')) {
      await _react(m, choice.substring(6));
      return;
    }
    if (choice == 'reply') {
      setState(() => _replyTo = m);
      return;
    }
    if (choice == 'report') {
      await showReportContentSheet(context, ref, targetType: 'message', targetId: m.id);
      return;
    }
    try {
      await _api.deleteMessage(m.id);
      if (mounted) {
        setState(() {
          _messages = [for (final x in _messages) x.id == m.id ? ChatMessage(id: x.id, mine: true, kind: x.kind, status: 'deleted', createdAt: x.createdAt) : x];
          if (_replyTo?.id == m.id) _replyTo = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  /// V1 : infos du groupe (membres, ajout, départ) ; au retour, la conversation est relue (ou fermée si j'ai quitté).
  Future<void> _openGroup() async {
    final left = await context.push<bool>('/messages/${widget.conversationId}/group');
    if (!mounted) return;
    if (left == true) {
      _invalidateLists();
      if (context.canPop()) context.pop();
      return;
    }
    await _load();
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
                      onTap: () => c.isGroup
                          ? _openGroup()
                          : (c.shop != null ? context.push('/bimshop/shops/${c.shop!.slug}') : (c.person != null ? context.push('/people/${c.person!.username}') : null)),
                      child: c.isGroup
                          ? const GroupAvatar()
                          : (c.shop != null ? ShopAvatar(shop: c.shop!) : (c.person != null ? PersonAvatar(person: c.person!) : const SizedBox(width: 40, height: 40))),
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
                  if (c?.isGroup ?? false)
                    IconButton(key: const ValueKey('group-info'), tooltip: 'Infos du groupe', icon: const Icon(Icons.group_outlined), onPressed: _openGroup),
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
                            if (m.isSystem) {
                              return Padding(
                                key: ValueKey('message-${m.id}'),
                                padding: const EdgeInsets.symmetric(vertical: BimSpacing.xs),
                                child: Text(m.text ?? '', textAlign: TextAlign.center, style: theme.textTheme.bodySmall?.copyWith(fontStyle: FontStyle.italic)),
                              );
                            }
                            return _Bubble(
                              message: m,
                              asShop: widget.asShop,
                              inGroup: c?.isGroup ?? false,
                              otherName: c?.title ?? '',
                              showRead: identical(m, lastMineRead) && (m.read ?? false),
                              onLongPress: () => _messageMenu(m),
                            );
                          },
                        ),
            ),
            if (c?.isRequest ?? false)
              Padding(
                padding: const EdgeInsets.all(BimSpacing.md),
                child: Column(
                  children: [
                    Text(c!.isGroup ? 'Tu es invité·e dans le groupe « ${c.title} ».' : '${c.title} veut t’envoyer un message.', textAlign: TextAlign.center),
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
              if (_replyTo != null)
                Container(
                  key: const ValueKey('reply-banner'),
                  color: theme.colorScheme.surfaceContainerLow,
                  padding: const EdgeInsets.fromLTRB(BimSpacing.md, BimSpacing.xs, BimSpacing.xs, BimSpacing.xs),
                  child: Row(
                    children: [
                      const Icon(Icons.reply_outlined, size: 18),
                      const SizedBox(width: BimSpacing.sm),
                      Expanded(
                        child: Text(
                          'Réponse à ${_replyTo!.mine ? 'toi' : (c?.title ?? '')} : ${_replyTo!.preview}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                      IconButton(key: const ValueKey('reply-cancel'), tooltip: 'Ne plus répondre à ce message', icon: const Icon(Icons.close), onPressed: () => setState(() => _replyTo = null)),
                    ],
                  ),
                ),
              if (widget.asShop) _QuickReplies(onPick: (t) => setState(() => _input.text = t)),
              if (_recorder != null)
                Padding(
                  padding: EdgeInsets.fromLTRB(BimSpacing.sm, BimSpacing.xs, BimSpacing.sm, BimSpacing.sm + MediaQuery.viewInsetsOf(context).bottom),
                  child: Row(
                    key: const ValueKey('voice-recording'),
                    children: [
                      IconButton(key: const ValueKey('voice-cancel'), tooltip: 'Annuler le vocal', icon: const Icon(Icons.delete_outline), onPressed: () => _stopRecording(send: false)),
                      const Icon(Icons.fiber_manual_record, color: BimColors.red, size: 14),
                      const SizedBox(width: BimSpacing.sm),
                      Expanded(child: Text('${formatVoiceDuration(_recElapsed)} / ${formatVoiceDuration(voiceMaxDuration)}', key: const ValueKey('voice-elapsed'))),
                      IconButton(key: const ValueKey('voice-send'), tooltip: 'Envoyer le vocal', icon: const Icon(Icons.send_rounded, color: BimColors.red), onPressed: () => _stopRecording(send: true)),
                    ],
                  ),
                )
              else
              Padding(
                padding: EdgeInsets.fromLTRB(BimSpacing.sm, BimSpacing.xs, BimSpacing.sm, BimSpacing.sm + MediaQuery.viewInsetsOf(context).bottom),
                child: Row(
                  children: [
                    IconButton(key: const ValueKey('message-photo'), tooltip: 'Envoyer une photo', icon: const Icon(Icons.photo_outlined), onPressed: _sending ? null : _pickPhoto),
                    // 7-B : la boutique propose une commande dans la conversation (vaut sa confirmation).
                    if (widget.asShop)
                      IconButton(key: const ValueKey('propose-order'), tooltip: 'Proposer une commande', icon: const Icon(Icons.receipt_long_outlined), onPressed: _sending ? null : _propose),
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
                    ValueListenableBuilder<TextEditingValue>(
                      valueListenable: _input,
                      builder: (_, value, __) => value.text.trim().isEmpty && !_sending
                          // V1 : champ vide → micro (message vocal, 2 minutes au plus).
                          ? IconButton(key: const ValueKey('voice-record'), tooltip: 'Enregistrer un vocal', icon: const Icon(Icons.mic_none_rounded, color: BimColors.red), onPressed: _startRecording)
                          : IconButton(
                              key: const ValueKey('message-send'),
                              tooltip: 'Envoyer',
                              icon: _sending ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, color: BimColors.red),
                              onPressed: _sending ? null : _send,
                            ),
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
  const _Bubble({required this.message, required this.showRead, required this.onLongPress, this.asShop = false, this.inGroup = false, this.otherName = ''});

  final ChatMessage message;
  final String otherName;
  final bool asShop;
  /// V1 : dans un groupe, le nom de l'auteur s'affiche au-dessus des messages reçus.
  final bool inGroup;
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
      _ when m.blockedSender => Text('Message d’une personne bloquée', style: TextStyle(color: fg, fontStyle: FontStyle.italic)),
      // Type à venir (cartes de commande, lot 7) : jamais de bulle vide.
      _ when !m.supported => Text('Ce message s’affiche dans une version plus récente de BIM.', key: const ValueKey('message-unsupported'), style: TextStyle(color: fg, fontStyle: FontStyle.italic)),
      _ when m.kind == 'order' => _OrderCardView(card: m.order!, fg: fg, onTap: () => context.push(asShop ? '/shop/orders/${m.order!.id}' : '/orders/${m.order!.id}')),
      _ when m.kind == 'voice' => VoiceMessageView(key: ValueKey('voice-${m.id}'), url: m.voiceUrl, durationMs: m.durationMs, color: fg),
      _ => m.kind == 'photo'
          ? ClipRRect(
              borderRadius: BorderRadius.circular(BimRadius.chip),
              child: m.photoUrl == null
                  ? const SizedBox(width: 180, height: 180, child: Icon(Icons.image_outlined))
                  : Image.network(m.photoUrl!, width: 220, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined)),
            )
          : Text(m.text ?? '', style: TextStyle(color: fg, fontSize: 16)),
    };
    final q = m.visible ? m.replyTo : null;
    return Align(
      alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: m.mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (inGroup && !m.mine && m.senderName != null)
            Padding(
              padding: const EdgeInsets.only(left: BimSpacing.sm, top: BimSpacing.xs),
              child: Text(m.senderName!, key: ValueKey('sender-${m.id}'), style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700)),
            ),
          GestureDetector(
            key: ValueKey('message-${m.id}'),
            onLongPress: onLongPress,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 280),
              margin: const EdgeInsets.symmetric(vertical: 3),
              padding: m.kind == 'photo' && m.visible ? const EdgeInsets.all(4) : const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(BimRadius.card)),
              child: q == null
                  ? content
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // 6-C : message cité.
                        Container(
                          key: ValueKey('quote-${m.id}'),
                          margin: const EdgeInsets.only(bottom: BimSpacing.xs),
                          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm, vertical: BimSpacing.xs),
                          decoration: BoxDecoration(
                            color: fg.withValues(alpha: 0.12),
                            border: Border(left: BorderSide(color: fg, width: 3)),
                            borderRadius: BorderRadius.circular(BimRadius.chip),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(q.mine ? 'Toi' : otherName, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 12)),
                              Text(
                                q.preview,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: fg, fontSize: 13, fontStyle: q.status == 'published' ? FontStyle.normal : FontStyle.italic),
                              ),
                            ],
                          ),
                        ),
                        content,
                      ],
                    ),
            ),
          ),
          // 6-C : réactions sous la bulle.
          if (m.visible && m.reactions.isNotEmpty)
            Wrap(
              key: ValueKey('reactions-${m.id}'),
              spacing: 4,
              children: [
                for (final r in m.reactions)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: r.emoji == m.myReaction ? BimColors.redSoft : scheme.surfaceContainerHigh,
                      borderRadius: BorderRadius.circular(BimRadius.chip),
                    ),
                    child: Text(r.count > 1 ? '${r.emoji} ${r.count}' : r.emoji, style: const TextStyle(fontSize: 13)),
                  ),
              ],
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

/// V1 — Avatar d'un groupe.
class GroupAvatar extends StatelessWidget {
  const GroupAvatar({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) => CircleAvatar(
        radius: size / 2,
        backgroundColor: BimColors.redSoft,
        child: Icon(Icons.groups_rounded, color: BimColors.red, size: size * 0.55),
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
                      // 7-B : la commande se passe depuis la fiche (taille, quantité, mode) ; aucun paiement ici.
                      onPressed: p.available ? () => context.push('/bimshop/products/${p.id}') : null,
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

/// Carte d'une proposition de commande : numéro, article(s), montant, état ; un appui ouvre la commande.
class _OrderCardView extends StatelessWidget {
  const _OrderCardView({required this.card, required this.fg, required this.onTap});
  final OrderCard card;
  final Color fg;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        key: ValueKey('order-card-${card.id}'),
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [Icon(Icons.receipt_long_outlined, color: fg, size: 18), const SizedBox(width: 6), Flexible(child: Text('Proposition ${card.number}', style: TextStyle(color: fg, fontWeight: FontWeight.w700)))],
            ),
            if (card.title != null) Text(card.title!, style: TextStyle(color: fg)),
            Text('${formatFcfa(card.itemsTotalFcfa)} · ${orderStatusLabel(card.status)}', style: TextStyle(color: fg, fontWeight: FontWeight.w600)),
            Text('Voir la commande', style: TextStyle(color: fg, decoration: TextDecoration.underline)),
          ],
        ),
      );
}

/// 7-B — La boutique choisit un article de son catalogue (publié ou non, A14), la variante, la quantité et, si elle le
/// souhaite, un prix plus bas (A15 : jamais au-dessus du catalogue). Le serveur revérifie tout.
class _ProposalSheet extends ConsumerStatefulWidget {
  const _ProposalSheet({required this.conversationId});
  final String conversationId;

  @override
  ConsumerState<_ProposalSheet> createState() => _ProposalSheetState();
}

class _ProposalSheetState extends ConsumerState<_ProposalSheet> {
  final _key = newIdempotencyKey();
  final _price = TextEditingController();
  List<ProductSummary> _products = const [];
  ProductDetail? _product;
  String? _variant;
  int _qty = 1;
  bool _busy = false;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  @override
  void dispose() {
    _price.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    final api = ref.read(shopApiProvider);
    try {
      final all = [for (final st in ['published', 'hidden', 'draft']) ...await api.products(status: st)];
      if (mounted) setState(() => _products = all);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _pick(String id) async {
    setState(() {
      _product = null;
      _variant = null;
    });
    try {
      final p = await ref.read(shopApiProvider).product(id);
      if (mounted) {
        setState(() {
          _product = p;
          _variant = p.variants.length == 1 ? p.variants.first.id : null;
          _price.text = '${p.priceFcfa}';
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _send() async {
    final p = _product!;
    final price = int.tryParse(_price.text);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(shopOrdersApiProvider).propose(
        widget.conversationId,
        [OrderLine(productId: p.id, variantId: _variant!, quantity: _qty, appliedPriceFcfa: price != null && price < p.priceFcfa ? price : null)],
        idempotencyKey: _key,
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final p = _product;
    final price = int.tryParse(_price.text);
    final priceOk = p != null && price != null && price >= 1 && price <= p.priceFcfa;
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.lg, BimSpacing.screen, BimSpacing.lg + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Proposer une commande', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.xs),
            Text('La personne choisit ensuite le retrait ou la livraison, puis accepte. Sans réponse, la proposition expire.', style: theme.textTheme.bodySmall),
            const SizedBox(height: BimSpacing.md),
            DropdownButtonFormField<String>(
              key: const ValueKey('proposal-product'),
              // ignore: deprecated_member_use
              value: p?.id,
              isExpanded: true,
              items: [for (final x in _products) DropdownMenuItem(value: x.id, child: Text('${x.title} · ${x.reference}', overflow: TextOverflow.ellipsis))],
              onChanged: (id) => id == null ? null : _pick(id),
              decoration: const InputDecoration(labelText: 'Article ou prestation'),
            ),
            if (p != null && p.variants.length > 1) ...[
              const SizedBox(height: BimSpacing.sm),
              Wrap(
                spacing: BimSpacing.sm,
                children: [for (final v in p.variants) ChoiceChip(key: ValueKey('proposal-variant-${v.label}'), label: Text(v.label), selected: _variant == v.id, onSelected: (_) => setState(() => _variant = v.id))],
              ),
            ],
            if (p != null) ...[
              const SizedBox(height: BimSpacing.sm),
              Row(
                children: [
                  const Text('Quantité'),
                  IconButton(tooltip: 'Un de moins', icon: const Icon(Icons.remove_circle_outline), onPressed: _qty > 1 ? () => setState(() => _qty--) : null),
                  Text('$_qty', key: const ValueKey('proposal-qty')),
                  IconButton(tooltip: 'Un de plus', icon: const Icon(Icons.add_circle_outline), onPressed: _qty < 99 ? () => setState(() => _qty++) : null),
                ],
              ),
              TextField(
                key: const ValueKey('proposal-price'),
                controller: _price,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: 'Prix unitaire (au plus ${formatFcfa(p.priceFcfa)})', errorText: priceOk ? null : 'Entre 1 F et le prix du catalogue.'),
                onChanged: (_) => setState(() {}),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: BimSpacing.sm),
              Text(_error!.message, key: const ValueKey('proposal-error'), style: const TextStyle(color: BimColors.red)),
            ],
            const SizedBox(height: BimSpacing.md),
            BimButton(
              key: const ValueKey('proposal-send'),
              label: 'Envoyer la proposition',
              loading: _busy,
              onPressed: p != null && _variant != null && priceOk && !_busy ? _send : null,
            ),
          ],
        ),
      ),
    );
  }
}
