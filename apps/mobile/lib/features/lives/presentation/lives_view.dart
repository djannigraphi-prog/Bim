import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../merchant/data/shop_api.dart';
import '../data/lives_api.dart';

String _when(DateTime? d) {
  if (d == null) return '';
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(l.day)}/${two(l.month)} à ${two(l.hour)} h ${two(l.minute)}';
}

/// Onglet Live (écran 39) : Lives en cours, Lives programmés, « Lancer un Live ». Prototype : sans vidéo.
class LivesView extends ConsumerWidget {
  const LivesView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(livesListProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(livesListProvider),
      child: ListView(
        padding: const EdgeInsets.all(BimSpacing.screen),
        children: [
          Text('Lives', style: theme.textTheme.headlineSmall),
          const SizedBox(height: BimSpacing.md),
          ...async.when(
            loading: () => [const Center(child: CircularProgressIndicator())],
            error: (e, _) => [
              Text(e is ApiException ? e.message : ApiException.unknown.message),
              const SizedBox(height: BimSpacing.sm),
              BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(livesListProvider)),
            ],
            data: (list) => !list.available
                ? [
                    const Center(child: Peni(pose: PeniPose.think, size: 110)),
                    const SizedBox(height: BimSpacing.md),
                    const Text('Les Lives arrivent dans une prochaine version.', key: ValueKey('lives-closed'), textAlign: TextAlign.center),
                  ]
                : [
                    BimButton(
                      key: const ValueKey('live-new'),
                      label: 'Lancer un Live',
                      icon: Icons.videocam_outlined,
                      onPressed: () async {
                        final l = await showNewLiveSheet(context);
                        ref.invalidate(livesListProvider);
                        if (l != null && context.mounted) await context.push('/lives/${l.id}');
                      },
                    ),
                    const SizedBox(height: BimSpacing.lg),
                    Text('En direct', style: theme.textTheme.titleMedium),
                    if (list.live.isEmpty) const Text('Personne n’est en direct pour l’instant.', key: ValueKey('lives-none')),
                    for (final l in list.live) _LiveTile(live: l),
                    const SizedBox(height: BimSpacing.lg),
                    Text('Programmés', style: theme.textTheme.titleMedium),
                    if (list.upcoming.isEmpty) const Text('Aucun Live programmé.'),
                    for (final l in list.upcoming) _LiveTile(live: l),
                  ],
          ),
        ],
      ),
    );
  }
}

class _LiveTile extends StatelessWidget {
  const _LiveTile({required this.live});

  final LiveSummary live;

  @override
  Widget build(BuildContext context) => ListTile(
        key: ValueKey('live-${live.id}'),
        contentPadding: EdgeInsets.zero,
        leading: CircleAvatar(
          backgroundColor: live.isLive ? BimColors.red : BimColors.grey200,
          child: Icon(live.isSale ? Icons.storefront_rounded : Icons.videocam_rounded, color: live.isLive ? BimColors.white : BimColors.grey800),
        ),
        title: Text(live.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(live.isLive ? '${live.displayName} · ${live.viewers} en ce moment' : '${live.displayName} · ${_when(live.scheduledAt)}'),
        trailing: live.isLive
            ? Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: BimColors.red, borderRadius: BorderRadius.circular(6)),
                child: const Text('EN DIRECT', style: TextStyle(color: BimColors.white, fontSize: 11, fontWeight: FontWeight.w800)),
              )
            : null,
        onTap: () => context.push('/lives/${live.id}'),
      );
}

/// Lancer un Live maintenant ou le programmer. [asShop] : Live vente de la boutique active.
Future<LiveSummary?> showNewLiveSheet(BuildContext context, {bool asShop = false}) => showModalBottomSheet<LiveSummary>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => NewLiveSheet(asShop: asShop),
    );

class NewLiveSheet extends ConsumerStatefulWidget {
  const NewLiveSheet({super.key, this.asShop = false});

  final bool asShop;

  @override
  ConsumerState<NewLiveSheet> createState() => _NewLiveSheetState();
}

class _NewLiveSheetState extends ConsumerState<NewLiveSheet> {
  final _title = TextEditingController();
  bool _later = false;
  DateTime? _at;
  bool _busy = false;
  String? _productId;
  List<ProductSummary> _products = const [];

  @override
  void initState() {
    super.initState();
    // Live vente : article à épingler, parmi les articles en ligne de la boutique.
    if (widget.asShop) {
      ref.read(shopApiProvider).products(status: 'published').then((p) {
        if (mounted) setState(() => _products = p);
      }).catchError((Object _) {});
    }
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 30)), initialDate: now);
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(now.add(const Duration(hours: 1))));
    if (t == null || !mounted) return;
    setState(() => _at = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final l = await ref.read(livesApiProvider).create(title: _title.text.trim(), scheduledAt: _later ? _at : null, asShop: widget.asShop, productId: _productId);
      if (!mounted) return;
      showBimSnack(context, _later ? 'Live programmé. Tes abonnés le verront dans « Programmés ».' : 'Tu es en direct (mode démo).');
      Navigator.of(context).pop(l);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ready = _title.text.trim().isNotEmpty && (!_later || _at != null);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg + MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.asShop ? 'Live vente' : 'Nouveau Live', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.xs),
            const Text('Mode démo : commentaires, cœurs et cadeaux fonctionnent ; la vidéo en direct arrive plus tard.'),
            const SizedBox(height: BimSpacing.md),
            TextField(
              key: const ValueKey('live-title'),
              controller: _title,
              maxLength: 100,
              decoration: const InputDecoration(labelText: 'Titre du Live'),
              onChanged: (_) => setState(() {}),
            ),
            Wrap(
              spacing: BimSpacing.sm,
              children: [
                ChoiceChip(key: const ValueKey('live-now'), label: const Text('Maintenant'), selected: !_later, onSelected: (_) => setState(() => _later = false)),
                ChoiceChip(key: const ValueKey('live-later'), label: const Text('Programmer'), selected: _later, onSelected: (_) => setState(() => _later = true)),
              ],
            ),
            if (widget.asShop && _products.isNotEmpty) ...[
              const SizedBox(height: BimSpacing.sm),
              DropdownButtonFormField<String?>(
                key: const ValueKey('live-product'),
                initialValue: _productId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Article épinglé (facultatif)'),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('Aucun')),
                  for (final p in _products) DropdownMenuItem<String?>(value: p.id, child: Text(p.title, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (v) => setState(() => _productId = v),
              ),
            ],
            if (_later)
              TextButton.icon(
                key: const ValueKey('live-pick-date'),
                onPressed: _pickDate,
                icon: const Icon(Icons.event_outlined),
                label: Text(_at == null ? 'Choisir la date et l’heure' : _when(_at)),
              ),
            const SizedBox(height: BimSpacing.md),
            BimButton(
              key: const ValueKey('live-submit'),
              label: _later ? 'Programmer le Live' : 'Passer en direct',
              loading: _busy,
              onPressed: ready && !_busy ? _submit : null,
            ),
          ],
        ),
      ),
    );
  }
}
