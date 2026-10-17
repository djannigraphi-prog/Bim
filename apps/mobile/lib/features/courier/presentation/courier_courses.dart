import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../merchant/data/shop_api.dart' show formatFcfa;
import '../../orders/data/orders_api.dart' show deliveryModeLabel, deliveryStatusLabel, incidentReasonLabel;
import '../data/courier_api.dart';

/// Lot 7-F — Espace livreur : missions proposées (accepter ou refuser dans le délai), courses en cours, historique.
/// Le livreur ne voit que ce qui le concerne ; avant acceptation, ni l'adresse ni le client.

String _route(Mission m) => [
      m.fromShop,
      if (m.fromPlace != null && m.fromPlace!.isNotEmpty) '(${m.fromPlace})',
      '→',
      m.toPlace ?? '—',
    ].join(' ');

String _facts(Mission m) => [
      if (m.mode != null) deliveryModeLabel(m.mode),
      '${m.itemsCount} article${m.itemsCount > 1 ? 's' : ''}',
      if (m.estimatedMinutes != null) '${m.estimatedMinutes} min',
      if (m.feeFcfa != null) 'frais ${formatFcfa(m.feeFcfa!)}',
    ].join(' · ');

/// Missions proposées et courses en cours, affichées en tête de l'espace livreur.
class CourierWorkSection extends ConsumerStatefulWidget {
  const CourierWorkSection({super.key});

  @override
  ConsumerState<CourierWorkSection> createState() => _CourierWorkSectionState();
}

class _CourierWorkSectionState extends ConsumerState<CourierWorkSection> {
  bool _busy = false;

  Future<void> _answer(Mission m, bool accept) async {
    setState(() => _busy = true);
    try {
      final api = ref.read(courierApiProvider);
      accept ? await api.accept(m.id) : await api.decline(m.id);
      if (mounted) showBimSnack(context, accept ? 'Mission acceptée' : 'Mission refusée');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref
        ..invalidate(missionsProvider)
        ..invalidate(coursesProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final missions = ref.watch(missionsProvider).valueOrNull ?? const <Mission>[];
    final current = ref.watch(coursesProvider(false)).valueOrNull ?? const <Mission>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Missions proposées', style: theme.textTheme.titleMedium),
        if (missions.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: BimSpacing.sm), child: Text('Aucune mission pour le moment.', key: ValueKey('missions-empty'))),
        for (final m in missions)
          Card(
            key: ValueKey('mission-${m.id}'),
            child: Padding(
              padding: const EdgeInsets.all(BimSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_route(m), style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(_facts(m)),
                  if (m.expiresAt != null) Text('Réponds avant ${formatDateTimeFr(m.expiresAt!)}', style: theme.textTheme.bodySmall),
                  const SizedBox(height: BimSpacing.sm),
                  Wrap(
                    spacing: BimSpacing.sm,
                    runSpacing: BimSpacing.xs,
                    children: [
                      FilledButton(key: ValueKey('mission-accept-${m.id}'), onPressed: _busy ? null : () => _answer(m, true), child: const Text('Accepter')),
                      OutlinedButton(key: ValueKey('mission-decline-${m.id}'), onPressed: _busy ? null : () => _answer(m, false), child: const Text('Refuser')),
                    ],
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: BimSpacing.md),
        Text('Courses à faire', style: theme.textTheme.titleMedium),
        if (current.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: BimSpacing.sm), child: Text('Aucune course à faire.', key: ValueKey('courses-empty'))),
        for (final c in current)
          ListTile(
            key: ValueKey('course-${c.deliveryId}'),
            contentPadding: EdgeInsets.zero,
            title: Text(_route(c), maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(deliveryStatusLabel(c.status ?? '')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/courier/courses/${c.deliveryId}'),
          ),
        TextButton(key: const ValueKey('courier-history'), onPressed: () => context.push('/courier/history'), child: const Text('Mon historique de livraisons')),
      ],
    );
  }
}

/// Historique personnel du livreur (courses terminées, refusées, client absent, annulées).
class CourierHistoryScreen extends ConsumerWidget {
  const CourierHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(coursesProvider(true));
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text('Mon historique', style: Theme.of(context).textTheme.titleLarge))]),
            const SizedBox(height: BimSpacing.md),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [Text(e is ApiException ? e.message : ApiException.unknown.message)],
              data: (items) => items.isEmpty
                  ? [const Text('Aucune livraison terminée pour le moment.', key: ValueKey('history-empty'))]
                  : [
                      for (final c in items)
                        ListTile(
                          key: ValueKey('history-${c.deliveryId}'),
                          contentPadding: EdgeInsets.zero,
                          title: Text(_route(c), maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text('${c.number ?? ''} · ${deliveryStatusLabel(c.status ?? '')}'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => context.push('/courier/courses/${c.deliveryId}'),
                        ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Détail d'une course : étapes (pris en charge, arrivé, code du client, espèces pour un employé, clôture),
/// « client absent » après le délai, incident. Chaque action est revérifiée par le serveur.
class CourseScreen extends ConsumerStatefulWidget {
  const CourseScreen({super.key, required this.deliveryId});
  final String deliveryId;

  @override
  ConsumerState<CourseScreen> createState() => _CourseScreenState();
}

class _CourseScreenState extends ConsumerState<CourseScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _released = false;
  String? _codeError;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(CourierApi api) f, {String? done}) async {
    setState(() {
      _busy = true;
      _codeError = null;
    });
    try {
      await f(ref.read(courierApiProvider));
      _code.clear();
      if (done != null && mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        showBimSnack(context, done);
      }
    } on ApiException catch (e) {
      if (e.code == 'HANDOVER_CODE_INVALID' || e.code == 'HANDOVER_CODE_BLOCKED' || e.code == 'HANDOVER_CODE_USED') {
        final left = e.details['remaining'];
        setState(() => _codeError = e.code == 'HANDOVER_CODE_INVALID' && left is int ? '${e.message} Essais restants : $left.' : e.message);
      } else if (mounted) {
        showApiError(context, e);
      }
    } finally {
      ref
        ..invalidate(courseProvider(widget.deliveryId))
        ..invalidate(coursesProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _incident() async {
    final r = await showDialog<({String reason, String description})>(context: context, builder: (_) => const IncidentDialog(reasons: ['client_absent', 'payment', 'behaviour', 'other']));
    if (r != null && mounted) await _run((api) => api.incident(widget.deliveryId, r.reason, description: r.description), done: 'Incident signalé');
  }

  /// Désistement : possible seulement avant la prise en charge ; le motif est transmis à la boutique.
  Future<void> _release() async {
    final reason = await showDialog<String>(context: context, builder: (_) => const ReleaseDialog());
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(courierApiProvider).release(widget.deliveryId, reason);
      ref.invalidate(coursesProvider);
      if (mounted) setState(() => _released = true);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
      ref.invalidate(courseProvider(widget.deliveryId));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _contestFee(CourseDetail c) async {
    final reason = await showDialog<String>(context: context, builder: (_) => const ReleaseDialog(title: 'Frais non reçus', intro: 'Explique ce qui ne va pas (rien reçu, montant différent…).', confirm: 'Envoyer'));
    if (reason != null && mounted) await _run((api) => api.deliveryFee(c.mission.deliveryId, 'contest', reason: reason), done: 'Contestation enregistrée');
  }

  Future<void> _reportReview(String reviewId) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Signaler cette évaluation'),
        children: [
          for (final (k, l) in const [('harassment', 'Harcèlement'), ('hate', 'Propos haineux'), ('false_info', 'Fausse information'), ('spam', 'Indésirable'), ('other', 'Autre')])
            SimpleDialogOption(key: ValueKey('report-$k'), onPressed: () => Navigator.pop(ctx, k), child: Text(l)),
        ],
      ),
    );
    if (reason != null && mounted) await _run((api) => api.reportReview(reviewId, reason), done: 'Signalement envoyé à la modération');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (_released) {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(BimSpacing.screen),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const BimBackButton(),
              const SizedBox(height: BimSpacing.md),
              Text('Course rendue à la boutique. Elle va choisir un autre livreur.', key: const ValueKey('course-released'), style: theme.textTheme.titleMedium),
            ],),
          ),
        ),
      );
    }
    final async = ref.watch(courseProvider(widget.deliveryId));
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(e is ApiException ? e.message : ApiException.unknown.message), const BimBackButton()])),
          data: (c) => ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text(c.mission.number ?? 'Course', style: theme.textTheme.titleLarge))]),
              const SizedBox(height: BimSpacing.xs),
              Text(deliveryStatusLabel(c.status), key: const ValueKey('course-status'), style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: BimSpacing.md),
              Text(_route(c.mission)),
              Text(_facts(c.mission), style: theme.textTheme.bodySmall),
              if (c.clientName != null) ...[
                const SizedBox(height: BimSpacing.md),
                Text('Client : ${c.clientName}${c.clientPhone != null ? ' · ${c.clientPhone}' : ''}', key: const ValueKey('course-client')),
                if (c.address != null) Text('Adresse : ${c.address}'),
              ],
              const SizedBox(height: BimSpacing.md),
              for (final i in c.items) Text('${i.quantity} × ${i.title}${i.variant == 'Unique' ? '' : ' · ${i.variant}'}'),
              if (c.paymentMethod != null) ...[
                const SizedBox(height: BimSpacing.sm),
                Text(
                  c.paymentMethod == 'cash'
                      ? (c.amountToCollectFcfa != null ? 'Espèces à recevoir pour la boutique : ${formatFcfa(c.amountToCollectFcfa!)}' : 'Paiement en espèces : réservé aux employés de la boutique.')
                      : (c.declaredByCustomer ? 'Le client a indiqué avoir payé la boutique (Mobile Money).' : 'Le client paie la boutique par Mobile Money ; tu ne reçois aucun argent.'),
                  key: const ValueKey('course-payment'),
                  style: theme.textTheme.bodySmall,
                ),
              ],
              const SizedBox(height: BimSpacing.lg),
              if (c.can('picked_up')) BimButton(key: const ValueKey('course-picked-up'), label: 'Colis pris en charge', loading: _busy, onPressed: _busy ? null : () => _run((api) => api.step(c.mission.deliveryId, 'picked-up'))),
              if (c.can('arrived')) BimButton(key: const ValueKey('course-arrived'), label: 'Je suis arrivé', loading: _busy, onPressed: _busy ? null : () => _run((api) => api.step(c.mission.deliveryId, 'arrived'))),
              if (c.can('validate_code')) ...[
                Text('Le client examine l’article, puis te donne son code s’il accepte. Ce code n’est pas une preuve de paiement.', style: theme.textTheme.bodySmall),
                TextField(
                  key: const ValueKey('course-code-input'),
                  controller: _code,
                  keyboardType: TextInputType.number,
                  maxLength: 4,
                  decoration: InputDecoration(labelText: 'Code du client', errorText: _codeError),
                ),
                BimButton(key: const ValueKey('course-code'), label: 'Valider le code', loading: _busy, onPressed: _busy ? null : () => _run((api) => api.code(c.mission.deliveryId, _code.text.trim()), done: 'Code validé')),
              ],
              if (c.can('cash_received') && c.amountToCollectFcfa != null) ...[
                const SizedBox(height: BimSpacing.sm),
                BimButton(
                  key: const ValueKey('course-cash'),
                  label: 'Espèces reçues : ${formatFcfa(c.amountToCollectFcfa!)}',
                  loading: _busy,
                  onPressed: _busy ? null : () => _run((api) => api.cash(c.mission.deliveryId, c.amountToCollectFcfa!), done: 'Espèces enregistrées'),
                ),
              ],
              if (c.can('close')) ...[
                const SizedBox(height: BimSpacing.sm),
                BimButton(key: const ValueKey('course-close'), label: 'Clôturer la livraison', loading: _busy, onPressed: _busy ? null : () => _run((api) => api.step(c.mission.deliveryId, 'close'), done: 'Livraison clôturée')),
              ],
              if (c.can('client_absent')) ...[
                const SizedBox(height: BimSpacing.sm),
                BimButton(
                  key: const ValueKey('course-client-absent'),
                  label: 'Client absent',
                  variant: BimButtonVariant.outline,
                  onPressed: _busy ? null : () => _run((api) => api.clientAbsent(c.mission.deliveryId), done: 'Absence signalée'),
                ),
              ],
              if (c.can('release')) TextButton(key: const ValueKey('course-release'), onPressed: _busy ? null : _release, child: const Text('Je ne peux plus faire cette course')),
              // A3-b : livreur indépendant — frais payés directement par le client (Mobile Money).
              if (c.feeAmountFcfa != null) ...[
                const SizedBox(height: BimSpacing.sm),
                Text('Frais de livraison : ${formatFcfa(c.feeAmountFcfa!)} — ${deliveryFeeStatusLabel(c.feeStatus ?? 'to_pay')}', key: const ValueKey('course-fee')),
                if (c.feeActions.contains('confirm_delivery_fee'))
                  BimButton(
                    key: const ValueKey('course-fee-confirm'),
                    label: 'Frais reçus',
                    loading: _busy,
                    onPressed: _busy ? null : () => _run((api) => api.deliveryFee(c.mission.deliveryId, 'confirm'), done: 'Frais confirmés'),
                  ),
                if (c.feeActions.contains('contest_delivery_fee'))
                  TextButton(key: const ValueKey('course-fee-contest'), onPressed: _busy ? null : () => _contestFee(c), child: const Text('Je n’ai pas reçu les frais')),
              ],
              if (c.can('report_incident')) TextButton(key: const ValueKey('course-incident'), onPressed: _busy ? null : _incident, child: const Text('Signaler un problème')),
              if (c.reviewRating != null) ...[
                const SizedBox(height: BimSpacing.lg),
                Text('Évaluation du client', style: theme.textTheme.titleMedium),
                Text('${'★' * c.reviewRating!}${'☆' * (5 - c.reviewRating!)}${c.reviewComment != null ? ' · ${c.reviewComment}' : ''}', key: const ValueKey('course-review')),
                if (c.reviewId != null) TextButton(key: const ValueKey('course-review-report'), onPressed: _busy ? null : () => _reportReview(c.reviewId!), child: const Text('Signaler cette évaluation')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Signaler un incident : motif dans la liste, description (obligatoire pour « Autre »). Le champ appartient à la
/// boîte de dialogue. Aucune pénalité ni remboursement automatique : le dossier peut être transmis au support.
/// Motif du désistement (3 à 300 caractères, comme côté serveur).
class ReleaseDialog extends StatefulWidget {
  const ReleaseDialog({
    super.key,
    this.title = 'Rendre la course',
    this.intro = 'Possible seulement avant d’avoir pris le colis. La boutique le verra dans la commande et choisira un autre livreur.',
    this.confirm = 'Confirmer',
  });

  final String title;
  final String intro;
  final String confirm;

  @override
  State<ReleaseDialog> createState() => _ReleaseDialogState();
}

class _ReleaseDialogState extends State<ReleaseDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ok = _reason.text.trim().length >= 3;
    return AlertDialog(
      title: Text(widget.title),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(widget.intro),
        TextField(key: const ValueKey('release-reason'), controller: _reason, maxLength: 300, decoration: const InputDecoration(labelText: 'Motif'), onChanged: (_) => setState(() {})),
      ],),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
        TextButton(key: const ValueKey('release-send'), onPressed: ok ? () => Navigator.pop(context, _reason.text.trim()) : null, child: Text(widget.confirm)),
      ],
    );
  }
}

class IncidentDialog extends StatefulWidget {
  const IncidentDialog({super.key, required this.reasons});
  final List<String> reasons;

  @override
  State<IncidentDialog> createState() => _IncidentDialogState();
}

class _IncidentDialogState extends State<IncidentDialog> {
  final _c = TextEditingController();
  String? _reason;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  bool get _ok => _reason != null && (_reason != 'other' || _c.text.trim().length >= 5);

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Signaler un problème'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: BimSpacing.sm,
                runSpacing: BimSpacing.xs,
                children: [
                  for (final r in widget.reasons) ChoiceChip(key: ValueKey('incident-$r'), label: Text(incidentReasonLabel(r)), selected: _reason == r, onSelected: (_) => setState(() => _reason = r)),
                ],
              ),
              TextField(
                key: const ValueKey('incident-description'),
                controller: _c,
                maxLength: 1000,
                maxLines: 3,
                decoration: InputDecoration(hintText: _reason == 'other' ? 'Décris le problème (obligatoire)' : 'Description (facultatif)'),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          TextButton(key: const ValueKey('incident-send'), onPressed: _ok ? () => Navigator.pop(context, (reason: _reason!, description: _c.text.trim())) : null, child: const Text('Envoyer')),
        ],
      );
}
