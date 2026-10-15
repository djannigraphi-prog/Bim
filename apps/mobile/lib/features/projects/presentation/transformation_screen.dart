import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../application/photo_source.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';

final projectPhotosProvider = FutureProvider.autoDispose.family<({bool available, List<ProjectPhoto> items}), String>(
  (ref, id) => ref.watch(projectsApiProvider).photos(id),
);

/// Prend une photo (appareil ou galerie) et l'envoie. Renvoie vrai si la photo est enregistrée.
Future<bool> captureProjectPhoto(BuildContext context, WidgetRef ref, String projectId, String kind) async {
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
  if (camera == null) return false;
  final bytes = await ref.read(photoSourceProvider).pick(camera: camera);
  if (bytes == null) return false;
  try {
    await ref.read(projectsApiProvider).uploadPhoto(projectId, kind, bytes);
    ref.invalidate(projectPhotosProvider(projectId));
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showApiError(context, e);
    return false;
  }
}

/// Écran 31 — « Ta transformation » : photos avant / après côte à côte, privées.
class TransformationScreen extends ConsumerWidget {
  const TransformationScreen({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(projectPhotosProvider(projectId));
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ProjectLoadError(error: e, onRetry: () => ref.invalidate(projectPhotosProvider(projectId))),
          data: (data) {
            final before = data.items.where((p) => p.kind == 'before').firstOrNull;
            final after = data.items.where((p) => p.kind == 'after').firstOrNull;
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
                  child: Row(
                    children: [
                      IconButton(tooltip: 'Fermer', icon: const Icon(Icons.close_rounded), onPressed: () => context.pop()),
                      Expanded(child: Text('Ta transformation', textAlign: TextAlign.center, style: theme.textTheme.titleLarge)),
                      const SizedBox(width: kBimMinTouch),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(BimSpacing.screen),
                    children: [
                      if (!data.available)
                        const Text('Le stockage des photos n’est pas encore disponible sur ce serveur.')
                      else ...[
                        AspectRatio(
                          aspectRatio: 0.9,
                          child: Row(
                            children: [
                              Expanded(child: _PhotoPane(photo: before, label: 'Avant', projectId: projectId, kind: 'before', grey: true)),
                              const SizedBox(width: BimSpacing.sm),
                              Expanded(child: _PhotoPane(photo: after, label: 'Après', projectId: projectId, kind: 'after')),
                            ],
                          ),
                        ),
                        const SizedBox(height: BimSpacing.lg),
                        Row(
                          children: [
                            Peni(pose: before != null && after != null ? PeniPose.cheer : PeniPose.think, size: 56),
                            const SizedBox(width: BimSpacing.md),
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.all(BimSpacing.md),
                                decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
                                child: Text(
                                  before != null && after != null
                                      ? 'Waouh, la différence ! Tu veux partager ton BIM pour motiver les autres ?'
                                      : 'Ajoute tes deux photos pour voir ta transformation. Elles restent privées.',
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
                  child: Column(
                    children: [
                      BimButton(
                        label: 'Publier « J’ai fait mon BIM »',
                        icon: Icons.auto_awesome,
                        key: const ValueKey('publish-bim'),
                        onPressed: before != null && after != null
                            ? () => context.push('/social/new', extra: projectId)
                            : () => showBimSnack(context, 'Ajoute tes photos « avant » et « après » pour publier ton BIM.'),
                      ),
                      const SizedBox(height: BimSpacing.sm),
                      BimButton(label: 'Garder pour moi', variant: BimButtonVariant.subtle, onPressed: () => context.pop()),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _PhotoPane extends ConsumerWidget {
  const _PhotoPane({required this.photo, required this.label, required this.projectId, required this.kind, this.grey = false});

  final ProjectPhoto? photo;
  final String label;
  final String projectId;
  final String kind;
  final bool grey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(BimRadius.card),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (photo == null)
            Material(
              color: scheme.surfaceContainerLow,
              child: InkWell(
                onTap: () => captureProjectPhoto(context, ref, projectId, kind),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.add_a_photo_outlined, size: 36, color: scheme.onSurfaceVariant),
                    const SizedBox(height: BimSpacing.sm),
                    Text('Ajouter la photo « ${label.toLowerCase()} »', textAlign: TextAlign.center),
                  ],
                ),
              ),
            )
          else
            ColorFiltered(
              colorFilter: grey
                  ? const ColorFilter.matrix([0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0.33, 0.33, 0.33, 0, 0, 0, 0, 0, 1, 0])
                  : const ColorFilter.mode(Colors.transparent, BlendMode.dst),
              child: Image.network(photo!.url, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Center(child: Icon(Icons.broken_image_outlined))),
            ),
          if (photo != null)
            Positioned(
              left: BimSpacing.sm,
              right: BimSpacing.sm,
              bottom: BimSpacing.sm,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 6),
                decoration: BoxDecoration(color: kind == 'after' ? BimColors.red : BimColors.black.withValues(alpha: 0.75), borderRadius: BorderRadius.circular(10)),
                child: Text(
                  '$label · ${shortDay(photo!.takenDay)}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: BimColors.white, fontWeight: FontWeight.w700),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
