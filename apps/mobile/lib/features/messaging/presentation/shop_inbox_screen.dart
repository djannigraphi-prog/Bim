import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../data/messaging_api.dart';
import 'messages_view.dart' show ConversationTile;

/// Lot 6-B — Écran 51, boîte de la boutique : Tous · Non lus · Commandes · Marqués · Archivés, marquer, archiver,
/// réponses rapides. La boîte est commune à toute l'équipe de la boutique. L'onglet « Commandes » est le point
/// d'arrivée des commandes (lot 7) : il l'annonce, sans rien inventer.
class ShopInboxScreen extends ConsumerStatefulWidget {
  const ShopInboxScreen({super.key});

  @override
  ConsumerState<ShopInboxScreen> createState() => _ShopInboxScreenState();
}

class _ShopInboxScreenState extends ConsumerState<ShopInboxScreen> {
  String _box = 'all';

  void _refresh() {
    ref
      ..invalidate(shopInboxProvider)
      ..invalidate(shopInboxUnreadProvider);
  }

  Future<void> _actions(ConversationSummary c) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const ValueKey('inbox-mark'),
              leading: Icon(c.marked ? Icons.bookmark_remove_outlined : Icons.bookmark_add_outlined),
              title: Text(c.marked ? 'Retirer la marque' : 'Marquer'),
              onTap: () => Navigator.pop(ctx, 'mark'),
            ),
            ListTile(
              key: const ValueKey('inbox-archive'),
              leading: Icon(c.archived ? Icons.unarchive_outlined : Icons.archive_outlined),
              title: Text(c.archived ? 'Sortir des archives' : 'Archiver'),
              onTap: () => Navigator.pop(ctx, 'archive'),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    try {
      final api = ref.read(shopInboxApiProvider);
      if (choice == 'mark') {
        await api.setMarked(c.id, !c.marked);
      } else {
        await api.setArchived(c.id, !c.archived);
        if (mounted) showBimSnack(context, c.archived ? 'Conversation sortie des archives' : 'Conversation archivée');
      }
      _refresh();
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _quickReplies() => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => const _QuickRepliesSheet());

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final counts = ref.watch(shopInboxUnreadProvider).valueOrNull;
    final orders = _box == 'orders';
    final async = orders ? null : ref.watch(shopInboxProvider(_box));
    final tabs = [
      ('all', counts == null ? 'Tous' : 'Tous · ${counts.all}'),
      ('unread', (counts?.unread ?? 0) > 0 ? 'Non lus · ${counts!.unread}' : 'Non lus'),
      ('orders', 'Commandes'),
      ('marked', 'Marqués'),
      ('archived', 'Archivés'),
    ];
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            _refresh();
            if (!orders) await ref.read(shopInboxProvider(_box).future);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
            children: [
              Row(
                children: [
                  const BimBackButton(),
                  const SizedBox(width: BimSpacing.sm),
                  Expanded(child: Text('Messages', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24))),
                  IconButton(key: const ValueKey('quick-replies-manage'), tooltip: 'Réponses rapides', icon: const Icon(Icons.bolt_outlined), onPressed: _quickReplies),
                ],
              ),
              const SizedBox(height: BimSpacing.sm),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final (value, label) in tabs)
                      Padding(
                        padding: const EdgeInsets.only(right: BimSpacing.xs),
                        child: ChoiceChip(
                          key: ValueKey('inbox-tab-$value'),
                          label: Text(label),
                          selected: _box == value,
                          showCheckmark: false,
                          onSelected: (_) => setState(() => _box = value),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: BimSpacing.md),
              if (orders)
                ..._empty(theme, 'Les commandes reçues arriveront ici avec les commandes. Pour l’instant, tes clients t’écrivent dans « Tous ».')
              else
                ...async!.when(
                  loading: () => [const Padding(padding: EdgeInsets.all(BimSpacing.xxl), child: Center(child: CircularProgressIndicator()))],
                  error: (e, _) => [
                    const SizedBox(height: BimSpacing.xl),
                    Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                    const SizedBox(height: BimSpacing.md),
                    BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _refresh),
                  ],
                  data: (page) => page.items.isEmpty
                      ? _empty(theme, _emptyText(_box))
                      : [
                          for (final c in page.items)
                            ConversationTile(
                              conversation: c,
                              trailingBadges: [
                                if (c.marked) _Label(text: 'Marquée', color: Colors.blue.shade700),
                                if (c.context?.offerId != null) const _Label(text: 'Demande projet', color: Colors.purple),
                              ],
                              onTap: () async {
                                await context.push('/shop/messages/${c.id}');
                                _refresh();
                              },
                              onLongPress: () => _actions(c),
                            ),
                        ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  static String _emptyText(String box) => switch (box) {
        'unread' => 'Tout est lu.',
        'marked' => 'Aucune conversation marquée.',
        'archived' => 'Aucune conversation archivée.',
        _ => 'Aucun message pour l’instant. Tes clients peuvent t’écrire depuis tes articles avec « Discuter ».',
      };

  List<Widget> _empty(ThemeData theme, String text) => [
        const SizedBox(height: BimSpacing.xl),
        const Peni(pose: PeniPose.wave, size: 100),
        const SizedBox(height: BimSpacing.md),
        Text(text, textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
      ];
}

class _Label extends StatelessWidget {
  const _Label({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: Text(text, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
      );
}

/// Réponses rapides de la boutique : 10 au plus, communes à l'équipe.
class _QuickRepliesSheet extends ConsumerStatefulWidget {
  const _QuickRepliesSheet();

  @override
  ConsumerState<_QuickRepliesSheet> createState() => _QuickRepliesSheetState();
}

class _QuickRepliesSheetState extends ConsumerState<_QuickRepliesSheet> {
  final _input = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) ref.invalidate(shopQuickRepliesProvider);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = ref.watch(shopQuickRepliesProvider).valueOrNull ?? const [];
    final api = ref.read(shopInboxApiProvider);
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.lg, BimSpacing.screen, BimSpacing.lg + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Réponses rapides', style: theme.textTheme.titleLarge),
          const SizedBox(height: BimSpacing.xs),
          Text('Elles apparaissent au-dessus du message dans tes conversations. 10 au plus, partagées avec ton équipe.', style: theme.textTheme.bodySmall),
          const SizedBox(height: BimSpacing.md),
          for (final q in items)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(q.text),
              trailing: IconButton(tooltip: 'Retirer', icon: const Icon(Icons.delete_outline), onPressed: _busy ? null : () => _run(() => api.removeQuickReply(q.id))),
            ),
          if (items.length < 10)
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('quick-reply-input'),
                    controller: _input,
                    maxLength: 200,
                    decoration: const InputDecoration(hintText: 'Ex. : Disponible ✅', counterText: ''),
                  ),
                ),
                IconButton(
                  key: const ValueKey('quick-reply-add'),
                  tooltip: 'Ajouter',
                  icon: const Icon(Icons.add_circle_outline),
                  onPressed: _busy
                      ? null
                      : () {
                          final t = _input.text.trim();
                          if (t.isEmpty) return;
                          _run(() async {
                            await api.addQuickReply(t);
                            _input.clear();
                          });
                        },
                ),
              ],
            ),
        ],
      ),
    );
  }
}
