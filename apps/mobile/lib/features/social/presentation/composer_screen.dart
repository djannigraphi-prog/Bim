import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/session_controller.dart';
import '../../projects/application/photo_source.dart';
import '../../projects/application/projects_providers.dart';
import '../application/social_providers.dart';
import '../data/social_api.dart';
import '../data/social_models.dart';
import 'social_widgets.dart';

const _maxImages = 4;

/// Écran 16 — Nouveau Bim : texte, 4 photos au plus, « Lier à un projet » (format « J'ai fait mon BIM » : les photos
/// avant / après du projet sont publiées, avec l'accord explicite de la personne), « Visible par ».
/// « Identifier des personnes » et « Ajouter un lieu » : non proposés pour l'instant (aucune donnée de lieu publiée).
class ComposerScreen extends ConsumerStatefulWidget {
  const ComposerScreen({super.key, this.projectId});

  /// Projet à lier d'emblée (depuis l'écran 31 « Ta transformation »).
  final String? projectId;

  @override
  ConsumerState<ComposerScreen> createState() => _ComposerScreenState();
}

class _ComposerScreenState extends ConsumerState<ComposerScreen> {
  final _text = TextEditingController();
  final _images = <Uint8List>[];
  String _visibility = 'public';
  String? _projectId;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _projectId = widget.projectId;
    _text.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  bool get _linked => _projectId != null;
  bool get _canPublish => !_sending && (_linked || _text.text.trim().isNotEmpty || _images.isNotEmpty);

  Future<void> _addImage() async {
    final camera = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Prendre une photo'), onTap: () => Navigator.pop(ctx, true)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choisir dans la galerie'), onTap: () => Navigator.pop(ctx, false)),
          ],
        ),
      ),
    );
    if (camera == null) return;
    final bytes = await ref.read(photoSourceProvider).pick(camera: camera);
    if (bytes != null && mounted) setState(() => _images.add(Uint8List.fromList(bytes)));
  }

  Future<void> _pickProject() async {
    final list = await ref.read(myProjectsProvider.future);
    if (!mounted) return;
    if (list.items.isEmpty) {
      showBimSnack(context, 'Tu n’as pas encore de projet à lier.');
      return;
    }
    final id = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Quel projet ?', style: TextStyle(fontWeight: FontWeight.w700))),
            for (final p in list.items)
              ListTile(
                leading: Icon(p.isCompleted ? Icons.emoji_events_outlined : Icons.flag_outlined, color: BimColors.red),
                title: Text(p.title),
                subtitle: Text(p.isCompleted ? 'Terminé' : 'Jour ${p.currentDay} sur ${p.durationDays}'),
                onTap: () => Navigator.pop(ctx, p.id),
              ),
          ],
        ),
      ),
    );
    if (id != null && mounted) setState(() => _projectId = id);
  }

  Future<void> _publish() async {
    setState(() => _sending = true);
    final api = ref.read(socialApiProvider);
    try {
      final FeedPost post = _linked
          ? await api.createBim(projectId: _projectId!, text: _text.text, visibility: _visibility)
          : await api.create(text: _text.text, visibility: _visibility, images: _images);
      ref
        ..invalidate(feedProvider('for_you'))
        ..invalidate(feedProvider('following'));
      if (!mounted) return;
      showBimSnack(context, post.isBim ? 'Ton BIM est publié 🎉' : 'C’est publié !');
      // Ouvert depuis le fil, l'écran 30 ou l'écran 31 ; sinon, retour à l'Accueil.
      if (context.canPop()) {
        context.pop(post);
      } else {
        context.go('/home');
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'BIM_PHOTOS_MISSING') {
        final projectId = _projectId!;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.message),
            action: SnackBarAction(label: 'Ajouter', onPressed: () => context.push('/projects/$projectId/transformation')),
          ),
        );
      } else {
        showApiError(context, e);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = ref.watch(sessionProvider);
    final me = session is SessionSignedIn ? PersonRef(id: session.me.id, username: session.me.username, fullName: session.me.fullName) : null;
    final projects = ref.watch(myProjectsProvider).valueOrNull;
    final linkedTitle = projects?.items.where((p) => p.id == _projectId).map((p) => p.title).firstOrNull;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Fermer', icon: const Icon(Icons.close_rounded), onPressed: () => context.pop()),
        title: const Text('Nouveau Bim'),
        centerTitle: true,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: BimSpacing.md),
            child: FilledButton(
              key: const ValueKey('composer-publish'),
              onPressed: _canPublish ? _publish : null,
              style: FilledButton.styleFrom(
                backgroundColor: BimColors.red,
                foregroundColor: BimColors.white,
                minimumSize: const Size(0, 38),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.chip)),
              ),
              child: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: BimColors.white)) : const Text('Publier'),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (me != null) PersonAvatar(person: me, size: 40),
              const SizedBox(width: BimSpacing.md),
              Expanded(
                child: TextField(
                  key: const ValueKey('composer-text'),
                  controller: _text,
                  maxLength: 2200,
                  minLines: 3,
                  maxLines: 10,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    hintText: _linked ? 'Raconte ta transformation…' : 'Partage un Bim…',
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: BimSpacing.sm),
          if (_linked)
            Container(
              padding: const EdgeInsets.all(BimSpacing.md),
              decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
              child: Row(
                children: [
                  const Icon(Icons.compare_rounded, color: BimColors.red),
                  const SizedBox(width: BimSpacing.md),
                  Expanded(
                    child: Text(
                      'Tes photos avant / après${linkedTitle == null ? '' : ' de « $linkedTitle »'} seront publiées avec le résumé du parcours. Le reste de ton projet reste privé.',
                    ),
                  ),
                ],
              ),
            )
          else
            Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                for (final (i, img) in _images.indexed)
                  Stack(
                    children: [
                      ClipRRect(borderRadius: BorderRadius.circular(BimRadius.chip), child: Image.memory(img, width: 104, height: 104, fit: BoxFit.cover)),
                      Positioned(
                        right: 2,
                        top: 2,
                        child: IconButton.filled(
                          tooltip: 'Retirer la photo',
                          style: IconButton.styleFrom(backgroundColor: BimColors.black.withValues(alpha: 0.6), minimumSize: const Size(32, 32)),
                          icon: const Icon(Icons.close_rounded, size: 16, color: BimColors.white),
                          onPressed: () => setState(() => _images.removeAt(i)),
                        ),
                      ),
                    ],
                  ),
                if (_images.length < _maxImages)
                  Semantics(
                    button: true,
                    label: 'Ajouter une photo',
                    child: InkWell(
                      key: const ValueKey('composer-add-photo'),
                      borderRadius: BorderRadius.circular(BimRadius.chip),
                      onTap: _addImage,
                      child: Container(
                        width: 104,
                        height: 104,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(BimRadius.chip),
                          border: Border.all(color: theme.colorScheme.outline, width: 1.5),
                        ),
                        child: Icon(Icons.add_photo_alternate_outlined, color: theme.colorScheme.onSurfaceVariant, size: 32),
                      ),
                    ),
                  ),
              ],
            ),
          const SizedBox(height: BimSpacing.lg),
          const Divider(height: 1),
          SwitchListTile(
            key: const ValueKey('composer-link-project'),
            contentPadding: EdgeInsets.zero,
            secondary: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.emoji_events_outlined, color: BimColors.red),
            ),
            title: const Text('Lier à un projet', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(linkedTitle != null ? '« $linkedTitle » · active le format J’ai fait mon BIM' : 'Active le format J’ai fait mon BIM'),
            value: _linked,
            activeTrackColor: BimColors.red,
            onChanged: (on) => on ? _pickProject() : setState(() => _projectId = null),
          ),
          const Divider(height: 1),
          ListTile(
            key: const ValueKey('composer-visibility'),
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.public_rounded),
            title: const Text('Visible par', style: TextStyle(fontWeight: FontWeight.w700)),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [Text(visibilityLabel(_visibility), style: theme.textTheme.bodyMedium), const Icon(Icons.chevron_right_rounded)],
            ),
            onTap: () async {
              final v = await showModalBottomSheet<String>(
                context: context,
                builder: (ctx) => SafeArea(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final (code, label, help) in postVisibilities)
                        ListTile(
                          key: ValueKey('visibility-$code'),
                          leading: Icon(_visibility == code ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded, color: BimColors.red),
                          title: Text(label),
                          subtitle: Text(help),
                          onTap: () => Navigator.pop(ctx, code),
                        ),
                    ],
                  ),
                ),
              );
              if (v != null) setState(() => _visibility = v);
            },
          ),
          const Divider(height: 1),
        ],
      ),
    );
  }
}
