import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../data/messaging_api.dart';

/// Noms d'utilisateur saisis : « @awa.k, koffi » → [awa.k, koffi].
List<String> parseUsernames(String raw) =>
    {for (final p in raw.split(RegExp(r'[\s,;]+'))) if (p.replaceFirst('@', '').trim().isNotEmpty) p.replaceFirst('@', '').trim().toLowerCase()}.toList();

/// V1 — Nouveau groupe (décisions du 18/10/2026) : réservé aux 18 ans et plus ; 32 personnes au plus. Une personne qui
/// ne suit pas le créateur reçoit une invitation ; certaines personnes ne peuvent pas être ajoutées (aucun motif donné).
class NewGroupScreen extends ConsumerStatefulWidget {
  const NewGroupScreen({super.key});

  @override
  ConsumerState<NewGroupScreen> createState() => _NewGroupScreenState();
}

class _NewGroupScreenState extends ConsumerState<NewGroupScreen> {
  final _title = TextEditingController();
  final _people = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _people.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(messagingApiProvider).createGroup(_title.text.trim(), parseUsernames(_people.text));
      ref.invalidate(conversationsProvider);
      if (!mounted) return;
      if (r.notAdded.isNotEmpty) showBimSnack(context, 'Pas ajouté·es : ${r.notAdded.map((u) => '@$u').join(', ')}');
      context.pushReplacement('/messages/${r.conversation.id}');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ready = _title.text.trim().isNotEmpty && parseUsernames(_people.text).isNotEmpty;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.sm),
            Text('Nouveau groupe', style: theme.textTheme.headlineSmall),
            const SizedBox(height: BimSpacing.xs),
            Text('32 personnes au plus, toi compris. Ceux qui ne te suivent pas reçoivent une invitation à accepter.', style: theme.textTheme.bodySmall),
            const SizedBox(height: BimSpacing.lg),
            TextField(
              key: const ValueKey('group-title'),
              controller: _title,
              maxLength: 60,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Nom du groupe'),
              onChanged: (_) => setState(() {}),
            ),
            TextField(
              key: const ValueKey('group-people'),
              controller: _people,
              minLines: 1,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Personnes à ajouter', hintText: '@awa.k, @koffi'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: BimSpacing.lg),
            BimButton(key: const ValueKey('group-create'), label: 'Créer le groupe', loading: _busy, onPressed: ready && !_busy ? _create : null),
          ],
        ),
      ),
    );
  }
}

/// V1 — Infos d'un groupe : membres (administrateurs d'abord, invités signalés), ajout, retrait et renommage pour les
/// administrateurs, « Quitter le groupe » pour tous. Revient avec `true` si j'ai quitté le groupe.
class GroupInfoScreen extends ConsumerStatefulWidget {
  const GroupInfoScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends ConsumerState<GroupInfoScreen> {
  ({List<GroupMember> items, String myRole, int maxMembers})? _members;
  ConversationSummary? _summary;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final api = ref.read(messagingApiProvider);
      final s = await api.conversation(widget.conversationId);
      final m = await api.groupMembers(widget.conversationId);
      if (mounted) {
        setState(() {
          _summary = s;
          _members = m;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  bool get _admin => _members?.myRole == 'admin';

  Future<String?> _ask(String title, String label, {String initial = ''}) => showDialog<String>(context: context, builder: (_) => _TextDialog(title: title, label: label, initial: initial));

  Future<void> _run(Future<void> Function() action, String done) async {
    try {
      await action();
      if (!mounted) return;
      showBimSnack(context, done);
      await _load();
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _add() async {
    final raw = await _ask('Ajouter des personnes', 'Noms d’utilisateur (@awa.k, @koffi)');
    if (raw == null || parseUsernames(raw).isEmpty) return;
    try {
      final notAdded = await ref.read(messagingApiProvider).addGroupMembers(widget.conversationId, parseUsernames(raw));
      if (!mounted) return;
      showBimSnack(context, notAdded.isEmpty ? 'Ajouté·es au groupe' : 'Pas ajouté·es : ${notAdded.map((u) => '@$u').join(', ')}');
      await _load();
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _rename() async {
    final t = await _ask('Renommer le groupe', 'Nom du groupe', initial: _summary?.title ?? '');
    if (t == null || t.trim().isEmpty) return;
    await _run(() => ref.read(messagingApiProvider).renameGroup(widget.conversationId, t.trim()), 'Groupe renommé');
  }

  Future<void> _remove(GroupMember m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Retirer ${m.fullName} ?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          TextButton(key: const ValueKey('member-remove-confirm'), onPressed: () => Navigator.pop(ctx, true), child: const Text('Retirer')),
        ],
      ),
    );
    if (ok == true) await _run(() => ref.read(messagingApiProvider).removeGroupMember(widget.conversationId, m.username), '${m.fullName} a été retiré·e');
  }

  Future<void> _leave() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Quitter le groupe ?'),
        content: const Text('Tu ne recevras plus ses messages.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          TextButton(key: const ValueKey('group-leave-confirm'), onPressed: () => Navigator.pop(ctx, true), child: const Text('Quitter')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(messagingApiProvider).leaveGroup(widget.conversationId);
      ref.invalidate(conversationsProvider);
      if (mounted) context.pop(true);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final m = _members;
    return Scaffold(
      body: SafeArea(
        child: _error != null
            ? Center(child: Text(_error is ApiException ? (_error! as ApiException).message : ApiException.unknown.message))
            : m == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(BimSpacing.screen),
                    children: [
                      const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
                      const SizedBox(height: BimSpacing.sm),
                      Row(
                        children: [
                          Expanded(child: Text(_summary?.title ?? '', key: const ValueKey('group-name'), style: theme.textTheme.headlineSmall)),
                          if (_admin) IconButton(key: const ValueKey('group-rename'), tooltip: 'Renommer', icon: const Icon(Icons.edit_outlined), onPressed: _rename),
                        ],
                      ),
                      Text('${m.items.length} / ${m.maxMembers} personnes', style: theme.textTheme.bodySmall),
                      const SizedBox(height: BimSpacing.md),
                      if (_admin && m.items.length < m.maxMembers)
                        ListTile(
                          key: const ValueKey('group-add'),
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(backgroundColor: BimColors.redSoft, child: Icon(Icons.person_add_alt_1, color: BimColors.red)),
                          title: const Text('Ajouter des personnes'),
                          onTap: _add,
                        ),
                      for (final x in m.items)
                        ListTile(
                          key: ValueKey('member-${x.username}'),
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(foregroundImage: x.avatarUrl == null ? null : NetworkImage(x.avatarUrl!), child: Text(x.fullName.isEmpty ? '?' : x.fullName[0])),
                          title: Text(x.isMe ? '${x.fullName} (toi)' : x.fullName),
                          subtitle: Text('@${x.username}${x.invited ? ' · invité·e' : ''}'),
                          trailing: x.isAdmin ? const Text('Admin') : null,
                          onTap: x.isMe ? null : () => context.push('/people/${x.username}'),
                          onLongPress: _admin && !x.isMe ? () => _remove(x) : null,
                        ),
                      const SizedBox(height: BimSpacing.lg),
                      BimButton(key: const ValueKey('group-leave'), label: 'Quitter le groupe', variant: BimButtonVariant.outline, onPressed: _leave),
                    ],
                  ),
      ),
    );
  }
}

class _TextDialog extends StatefulWidget {
  const _TextDialog({required this.title, required this.label, this.initial = ''});

  final String title;
  final String label;
  final String initial;

  @override
  State<_TextDialog> createState() => _TextDialogState();
}

class _TextDialogState extends State<_TextDialog> {
  late final _c = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: TextField(key: const ValueKey('dialog-text'), controller: _c, autofocus: true, decoration: InputDecoration(labelText: widget.label)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          TextButton(key: const ValueKey('dialog-ok'), onPressed: () => Navigator.pop(context, _c.text), child: const Text('OK')),
        ],
      );
}
