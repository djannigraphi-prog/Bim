import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/util/date_fr.dart';
import '../../../core/util/url_opener.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../courier/data/courier_api.dart' show vehicleLabel;
import '../../courier/presentation/courier_courses.dart' show IncidentDialog;
import '../../merchant/data/shop_api.dart' show formatFcfa;
import '../../projects/application/photo_source.dart';
import '../data/orders_api.dart';
import 'checkout_screen.dart';

/// Lot 7-B — « Mes commandes » et détail d'une commande (client), « Commandes reçues » et détail (boutique).
/// Les actions affichées sont celles que le serveur autorise maintenant ; il revérifie tout.

final _orderProvider = FutureProvider.autoDispose.family<OrderDetail, String>((ref, id) => ref.watch(ordersApiProvider).order(id));
final _shopOrderProvider = FutureProvider.autoDispose.family<OrderDetail, String>((ref, id) => ref.watch(shopOrdersApiProvider).order(id));

Color _statusColor(String s) => switch (s) {
      'delivered' || 'completed' => BimColors.success,
      'declined' || 'expired' || 'cancelled' => BimColors.grey800,
      _ => BimColors.red,
    };

class OrderStatusChip extends StatelessWidget {
  const OrderStatusChip({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm, vertical: BimSpacing.xs),
        decoration: BoxDecoration(color: _statusColor(status).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: Text(orderStatusLabel(status), style: TextStyle(fontWeight: FontWeight.w700, color: _statusColor(status))),
      );
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.o, required this.onTap, this.subtitle});
  final OrderSummary o;
  final VoidCallback onTap;
  final String? subtitle;

  @override
  Widget build(BuildContext context) => ListTile(
        key: ValueKey('order-${o.id}'),
        contentPadding: EdgeInsets.zero,
        onTap: onTap,
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(BimRadius.chip),
          child: SizedBox(
            width: 52,
            height: 52,
            child: o.photoUrl == null ? const Icon(Icons.shopping_bag_outlined) : Image.network(o.photoUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.shopping_bag_outlined)),
          ),
        ),
        title: Text(o.title ?? o.number, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('${o.number} · ${subtitle ?? ''} · ${formatFcfa(o.totalFcfa)}', maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: OrderStatusChip(status: o.status),
      );
}

Widget _listBody(BuildContext context, AsyncValue<List<OrderSummary>> async, {required String empty, required Widget Function(OrderSummary) tile, required VoidCallback retry}) => async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
            TextButton(onPressed: retry, child: const Text('Réessayer')),
          ],
        ),
      ),
      data: (items) => items.isEmpty
          ? Center(child: Padding(padding: const EdgeInsets.all(BimSpacing.xl), child: Text(empty, key: const ValueKey('orders-empty'), textAlign: TextAlign.center)))
          : ListView(padding: const EdgeInsets.symmetric(horizontal: BimSpacing.screen), children: [for (final o in items) tile(o)]),
    );

/// « Mes commandes » (client).
class MyOrdersScreen extends ConsumerWidget {
  const MyOrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(BimSpacing.screen),
                child: Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Text('Mes commandes', style: Theme.of(context).textTheme.titleLarge)]),
              ),
              Expanded(
                child: _listBody(
                  context,
                  ref.watch(myOrdersProvider),
                  empty: 'Aucune commande pour le moment. Les articles du BimShop se commandent depuis leur fiche.',
                  retry: () => ref.invalidate(myOrdersProvider),
                  tile: (o) => _OrderTile(o: o, subtitle: o.shopName, onTap: () => context.push('/orders/${o.id}')),
                ),
              ),
            ],
          ),
        ),
      );
}

/// « Commandes reçues » (boutique) : à traiter, en cours, terminées.
class ShopOrdersScreen extends ConsumerWidget {
  const ShopOrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => DefaultTabController(
        length: 3,
        child: Scaffold(
          body: SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(BimSpacing.screen),
                  child: Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Text('Commandes reçues', style: Theme.of(context).textTheme.titleLarge)]),
                ),
                const TabBar(tabs: [Tab(text: 'À traiter'), Tab(text: 'En cours'), Tab(text: 'Terminées')]),
                Expanded(
                  child: TabBarView(
                    children: [
                      for (final box in ['todo', 'active', 'done'])
                        _listBody(
                          context,
                          ref.watch(shopOrdersProvider(box)),
                          empty: box == 'todo' ? 'Rien à traiter pour le moment.' : 'Aucune commande ici.',
                          retry: () => ref.invalidate(shopOrdersProvider(box)),
                          tile: (o) => _OrderTile(o: o, subtitle: o.customerName, onTap: () => context.push('/shop/orders/${o.id}')),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
}

/// Détail commun : lignes figées, mode, frais, total, historique.
class _OrderBody extends StatelessWidget {
  const _OrderBody({required this.o, required this.top, required this.actions, this.asShop = false, this.onSupport, this.onAddPhoto});
  final OrderDetail o;
  final void Function(String incidentId)? onSupport;
  /// Joindre une photo au problème signalé (3 au plus).
  final void Function(String incidentId)? onAddPhoto;
  final List<Widget> top;
  final List<Widget> actions;
  final bool asShop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        Row(
          children: [
            const BimBackButton(),
            const SizedBox(width: BimSpacing.sm),
            Expanded(child: Text(o.number, key: const ValueKey('order-number'), style: theme.textTheme.titleLarge)),
            OrderStatusChip(status: o.status),
          ],
        ),
        const SizedBox(height: BimSpacing.xs),
        Text(asShop ? 'Client : ${o.customerName ?? ''}' : o.shopName, style: theme.textTheme.bodySmall),
        ...top,
        if (o.tracking != null) _TrackingCard(t: o.tracking!, asShop: asShop),
        const SizedBox(height: BimSpacing.lg),
        for (final i in o.items)
          Padding(
            padding: const EdgeInsets.only(bottom: BimSpacing.sm),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(BimRadius.chip),
                  child: SizedBox(width: 48, height: 48, child: i.photoUrl == null ? const Icon(Icons.image_outlined) : Image.network(i.photoUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.image_outlined))),
                ),
                const SizedBox(width: BimSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${i.quantity} × ${i.title}', maxLines: 2, overflow: TextOverflow.ellipsis),
                      Text('Réf. ${i.reference}${i.variantLabel == 'Unique' ? '' : ' · ${i.variantLabel}'}', style: theme.textTheme.bodySmall),
                      if (i.unitPriceFcfa < i.catalogPriceFcfa) Text('Prix convenu (catalogue : ${formatFcfa(i.catalogPriceFcfa)})', style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                Text(formatFcfa(i.lineTotalFcfa), style: const TextStyle(fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        const Divider(),
        Text(deliveryModeLabel(o.deliveryMode), style: const TextStyle(fontWeight: FontWeight.w700)),
        if (o.commune != null) Text('${o.commune} · ${o.address ?? ''}'),
        if (o.estimatedMinutes != null) Text('Trajet estimé : ${o.estimatedMinutes} min', style: theme.textTheme.bodySmall),
        if (o.waitRule != null) Text(o.waitRule!.text, style: theme.textTheme.bodySmall),
        Text('Paiement prévu : ${paymentMethodLabel(o.paymentMethod)}', style: theme.textTheme.bodySmall),
        const SizedBox(height: BimSpacing.sm),
        _line('Articles', formatFcfa(o.itemsTotalFcfa)),
        if (o.deliveryFeeFcfa != null) _line('Livraison', formatFcfa(o.deliveryFeeFcfa!)),
        _line('Total', formatFcfa(o.totalFcfa), bold: true, key: const ValueKey('order-total')),
        if (o.payment != null) ...[
          const SizedBox(height: BimSpacing.sm),
          Text('Paiement : ${paymentStatusLabel(o.payment!.status)}', key: const ValueKey('payment-status'), style: const TextStyle(fontWeight: FontWeight.w600)),
          if (o.payment!.declaredReference != null) Text('Référence indiquée par le client : ${o.payment!.declaredReference}', style: theme.textTheme.bodySmall),
          if (o.payment!.contestReason != null) Text('Motif : ${o.payment!.contestReason}', style: theme.textTheme.bodySmall),
        ],
        if (o.endReason != null) ...[
          const SizedBox(height: BimSpacing.sm),
          Text('Motif : ${o.endReason}', key: const ValueKey('order-end-reason')),
        ],
        const SizedBox(height: BimSpacing.lg),
        ...actions,
        // 7-G : litige en cours, et délai de contestation après la remise.
        if (o.inDispute)
          const Padding(
            padding: EdgeInsets.only(top: BimSpacing.sm),
            child: Text('Problème signalé après la remise : à régler directement entre le client et la boutique.', key: ValueKey('order-in-dispute'), style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        if (o.disputeUntil != null)
          Padding(
            padding: const EdgeInsets.only(top: BimSpacing.xs),
            child: Text(
              o.disputeOpen
                  ? 'Un problème ? Il se signale jusqu’au ${formatDateTimeFr(o.disputeUntil!)}.'
                  : 'Vente close : le délai pour signaler un problème est dépassé.${asShop ? '' : ' Tu peux toujours évaluer la boutique.'}',
              key: const ValueKey('order-dispute-window'),
              style: theme.textTheme.bodySmall,
            ),
          ),
        if (o.incidents.isNotEmpty) ...[
          const SizedBox(height: BimSpacing.lg),
          Text('Incidents', style: theme.textTheme.titleMedium),
          for (final i in o.incidents)
            Padding(
              key: ValueKey('incident-${i.id}'),
              padding: const EdgeInsets.symmetric(vertical: BimSpacing.xs),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(incidentReasonLabel(i.reason), style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(incidentStatusLabel(i.status)),
                  // L7-08 : un problème signalé après la remise se règle entre le client et la boutique.
                  if (i.status == 'open' && !i.afterDelivery && onSupport != null)
                    TextButton(key: ValueKey('incident-support-${i.id}'), onPressed: () => onSupport!(i.id), child: const Text('Transmettre au support')),
                  if (i.photoUrls.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: BimSpacing.xs),
                      child: Wrap(
                        spacing: BimSpacing.xs,
                        children: [
                          for (final (k, u) in i.photoUrls.indexed)
                            ClipRRect(
                              key: ValueKey('incident-photo-${i.id}-$k'),
                              borderRadius: BorderRadius.circular(8),
                              child: Image.network(u, width: 72, height: 72, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox(width: 72, height: 72, child: Icon(Icons.broken_image_outlined))),
                            ),
                        ],
                      ),
                    ),
                  if (i.canAddPhoto && onAddPhoto != null)
                    TextButton.icon(key: ValueKey('incident-photo-add-${i.id}'), onPressed: () => onAddPhoto!(i.id), icon: const Icon(Icons.add_a_photo_outlined), label: const Text('Ajouter une photo')),
                ],
              ),
            ),
          Text('Aucune pénalité ni remboursement automatique. Photos privées, supprimées 30 jours après la clôture.', style: theme.textTheme.bodySmall),
        ],
        const SizedBox(height: BimSpacing.lg),
        Text('Historique', style: theme.textTheme.titleMedium),
        for (final e in o.events.reversed)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.circle, size: 10),
            title: Text(orderEventLabel(e)),
            subtitle: Text('${formatDateTimeFr(e.at)}${e.reason != null ? ' · ${e.reason}' : ''}'),
          ),
      ],
    );
  }

  Widget _line(String a, String b, {bool bold = false, Key? key}) => Row(
        children: [
          Expanded(child: Text(a, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400))),
          Text(b, key: key, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
        ],
      );
}

Widget _async(AsyncValue<OrderDetail> async, Widget Function(OrderDetail) data) => async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(BimSpacing.xl),
          child: Column(mainAxisSize: MainAxisSize.min, children: [Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center), const BimBackButton()]),
        ),
      ),
      data: data,
    );

Future<String?> _askReason(BuildContext context, {required String title, required String action, bool required = true}) =>
    showDialog<String>(context: context, builder: (_) => _ReasonDialog(title: title, action: action, required: required));

/// Motif d'un refus ou d'une annulation. Le champ appartient à la boîte de dialogue : il vit aussi longtemps qu'elle
/// (même leçon qu'en 6-A : un contrôleur libéré pendant l'animation de fermeture provoque une erreur).
class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.action, required this.required});
  final String title;
  final String action;
  final bool required;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: TextField(
          key: const ValueKey('reason-input'),
          controller: _c,
          maxLength: 300,
          decoration: InputDecoration(hintText: widget.required ? 'Motif (obligatoire)' : 'Motif (facultatif)'),
          onChanged: (_) => setState(() {}),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Retour')),
          TextButton(
            key: const ValueKey('reason-confirm'),
            onPressed: !widget.required || _c.text.trim().length >= 3 ? () => Navigator.pop(context, _c.text.trim()) : null,
            child: Text(widget.action),
          ),
        ],
      );
}

/// 7-F — Suivi de la livraison : état, livreur (prénom pour le client), délai de réponse du livreur sollicité.
class _TrackingCard extends StatelessWidget {
  const _TrackingCard({required this.t, required this.asShop});
  final DeliveryTracking t;
  final bool asShop;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      key: const ValueKey('delivery-tracking'),
      margin: const EdgeInsets.only(top: BimSpacing.md),
      padding: const EdgeInsets.all(BimSpacing.md),
      decoration: BoxDecoration(border: Border.all(color: theme.colorScheme.outline), borderRadius: BorderRadius.circular(BimRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Livraison : ${deliveryStatusLabel(t.status)}', key: const ValueKey('delivery-status'), style: const TextStyle(fontWeight: FontWeight.w700)),
          if (t.courierName != null)
            Text(
              [
                'Livreur : ${t.courierName}',
                if (t.vehicle != null) vehicleLabel(t.vehicle),
                if (asShop && t.category != null) courierCategoryLabel(t.category!),
              ].join(' · '),
              key: const ValueKey('delivery-courier'),
            ),
          if (asShop && t.requestExpiresAt != null) Text('Réponse attendue avant ${formatDateTimeFr(t.requestExpiresAt!)}', style: theme.textTheme.bodySmall),
          if (t.refusalReason != null) Text('Motif du refus : ${refusalReasonLabel(t.refusalReason!)}', style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}

String refusalReasonLabel(String r) => const {'incorrect': 'Article incorrect', 'damaged': 'Article endommagé', 'incomplete': 'Article incomplet', 'other': 'Autre'}[r] ?? r;

const _customerIncidentReasons = ['item_incorrect', 'item_damaged', 'item_incomplete', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'other'];
const _shopIncidentReasons = ['courier_absent', 'delay', 'payment', 'behaviour', 'other'];

/// Un incident concerne une commande confirmée (revérifié par le serveur).
/// 7-G : après la remise, seulement dans le délai de contestation (le serveur le revérifie).
bool _incidentPossible(OrderDetail o) => !const ['proposed', 'pending_shop', 'declined', 'expired'].contains(o.status) && o.disputeOpen;

/// Refus de la remise après examen : motif obligatoire, précision pour « Autre ». Le champ appartient à la boîte.
class _RefuseDialog extends StatefulWidget {
  const _RefuseDialog();

  @override
  State<_RefuseDialog> createState() => _RefuseDialogState();
}

class _RefuseDialogState extends State<_RefuseDialog> {
  final _c = TextEditingController();
  String? _reason;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Refuser la remise ?'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: BimSpacing.sm,
                runSpacing: BimSpacing.xs,
                children: [
                  for (final r in const ['incorrect', 'damaged', 'incomplete', 'other'])
                    ChoiceChip(key: ValueKey('refuse-$r'), label: Text(refusalReasonLabel(r)), selected: _reason == r, onSelected: (_) => setState(() => _reason = r)),
                ],
              ),
              TextField(key: const ValueKey('refuse-details'), controller: _c, maxLength: 300, decoration: const InputDecoration(hintText: 'Précision'), onChanged: (_) => setState(() {})),
              const Text('Ne donne pas ton code. Un incident est ouvert ; aucun remboursement automatique.'),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Retour')),
          TextButton(
            key: const ValueKey('refuse-send'),
            onPressed: _reason != null && (_reason != 'other' || _c.text.trim().length >= 3) ? () => Navigator.pop(context, (reason: _reason!, details: _c.text.trim())) : null,
            child: const Text('Refuser'),
          ),
        ],
      );
}

/// Détail d'une commande (client) : code de remise visible tant qu'il peut servir ; accepter ou refuser une proposition.
class OrderScreen extends ConsumerStatefulWidget {
  const OrderScreen({super.key, required this.orderId});
  final String orderId;

  @override
  ConsumerState<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends ConsumerState<OrderScreen> {
  final _reference = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reference.dispose();
    super.dispose();
  }

  Future<void> _review(OrderDetail o, {int? position, required String about}) async {
    final r = await showDialog<({int rating, String comment})>(context: context, builder: (_) => _ReviewDialog(about: about));
    if (r == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(ordersApiProvider).review(o.id, position: position, rating: r.rating, comment: r.comment);
      if (mounted) showBimSnack(context, 'Merci pour ton avis');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref.invalidate(_orderProvider(o.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _call(OrderDetail o, Future<void> Function(OrdersApi api) f, {String? done}) async {
    setState(() => _busy = true);
    try {
      await f(ref.read(ordersApiProvider));
      if (done != null && mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        showBimSnack(context, done);
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref.invalidate(_orderProvider(o.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Lot 8 : paiement en ligne — la page du prestataire s'ouvre ; le client revient et demande la vérification.
  Future<void> _payOnline(OrderDetail o) async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(ordersApiProvider).startOnlinePayment(o.id);
      final url = r.redirectUrl == null ? null : Uri.tryParse(r.redirectUrl!);
      if (url != null && url.scheme == 'https') await ref.read(urlOpenerProvider)(url);
      if (mounted) showBimSnack(context, 'Valide le paiement, puis reviens ici et touche « Vérifier mon paiement ».');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref.invalidate(_orderProvider(o.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkOnline(OrderDetail o) async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(ordersApiProvider).checkOnlinePayment(o.id);
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        showBimSnack(context, onlineStatusLabel(r.status));
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref.invalidate(_orderProvider(o.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refuse(OrderDetail o) async {
    final r = await showDialog<({String reason, String details})>(context: context, builder: (_) => const _RefuseDialog());
    if (r != null && mounted) await _call(o, (api) => api.refuseDelivery(o.id, r.reason, details: r.details), done: 'Remise refusée');
  }

  Future<void> _incident(OrderDetail o) async {
    final r = await showDialog<({String reason, String description})>(context: context, builder: (_) => const IncidentDialog(reasons: _customerIncidentReasons));
    if (r != null && mounted) await _call(o, (api) => api.openIncident(o.id, r.reason, description: r.description), done: 'Incident signalé');
  }

  Future<void> _reviewDelivery(OrderDetail o) async {
    final r = await showDialog<({int rating, String comment})>(context: context, builder: (_) => const _ReviewDialog(about: 'la livraison'));
    if (r != null && mounted) await _call(o, (api) => api.reviewDelivery(o.id, rating: r.rating, comment: r.comment), done: 'Merci pour ton avis');
  }

  Future<void> _declare(OrderDetail o) async {
    setState(() => _busy = true);
    try {
      await ref.read(ordersApiProvider).declarePayment(o.id, reference: _reference.text.trim());
      if (mounted) showBimSnack(context, 'Merci : la boutique va confirmer la réception.');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref.invalidate(_orderProvider(o.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(OrderDetail o) async {
    final proposal = o.status == 'proposed';
    final reason = await _askReason(context, title: proposal ? 'Refuser cette proposition ?' : 'Annuler la commande ?', action: proposal ? 'Refuser' : 'Annuler la commande', required: false);
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(ordersApiProvider).cancel(o.id, reason: reason.isEmpty ? null : reason);
      ref
        ..invalidate(_orderProvider(o.id))
        ..invalidate(myOrdersProvider);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
      ref.invalidate(_orderProvider(o.id));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _accept(OrderDetail o) => context.push(
        '/orders/checkout',
        extra: CheckoutArgs(
          shopId: '',
          shopName: o.shopName,
          proposalId: o.id,
          proposalItemsTotalFcfa: o.itemsTotalFcfa,
          lines: [
            for (final i in o.items) CheckoutLine(line: OrderLine(productId: '', variantId: '', quantity: i.quantity), title: i.title, variantLabel: i.variantLabel, unitPriceFcfa: i.unitPriceFcfa),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: _async(
          ref.watch(_orderProvider(widget.orderId)),
          (o) => RefreshIndicator(
            onRefresh: () async => ref.invalidate(_orderProvider(widget.orderId)),
            child: _OrderBody(
              o: o,
              onSupport: (id) => _call(o, (api) => api.incidentToSupport(id), done: 'Dossier transmis au support'),
              onAddPhoto: (id) async {
                final bytes = await ref.read(photoSourceProvider).pick(camera: false);
                if (bytes != null && mounted) await _call(o, (api) => api.addIncidentPhoto(id, bytes), done: 'Photo ajoutée');
              },
              top: [
                if (o.handoverCode != null)
                  Container(
                    margin: const EdgeInsets.only(top: BimSpacing.md),
                    padding: const EdgeInsets.all(BimSpacing.md),
                    decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(BimRadius.card)),
                    child: Column(
                      children: [
                        const Text('Ton code de remise'),
                        Text(o.handoverCode!, key: const ValueKey('handover-code'), style: theme.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 8)),
                        Text(
                          'Ne le donne qu’au moment de recevoir ton article, après l’avoir vérifié. Ce code n’est pas une preuve de paiement.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                if (o.handoverCodeStatus == 'blocked') ...[
                  const Padding(padding: EdgeInsets.only(top: BimSpacing.sm), child: Text('Code bloqué après trop d’essais.', style: TextStyle(color: BimColors.red))),
                  TextButton(
                    key: const ValueKey('renew-code'),
                    onPressed: () => _call(o, (api) => api.renewHandoverCode(o.id), done: 'Nouveau code créé'),
                    child: const Text('Recevoir un nouveau code'),
                  ),
                ],
                if (o.status == 'proposed' && o.expiresAt != null)
                  Padding(padding: const EdgeInsets.only(top: BimSpacing.sm), child: Text('Proposition valable jusqu’au ${formatDateTimeFr(o.expiresAt!)}.', style: theme.textTheme.bodySmall)),
              ],
              actions: [
                // 7-C : payer au numéro Mobile Money confirmé de la boutique, puis déclarer. L'app ne transfère rien.
                if (o.can('declare_payment') && o.payment != null) ...[
                  Container(
                    key: const ValueKey('pay-instructions'),
                    padding: const EdgeInsets.all(BimSpacing.md),
                    decoration: BoxDecoration(border: Border.all(color: theme.colorScheme.outline), borderRadius: BorderRadius.circular(BimRadius.card)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Montant à payer : ${formatFcfa(o.payment!.amountFcfa)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        if (o.payment!.deliveryFeeIncludedFcfa > 0) Text('dont frais de livraison : ${formatFcfa(o.payment!.deliveryFeeIncludedFcfa)}'),
                        if (o.payment!.payoutPhone != null)
                          Text('${operatorLabel(o.payment!.payoutOperator)} de la boutique : ${o.payment!.payoutPhone}', key: const ValueKey('shop-payout')),
                        Text('Paie depuis ton application Mobile Money, puis indique-le ici. BIM ne fait aucun transfert et ne confirme rien à la place de la boutique.', style: theme.textTheme.bodySmall),
                        TextField(key: const ValueKey('pay-reference'), controller: _reference, maxLength: 60, decoration: const InputDecoration(labelText: 'Référence de la transaction (facultatif)')),
                      ],
                    ),
                  ),
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(key: const ValueKey('declare-payment'), label: 'J’ai payé', loading: _busy, onPressed: _busy ? null : () => _declare(o)),
                  const SizedBox(height: BimSpacing.sm),
                ],
                // A3-b : frais de livraison payés directement au livreur indépendant, puis déclarés.
                if (o.deliveryFee != null) ...[
                  Container(
                    key: const ValueKey('delivery-fee'),
                    padding: const EdgeInsets.all(BimSpacing.md),
                    decoration: BoxDecoration(border: Border.all(color: theme.colorScheme.outline), borderRadius: BorderRadius.circular(BimRadius.card)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Frais de livraison : ${formatFcfa(o.deliveryFee!.amountFcfa)} — ${deliveryFeeStatusLabelFr(o.deliveryFee!.status)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        if (o.deliveryFee!.payToPhone != null)
                          Text(
                            'À payer à ${o.deliveryFee!.payToName ?? 'ton livreur'} (ton livreur) : ${o.deliveryFee!.payToOperator != null ? '${operatorLabel(o.deliveryFee!.payToOperator)} ' : 'Mobile Money '}${o.deliveryFee!.payToPhone}',
                            key: const ValueKey('delivery-fee-payto'),
                          ),
                        if (o.deliveryFee!.actions.contains('declare_delivery_fee'))
                          Text('Paie depuis ton application Mobile Money, puis indique-le ici. BIM ne fait aucun transfert.', style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                  if (o.deliveryFee!.actions.contains('declare_delivery_fee')) ...[
                    const SizedBox(height: BimSpacing.sm),
                    BimButton(
                      key: const ValueKey('declare-delivery-fee'),
                      label: 'J’ai payé le livreur',
                      variant: BimButtonVariant.outline,
                      loading: _busy,
                      onPressed: _busy ? null : () => _call(o, (api) => api.declareDeliveryFee(o.id), done: 'Paiement du livreur indiqué'),
                    ),
                  ],
                  const SizedBox(height: BimSpacing.sm),
                ],
                // Lot 8 : paiement en ligne, seulement s'il est réellement ouvert (opérateurs du prestataire).
                if (o.onlinePayment != null) ...[
                  if (o.onlinePayment!.lastStatus != null)
                    Text(onlineStatusLabel(o.onlinePayment!.lastStatus!), key: const ValueKey('online-status'), style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (o.can('pay_online')) ...[
                    BimButton(key: const ValueKey('pay-online'), label: 'Payer en ligne', loading: _busy, onPressed: _busy ? null : () => _payOnline(o)),
                    Text('Moyens acceptés : ${operatorsLabel(o.onlinePayment!.operators)}. L’argent va directement à la boutique.', key: const ValueKey('online-operators'), style: theme.textTheme.bodySmall),
                  ],
                  if (o.onlinePayment!.lastStatus == 'pending')
                    TextButton(key: const ValueKey('online-check'), onPressed: _busy ? null : () => _checkOnline(o), child: const Text('Vérifier mon paiement')),
                  const SizedBox(height: BimSpacing.sm),
                ],
                if (o.can('accept')) BimButton(key: const ValueKey('order-accept'), label: 'Accepter la proposition', onPressed: _busy ? null : () => _accept(o)),
                if (o.can('decline') || o.can('cancel')) ...[
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(
                    key: const ValueKey('order-cancel'),
                    label: o.can('decline') ? 'Refuser la proposition' : 'Annuler la commande',
                    variant: BimButtonVariant.outline,
                    loading: _busy,
                    onPressed: _busy ? null : () => _cancel(o),
                  ),
                ],
                // 7-F : à l'arrivée du livreur, examiner l'article ; refuser la remise si besoin (le code n'est pas donné).
                if (o.can('refuse_delivery')) ...[
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(key: const ValueKey('delivery-refuse'), label: 'Refuser la remise', variant: BimButtonVariant.outline, onPressed: _busy ? null : () => _refuse(o)),
                ],
                if (o.can('review_delivery') && o.tracking?.reviewRating == null) ...[
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(key: const ValueKey('delivery-review'), label: 'Évaluer la livraison', variant: BimButtonVariant.outline, onPressed: _busy ? null : () => _reviewDelivery(o)),
                ],
                if (o.tracking?.reviewRating != null) Text('Ton évaluation de la livraison : ${stars(o.tracking!.reviewRating!)}', key: const ValueKey('delivery-review-done')),
                if (_incidentPossible(o)) TextButton(key: const ValueKey('order-incident'), onPressed: _busy ? null : () => _incident(o), child: const Text('Signaler un problème')),
                if (o.conversationId != null) TextButton(onPressed: () => context.push('/messages/${o.conversationId}'), child: const Text('Voir la conversation')),
                // 7-H : évaluer chaque article et la boutique, une fois, après la remise.
                if (o.reviews != null && (o.reviews!.open || o.reviews!.itemRatings.any((r) => r != null) || o.reviews!.shopRating != null)) ...[
                  const SizedBox(height: BimSpacing.md),
                  Text('Ton avis', style: theme.textTheme.titleMedium),
                  for (final (i, item) in o.items.indexed)
                    if (i < o.reviews!.itemRatings.length)
                      ListTile(
                        key: ValueKey('review-item-$i'),
                        contentPadding: EdgeInsets.zero,
                        title: Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: o.reviews!.itemRatings[i] != null ? Text(stars(o.reviews!.itemRatings[i]!)) : null,
                        trailing: o.reviews!.itemRatings[i] == null && o.reviews!.open
                            ? TextButton(onPressed: _busy ? null : () => _review(o, position: i, about: item.title), child: const Text('Évaluer'))
                            : null,
                      ),
                  ListTile(
                    key: const ValueKey('review-shop'),
                    contentPadding: EdgeInsets.zero,
                    title: Text('La boutique ${o.shopName}'),
                    subtitle: o.reviews!.shopRating != null ? Text(stars(o.reviews!.shopRating!)) : null,
                    trailing: o.reviews!.shopRating == null && o.reviews!.open
                        ? TextButton(onPressed: _busy ? null : () => _review(o, about: 'la boutique ${o.shopName}'), child: const Text('Évaluer'))
                        : null,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Détail d'une commande reçue (boutique) : confirmer, refuser, préparer, prête, remettre (code), annuler.
class ShopOrderScreen extends ConsumerStatefulWidget {
  const ShopOrderScreen({super.key, required this.orderId});
  final String orderId;

  @override
  ConsumerState<ShopOrderScreen> createState() => _ShopOrderScreenState();
}

class _ShopOrderScreenState extends ConsumerState<ShopOrderScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _codeError;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _confirmReturn() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Colis revenu en boutique ?'),
        content: const Text('Confirme seulement si tu as récupéré le colis. La commande sera annulée et le stock remis. Un paiement déjà reçu se rembourse avec le support.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          TextButton(key: const ValueKey('returned-confirm'), onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmer')),
        ],
      ),
    );
    if (ok == true && mounted) await _act('delivery/returned', done: 'Retour enregistré, commande annulée');
  }

  Future<void> _act(String action, {String? reason, String? code, int? amountFcfa, String? done}) async {
    setState(() {
      _busy = true;
      _codeError = null;
    });
    try {
      await ref.read(shopOrdersApiProvider).act(widget.orderId, action, reason: reason, code: code, amountFcfa: amountFcfa);
      if (done != null && mounted) showBimSnack(context, done);
      _code.clear();
    } on ApiException catch (e) {
      if (action == 'handover' && (e.code == 'HANDOVER_CODE_INVALID' || e.code == 'HANDOVER_CODE_BLOCKED')) {
        final left = e.details['remaining'];
        setState(() => _codeError = e.code == 'HANDOVER_CODE_INVALID' && left is int ? '${e.message} Essais restants : $left.' : e.message);
      } else if (mounted) {
        showApiError(context, e);
      }
    } finally {
      ref
        ..invalidate(_shopOrderProvider(widget.orderId))
        ..invalidate(shopOrdersProvider)
        ..invalidate(shopOrderCountsProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _shopIncident(OrderDetail o) async {
    final r = await showDialog<({String reason, String description})>(context: context, builder: (_) => const IncidentDialog(reasons: _shopIncidentReasons));
    if (r == null || !mounted) return;
    await _call(() => ref.read(shopOrdersApiProvider).openIncident(o.id, r.reason, description: r.description), done: 'Incident signalé');
  }

  Future<void> _call(Future<void> Function() f, {String? done}) async {
    setState(() => _busy = true);
    try {
      await f();
      if (done != null && mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        showBimSnack(context, done);
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      ref.invalidate(_shopOrderProvider(widget.orderId));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _selectCourier(OrderDetail o) async {
    final done = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _CandidatesSheet(orderId: o.id));
    ref.invalidate(_shopOrderProvider(widget.orderId));
    if (done == true && mounted) showBimSnack(context, 'Livreur sollicité : il doit accepter la mission.');
  }

  Future<void> _withReason(String action, String title, String label) async {
    final r = await _askReason(context, title: title, action: label);
    if (r != null && mounted) await _act(action, reason: r);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: _async(
            ref.watch(_shopOrderProvider(widget.orderId)),
            (o) => _OrderBody(
              o: o,
              asShop: true,
              onSupport: (id) => _call(() => ref.read(shopOrdersApiProvider).incidentToSupport(id), done: 'Dossier transmis au support'),
              onAddPhoto: (id) async {
                final bytes = await ref.read(photoSourceProvider).pick(camera: false);
                if (bytes != null && mounted) await _call(() => ref.read(shopOrdersApiProvider).addIncidentPhoto(id, bytes), done: 'Photo ajoutée');
              },
              top: [
                if (o.status == 'pending_shop' && o.expiresAt != null)
                  Padding(padding: const EdgeInsets.only(top: BimSpacing.sm), child: Text('À confirmer avant le ${formatDateTimeFr(o.expiresAt!)}, sinon elle expire.')),
              ],
              actions: [
                if (o.can('confirm')) BimButton(key: const ValueKey('shop-order-confirm'), label: 'Confirmer la commande', loading: _busy, onPressed: _busy ? null : () => _act('confirm', done: 'Commande confirmée')),
                if (o.can('prepare')) BimButton(key: const ValueKey('shop-order-prepare'), label: 'Commencer la préparation', loading: _busy, onPressed: _busy ? null : () => _act('prepare')),
                if (o.can('ready')) BimButton(key: const ValueKey('shop-order-ready'), label: 'Marquer prête', loading: _busy, onPressed: _busy ? null : () => _act('ready', done: 'Commande prête')),
                // 7-F : lancer la recherche, solliciter un livreur éligible (calculé par le serveur), retirer la demande.
                if (o.can('start_delivery'))
                  BimButton(key: const ValueKey('delivery-start'), label: 'Chercher un livreur', loading: _busy, onPressed: _busy ? null : () => _act('delivery/start')),
                if (o.can('select_courier')) BimButton(key: const ValueKey('delivery-select'), label: 'Choisir un livreur', onPressed: _busy ? null : () => _selectCourier(o)),
                if (o.can('withdraw_request'))
                  BimButton(
                    key: const ValueKey('delivery-withdraw'),
                    label: 'Retirer la demande au livreur',
                    variant: BimButtonVariant.outline,
                    loading: _busy,
                    onPressed: _busy ? null : () => _act('delivery/withdraw', done: 'Demande retirée'),
                  ),
                // Retour en boutique après un refus ou une absence du client : la commande sera annulée, le stock remis.
                if (o.can('confirm_return'))
                  BimButton(key: const ValueKey('delivery-returned'), label: 'Colis revenu en boutique', loading: _busy, onPressed: _busy ? null : _confirmReturn),
                if (o.can('handover')) ...[
                  TextField(
                    key: const ValueKey('handover-input'),
                    controller: _code,
                    keyboardType: TextInputType.number,
                    maxLength: 4,
                    decoration: InputDecoration(labelText: 'Code donné par le client', errorText: _codeError),
                  ),
                  BimButton(key: const ValueKey('shop-order-handover'), label: 'Valider le code et remettre', loading: _busy, onPressed: _busy ? null : () => _act('handover', code: _code.text.trim(), done: 'Commande remise')),
                ],
                // 7-C : espèces constatées au comptoir, puis décision (permission « confirmer ou contester un paiement »).
                if (o.can('cash_received') && o.payment != null)
                  BimButton(
                    key: const ValueKey('shop-cash-received'),
                    label: 'Espèces reçues : ${formatFcfa(o.payment!.amountFcfa)}',
                    loading: _busy,
                    onPressed: _busy ? null : () => _act('payment/cash', amountFcfa: o.payment!.amountFcfa, done: 'Espèces enregistrées'),
                  ),
                if (o.can('confirm_payment')) ...[
                  BimButton(key: const ValueKey('shop-payment-confirm'), label: 'Confirmer le paiement reçu', loading: _busy, onPressed: _busy ? null : () => _act('payment/confirm', done: 'Paiement confirmé')),
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(
                    key: const ValueKey('shop-payment-contest'),
                    label: 'Contester le paiement',
                    variant: BimButtonVariant.outline,
                    onPressed: _busy ? null : () => _withReason('payment/contest', 'Contester le paiement ?', 'Contester'),
                  ),
                ],
                if (o.can('decline')) ...[
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(key: const ValueKey('shop-order-decline'), label: 'Refuser', variant: BimButtonVariant.outline, onPressed: _busy ? null : () => _withReason('decline', 'Refuser la commande ?', 'Refuser')),
                ],
                if (o.can('withdraw') || o.can('cancel')) ...[
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(
                    key: const ValueKey('shop-order-cancel'),
                    label: o.can('withdraw') ? 'Retirer la proposition' : 'Annuler la commande',
                    variant: BimButtonVariant.subtle,
                    onPressed: _busy ? null : () => _withReason('cancel', o.can('withdraw') ? 'Retirer la proposition ?' : 'Annuler la commande ?', 'Confirmer'),
                  ),
                ],
                if (_incidentPossible(o)) TextButton(key: const ValueKey('shop-order-incident'), onPressed: _busy ? null : () => _shopIncident(o), child: const Text('Signaler un problème')),
                if (o.conversationId != null) TextButton(onPressed: () => context.push('/shop/messages/${o.conversationId}'), child: const Text('Voir la conversation')),
              ],
            ),
          ),
        ),
      );
}

/// Livreurs éligibles, dans l'ordre du serveur : employés, puis partenaires, puis indépendants. En rapide, seuls les
/// meilleurs disponibles sont sélectionnables ; en économique, passer un prioritaire demande un motif.
class _CandidatesSheet extends ConsumerStatefulWidget {
  const _CandidatesSheet({required this.orderId});
  final String orderId;

  @override
  ConsumerState<_CandidatesSheet> createState() => _CandidatesSheetState();
}

class _CandidatesSheetState extends ConsumerState<_CandidatesSheet> {
  late Future<List<CourierCandidate>> _list = ref.read(shopOrdersApiProvider).candidates(widget.orderId);
  bool _busy = false;
  String? _error;

  Future<void> _offer(CourierCandidate c) async {
    String? reason;
    if (c.reasonRequired) {
      reason = await _askReason(context, title: 'Pourquoi passer un livreur prioritaire ?', action: 'Solliciter');
      if (reason == null || !mounted) return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(shopOrdersApiProvider).offer(widget.orderId, c.courierId, reason: reason);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _busy = false;
          _list = ref.read(shopOrdersApiProvider).candidates(widget.orderId);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(BimSpacing.screen),
          child: FutureBuilder<List<CourierCandidate>>(
            future: _list,
            builder: (context, snap) {
              final items = snap.data;
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Livreurs éligibles', style: Theme.of(context).textTheme.titleLarge),
                  const Text('Le livreur choisi doit accepter la mission dans le délai ; sinon, choisis-en un autre.'),
                  const SizedBox(height: BimSpacing.sm),
                  if (snap.hasError) Text(snap.error is ApiException ? (snap.error! as ApiException).message : ApiException.unknown.message),
                  if (items == null && !snap.hasError) const Center(child: CircularProgressIndicator()),
                  if (items != null && items.isEmpty) const Text('Aucun livreur éligible disponible pour le moment.', key: ValueKey('candidates-empty')),
                  if (items != null)
                    Flexible(
                      child: ListView(
                        shrinkWrap: true,
                        children: [
                          for (final c in items)
                            ListTile(
                              key: ValueKey('candidate-${c.courierId}'),
                              contentPadding: EdgeInsets.zero,
                              title: Text(c.fullName),
                              subtitle: Text([
                                courierCategoryLabel(c.category),
                                if (c.vehicle != null) vehicleLabel(c.vehicle),
                                if (!c.selectable) 'un livreur prioritaire est disponible',
                                if (c.selectable && c.reasonRequired) 'motif demandé',
                              ].join(' · '),),
                              trailing: const Icon(Icons.chevron_right),
                              enabled: c.selectable && !_busy,
                              onTap: c.selectable && !_busy ? () => _offer(c) : null,
                            ),
                        ],
                      ),
                    ),
                  if (_error != null) Text(_error!, key: const ValueKey('candidates-error'), style: const TextStyle(color: BimColors.red)),
                ],
              );
            },
          ),
        ),
      );
}

/// Note sur 5 en étoiles pleines et vides (affichage d'un avis ; aucune moyenne, A17).
String stars(int rating) => '${'★' * rating}${'☆' * (5 - rating)}';

/// Évaluation : une note de 1 à 5 et un commentaire facultatif. Le champ appartient à la boîte de dialogue.
class _ReviewDialog extends StatefulWidget {
  const _ReviewDialog({required this.about});
  final String about;

  @override
  State<_ReviewDialog> createState() => _ReviewDialogState();
}

class _ReviewDialogState extends State<_ReviewDialog> {
  final _c = TextEditingController();
  int _rating = 0;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('Évaluer ${widget.about}', maxLines: 2, overflow: TextOverflow.ellipsis),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var n = 1; n <= 5; n++)
                  IconButton(
                    key: ValueKey('star-$n'),
                    tooltip: '$n sur 5',
                    icon: Icon(n <= _rating ? Icons.star_rounded : Icons.star_border_rounded, color: BimColors.red),
                    onPressed: () => setState(() => _rating = n),
                  ),
              ],
            ),
            TextField(key: const ValueKey('review-comment'), controller: _c, maxLength: 1000, maxLines: 3, decoration: const InputDecoration(hintText: 'Ton commentaire (facultatif)')),
            const Text('Ton avis est public et ne se modifie plus ; tu pourras le retirer.'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          TextButton(
            key: const ValueKey('review-send'),
            onPressed: _rating == 0 ? null : () => Navigator.pop(context, (rating: _rating, comment: _c.text.trim())),
            child: const Text('Publier'),
          ),
        ],
      );
}
