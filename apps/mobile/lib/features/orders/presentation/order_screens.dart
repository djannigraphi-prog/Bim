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
import '../data/orders_api.dart';
import 'checkout_screen.dart';

/// Lot 7-B — « Mes commandes » et détail d'une commande (client), « Commandes reçues » et détail (boutique).
/// Les actions affichées sont celles que le serveur autorise maintenant ; il revérifie tout.

final _orderProvider = FutureProvider.autoDispose.family<OrderDetail, String>((ref, id) => ref.watch(ordersApiProvider).order(id));
final _shopOrderProvider = FutureProvider.autoDispose.family<OrderDetail, String>((ref, id) => ref.watch(shopOrdersApiProvider).order(id));

Color _statusColor(String s) => switch (s) {
      'delivered' => BimColors.success,
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
  const _OrderBody({required this.o, required this.top, required this.actions, this.asShop = false});
  final OrderDetail o;
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
                if (o.handoverCodeStatus == 'blocked')
                  const Padding(padding: EdgeInsets.only(top: BimSpacing.sm), child: Text('Code bloqué après trop d’essais : contacte le support.', style: TextStyle(color: BimColors.red))),
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
                if (o.conversationId != null) TextButton(onPressed: () => context.push('/messages/${o.conversationId}'), child: const Text('Voir la conversation')),
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
              top: [
                if (o.status == 'pending_shop' && o.expiresAt != null)
                  Padding(padding: const EdgeInsets.only(top: BimSpacing.sm), child: Text('À confirmer avant le ${formatDateTimeFr(o.expiresAt!)}, sinon elle expire.')),
              ],
              actions: [
                if (o.can('confirm')) BimButton(key: const ValueKey('shop-order-confirm'), label: 'Confirmer la commande', loading: _busy, onPressed: _busy ? null : () => _act('confirm', done: 'Commande confirmée')),
                if (o.can('prepare')) BimButton(key: const ValueKey('shop-order-prepare'), label: 'Commencer la préparation', loading: _busy, onPressed: _busy ? null : () => _act('prepare')),
                if (o.can('ready')) BimButton(key: const ValueKey('shop-order-ready'), label: 'Marquer prête', loading: _busy, onPressed: _busy ? null : () => _act('ready', done: 'Commande prête')),
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
                if (o.conversationId != null) TextButton(onPressed: () => context.push('/shop/messages/${o.conversationId}'), child: const Text('Voir la conversation')),
              ],
            ),
          ),
        ),
      );
}
