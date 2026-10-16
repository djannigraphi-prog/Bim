import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../data/shop_api.dart';

/// Lot 7-A (A16) — Équipe de la boutique, réservée au propriétaire : inviter une personne (elle accepte ou refuse),
/// accorder et retirer des permissions séparées, retirer un employé. Aucune permission par défaut ; aucune ne permet
/// d'encaisser des espèces (cela dépend du statut réel du livreur). Le serveur contrôle chaque action.
class ShopTeamScreen extends ConsumerStatefulWidget {
  const ShopTeamScreen({super.key});

  @override
  ConsumerState<ShopTeamScreen> createState() => _ShopTeamScreenState();
}

class _ShopTeamScreenState extends ConsumerState<ShopTeamScreen> {
  final _username = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _username.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(ShopTeamApi api) action, {String? done}) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(shopTeamApiProvider));
      ref.invalidate(shopTeamProvider);
      if (done != null && mounted) showBimSnack(context, done);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _invite() async {
    final name = _username.text.trim().replaceFirst('@', '');
    if (name.isEmpty) return;
    await _run((api) async {
      await api.invite(name);
      _username.clear();
    }, done: 'Invitation envoyée : la personne doit l’accepter.',);
  }

  Future<void> _remove(TeamMember m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(m.status == 'invited' ? 'Annuler l’invitation ?' : 'Retirer ${m.fullName} de l’équipe ?'),
        content: const Text('Ses accès et ses permissions sont supprimés immédiatement.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          TextButton(key: const ValueKey('confirm-remove-member'), onPressed: () => Navigator.pop(ctx, true), child: const Text('Retirer')),
        ],
      ),
    );
    if (ok == true) await _run((api) => api.remove(m.userId), done: 'Retiré de l’équipe');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(shopTeamProvider);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(
              children: [
                const BimBackButton(),
                const SizedBox(width: BimSpacing.sm),
                Expanded(child: Text('Équipe', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24))),
              ],
            ),
            const SizedBox(height: BimSpacing.sm),
            Text(
              'Invite une personne par son nom d’utilisateur, puis choisis ce qu’elle peut faire. Elle n’a aucun droit tant que tu ne lui en donnes pas.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: BimSpacing.md),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('team-username'),
                    controller: _username,
                    decoration: const InputDecoration(prefixText: '@', hintText: 'nom d’utilisateur'),
                    onSubmitted: (_) => _invite(),
                  ),
                ),
                const SizedBox(width: BimSpacing.sm),
                BimButton(key: const ValueKey('team-invite'), label: 'Inviter', loading: _busy, onPressed: _busy ? null : _invite),
              ],
            ),
            const SizedBox(height: BimSpacing.lg),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [Text(e is ApiException ? e.message : ApiException.unknown.message)],
              data: (members) => [
                for (final m in members)
                  _MemberCard(
                    member: m,
                    busy: _busy,
                    onToggle: (permission, on) {
                      final next = {...m.permissions};
                      if (on) {
                        next.add(permission);
                      } else {
                        next.remove(permission);
                      }
                      _run((api) => api.setPermissions(m.userId, next.toList()));
                    },
                    onRemove: () => _remove(m),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({required this.member, required this.busy, required this.onToggle, required this.onRemove});

  final TeamMember member;
  final bool busy;
  final void Function(String permission, bool on) onToggle;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final m = member;
    return Container(
      key: ValueKey('member-${m.userId}'),
      margin: const EdgeInsets.only(bottom: BimSpacing.md),
      padding: const EdgeInsets.all(BimSpacing.md),
      decoration: BoxDecoration(border: Border.all(color: theme.colorScheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                foregroundImage: m.avatarUrl == null ? null : NetworkImage(m.avatarUrl!),
                child: Text(m.fullName.isEmpty ? '?' : m.fullName[0].toUpperCase()),
              ),
              const SizedBox(width: BimSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.fullName, style: theme.textTheme.titleMedium),
                    Text(
                      m.isOwner ? 'Propriétaire · tous les droits' : (m.status == 'invited' ? '@${m.username} · invitation en attente' : '@${m.username} · employé'),
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              if (!m.isOwner) IconButton(key: ValueKey('remove-${m.userId}'), tooltip: 'Retirer', icon: const Icon(Icons.person_remove_outlined), onPressed: busy ? null : onRemove),
            ],
          ),
          if (!m.isOwner) ...[
            const SizedBox(height: BimSpacing.sm),
            for (final entry in shopPermissionLabels.entries)
              CheckboxListTile(
                key: ValueKey('perm-${m.userId}-${entry.key}'),
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: m.permissions.contains(entry.key),
                title: Text(entry.value),
                onChanged: busy ? null : (on) => onToggle(entry.key, on ?? false),
              ),
          ],
        ],
      ),
    );
  }
}

/// Invitations reçues (écran 53) : rejoindre ou refuser l'équipe d'une boutique.
class ShopInvitationsList extends ConsumerWidget {
  const ShopInvitationsList({super.key, this.onJoined});

  final VoidCallback? onJoined;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(shopInvitationsProvider).valueOrNull ?? const [];
    if (items.isEmpty) return const SizedBox.shrink();
    Future<void> answer(String shopId, bool accept) async {
      try {
        await ref.read(shopTeamApiProvider).answer(shopId, accept: accept);
        ref.invalidate(shopInvitationsProvider);
        if (accept) onJoined?.call();
        if (context.mounted) showBimSnack(context, accept ? 'Tu fais partie de l’équipe : la boutique est dans tes profils.' : 'Invitation refusée');
      } on ApiException catch (e) {
        if (context.mounted) showApiError(context, e);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final i in items)
          Container(
            key: ValueKey('invitation-${i.shopId}'),
            margin: const EdgeInsets.only(bottom: BimSpacing.sm),
            padding: const EdgeInsets.all(BimSpacing.md),
            decoration: BoxDecoration(color: BimColors.redSoft.withValues(alpha: 0.35), borderRadius: BorderRadius.circular(BimRadius.card)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${i.name} t’invite dans son équipe.', style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: BimSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: BimButton(key: ValueKey('decline-${i.shopId}'), label: 'Refuser', variant: BimButtonVariant.outline, onPressed: () => answer(i.shopId, false)),
                    ),
                    const SizedBox(width: BimSpacing.sm),
                    Expanded(child: BimButton(key: ValueKey('join-${i.shopId}'), label: 'Rejoindre', onPressed: () => answer(i.shopId, true))),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }
}
