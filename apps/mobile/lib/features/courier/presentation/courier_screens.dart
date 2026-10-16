import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../account/data/account_api.dart';
import '../../auth/application/session_controller.dart';
import '../../orders/data/orders_api.dart' show communesProvider;
import '../../projects/application/photo_source.dart';
import '../data/courier_api.dart';
import 'courier_courses.dart';

/// Lot 7-E — Devenir livreur : pièce d'identité et selfie (chiffrés), moyen de transport, envoi pour vérification.
class CourierApplyScreen extends ConsumerStatefulWidget {
  const CourierApplyScreen({super.key});

  @override
  ConsumerState<CourierApplyScreen> createState() => _CourierApplyScreenState();
}

class _CourierApplyScreenState extends ConsumerState<CourierApplyScreen> {
  CourierApplication? _app;
  bool _available = true;
  bool _loading = true;
  bool _busy = false;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await ref.read(courierApiProvider).application();
      _app = r.application;
      _available = r.available;
    } on ApiException catch (e) {
      _error = e;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _run(Future<CourierApplication> Function(CourierApi api) f) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final a = await f(ref.read(courierApiProvider));
      if (mounted) setState(() => _app = a);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _photo(String kind) async {
    final bytes = await ref.read(photoSourceProvider).pick(camera: kind == 'selfie');
    if (bytes == null || !mounted) return;
    await _run((api) => api.upload(kind, bytes));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final a = _app;
    final editable = a != null && (a.stage == 'draft' || a.stage == 'to_correct');
    return Scaffold(
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(BimSpacing.screen),
                children: [
                  Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text('Devenir livreur', style: theme.textTheme.titleLarge))]),
                  const SizedBox(height: BimSpacing.md),
                  Text(
                    'L’équipe BIM vérifie ta pièce d’identité et ton selfie à la main. Ces documents sont chiffrés et ne sont vus que par les '
                    'personnes chargées de la vérification. Les boutiques ne voient que ton nom.',
                    style: theme.textTheme.bodyMedium,
                  ),
                  const SizedBox(height: BimSpacing.lg),
                  if (!_available) const Text('Le compte livreur n’est pas encore disponible.', key: ValueKey('courier-unavailable')),
                  if (a == null && _available)
                    BimButton(key: const ValueKey('courier-start'), label: 'Commencer ma demande', loading: _busy, onPressed: _busy ? null : () => _run((api) => api.apply())),
                  if (a != null) ...[
                    Text(
                      switch (a.stage) {
                        'submitted' => 'Demande envoyée : l’équipe BIM la vérifie.',
                        'to_correct' => 'À corriger : ${a.rejectReason ?? ''}',
                        'active' => 'Compte livreur vérifié. Passe dans ton espace livreur depuis « Changer de profil ».',
                        _ => 'Complète ta demande.',
                      },
                      key: const ValueKey('courier-stage'),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: BimSpacing.md),
                    Text('Pièce d’identité', style: theme.textTheme.titleMedium),
                    Wrap(
                      spacing: BimSpacing.sm,
                      children: [
                        for (final (k, l) in const [('cni', 'Carte d’identité'), ('passport', 'Passeport'), ('permis', 'Permis')])
                          ChoiceChip(key: ValueKey('doc-$k'), label: Text(l), selected: a.idDocType == k, onSelected: editable ? (_) => _run((api) => api.update(idDocType: k)) : null),
                      ],
                    ),
                    const SizedBox(height: BimSpacing.sm),
                    Text('Moyen de transport', style: theme.textTheme.titleMedium),
                    Wrap(
                      spacing: BimSpacing.sm,
                      children: [
                        for (final v in const ['moto', 'velo', 'voiture', 'pied'])
                          ChoiceChip(key: ValueKey('vehicle-$v'), label: Text(vehicleLabel(v)), selected: a.vehicle == v, onSelected: editable ? (_) => _run((api) => api.update(vehicle: v)) : null),
                      ],
                    ),
                    const SizedBox(height: BimSpacing.md),
                    for (final (k, l, done) in [('id_front', 'Pièce, recto', a.identity), ('id_back', 'Pièce, verso', a.identity), ('selfie', 'Selfie', a.selfie)])
                      ListTile(
                        key: ValueKey('upload-$k'),
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(done ? Icons.check_circle : Icons.photo_camera_outlined, color: done ? BimColors.success : null),
                        title: Text(l),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: editable && !_busy ? () => _photo(k) : null,
                      ),
                    const SizedBox(height: BimSpacing.md),
                    if (editable)
                      BimButton(key: const ValueKey('courier-submit'), label: 'Envoyer pour vérification', loading: _busy, onPressed: a.complete && !_busy ? () => _run((api) => api.submit()) : null),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: BimSpacing.md),
                    Text(_error!.message, key: const ValueKey('courier-error'), style: const TextStyle(color: BimColors.red)),
                  ],
                ],
              ),
      ),
    );
  }
}

/// Lot 7-E — Espace livreur : disponibilité, capacité, communes desservies, relations avec les boutiques.
/// Aucune commande de boutique ici (L7-04) : seulement les missions proposées à ce livreur et ses courses (7-F).
class CourierSpaceScreen extends ConsumerStatefulWidget {
  const CourierSpaceScreen({super.key});

  @override
  ConsumerState<CourierSpaceScreen> createState() => _CourierSpaceScreenState();
}

class _CourierSpaceScreenState extends ConsumerState<CourierSpaceScreen> {
  bool _busy = false;

  Future<void> _do(Future<CourierProfile> Function(CourierApi api) f, {String? done}) async {
    setState(() => _busy = true);
    try {
      await f(ref.read(courierApiProvider));
      ref
        ..invalidate(courierProfileProvider)
        ..invalidate(missionsProvider);
      if (done != null && mounted) showBimSnack(context, done);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _backToProfile() async {
    try {
      final api = ref.read(accountApiProvider);
      final user = (await api.spaces()).firstWhere((s) => s.type == 'user');
      await ref.read(tokenStorageProvider).saveAccess(await api.switchSpace('user', user.id));
      await ref.read(sessionProvider.notifier).refreshMe();
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  Future<void> _editCommunes(CourierProfile p) async {
    final picked = await showModalBottomSheet<List<String>>(context: context, isScrollControlled: true, builder: (_) => _CommunesSheet(selected: {for (final c in p.communes) c.code}));
    if (picked != null) await _do((api) => api.updateProfile(communes: picked), done: 'Communes enregistrées');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(courierProfileProvider);
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                TextButton(onPressed: _backToProfile, child: const Text('Revenir à mon profil')),
              ],
            ),
          ),
          data: (p) => ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              Text('Espace livreur', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
              const SizedBox(height: BimSpacing.xs),
              Text('Tu ne vois que les missions qui te sont proposées, tes courses et ton historique.', style: theme.textTheme.bodySmall),
              const SizedBox(height: BimSpacing.lg),
              const CourierWorkSection(),
              const Divider(height: BimSpacing.xl),
              SwitchListTile(
                key: const ValueKey('courier-available'),
                contentPadding: EdgeInsets.zero,
                title: Text(p.available ? 'Disponible' : 'Indisponible'),
                subtitle: const Text('Les boutiques et les annonces tiennent compte de ta disponibilité.'),
                value: p.available,
                onChanged: _busy ? null : (v) => _do((api) => api.updateProfile(available: v)),
              ),
              Row(
                children: [
                  const Expanded(child: Text('Courses en même temps')),
                  IconButton(tooltip: 'Une de moins', icon: const Icon(Icons.remove_circle_outline), onPressed: _busy || p.capacity <= 1 ? null : () => _do((api) => api.updateProfile(capacity: p.capacity - 1))),
                  Text('${p.capacity}', key: const ValueKey('courier-capacity')),
                  IconButton(tooltip: 'Une de plus', icon: const Icon(Icons.add_circle_outline), onPressed: _busy || p.capacity >= 20 ? null : () => _do((api) => api.updateProfile(capacity: p.capacity + 1))),
                ],
              ),
              ListTile(
                key: const ValueKey('courier-communes'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Communes desservies'),
                subtitle: Text(p.communes.isEmpty ? 'Aucune pour le moment' : p.communes.map((c) => c.label).join(', ')),
                trailing: const Icon(Icons.edit_outlined),
                onTap: _busy ? null : () => _editCommunes(p),
              ),
              const Divider(height: BimSpacing.xl),
              Text('Boutiques', style: theme.textTheme.titleMedium),
              if (p.relations.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: BimSpacing.sm), child: Text('Aucune boutique ne t’a encore proposé de travailler avec elle.')),
              for (final r in p.relations)
                Card(
                  key: ValueKey('relation-${r.id}'),
                  child: Padding(
                    padding: const EdgeInsets.all(BimSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.shopName, style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('${relationLabel(r.relation)}${r.place != null && r.place!.isNotEmpty ? ' · ${r.place}' : ''} · ${r.status == 'pending' ? 'proposition à accepter' : 'en cours'}'),
                        if (r.relation == 'employee') Text('Employé : tu peux recevoir des espèces pour cette boutique, selon ses règles.', style: theme.textTheme.bodySmall),
                        const SizedBox(height: BimSpacing.sm),
                        Wrap(
                          spacing: BimSpacing.sm,
                          runSpacing: BimSpacing.xs,
                          children: [
                            if (r.status == 'pending') ...[
                              FilledButton(key: ValueKey('relation-accept-${r.id}'), onPressed: _busy ? null : () => _do((api) => api.relation(r.id, 'accept'), done: 'Relation acceptée'), child: const Text('Accepter')),
                              OutlinedButton(key: ValueKey('relation-decline-${r.id}'), onPressed: _busy ? null : () => _do((api) => api.relation(r.id, 'decline')), child: const Text('Refuser')),
                            ] else
                              TextButton(key: ValueKey('relation-end-${r.id}'), onPressed: _busy ? null : () => _do((api) => api.relation(r.id, 'end'), done: 'Relation terminée'), child: const Text('Mettre fin')),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: BimSpacing.xl),
              BimButton(label: 'Revenir à mon profil', variant: BimButtonVariant.subtle, onPressed: _backToProfile),
            ],
          ),
        ),
      ),
    );
  }
}

class _CommunesSheet extends ConsumerStatefulWidget {
  const _CommunesSheet({required this.selected});
  final Set<String> selected;

  @override
  ConsumerState<_CommunesSheet> createState() => _CommunesSheetState();
}

class _CommunesSheetState extends ConsumerState<_CommunesSheet> {
  late final Set<String> _sel = {...widget.selected};

  @override
  Widget build(BuildContext context) {
    final communes = ref.watch(communesProvider).valueOrNull ?? const [];
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(BimSpacing.screen),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Communes desservies', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: BimSpacing.sm),
            Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                for (final c in communes)
                  FilterChip(
                    key: ValueKey('commune-${c.code}'),
                    label: Text(c.label),
                    selected: _sel.contains(c.code),
                    onSelected: (on) => setState(() => on ? _sel.add(c.code) : _sel.remove(c.code)),
                  ),
              ],
            ),
            const SizedBox(height: BimSpacing.md),
            BimButton(key: const ValueKey('communes-save'), label: 'Enregistrer', onPressed: () => Navigator.pop(context, _sel.toList())),
          ],
        ),
      ),
    );
  }
}

/// Lot 7-E — Livreurs de la boutique : proposer un emploi ou un partenariat (le livreur accepte), y mettre fin.
class ShopCouriersScreen extends ConsumerStatefulWidget {
  const ShopCouriersScreen({super.key});

  @override
  ConsumerState<ShopCouriersScreen> createState() => _ShopCouriersScreenState();
}

class _ShopCouriersScreenState extends ConsumerState<ShopCouriersScreen> {
  final _username = TextEditingController();
  String _relation = 'partner';
  bool _busy = false;

  @override
  void dispose() {
    _username.dispose();
    super.dispose();
  }

  Future<void> _do(Future<List<ShopCourier>> Function(ShopCouriersApi api) f, {String? done}) async {
    setState(() => _busy = true);
    try {
      await f(ref.read(shopCouriersApiProvider));
      ref.invalidate(shopCouriersProvider);
      if (done != null && mounted) showBimSnack(context, done);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(shopCouriersProvider);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text('Livreurs', style: theme.textTheme.titleLarge))]),
            const SizedBox(height: BimSpacing.sm),
            Text(
              'Seuls tes livreurs employés peuvent recevoir des espèces pour ta boutique. Un partenaire ou un indépendant, jamais. '
              'Le livreur doit accepter ta proposition ; mettre fin à une relation prend effet tout de suite.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: BimSpacing.lg),
            TextField(key: const ValueKey('courier-username'), controller: _username, decoration: const InputDecoration(labelText: 'Nom d’utilisateur du livreur', prefixText: '@')),
            const SizedBox(height: BimSpacing.sm),
            SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'partner', label: Text('Partenaire')), ButtonSegment(value: 'employee', label: Text('Employé'))],
              selected: {_relation},
              onSelectionChanged: (s) => setState(() => _relation = s.first),
            ),
            const SizedBox(height: BimSpacing.sm),
            BimButton(
              key: const ValueKey('courier-invite'),
              label: 'Proposer',
              loading: _busy,
              onPressed: _busy ? null : () => _do((api) => api.invite(_username.text.trim(), _relation), done: 'Proposition envoyée'),
            ),
            const Divider(height: BimSpacing.xl),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [Text(e is ApiException ? e.message : ApiException.unknown.message)],
              data: (items) => items.isEmpty
                  ? [const Text('Aucun livreur pour le moment.', key: ValueKey('shop-couriers-empty'))]
                  : [
                      for (final c in items)
                        ListTile(
                          key: ValueKey('shop-courier-${c.id}'),
                          contentPadding: EdgeInsets.zero,
                          title: Text(c.fullName),
                          subtitle: Text(
                            '@${c.username} · ${relationLabel(c.relation)} · ${c.status == 'pending' ? 'en attente de son accord' : (c.available == true ? 'disponible' : 'indisponible')}',
                          ),
                          trailing: TextButton(onPressed: _busy ? null : () => _do((api) => api.end(c.id), done: 'Relation terminée'), child: const Text('Mettre fin')),
                        ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}
