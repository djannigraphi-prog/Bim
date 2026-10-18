import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../social/presentation/social_widgets.dart';
import '../data/messaging_api.dart';
import 'conversation_screen.dart' show GroupAvatar, ShopAvatar;

/// Ouvre (ou retrouve) la conversation avec une personne puis l'affiche.
Future<void> openConversationWith(BuildContext context, WidgetRef ref, String username) async {
  try {
    final c = await ref.read(messagingApiProvider).start(username);
    if (context.mounted) await context.push('/messages/${c.id}');
    ref
      ..invalidate(conversationsProvider)
      ..invalidate(messagesUnreadProvider);
  } on ApiException catch (e) {
    if (context.mounted) showApiError(context, e);
  }
}

/// Lot 6-B — « Discuter » avec une boutique (article, offre de projet ou profil de la boutique).
Future<void> openShopConversation(BuildContext context, WidgetRef ref, String shopSlug, {String? productId, String? offerId}) async {
  try {
    final c = await ref.read(messagingApiProvider).startWithShop(shopSlug, productId: productId, offerId: offerId);
    if (context.mounted) await context.push('/messages/${c.id}');
    ref
      ..invalidate(conversationsProvider)
      ..invalidate(messagesUnreadProvider);
  } on ApiException catch (e) {
    if (context.mounted) showApiError(context, e);
  }
}

/// Lot 6-A — Écran 47, onglet Messages : « Tous » et « Demandes ». Les onglets Clients / Marchands / Livreurs /
/// Groupes arrivent avec les boutiques (6-B), les livraisons (lot 7) et les groupes (6-C).
class MessagesView extends ConsumerStatefulWidget {
  const MessagesView({super.key});

  @override
  ConsumerState<MessagesView> createState() => _MessagesViewState();
}

class _MessagesViewState extends ConsumerState<MessagesView> {
  bool _requests = false;

  Future<void> _newMessage() async {
    // V1 : un message à une personne, ou un nouveau groupe.
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(key: const ValueKey('new-direct'), leading: const Icon(Icons.person_outline), title: const Text('Nouveau message'), onTap: () => Navigator.pop(ctx, 'direct')),
            ListTile(key: const ValueKey('new-group'), leading: const Icon(Icons.groups_outlined), title: const Text('Nouveau groupe'), onTap: () => Navigator.pop(ctx, 'group')),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    if (choice == 'group') {
      await context.push('/messages/new-group');
      ref.invalidate(conversationsProvider);
      return;
    }
    final username = await showDialog<String>(context: context, builder: (_) => const _NewMessageDialog());
    if (username == null || username.isEmpty || !mounted) return;
    await openConversationWith(context, ref, username.replaceFirst('@', ''));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unread = ref.watch(messagesUnreadProvider).valueOrNull;
    final async = ref.watch(conversationsProvider(_requests));
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(conversationsProvider)
          ..invalidate(messagesUnreadProvider);
        await ref.read(conversationsProvider(_requests).future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
        children: [
          Row(
            children: [
              Expanded(child: Text('Messages', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24))),
              IconButton(key: const ValueKey('new-message'), tooltip: 'Nouveau message', icon: const Icon(Icons.edit_square), onPressed: _newMessage),
            ],
          ),
          const SizedBox(height: BimSpacing.sm),
          SegmentedButton<bool>(
            segments: [
              const ButtonSegment(value: false, label: Text('Tous')),
              ButtonSegment(value: true, label: Text((unread?.requests ?? 0) > 0 ? 'Demandes (${unread!.requests})' : 'Demandes')),
            ],
            selected: {_requests},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => _requests = s.first),
          ),
          const SizedBox(height: BimSpacing.md),
          if (_requests)
            Padding(
              padding: const EdgeInsets.only(bottom: BimSpacing.sm),
              child: Text('Messages de personnes que tu ne suis pas. Elles ne savent pas si tu as lu leur demande.', style: theme.textTheme.bodySmall),
            ),
          ...async.when(
            loading: () => [const Padding(padding: EdgeInsets.all(BimSpacing.xxl), child: Center(child: CircularProgressIndicator()))],
            error: (e, _) => [
              const SizedBox(height: BimSpacing.xl),
              Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
              const SizedBox(height: BimSpacing.md),
              BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(conversationsProvider(_requests))),
            ],
            data: (page) => page.items.isEmpty
                ? [
                    const SizedBox(height: BimSpacing.xl),
                    const Peni(pose: PeniPose.wave, size: 100),
                    const SizedBox(height: BimSpacing.md),
                    Text(_requests ? 'Aucune demande.' : 'Aucun message pour l’instant. Écris à une personne que tu suis !', textAlign: TextAlign.center),
                  ]
                : [
                    for (final c in page.items)
                      ConversationTile(
                        conversation: c,
                        onTap: () async {
                          await context.push('/messages/${c.id}');
                          ref
                            ..invalidate(conversationsProvider)
                            ..invalidate(messagesUnreadProvider);
                        },
                      ),
                  ],
          ),
        ],
      ),
    );
  }
}

/// Saisie du destinataire. Le dialogue possède son contrôleur : il n'est libéré qu'à la fermeture complète
/// (animation de sortie comprise), jamais pendant que le champ est encore affiché.
class _NewMessageDialog extends StatefulWidget {
  const _NewMessageDialog();

  @override
  State<_NewMessageDialog> createState() => _NewMessageDialogState();
}

class _NewMessageDialogState extends State<_NewMessageDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Nouveau message'),
        content: TextField(
          key: const ValueKey('new-message-username'),
          controller: _controller,
          autofocus: true,
          decoration: const InputDecoration(prefixText: '@', hintText: 'nom d’utilisateur'),
          onSubmitted: (v) => Navigator.pop(context, v.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          TextButton(key: const ValueKey('new-message-go'), onPressed: () => Navigator.pop(context, _controller.text.trim()), child: const Text('Écrire')),
        ],
      );
}

/// Une conversation dans une liste : avec une personne ou une boutique (écran 47), ou côté boutique (écran 51).
class ConversationTile extends StatelessWidget {
  const ConversationTile({super.key, required this.conversation, required this.onTap, this.onLongPress, this.trailingBadges = const []});

  final ConversationSummary conversation;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  /// Étiquettes sous l'aperçu (écran 51 : « Marquée »).
  final List<Widget> trailingBadges;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = conversation;
    final bold = c.unread > 0;
    return ListTile(
      key: ValueKey('conversation-${c.id}'),
      contentPadding: EdgeInsets.zero,
      leading: c.isGroup ? const GroupAvatar(size: 48) : (c.shop != null ? ShopAvatar(shop: c.shop!, size: 48) : (c.person != null ? PersonAvatar(person: c.person!, size: 48) : null)),
      title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            c.lastPreview == null ? c.subtitle : '${c.lastFromMe ? 'Toi : ' : ''}${c.lastPreview}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodyMedium?.copyWith(fontWeight: bold ? FontWeight.w700 : null),
          ),
          if (trailingBadges.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Wrap(spacing: 6, children: trailingBadges)),
        ],
      ),
      trailing: c.unread > 0
          ? Badge(label: Text('${c.unread}'), backgroundColor: BimColors.red)
          : (c.lastAt == null ? null : Text(_ago(c.lastAt!), style: theme.textTheme.bodySmall)),
      onTap: onTap,
      onLongPress: onLongPress,
    );
  }

  static String _ago(DateTime at) {
    final d = DateTime.now().difference(at);
    if (d.inMinutes < 1) return 'à l’instant';
    if (d.inHours < 1) return '${d.inMinutes} min';
    if (d.inDays < 1) return '${d.inHours} h';
    return '${d.inDays} j';
  }
}
