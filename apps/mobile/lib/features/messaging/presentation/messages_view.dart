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
import '../../projects/presentation/project_widgets.dart' show ChoiceChipBim;
import '../../social/presentation/stories.dart' show StoriesBar;

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

/// Lot 6-A — Écran 47, onglet Messages (maquette) : recherche, stories, filtres Tous / Personnes / Marchands /
/// Groupes, « Demandes de messages », conversations avec leur rôle.
class MessagesView extends ConsumerStatefulWidget {
  const MessagesView({super.key});

  @override
  ConsumerState<MessagesView> createState() => _MessagesViewState();
}

class _MessagesViewState extends ConsumerState<MessagesView> {
  bool _requests = false;
  /// Maquette 47 : filtres Tous, Personnes, Marchands, Groupes et recherche dans les conversations chargées.
  String _filter = 'all';
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

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

  bool _matches(ConversationSummary c) {
    final ok = switch (_filter) {
      'people' => !c.isGroup && c.shop == null,
      'shops' => c.shop != null,
      'groups' => c.isGroup,
      _ => true,
    };
    final q = _search.text.trim().toLowerCase();
    return ok && (q.isEmpty || c.title.toLowerCase().contains(q) || (c.lastPreview ?? '').toLowerCase().contains(q));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unread = ref.watch(messagesUnreadProvider).valueOrNull;
    final async = ref.watch(conversationsProvider(_requests));
    final requests = unread?.requests ?? 0;
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(conversationsProvider)
          ..invalidate(messagesUnreadProvider);
        await ref.read(conversationsProvider(_requests).future);
      },
      child: ListView(
        // La barre du bas flotte au-dessus : marge du bas = sa hauteur (Scaffold.extendBody).
        padding: EdgeInsets.fromLTRB(0, BimSpacing.sm, 0, BimSpacing.xxl + MediaQuery.paddingOf(context).bottom),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
            child: Row(
              children: [
                if (_requests)
                  IconButton(key: const ValueKey('requests-back'), tooltip: 'Retour aux messages', icon: const Icon(Icons.arrow_back_rounded), onPressed: () => setState(() => _requests = false)),
                Expanded(child: Text(_requests ? 'Demandes' : 'Messages', style: theme.textTheme.headlineMedium)),
                IconButton(key: const ValueKey('new-message'), tooltip: 'Nouveau message', icon: const Icon(Icons.edit_square), onPressed: _newMessage),
              ],
            ),
          ),
          if (!_requests) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.sm),
              child: TextField(
                key: const ValueKey('messages-search'),
                controller: _search,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Rechercher',
                  prefixIcon: const Icon(Icons.search_rounded),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                ),
              ),
            ),
            const StoriesBar(),
            SizedBox(
              height: 46,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
                children: [
                  for (final (code, label) in const [('all', 'Tous'), ('people', 'Personnes'), ('shops', 'Marchands'), ('groups', 'Groupes')]) ...[
                    ChoiceChipBim(key: ValueKey('messages-filter-$code'), label: label, selected: _filter == code, dark: true, onTap: () => setState(() => _filter = code)),
                    const SizedBox(width: BimSpacing.sm),
                  ],
                ],
              ),
            ),
            // Maquette 47 : « Demandes de messages · N » (personnes que tu ne suis pas).
            ListTile(
              key: const ValueKey('messages-requests'),
              contentPadding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
              leading: const Icon(Icons.inbox_outlined),
              title: Text.rich(TextSpan(children: [
                const TextSpan(text: 'Demandes de messages', style: TextStyle(fontWeight: FontWeight.w600)),
                if (requests > 0) TextSpan(text: ' · $requests', style: theme.textTheme.bodyMedium),
              ],),),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => setState(() => _requests = true),
            ),
          ] else
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.sm),
              child: Text('Messages de personnes que tu ne suis pas. Elles ne savent pas si tu as lu leur demande.', style: theme.textTheme.bodySmall),
            ),
          ...async.when(
            loading: () => [const Padding(padding: EdgeInsets.all(BimSpacing.xxl), child: Center(child: CircularProgressIndicator()))],
            error: (e, _) => [
              const SizedBox(height: BimSpacing.xl),
              Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
              const SizedBox(height: BimSpacing.md),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
                child: BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(conversationsProvider(_requests))),
              ),
            ],
            data: (page) {
              final items = page.items.where(_matches).toList();
              return items.isEmpty
                  ? [
                      const SizedBox(height: BimSpacing.xl),
                      const Peni(pose: PeniPose.wave, size: 100),
                      const SizedBox(height: BimSpacing.md),
                      Text(
                        _requests ? 'Aucune demande.' : (page.items.isEmpty ? 'Aucun message pour l’instant. Écris à une personne que tu suis !' : 'Aucune conversation ne correspond.'),
                        textAlign: TextAlign.center,
                      ),
                    ]
                  : [
                      for (final c in items)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
                          child: ConversationTile(
                            conversation: c,
                            onTap: () async {
                              await context.push('/messages/${c.id}');
                              ref
                                ..invalidate(conversationsProvider)
                                ..invalidate(messagesUnreadProvider);
                            },
                          ),
                        ),
                    ];
            },
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
      title: Row(
        children: [
          Flexible(child: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w700))),
          // Maquette 47 : rôle de la conversation.
          if (c.shop != null) const _RoleBadge(icon: Icons.storefront_outlined, label: 'Marchand', color: BimColors.black)
          else if (c.isGroup) const _RoleBadge(icon: Icons.groups_outlined, label: 'Groupe', color: Color(0xFF2F6FEB)),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            c.lastPreview == null ? c.subtitle : '${c.lastFromMe ? 'Toi : ' : ''}${c.lastPreview}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodyMedium?.copyWith(fontWeight: bold ? FontWeight.w600 : null, color: bold ? theme.colorScheme.onSurface : null),
          ),
          if (trailingBadges.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Wrap(spacing: 6, children: trailingBadges)),
        ],
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (c.lastAt != null) Text(_ago(c.lastAt!), style: theme.textTheme.bodySmall?.copyWith(color: c.unread > 0 ? BimColors.red : null, fontWeight: c.unread > 0 ? FontWeight.w700 : null)),
          if (c.unread > 0) ...[const SizedBox(height: 4), Badge(label: Text('${c.unread}'), backgroundColor: BimColors.red)],
        ],
      ),
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

class _RoleBadge extends StatelessWidget {
  const _RoleBadge({required this.icon, required this.label, required this.color});
  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = dark && color == BimColors.black ? BimColors.white : color;
    return Padding(
      padding: const EdgeInsets.only(left: 6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(color: fg.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 13, color: fg), const SizedBox(width: 3), Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg))]),
      ),
    );
  }
}
