import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../data/social_api.dart';
import '../data/social_models.dart';

/// Signaler un contenu (publication, commentaire, profil) à la modération de BIM. Renvoie vrai si c'est envoyé.
Future<bool> showReportContentSheet(BuildContext context, WidgetRef ref, {required String targetType, required String targetId}) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => _ReportSheet(targetType: targetType, targetId: targetId),
  );
  if (sent == true && context.mounted) {
    showBimSnack(context, 'Merci, l’équipe BIM va examiner ce signalement.');
  }
  return sent == true;
}

class _ReportSheet extends ConsumerStatefulWidget {
  const _ReportSheet({required this.targetType, required this.targetId});

  final String targetType;
  final String targetId;

  @override
  ConsumerState<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<_ReportSheet> {
  String? _reason;
  final _message = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await ref.read(socialApiProvider).report(targetType: widget.targetType, targetId: widget.targetId, reason: _reason!, message: _message.text);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final what = switch (widget.targetType) { 'comment' => 'ce commentaire', 'user' => 'ce profil', 'message' => 'ce message', _ => 'cette publication' };
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg + MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Signaler $what', style: theme.textTheme.titleLarge),
              const SizedBox(height: BimSpacing.xs),
              Text('Ton signalement est anonyme pour la personne concernée.', style: theme.textTheme.bodyMedium),
              const SizedBox(height: BimSpacing.sm),
              for (final (code, label) in contentReportReasons)
                ListTile(
                  key: ValueKey('report-$code'),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    _reason == code ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
                    color: _reason == code ? BimColors.red : theme.colorScheme.onSurfaceVariant,
                  ),
                  title: Text(label),
                  selected: _reason == code,
                  onTap: () => setState(() => _reason = code),
                ),
              if (_reason == 'self_harm')
                Container(
                  margin: const EdgeInsets.only(bottom: BimSpacing.sm),
                  padding: const EdgeInsets.all(BimSpacing.md),
                  decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
                  child: const Text(
                    'Si quelqu’un est en danger immédiat, appelle le SAMU (185) ou les pompiers (180).',
                    style: TextStyle(color: BimColors.black),
                  ),
                ),
              TextField(
                controller: _message,
                maxLength: 500,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Précision (facultatif)'),
              ),
              const SizedBox(height: BimSpacing.sm),
              BimButton(label: 'Envoyer le signalement', loading: _sending, onPressed: _reason == null ? null : _send),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bloquer une personne, après confirmation. Renvoie vrai si c'est fait.
Future<bool> confirmBlock(BuildContext context, WidgetRef ref, PersonRef person) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Bloquer @${person.username} ?'),
      content: const Text('Vous ne verrez plus vos publications, commentaires et profils l’un de l’autre, et vos abonnements mutuels seront retirés. Tu pourras débloquer depuis ton compte.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Bloquer', style: TextStyle(color: BimColors.red))),
      ],
    ),
  );
  if (ok != true || !context.mounted) return false;
  try {
    await ref.read(socialApiProvider).block(person.username, on: true);
    if (context.mounted) showBimSnack(context, '@${person.username} est bloqué·e.');
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showApiError(context, e);
    return false;
  }
}

/// Menu « … » d'une publication : supprimer (la sienne), ou signaler et bloquer (celle d'un autre).
/// Renvoie 'deleted' ou 'blocked' quand la publication doit disparaître de l'écran.
Future<String?> showPostMenu(BuildContext context, WidgetRef ref, FeedPost post) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (post.isMine)
            ListTile(
              key: const ValueKey('post-delete'),
              leading: const Icon(Icons.delete_outline_rounded, color: BimColors.red),
              title: const Text('Supprimer la publication', style: TextStyle(color: BimColors.red)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            )
          else ...[
            ListTile(key: const ValueKey('post-report'), leading: const Icon(Icons.flag_outlined), title: const Text('Signaler la publication'), onTap: () => Navigator.pop(ctx, 'report')),
            ListTile(
              key: const ValueKey('post-block'),
              leading: const Icon(Icons.block_rounded),
              title: Text('Bloquer @${post.author.username}'),
              onTap: () => Navigator.pop(ctx, 'block'),
            ),
          ],
        ],
      ),
    ),
  );
  if (!context.mounted) return null;
  switch (choice) {
    case 'report':
      await showReportContentSheet(context, ref, targetType: 'post', targetId: post.id);
      return null;
    case 'block':
      return await confirmBlock(context, ref, post.author) ? 'blocked' : null;
    case 'delete':
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Supprimer cette publication ?'),
          content: const Text('Elle disparaîtra pour tout le monde, avec ses photos et ses commentaires. Les photos privées de ton projet ne sont pas touchées.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Supprimer', style: TextStyle(color: BimColors.red))),
          ],
        ),
      );
      if (ok != true || !context.mounted) return null;
      try {
        await ref.read(socialApiProvider).delete(post.id);
        if (context.mounted) showBimSnack(context, 'Publication supprimée.');
        return 'deleted';
      } on ApiException catch (e) {
        if (context.mounted) showApiError(context, e);
        return null;
      }
  }
  return null;
}
