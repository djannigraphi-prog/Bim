import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../projects/application/photo_source.dart';
import '../application/social_providers.dart';
import '../data/social_api.dart';
import '../data/social_models.dart';
import 'moderation_sheets.dart';
import 'social_widgets.dart';

/// Écran 52 — Profil : photo, compteurs (BIM, abonnés, projets sur son propre profil), s'abonner, grille des
/// publications visibles. Médailles, solde de pièces et Passe Premium : lots 8 et 9.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key, required this.username});

  final String username;

  Future<void> _changeAvatar(BuildContext context, WidgetRef ref, PublicProfile p) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Prendre une photo'), onTap: () => Navigator.pop(ctx, 'camera')),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choisir dans la galerie'), onTap: () => Navigator.pop(ctx, 'gallery')),
            if (p.person.avatarUrl != null)
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded, color: BimColors.red),
                title: const Text('Retirer ma photo', style: TextStyle(color: BimColors.red)),
                onTap: () => Navigator.pop(ctx, 'remove'),
              ),
          ],
        ),
      ),
    );
    if (action == null || !context.mounted) return;
    try {
      if (action == 'remove') {
        await ref.read(socialApiProvider).removeAvatar();
      } else {
        final bytes = await ref.read(photoSourceProvider).pick(camera: action == 'camera');
        if (bytes == null) return;
        await ref.read(socialApiProvider).setAvatar(bytes);
      }
      ref.invalidate(profileProvider(username));
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  Future<void> _toggleFollow(BuildContext context, WidgetRef ref, PublicProfile p) async {
    try {
      await ref.read(socialApiProvider).follow(p.person.username, on: !p.followedByMe);
      ref.invalidate(profileProvider(username));
      ref.invalidate(personPostsProvider(username));
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(profileProvider(username));
    final p = async.valueOrNull;
    return Scaffold(
      appBar: AppBar(
        centerTitle: false,
        title: Text(p?.person.username ?? username, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
        actions: [
          if (p != null && !p.isMe)
            PopupMenuButton<String>(
              tooltip: 'Plus d’options',
              onSelected: (v) async {
                if (v == 'report') {
                  await showReportContentSheet(context, ref, targetType: 'user', targetId: p.person.id);
                } else if (v == 'block') {
                  final blocked = await confirmBlock(context, ref, p.person);
                  if (blocked && context.mounted) context.pop();
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'report', child: Text('Signaler ce profil')),
                PopupMenuItem(value: 'block', child: Text('Bloquer')),
              ],
            ),
          if (p != null && p.isMe) IconButton(tooltip: 'Mon compte', icon: const Icon(Icons.menu_rounded), onPressed: () => context.push('/account')),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(BimSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Peni(pose: PeniPose.think, size: 90),
                const SizedBox(height: BimSpacing.md),
                Text(e is ApiException && e.status == 404 ? 'Ce profil n’est pas disponible.' : (e is ApiException ? e.message : ApiException.unknown.message), textAlign: TextAlign.center),
              ],
            ),
          ),
        ),
        data: (p) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(personPostsProvider(username));
            ref.invalidate(profileProvider(username));
            await ref.read(profileProvider(username).future);
          },
          child: ListView(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: p.isMe ? () => _changeAvatar(context, ref, p) : null,
                      child: Stack(
                        children: [
                          PersonAvatar(person: p.person, size: 92, ring: true),
                          if (p.isMe)
                            Positioned(
                              right: 0,
                              bottom: 0,
                              child: Container(
                                padding: const EdgeInsets.all(5),
                                decoration: BoxDecoration(color: theme.colorScheme.onSurface, shape: BoxShape.circle),
                                child: Icon(Icons.photo_camera_outlined, size: 16, color: theme.colorScheme.surface),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: BimSpacing.lg),
                    Expanded(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          _Count(value: p.bims, label: 'BIM'),
                          _Count(value: p.followers, label: 'Abonnés'),
                          if (p.projects != null) _Count(value: p.projects!, label: 'Projets', onTap: () => context.push('/projects')) else _Count(value: p.following, label: 'Abonnements'),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.md, BimSpacing.screen, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.person.fullName, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    if (p.city != null) Text(p.city!, style: theme.textTheme.bodyMedium),
                    if (!p.isMe && p.followsMe) Text('Te suit', style: theme.textTheme.bodySmall),
                    const SizedBox(height: BimSpacing.md),
                    if (p.isMe)
                      Row(
                        children: [
                          Expanded(child: BimButton(label: 'Changer ma photo', variant: BimButtonVariant.subtle, onPressed: () => _changeAvatar(context, ref, p))),
                          const SizedBox(width: BimSpacing.sm),
                          Expanded(child: BimButton(label: 'Mes projets', variant: BimButtonVariant.subtle, onPressed: () => context.push('/projects'))),
                        ],
                      )
                    else
                      BimButton(
                        key: const ValueKey('profile-follow'),
                        label: p.followedByMe ? 'Abonné·e' : 'Suivre',
                        icon: p.followedByMe ? Icons.check_rounded : null,
                        variant: p.followedByMe ? BimButtonVariant.subtle : BimButtonVariant.primary,
                        onPressed: () => _toggleFollow(context, ref, p),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: BimSpacing.lg),
              const Divider(height: 1),
              _PostsGrid(username: username),
            ],
          ),
        ),
      ),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.value, required this.label, this.onTap});

  final int value;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(BimRadius.chip),
      child: Padding(
        padding: const EdgeInsets.all(BimSpacing.xs),
        child: Column(
          children: [
            Text(compactCount(value), style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            Text(label, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _PostsGrid extends ConsumerWidget {
  const _PostsGrid({required this.username});

  final String username;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(personPostsProvider(username));
    return async.when(
      loading: () => const Padding(padding: EdgeInsets.all(BimSpacing.xl), child: Center(child: CircularProgressIndicator())),
      error: (e, _) => Padding(padding: const EdgeInsets.all(BimSpacing.xl), child: Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center)),
      data: (page) => page.items.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(BimSpacing.xl),
              child: Text('Aucune publication pour l’instant.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
            )
          : GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 2,
              crossAxisSpacing: 2,
              children: [
                for (final post in page.items)
                  InkWell(
                    key: ValueKey('grid-${post.id}'),
                    onTap: () async {
                      final r = await context.push<Object?>('/posts/${post.id}');
                      if (r != null) ref.invalidate(personPostsProvider(username));
                    },
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (post.media.isNotEmpty)
                          PostImage(media: post.after ?? post.media.first)
                        else
                          Container(
                            color: theme.colorScheme.surfaceContainerLow,
                            padding: const EdgeInsets.all(BimSpacing.sm),
                            child: Text(post.text ?? '', maxLines: 5, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall),
                          ),
                        if (post.isBim) const Positioned(left: 6, top: 6, child: PhotoTag(text: 'BIM')),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

/// Recherche de personnes (loupe de l'écran 10).
class PeopleSearchScreen extends ConsumerStatefulWidget {
  const PeopleSearchScreen({super.key});

  @override
  ConsumerState<PeopleSearchScreen> createState() => _PeopleSearchScreenState();
}

class _PeopleSearchScreenState extends ConsumerState<PeopleSearchScreen> {
  final _q = TextEditingController();
  List<PersonResult>? _results;
  bool _loading = false;
  int _seq = 0;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _search(String q) async {
    final mine = ++_seq;
    if (q.trim().length < 2) {
      setState(() => _results = null);
      return;
    }
    setState(() => _loading = true);
    try {
      final r = await ref.read(socialApiProvider).search(q.trim());
      if (mounted && mine == _seq) setState(() => _results = r);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted && mine == _seq) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final results = _results;
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          key: const ValueKey('people-search'),
          controller: _q,
          autofocus: true,
          textInputAction: TextInputAction.search,
          onChanged: _search,
          decoration: const InputDecoration(hintText: 'Rechercher une personne', prefixIcon: Icon(Icons.search_rounded)),
        ),
      ),
      body: _loading && results == null
          ? const Center(child: CircularProgressIndicator())
          : results == null
              ? Padding(
                  padding: const EdgeInsets.all(BimSpacing.xl),
                  child: Text('Tape au moins deux lettres d’un nom ou d’un @nom d’utilisateur.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
                )
              : results.isEmpty
                  ? Padding(padding: const EdgeInsets.all(BimSpacing.xl), child: Text('Personne ne correspond.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium))
                  : ListView(
                      children: [
                        for (final r in results)
                          ListTile(
                            leading: PersonAvatar(person: r.person, size: 44),
                            title: Text(r.person.fullName, style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text('@${r.person.username}${r.followedByMe ? ' · abonné·e' : ''}'),
                            onTap: () => context.push('/people/${r.person.username}'),
                          ),
                      ],
                    ),
    );
  }
}

/// Personnes bloquées (compte → confidentialité) : débloquer.
class BlockedPeopleScreen extends ConsumerStatefulWidget {
  const BlockedPeopleScreen({super.key});

  @override
  ConsumerState<BlockedPeopleScreen> createState() => _BlockedPeopleScreenState();
}

class _BlockedPeopleScreenState extends ConsumerState<BlockedPeopleScreen> {
  late Future<List<PersonRef>> _future = ref.read(socialApiProvider).blocked();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Personnes bloquées')),
      body: FutureBuilder<List<PersonRef>>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text(snap.error is ApiException ? (snap.error! as ApiException).message : ApiException.unknown.message));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final items = snap.data!;
          if (items.isEmpty) {
            return Padding(padding: const EdgeInsets.all(BimSpacing.xl), child: Text('Tu n’as bloqué personne.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium));
          }
          return ListView(
            children: [
              for (final p in items)
                ListTile(
                  leading: PersonAvatar(person: p, size: 40),
                  title: Text(p.fullName),
                  subtitle: Text('@${p.username}'),
                  trailing: TextButton(
                    onPressed: () async {
                      try {
                        await ref.read(socialApiProvider).block(p.username, on: false);
                        setState(() => _future = ref.read(socialApiProvider).blocked());
                      } on ApiException catch (e) {
                        if (context.mounted) showApiError(context, e);
                      }
                    },
                    child: const Text('Débloquer'),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
