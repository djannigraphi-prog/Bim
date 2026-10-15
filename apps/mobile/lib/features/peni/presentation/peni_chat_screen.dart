import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../projects/data/projects_models.dart';
import '../data/peni_api.dart';

/// Écran 25 — discussion avec Peni pour construire un projet (lot 3).
///
/// Les réponses de Peni sont écrites par l'équipe BIM et produites par l'API (aucune IA, aucune donnée envoyée à
/// l'extérieur). À la fin, « Voir mon programme » rend le brouillon à l'écran « Nouveau projet », qui le fait vérifier
/// et confirmer : le projet n'est créé qu'avec l'accord de la personne (règle R5).
class PeniChatScreen extends ConsumerStatefulWidget {
  const PeniChatScreen({super.key, this.mode, this.budget});

  /// Mode déjà choisi à l'écran 19 (Peni ne le redemande pas).
  final String? mode;
  final String? budget;

  @override
  ConsumerState<PeniChatScreen> createState() => _PeniChatScreenState();
}

class _PeniChatScreenState extends ConsumerState<PeniChatScreen> {
  final _messages = <PeniMessage>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  String? _conversationId;
  ProjectDraft? _draft;
  bool _busy = true;
  Object? _startError;

  PeniApi get _api => ref.read(peniApiProvider);

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _startError = null;
    });
    try {
      final t = await _api.start(mode: widget.mode, budget: widget.budget);
      if (!mounted) return;
      setState(() {
        _conversationId = t.conversationId;
        _messages
          ..clear()
          ..addAll(t.messages);
        _draft = t.draft;
        _busy = false;
      });
      _scrollToEnd();
    } catch (e) {
      if (mounted) {
        setState(() {
          _startError = e;
          _busy = false;
        });
      }
    }
  }

  Future<void> _send({String? text, String? choice}) async {
    final id = _conversationId;
    if (id == null || _busy) return;
    if (text != null && text.trim().isEmpty) return;
    setState(() => _busy = true);
    _scrollToEnd();
    try {
      final t = await _api.send(id, text: text?.trim(), choice: choice);
      if (!mounted) return;
      if (text != null) _input.clear();
      setState(() {
        _messages.addAll(t.messages);
        _draft = t.draft;
      });
    } catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollToEnd();
    }
  }

  /// Fait défiler jusqu'au dernier message, sans dépasser le bas de la liste.
  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.md),
              child: Row(
                children: [
                  const BimBackButton(),
                  const SizedBox(width: BimSpacing.md),
                  const Peni(pose: PeniPose.happy, size: 48),
                  const SizedBox(width: BimSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Peni', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                        Row(
                          children: [
                            Container(width: 8, height: 8, decoration: const BoxDecoration(color: BimColors.success, shape: BoxShape.circle)),
                            const SizedBox(width: BimSpacing.xs),
                            Flexible(
                              child: Text('Ton assistante BIM', style: theme.textTheme.bodySmall?.copyWith(color: BimColors.success), overflow: TextOverflow.ellipsis),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: theme.colorScheme.outlineVariant),
            Expanded(child: _body(context)),
            _InputBar(controller: _input, enabled: !_busy && _conversationId != null, onSend: (t) => _send(text: t)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final error = _startError;
    if (error != null) {
      return ListView(
        padding: const EdgeInsets.all(BimSpacing.screen),
        children: [
          Text(error is ApiException ? error.message : ApiException.unknown.message, key: const ValueKey('peni-error')),
          const SizedBox(height: BimSpacing.md),
          BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _start),
        ],
      );
    }
    if (_messages.isEmpty) return const Center(child: CircularProgressIndicator());
    final lastIndex = _messages.length - 1;
    final children = <Widget>[];
    for (var i = 0; i < _messages.length; i++) {
      final m = _messages[i];
      children.add(_Bubble(message: m, draft: i == lastIndex ? _draft : null, onSeeProgram: _draft == null ? null : () => context.pop(_draft)));
      if (i == lastIndex && m.fromPeni && m.quickReplies.isNotEmpty) {
        children.add(
          Padding(
            padding: const EdgeInsets.only(top: BimSpacing.sm),
            child: Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                for (final q in m.quickReplies)
                  OutlinedButton(
                    key: ValueKey('qr-${q.id}'),
                    onPressed: _busy ? null : () => _send(choice: q.id),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, kBimMinTouch),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.chip)),
                      foregroundColor: Theme.of(context).colorScheme.onSurface,
                    ),
                    child: Text(q.label),
                  ),
              ],
            ),
          ),
        );
      }
    }
    if (_busy) children.add(const _Typing());
    return ListView.separated(
      key: const ValueKey('peni-messages'),
      controller: _scroll,
      padding: const EdgeInsets.all(BimSpacing.screen),
      itemCount: children.length,
      separatorBuilder: (_, __) => const SizedBox(height: BimSpacing.md),
      itemBuilder: (_, i) => children[i],
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, this.draft, this.onSeeProgram});

  final PeniMessage message;
  final ProjectDraft? draft;
  final VoidCallback? onSeeProgram;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final peni = message.fromPeni;
    final caution = message.safety != null;
    final background = peni ? (caution ? BimColors.warningBg : scheme.surfaceContainerLow) : scheme.inverseSurface;
    final foreground = peni ? (caution ? BimColors.black : scheme.onSurface) : scheme.onInverseSurface;
    final summary = message.summary;
    return Align(
      alignment: peni ? Alignment.centerLeft : Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
        child: Container(
          padding: const EdgeInsets.all(BimSpacing.lg),
          decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(BimRadius.card)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message.text, style: theme.textTheme.bodyLarge?.copyWith(color: foreground)),
              if (summary != null) ...[
                const SizedBox(height: BimSpacing.md),
                Container(
                  key: const ValueKey('peni-summary'),
                  padding: const EdgeInsets.all(BimSpacing.md),
                  decoration: BoxDecoration(color: scheme.surface, borderRadius: BorderRadius.circular(BimRadius.field)),
                  child: Column(
                    children: [
                      for (final row in summary)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: BimSpacing.xs),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.check_rounded, size: 20, color: BimColors.success),
                              const SizedBox(width: BimSpacing.sm),
                              Text(row.label, style: theme.textTheme.bodyMedium?.copyWith(color: BimColors.grey600)),
                              const SizedBox(width: BimSpacing.sm),
                              Expanded(child: Text(row.value, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700))),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                if (draft != null) ...[
                  const SizedBox(height: BimSpacing.md),
                  BimButton(key: const ValueKey('peni-see-program'), label: 'Voir mon programme', onPressed: onSeeProgram),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Typing extends StatelessWidget {
  const _Typing();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.md),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Text('Peni écrit…', style: theme.textTheme.bodyMedium?.copyWith(color: BimColors.grey600)),
      ),
    );
  }
}

class _InputBar extends StatelessWidget {
  const _InputBar({required this.controller, required this.enabled, required this.onSend});

  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<String> onSend;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant))),
      padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.md, BimSpacing.screen, BimSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              key: const ValueKey('peni-input'),
              controller: controller,
              enabled: enabled,
              maxLength: 500,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: enabled ? onSend : null,
              decoration: InputDecoration(
                hintText: 'Écris à Peni…',
                counterText: '',
                filled: true,
                fillColor: scheme.surfaceContainerLow,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(28), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.md),
              ),
            ),
          ),
          const SizedBox(width: BimSpacing.sm),
          Material(
            color: enabled ? BimColors.red : BimColors.grey400,
            shape: const CircleBorder(),
            child: IconButton(
              key: const ValueKey('peni-send'),
              tooltip: 'Envoyer',
              onPressed: enabled ? () => onSend(controller.text) : null,
              icon: const Icon(Icons.send_rounded, color: BimColors.white),
              constraints: const BoxConstraints(minWidth: 52, minHeight: 52),
            ),
          ),
        ],
      ),
    );
  }
}
