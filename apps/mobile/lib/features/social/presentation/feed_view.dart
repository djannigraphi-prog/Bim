import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../../projects/application/projects_providers.dart';
import '../../projects/presentation/my_projects_screen.dart';
import '../application/social_providers.dart';
import '../data/social_api.dart';
import '../data/social_models.dart';
import 'post_card.dart';
import 'social_widgets.dart';
import 'stories.dart';

/// Écran 10 — Accueil : fils « Pour toi » et « Abonnés », « Partage un Bim… », et en tête mes projets (la carte du
/// jour, ou l'invitation à créer un premier projet). Stories : prochaine étape du lot 4 ; pièces : lot 9.
class FeedView extends ConsumerStatefulWidget {
  const FeedView({super.key, this.visitor = false});

  /// Visiteur sans compte (écran 06) : fil public en lecture ; toute action ouvre l'invitation à créer un compte.
  final bool visitor;

  @override
  ConsumerState<FeedView> createState() => _FeedViewState();
}

class _FeedViewState extends ConsumerState<FeedView> {
  String _tab = 'for_you';

  @override
  Widget build(BuildContext context) {
    if (widget.visitor) return const _VisitorFeed();
    final async = ref.watch(feedProvider(_tab));
    final controller = ref.read(feedProvider(_tab).notifier);
    final header = <Widget>[
      Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.md),
        child: Row(
          children: [
            _TabPill(label: 'Pour toi', selected: _tab == 'for_you', onTap: () => setState(() => _tab = 'for_you')),
            const SizedBox(width: BimSpacing.sm),
            _TabPill(label: 'Abonnés', selected: _tab == 'following', onTap: () => setState(() => _tab = 'following')),
            const Spacer(),
            // Lot 11 : Reels (vidéos courtes).
            TextButton.icon(
              key: const ValueKey('open-reels'),
              onPressed: () => context.push('/reels'),
              icon: const Icon(Icons.slow_motion_video_rounded),
              label: const Text('Reels'),
            ),
          ],
        ),
      ),
      const StoriesBar(),
      const SizedBox(height: BimSpacing.sm),
      const _ComposerRow(),
      const _MyProjectsHeader(),
      if (_tab == 'for_you') const _Suggestions(),
    ];
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(myProjectsProvider)
          ..invalidate(storiesProvider)
          ..invalidate(feedProvider(_tab));
        await ref.read(feedProvider(_tab).future);
      },
      child: async.when(
        loading: () => ListView(children: [...header, const Padding(padding: EdgeInsets.all(BimSpacing.xl), child: Center(child: CircularProgressIndicator()))]),
        error: (e, _) => ListView(
          children: [
            ...header,
            Padding(
              padding: const EdgeInsets.all(BimSpacing.xl),
              child: Column(
                children: [
                  Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                  const SizedBox(height: BimSpacing.md),
                  BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(feedProvider(_tab))),
                ],
              ),
            ),
          ],
        ),
        data: (s) => ListView.builder(
          key: PageStorageKey('feed-$_tab'),
          itemCount: header.length + (s.items.isEmpty ? 1 : s.items.length) + (s.hasMore ? 1 : 0),
          itemBuilder: (context, i) {
            if (i < header.length) return header[i];
            final k = i - header.length;
            if (s.items.isEmpty) return _EmptyFeed(tab: _tab);
            if (k >= s.items.length) {
              if (s.pageError) {
                return Center(
                  child: TextButton(key: const ValueKey('feed-retry'), onPressed: () => controller.loadMore(retry: true), child: const Text('Réessayer')),
                );
              }
              // Fin de la liste chargée : page suivante.
              WidgetsBinding.instance.addPostFrameCallback((_) => controller.loadMore().ignore());
              return const Padding(padding: EdgeInsets.all(BimSpacing.lg), child: Center(child: CircularProgressIndicator()));
            }
            final post = s.items[k];
            return PostCard(key: ValueKey(post.id), post: post, onChanged: controller.replace, onGone: () => controller.remove(post.id));
          },
        ),
      ),
    );
  }
}

/// V1 — « Personnes à suivre » : abonnements en commun, mêmes objectifs, publications appréciées ; masqué si vide.
class _Suggestions extends ConsumerStatefulWidget {
  const _Suggestions();

  @override
  ConsumerState<_Suggestions> createState() => _SuggestionsState();
}

class _SuggestionsState extends ConsumerState<_Suggestions> {
  final _followed = <String>{};

  Future<void> _follow(PersonSuggestion s) async {
    setState(() => _followed.add(s.person.username));
    try {
      await ref.read(socialApiProvider).follow(s.person.username, on: true);
      ref.invalidate(feedProvider('following'));
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _followed.remove(s.person.username));
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = (ref.watch(suggestionsProvider).valueOrNull ?? const <PersonSuggestion>[]).where((s) => !_followed.contains(s.person.username)).toList();
    if (items.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Column(
      key: const ValueKey('suggestions'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xs), child: Text('Personnes à suivre', style: theme.textTheme.titleMedium)),
        SizedBox(
          height: 172,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen),
            children: [
              for (final s in items)
                Container(
                  key: ValueKey('suggestion-${s.person.username}'),
                  width: 140,
                  margin: const EdgeInsets.only(right: BimSpacing.sm),
                  padding: const EdgeInsets.all(BimSpacing.sm),
                  decoration: BoxDecoration(border: Border.all(color: theme.colorScheme.outlineVariant), borderRadius: BorderRadius.circular(BimRadius.card)),
                  child: Column(
                    children: [
                      InkWell(onTap: () => context.push('/people/${s.person.username}'), child: PersonAvatar(person: s.person, size: 48)),
                      const SizedBox(height: BimSpacing.xs),
                      Text(s.person.fullName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(s.reasonLabel, maxLines: 2, textAlign: TextAlign.center, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall),
                      const Spacer(),
                      SizedBox(
                        height: 32,
                        child: FilledButton(
                          key: ValueKey('suggestion-follow-${s.person.username}'),
                          style: FilledButton.styleFrom(backgroundColor: BimColors.red, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: BimSpacing.md)),
                          onPressed: () => _follow(s),
                          child: const Text('Suivre'),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TabPill extends StatelessWidget {
  const _TabPill({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(BimRadius.chip),
        onTap: onTap,
        child: AnimatedContainer(
          duration: BimDurations.fast,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(color: selected ? scheme.onSurface : scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.chip)),
          child: Text(label, style: TextStyle(fontWeight: FontWeight.w700, color: selected ? scheme.surface : scheme.onSurface)),
        ),
      ),
    );
  }
}

/// « Partage un Bim… » : ouvre l'écran de publication (écran 16).
class _ComposerRow extends ConsumerWidget {
  const _ComposerRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final scheme = Theme.of(context).colorScheme;
    final me = session is SessionSignedIn ? PersonRef(id: session.me.id, username: session.me.username, fullName: session.me.fullName) : null;
    return Padding(
      padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
      child: Material(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(BimRadius.field),
        child: InkWell(
          key: const ValueKey('share-a-bim'),
          borderRadius: BorderRadius.circular(BimRadius.field),
          onTap: () => context.push('/social/new'),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
            child: Row(
              children: [
                if (me != null)
                  GestureDetector(onTap: () => context.push('/people/${me.username}'), child: PersonAvatar(person: me, size: 36))
                else
                  const SizedBox(width: 36),
                const SizedBox(width: BimSpacing.md),
                Expanded(child: Text('Partage un Bim…', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 16))),
                Icon(Icons.image_outlined, color: scheme.onSurfaceVariant),
                const SizedBox(width: BimSpacing.sm),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: scheme.onSurface, borderRadius: BorderRadius.circular(10)),
                  child: Icon(Icons.add, color: scheme.surface),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Mes projets en tête du fil : la carte du jour, l'accès à la liste (écran 18), ou l'invitation à commencer.
class _MyProjectsHeader extends ConsumerWidget {
  const _MyProjectsHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(myProjectsProvider).valueOrNull;
    if (list == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    if (list.items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.xl),
        child: Column(
          children: [
            const ProjectsEmptyState(),
            BimButton(label: 'Nouveau projet', icon: Icons.add, onPressed: () => context.push('/projects/new')),
          ],
        ),
      );
    }
    final today = list.items.where((p) => !p.isCompleted && !p.isPaused).firstOrNull;
    return Padding(
      padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.xl),
      child: Column(
        children: [
          if (today != null) TodayCard(project: today, today: list.today),
          ListTile(
            key: const ValueKey('my-projects'),
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.flag_outlined, color: BimColors.red),
            title: Text('Mes projets', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            subtitle: Text('${list.activeCount} en cours${list.items.length > list.activeCount ? ' · ${list.items.length - list.activeCount} terminé${list.items.length - list.activeCount > 1 ? 's' : ''}' : ''}'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => context.push('/projects'),
          ),
        ],
      ),
    );
  }
}

class _EmptyFeed extends StatelessWidget {
  const _EmptyFeed({required this.tab});

  final String tab;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final following = tab == 'following';
    return Padding(
      padding: const EdgeInsets.fromLTRB(BimSpacing.xl, BimSpacing.lg, BimSpacing.xl, BimSpacing.xxl),
      child: Column(
        children: [
          const Peni(pose: PeniPose.think, size: 80),
          const SizedBox(height: BimSpacing.md),
          Text(
            following ? 'Suis des personnes pour voir leurs Bims ici.' : 'Aucune publication pour l’instant. Partage le premier Bim !',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge,
          ),
          if (following) ...[
            const SizedBox(height: BimSpacing.md),
            BimButton(label: 'Trouver des personnes', icon: Icons.search_rounded, variant: BimButtonVariant.outline, onPressed: () => context.push('/search')),
          ],
        ],
      ),
    );
  }
}

/// Écran 06 — Fil des visiteurs : publications « Tout le monde », en lecture ; j'aime, commentaires, abonnement et
/// publication ouvrent l'invitation à créer un compte (« Rejoins BIM pour réagir »).
class _VisitorFeed extends ConsumerWidget {
  const _VisitorFeed();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(publicFeedProvider);
    void gate() => showVisitorGate(context, ref);
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(publicFeedProvider);
        await ref.read(publicFeedProvider.future);
      },
      child: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(
          padding: const EdgeInsets.all(BimSpacing.xl),
          children: [
            Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
            const SizedBox(height: BimSpacing.md),
            BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(publicFeedProvider)),
          ],
        ),
        data: (page) => ListView(
          padding: const EdgeInsets.only(top: BimSpacing.md),
          children: [
            if (page.items.isEmpty) const _EmptyFeed(tab: 'for_you'),
            for (final post in page.items) PostCard(key: ValueKey(post.id), post: post, onChanged: (_) {}, onGone: () {}, readOnlyAction: gate),
          ],
        ),
      ),
    );
  }
}
