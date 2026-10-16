import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/session_controller.dart';
import '../../projects/application/photo_source.dart';
import '../application/social_providers.dart';
import '../data/social_api.dart';
import '../data/social_models.dart';
import 'moderation_sheets.dart';
import 'social_widgets.dart';

/// Bandeau des stories (écran 10) : « Ta story » puis les personnes suivies (anneau rouge : pas encore vue).
class StoriesBar extends ConsumerWidget {
  const StoriesBar({super.key});

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final camera = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(title: Text('Nouvelle story', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('Visible 24 heures par tes abonnés')),
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Prendre une photo'), onTap: () => Navigator.pop(ctx, true)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choisir dans la galerie'), onTap: () => Navigator.pop(ctx, false)),
          ],
        ),
      ),
    );
    if (camera == null) return;
    final bytes = await ref.read(photoSourceProvider).pick(camera: camera);
    if (bytes == null) return;
    try {
      await ref.read(socialApiProvider).createStory(bytes);
      ref.invalidate(storiesProvider);
      if (context.mounted) showBimSnack(context, 'Ta story est en ligne pour 24 heures.');
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  Future<void> _open(BuildContext context, WidgetRef ref, List<StoryGroup> groups, int index) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => StoryViewer(groups: groups, initialGroup: index)));
    ref.invalidate(storiesProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    if (session is! SessionSignedIn) return const SizedBox.shrink();
    final me = PersonRef(id: session.me.id, username: session.me.username, fullName: session.me.fullName);
    final tray = ref.watch(storiesProvider).valueOrNull;
    final mine = tray?.mine;
    final others = tray?.items ?? const <StoryGroup>[];
    return SizedBox(
      height: 104,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen - 4),
        children: [
          _Bubble(
            key: const ValueKey('story-mine'),
            person: mine?.author ?? me,
            label: 'Ta story',
            ring: mine == null ? _Ring.none : _Ring.seen,
            showAdd: true,
            onTap: () => mine == null ? _add(context, ref) : _open(context, ref, [mine], 0),
            onAdd: () => _add(context, ref),
          ),
          for (final (i, g) in others.indexed)
            _Bubble(
              key: ValueKey('story-${g.author.username}'),
              person: g.author,
              label: g.author.fullName.split(' ').first,
              ring: g.allSeen ? _Ring.seen : _Ring.unseen,
              onTap: () => _open(context, ref, others, i),
            ),
        ],
      ),
    );
  }
}

enum _Ring { none, seen, unseen }

class _Bubble extends StatelessWidget {
  const _Bubble({super.key, required this.person, required this.label, required this.ring, required this.onTap, this.showAdd = false, this.onAdd});

  final PersonRef person;
  final String label;
  final _Ring ring;
  final VoidCallback onTap;
  final bool showAdd;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (ring) { _Ring.unseen => BimColors.red, _Ring.seen => scheme.outline, _Ring.none => Colors.transparent };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: SizedBox(
        width: 72,
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onTap,
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: color, width: 2.5)),
                    child: PersonAvatar(person: person, size: 60),
                  ),
                ),
                if (showAdd)
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Semantics(
                      button: true,
                      label: 'Ajouter une story',
                      child: GestureDetector(
                        key: const ValueKey('story-add'),
                        onTap: onAdd,
                        child: Container(
                          width: 24,
                          height: 24,
                          decoration: BoxDecoration(color: BimColors.red, shape: BoxShape.circle, border: Border.all(color: scheme.surface, width: 2)),
                          child: const Icon(Icons.add, size: 16, color: BimColors.white),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

/// Lecteur de stories plein écran : 5 secondes par photo, toucher à droite pour avancer, à gauche pour revenir.
class StoryViewer extends ConsumerStatefulWidget {
  const StoryViewer({super.key, required this.groups, this.initialGroup = 0});

  final List<StoryGroup> groups;
  final int initialGroup;

  @override
  ConsumerState<StoryViewer> createState() => _StoryViewerState();
}

class _StoryViewerState extends ConsumerState<StoryViewer> with SingleTickerProviderStateMixin {
  static const _duration = Duration(seconds: 5);
  late int _g = widget.initialGroup;
  int _i = 0;
  late final AnimationController _progress = AnimationController(vsync: this, duration: _duration)
    ..addStatusListener((s) {
      if (s == AnimationStatus.completed) _next();
    });

  StoryGroup get _group => widget.groups[_g];
  StoryItem get _item => _group.items[_i];

  bool get _mine {
    final s = ref.read(sessionProvider);
    return s is SessionSignedIn && s.me.id == _group.author.id;
  }

  @override
  void initState() {
    super.initState();
    _show();
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  void _show() {
    _progress.forward(from: 0);
    if (!_mine && !_item.seen) unawaited(_markSeen(_item.id));
  }

  /// « Vue » enregistrée sans gêner la lecture : une erreur réseau est sans conséquence.
  Future<void> _markSeen(String id) async {
    try {
      await ref.read(socialApiProvider).viewStory(id);
    } catch (_) {}
  }

  void _next() {
    if (_i < _group.items.length - 1) {
      setState(() => _i++);
    } else if (_g < widget.groups.length - 1) {
      setState(() {
        _g++;
        _i = 0;
      });
    } else {
      Navigator.of(context).maybePop();
      return;
    }
    _show();
  }

  void _previous() {
    if (_i > 0) {
      setState(() => _i--);
    } else if (_g > 0) {
      setState(() {
        _g--;
        _i = widget.groups[_g].items.length - 1;
      });
    }
    _show();
  }

  Future<void> _menu() async {
    _progress.stop();
    final mine = _mine;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (mine)
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded, color: BimColors.red),
                title: const Text('Supprimer cette story', style: TextStyle(color: BimColors.red)),
                onTap: () => Navigator.pop(ctx, 'delete'),
              )
            else ...[
              ListTile(leading: const Icon(Icons.flag_outlined), title: const Text('Signaler cette story'), onTap: () => Navigator.pop(ctx, 'report')),
              ListTile(leading: const Icon(Icons.block_rounded), title: Text('Bloquer @${_group.author.username}'), onTap: () => Navigator.pop(ctx, 'block')),
            ],
          ],
        ),
      ),
    );
    if (!mounted) return;
    switch (choice) {
      case 'delete':
        try {
          await ref.read(socialApiProvider).deleteStory(_item.id);
          if (mounted) Navigator.of(context).pop();
        } on ApiException catch (e) {
          if (mounted) showApiError(context, e);
        }
        return;
      case 'report':
        await showReportContentSheet(context, ref, targetType: 'story', targetId: _item.id);
      case 'block':
        final blocked = await confirmBlock(context, ref, _group.author);
        if (blocked && mounted) {
          Navigator.of(context).pop();
          return;
        }
    }
    if (mounted) unawaited(_progress.forward());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BimColors.black,
      body: SafeArea(
        child: GestureDetector(
          // Tout l'écran réagit, y compris autour de la photo.
          behavior: HitTestBehavior.opaque,
          onTapUp: (d) => d.localPosition.dx > MediaQuery.sizeOf(context).width / 3 ? _next() : _previous(),
          onLongPressStart: (_) => _progress.stop(),
          onLongPressEnd: (_) => _progress.forward(),
          child: Stack(
            fit: StackFit.expand,
            children: [
              Center(
                child: Image.network(
                  _item.url,
                  key: ValueKey(_item.id),
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined, color: BimColors.grey400, size: 48),
                ),
              ),
              Positioned(
                left: BimSpacing.sm,
                right: BimSpacing.sm,
                top: BimSpacing.sm,
                child: Row(
                  children: [
                    for (var k = 0; k < _group.items.length; k++)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 2),
                          child: AnimatedBuilder(
                            animation: _progress,
                            builder: (_, __) => LinearProgressIndicator(
                              value: k < _i ? 1 : (k == _i ? _progress.value : 0),
                              minHeight: 3,
                              backgroundColor: BimColors.white.withValues(alpha: 0.3),
                              valueColor: const AlwaysStoppedAnimation(BimColors.white),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Positioned(
                left: BimSpacing.md,
                right: 0,
                top: BimSpacing.lg,
                child: Row(
                  children: [
                    PersonAvatar(person: _group.author, size: 36),
                    const SizedBox(width: BimSpacing.sm),
                    Expanded(
                      child: Text(
                        '${_group.author.fullName} · ${timeAgo(_item.createdAt)}',
                        style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w700),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    IconButton(tooltip: 'Plus d’options', icon: const Icon(Icons.more_horiz_rounded, color: BimColors.white), onPressed: _menu),
                    IconButton(tooltip: 'Fermer', icon: const Icon(Icons.close_rounded, color: BimColors.white), onPressed: () => Navigator.of(context).maybePop()),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
