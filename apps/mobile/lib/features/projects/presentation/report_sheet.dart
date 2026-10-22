import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../application/photo_source.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_dialogs.dart';
import 'project_widgets.dart';

/// Ouvre le formulaire de signalement puis informe la personne du résultat.
/// Sans [projectId] : « Résoudre un problème » (problème général, description obligatoire).
/// Avec [projectId] et [day] : problème sur une journée du projet (écran 27), tâche facultative.
Future<void> reportProblem(BuildContext context, {String? projectId, String? day, List<ProjectTask> tasks = const []}) async {
  final health = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => ReportSheet(projectId: projectId, day: day, tasks: tasks),
  );
  if (health == null || !context.mounted) return;
  if (health) {
    await showHealthAdvice(context);
    return;
  }
  // Pas de bouton dans le message : un message avec action reste affiché (Flutter récent) et masquerait l'écran.
  showBimSnack(context, 'Merci, ton signalement est envoyé à l’équipe BIM. Suis la réponse dans « Mes signalements ».');
}

class ReportSheet extends ConsumerStatefulWidget {
  const ReportSheet({super.key, this.projectId, this.day, this.tasks = const []});

  final String? projectId;
  final String? day;
  final List<ProjectTask> tasks;

  bool get general => projectId == null;

  @override
  ConsumerState<ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<ReportSheet> {
  String? _reason;
  String? _taskId;
  final _message = TextEditingController();
  Uint8List? _image;
  bool _sending = false;
  String? _error;
  String? _imageError;
  String? _messageError;
  /// L'envoi d'images n'est pas disponible sur le serveur : on propose d'envoyer sans image.
  bool _imagesUnavailable = false;

  @override
  void initState() {
    super.initState();
    _message.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  bool get _canSend => !_sending && _reason != null && (!widget.general || _message.text.trim().length >= 10);

  Future<void> _pick() async {
    final camera = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Prendre une photo'), onTap: () => Navigator.pop(ctx, true)),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choisir une image ou une capture d’écran'),
              onTap: () => Navigator.pop(ctx, false),
            ),
          ],
        ),
      ),
    );
    if (camera == null || !mounted) return;
    final bytes = await pickWithFeedback(context, () => ref.read(photoSourceProvider).pick(camera: camera));
    if (bytes == null || !mounted) return;
    setState(() {
      _image = Uint8List.fromList(bytes);
      _imageError = null;
    });
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
      _imageError = null;
      _messageError = null;
    });
    try {
      final health = await ref.read(projectsApiProvider).sendReport(
            projectId: widget.projectId,
            day: widget.day,
            taskId: _taskId,
            reason: _reason!,
            message: _message.text.trim(),
            image: _image,
          );
      if (mounted) Navigator.pop(context, health);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        if (e.code == 'NOT_CONFIGURED' && _image != null) {
          _imagesUnavailable = true;
          _error = 'L’envoi d’images n’est pas disponible pour le moment. Tu peux envoyer ton signalement sans image.';
        } else if (e.fieldError('image') != null) {
          _imageError = e.fieldError('image');
        } else if (e.fieldError('message') != null) {
          _messageError = e.fieldError('message');
        } else {
          // Réseau coupé, trop d'envois… : le formulaire reste rempli pour réessayer.
          _error = e.message;
        }
      });
    } finally {
      // Réponse inattendue : le bouton « Envoyer » ne reste jamais bloqué.
      if (mounted && _sending) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final reasons = widget.general ? ProjectReport.generalReasons : ProjectReport.reasons;
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, MediaQuery.viewInsetsOf(context).bottom + BimSpacing.lg),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.general ? 'Résoudre un problème' : 'Signaler un problème', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.xs),
            Text('L’équipe BIM lit chaque signalement et te répond dans « Mes signalements ».', style: theme.textTheme.bodyMedium),
            const SizedBox(height: BimSpacing.md),
            Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                for (final e in reasons.entries) ChoiceChipBim(label: e.value, selected: _reason == e.key, onTap: () => setState(() => _reason = e.key)),
              ],
            ),
            if (widget.tasks.isNotEmpty) ...[
              const SizedBox(height: BimSpacing.md),
              Text('Tâche concernée (facultatif)', style: theme.textTheme.titleMedium),
              const SizedBox(height: BimSpacing.sm),
              Wrap(
                spacing: BimSpacing.sm,
                runSpacing: BimSpacing.sm,
                children: [
                  for (final t in widget.tasks)
                    ChoiceChipBim(label: t.title, selected: _taskId == t.id, onTap: () => setState(() => _taskId = _taskId == t.id ? null : t.id)),
                ],
              ),
            ],
            const SizedBox(height: BimSpacing.md),
            TextField(
              key: const Key('report-message'),
              controller: _message,
              maxLength: 1000,
              minLines: 2,
              maxLines: 5,
              decoration: InputDecoration(
                hintText: widget.general ? 'Décris ton problème (10 caractères au moins)' : 'Explique en quelques mots (facultatif)',
                errorText: _messageError,
              ),
            ),
            if (!_imagesUnavailable) ...[
              if (_image == null)
                OutlinedButton.icon(
                  onPressed: _sending ? null : _pick,
                  icon: const Icon(Icons.add_photo_alternate_outlined),
                  label: const Text('Joindre une image ou une capture'),
                )
              else
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(BimRadius.chip),
                      child: Image.memory(_image!, width: 88, height: 88, fit: BoxFit.cover, semanticLabel: 'Image jointe'),
                    ),
                    const SizedBox(width: BimSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Image jointe', style: theme.textTheme.titleMedium),
                          Text('Elle reste privée : seule l’équipe BIM la voit.', style: theme.textTheme.bodySmall),
                          TextButton(
                            onPressed: _sending ? null : () => setState(() => _image = null),
                            style: TextButton.styleFrom(padding: EdgeInsets.zero, foregroundColor: BimColors.red),
                            child: const Text('Retirer l’image'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              if (_imageError != null) Text(_imageError!, style: TextStyle(color: scheme.error)),
            ],
            if (_error != null) ...[
              const SizedBox(height: BimSpacing.sm),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(BimSpacing.md),
                decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(BimRadius.chip)),
                child: Text(_error!, style: TextStyle(color: scheme.onErrorContainer)),
              ),
            ],
            const SizedBox(height: BimSpacing.md),
            if (_imagesUnavailable && _image != null)
              BimButton(
                label: 'Envoyer sans image',
                variant: BimButtonVariant.dark,
                onPressed: _sending
                    ? null
                    : () {
                        setState(() => _image = null);
                        _send();
                      },
              )
            else
              BimButton(label: _sending ? 'Envoi…' : 'Envoyer', variant: BimButtonVariant.dark, onPressed: _canSend ? _send : null),
          ],
        ),
      ),
    );
  }
}
