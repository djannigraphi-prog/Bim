import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/step_header.dart';
import '../../projects/presentation/project_widgets.dart';
import '../data/inbox_api.dart';

/// Écran 17 — Notifications. Lot 2 : coffres ouverts, réponses de l'équipe BIM, rappels envoyés par le serveur.
/// Filtres « Tout » et « Projets » ; « Pièces », « Commandes » et « Live » arriveront avec leurs lots (rien de simulé).
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key, this.now});

  /// Heure de référence (tests et captures) ; par défaut, maintenant.
  final DateTime? now;

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  String? _category;
  final List<InboxItem> _items = [];
  String? _next;
  String? _nextId;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  bool _markedSeen = false;

  InboxApi get _api => ref.read(inboxApiProvider);

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _api.page(category: _category);
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _next = page.nextBefore;
        _nextId = page.nextBeforeId;
        _loading = false;
      });
      // Affichées une fois avec leur état « non vu », puis marquées vues : la pastille de la cloche disparaît.
      if (!_markedSeen) {
        _markedSeen = true;
        // Un échec ici ne doit pas masquer la liste déjà affichée (audit, M-11) : on réessaiera à la prochaine ouverture.
        try {
          await _api.markSeen();
          ref.invalidate(inboxUnreadProvider);
        } catch (_) {
          _markedSeen = false;
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _more() async {
    final next = _next;
    if (next == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await _api.page(category: _category, before: next, beforeId: _nextId);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _next = page.nextBefore;
        _nextId = page.nextBeforeId;
      });
    } catch (_) {
      // La liste déjà affichée reste ; « Voir plus » peut être retouché.
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _select(String? category) {
    if (_category == category) return;
    _category = category;
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = widget.now ?? DateTime.now();
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.sm, 0),
              child: Row(
                children: [
                  const BimBackButton(),
                  Expanded(child: Text('Notifications', textAlign: TextAlign.center, style: theme.textTheme.titleLarge)),
                  IconButton(
                    tooltip: 'Réglages des rappels',
                    icon: const Icon(Icons.settings_outlined),
                    onPressed: () => context.push('/account/reminders'),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.md, BimSpacing.screen, BimSpacing.sm),
              child: Row(
                children: [
                  ChoiceChipBim(label: 'Tout', selected: _category == null, dark: true, onTap: () => _select(null)),
                  const SizedBox(width: BimSpacing.sm),
                  ChoiceChipBim(label: 'Projets', selected: _category == 'projects', dark: true, onTap: () => _select('projects')),
                ],
              ),
            ),
            Expanded(child: _body(context, now)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context, DateTime now) {
    final theme = Theme.of(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    final error = _error;
    if (error != null) {
      return ListView(
        padding: const EdgeInsets.all(BimSpacing.screen),
        children: [
          Text(error is ApiException ? error.message : ApiException.unknown.message),
          const SizedBox(height: BimSpacing.md),
          BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: _reload),
        ],
      );
    }
    if (_items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(BimSpacing.xl),
        children: [
          const SizedBox(height: BimSpacing.xl),
          const Center(child: Peni(pose: PeniPose.think, size: 96)),
          const SizedBox(height: BimSpacing.lg),
          Text(
            'Rien de nouveau pour l’instant. Tes coffres, les réponses de l’équipe BIM et tes rappels apparaîtront ici.',
            key: const ValueKey('inbox-empty'),
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium,
          ),
        ],
      );
    }
    final children = <Widget>[];
    String? section;
    for (final item in _items) {
      final s = _section(item.at, now);
      if (s != section) {
        section = s;
        children.add(
          Padding(
            padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.lg, BimSpacing.screen, BimSpacing.sm),
            child: Text(s, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700, color: BimColors.grey600)),
          ),
        );
      }
      children.add(_Tile(item: item, ago: _ago(item.at, now)));
    }
    if (_next != null) {
      children.add(
        Padding(
          padding: const EdgeInsets.all(BimSpacing.screen),
          child: BimButton(label: 'Voir plus', variant: BimButtonVariant.outline, loading: _loadingMore, onPressed: _more),
        ),
      );
    }
    return RefreshIndicator(onRefresh: _reload, child: ListView(children: children));
  }

  static String _section(DateTime at, DateTime now) {
    final local = at.toLocal();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(local.year, local.month, local.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) return 'AUJOURD’HUI';
    if (diff < 7) return 'CETTE SEMAINE';
    return 'PLUS ANCIEN';
  }

  static String _ago(DateTime at, DateTime now) {
    final d = now.difference(at);
    if (d.inMinutes < 1) return 'à l’instant';
    if (d.inHours < 1) return 'il y a ${d.inMinutes} min';
    if (d.inDays < 1) return 'il y a ${d.inHours} h';
    if (d.inDays == 1) return 'hier';
    return 'il y a ${d.inDays} j';
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.item, required this.ago});

  final InboxItem item;
  final String ago;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final peni = item.sender == 'peni';
    final link = item.link;
    return Material(
      color: item.unread ? BimColors.redSoft : Colors.transparent,
      child: InkWell(
        key: ValueKey('inbox-${item.id}'),
        onTap: link == null ? null : () => context.push(link),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen, vertical: BimSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: peni ? BimColors.white : BimColors.red,
                child: peni ? const Peni(size: 40) : const Text('B', style: TextStyle(color: BimColors.white, fontWeight: FontWeight.w900, fontSize: 22)),
              ),
              const SizedBox(width: BimSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(text: peni ? 'Peni : ' : 'BIM : ', style: const TextStyle(fontWeight: FontWeight.w800)),
                        TextSpan(text: item.text),
                      ],),
                      style: theme.textTheme.bodyLarge?.copyWith(color: item.unread ? BimColors.black : null),
                    ),
                    const SizedBox(height: BimSpacing.xs),
                    Text(ago, style: theme.textTheme.bodySmall?.copyWith(color: BimColors.grey600)),
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
