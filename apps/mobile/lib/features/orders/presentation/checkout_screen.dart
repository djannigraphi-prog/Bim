import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_text_field.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../merchant/data/shop_api.dart' show formatFcfa;
import '../data/orders_api.dart';

/// Ligne affichée dans le récapitulatif (le serveur recalcule tout).
class CheckoutLine {
  const CheckoutLine({required this.line, required this.title, required this.variantLabel, required this.unitPriceFcfa});
  final OrderLine line;
  final String title;
  final String variantLabel;
  final int unitPriceFcfa;
}

/// Ce que l'écran de confirmation reçoit : une commande du BimShop, ou l'acceptation d'une proposition de la boutique.
class CheckoutArgs {
  const CheckoutArgs({required this.shopId, required this.shopName, required this.lines, this.proposalId, this.proposalItemsTotalFcfa});
  final String shopId;
  final String shopName;
  final List<CheckoutLine> lines;
  final String? proposalId;
  final int? proposalItemsTotalFcfa;
  bool get isProposal => proposalId != null;
}

/// Lot 7-B — Avant la confirmation (§3.1) : mode (retrait, rapide, économique selon disponibilité réelle), adresse,
/// moyen de paiement prévu, prix des lignes, frais calculés par le serveur, délai, règle d'attente. Aucun paiement ici.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key, required this.args});
  final CheckoutArgs args;

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _address = TextEditingController();
  final _key = newIdempotencyKey();
  String _mode = 'pickup';
  String _payment = 'mobile_money';
  String? _commune;
  List<ModeQuote> _quotes = const [];
  OrderPreview? _preview;
  bool _busy = false;
  ApiException? _error;
  late final List<int> _qty = [for (final l in widget.args.lines) l.line.quantity];

  CheckoutArgs get a => widget.args;

  List<OrderLine> get _lines => [for (final (i, l) in a.lines.indexed) OrderLine(productId: l.line.productId, variantId: l.line.variantId, quantity: _qty[i])];

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  ModeQuote? _quote(String mode) => _quotes.where((q) => q.mode == mode).firstOrNull;

  /// Espèces : au retrait, ou en livraison si la boutique a un livreur employé (L7-07, revérifié par le serveur).
  bool get _cashAllowed => _mode == 'pickup' || (_quote(_mode)?.cashOnDelivery ?? false);

  Fulfilment get _fulfilment => Fulfilment(mode: _mode, paymentMethod: _payment, communeCode: _commune, address: _address.text.trim());

  /// Montant total affiché : celui du serveur (récapitulatif), ou lignes de la proposition + frais du devis.
  int? get _total {
    if (!a.isProposal) return _preview?.totalFcfa;
    if (_mode == 'pickup') return a.proposalItemsTotalFcfa;
    final q = _quote(_mode);
    return q != null && q.available ? a.proposalItemsTotalFcfa! + q.feeFcfa! : null;
  }

  int? get _fee => _mode == 'pickup' ? null : (a.isProposal ? _quote(_mode)?.feeFcfa : _preview?.deliveryFeeFcfa);

  bool get _ready => _total != null && (_mode == 'pickup' || (_commune != null && _address.text.trim().length >= 5 && (_quote(_mode)?.available ?? false)));

  /// Numéro de la dernière demande de récapitulatif : une réponse plus ancienne arrivée en retard (quantité ou mode
  /// changés entre-temps) est ignorée, sinon elle afficherait un total qui ne correspond plus au panier.
  int _refreshSeq = 0;

  Future<void> _refresh() async {
    final mine = ++_refreshSeq;
    final api = ref.read(ordersApiProvider);
    _error = null;
    try {
      if (_commune != null) {
        final quotes = await api.quote(a.shopId, _commune!);
        if (mine != _refreshSeq) return;
        _quotes = quotes;
      }
      if (!_cashAllowed) _payment = 'mobile_money';
      if (!a.isProposal && (_mode == 'pickup' || (_quote(_mode)?.available ?? false))) {
        final preview = await api.preview(a.shopId, _lines, _fulfilment);
        if (mine != _refreshSeq) return;
        _preview = preview;
      } else if (!a.isProposal) {
        _preview = null;
      }
    } on ApiException catch (e) {
      if (mine != _refreshSeq) return;
      _preview = null;
      _error = e;
    }
    if (mounted) setState(() {});
  }

  void _setQty(int i, int q) {
    setState(() => _qty[i] = q);
    _refresh();
  }

  void _setMode(String m) {
    setState(() {
      _mode = m;
      if (!_cashAllowed) _payment = 'mobile_money';
    });
    _refresh();
  }

  Future<void> _confirm() async {
    final total = _total;
    if (total == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(ordersApiProvider);
    // Conteneur capturé avant l'attente : « Mes commandes » est rafraîchi même si l'écran a été fermé entre-temps.
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final o = a.isProposal
          ? await api.accept(a.proposalId!, _fulfilment, expectedTotalFcfa: total)
          : await api.create(a.shopId, _lines, _fulfilment, expectedTotalFcfa: total, idempotencyKey: _key);
      container.invalidate(myOrdersProvider);
      if (!mounted) return;
      showBimSnack(context, a.isProposal ? 'Proposition acceptée' : 'Commande envoyée à la boutique');
      context.pushReplacement('/orders/${o.id}');
    } on ApiException catch (e) {
      // Montant changé entre-temps : on recharge le récapitulatif et on le montre avant toute nouvelle confirmation.
      if (e.code == 'PRICE_CHANGED' && mounted) await _refresh();
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _unavailable(ModeQuote? q) => switch (q?.reason) {
        'NO_TARIFF' => 'pas encore proposée',
        'NO_DURATION' || 'COMMUNE_UNKNOWN' => 'indisponible pour cette commune',
        _ => 'choisis d’abord ta commune',
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final communes = ref.watch(communesProvider).valueOrNull ?? const <Commune>[];
    final e = _error;
    final itemsTotal = a.isProposal ? a.proposalItemsTotalFcfa! : (_preview?.itemsTotalFcfa ?? [for (final (i, l) in a.lines.indexed) l.unitPriceFcfa * _qty[i]].fold<int>(0, (s, x) => s + x));
    final wait = a.isProposal ? null : _preview?.waitRule;
    final q = _quote(_mode);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(
              children: [
                const BimBackButton(),
                const SizedBox(width: BimSpacing.sm),
                Expanded(child: Text(a.isProposal ? 'Accepter la proposition' : 'Commander', style: theme.textTheme.titleLarge)),
              ],
            ),
            const SizedBox(height: BimSpacing.sm),
            Text(a.shopName, style: theme.textTheme.bodySmall),
            const SizedBox(height: BimSpacing.lg),
            for (final (i, l) in a.lines.indexed)
              Padding(
                padding: const EdgeInsets.only(bottom: BimSpacing.xs),
                child: Row(
                  children: [
                    Expanded(child: Text('${_qty[i]} × ${l.title}${l.variantLabel == 'Unique' ? '' : ' · ${l.variantLabel}'}')),
                    // Quantité : commande du BimShop seulement (une proposition est acceptée telle quelle).
                    if (!a.isProposal) ...[
                      IconButton(key: ValueKey('qty-minus-$i'), tooltip: 'Un de moins', icon: const Icon(Icons.remove_circle_outline), onPressed: _qty[i] > 1 ? () => _setQty(i, _qty[i] - 1) : null),
                      IconButton(key: ValueKey('qty-plus-$i'), tooltip: 'Un de plus', icon: const Icon(Icons.add_circle_outline), onPressed: _qty[i] < 99 ? () => _setQty(i, _qty[i] + 1) : null),
                    ],
                    Text(formatFcfa(l.unitPriceFcfa * _qty[i]), style: const TextStyle(fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            const Divider(height: BimSpacing.xl),
            Text('Comment recevoir ta commande ?', style: theme.textTheme.titleMedium),
            const SizedBox(height: BimSpacing.sm),
            Wrap(
              spacing: BimSpacing.sm,
              runSpacing: BimSpacing.sm,
              children: [
                ChoiceChip(key: const ValueKey('mode-pickup'), label: const Text('Retrait en boutique'), selected: _mode == 'pickup', onSelected: (_) => _setMode('pickup')),
                ChoiceChip(key: const ValueKey('mode-express'), label: const Text('Rapide'), selected: _mode == 'express', onSelected: (_) => _setMode('express')),
                ChoiceChip(key: const ValueKey('mode-economy'), label: const Text('Économique'), selected: _mode == 'economy', onSelected: (_) => _setMode('economy')),
              ],
            ),
            if (_mode != 'pickup') ...[
              const SizedBox(height: BimSpacing.md),
              DropdownButtonFormField<String>(
                key: const ValueKey('checkout-commune'),
                // ignore: deprecated_member_use
                value: _commune,
                isExpanded: true,
                items: [for (final c in communes) DropdownMenuItem(value: c.code, child: Text(c.label, overflow: TextOverflow.ellipsis))],
                onChanged: (c) {
                  setState(() => _commune = c);
                  _refresh();
                },
                decoration: const InputDecoration(labelText: 'Commune de livraison *'),
              ),
              const SizedBox(height: BimSpacing.sm),
              BimTextField(
                key: const ValueKey('checkout-address'),
                label: 'Adresse (quartier, repère)',
                controller: _address,
                required: true,
                maxLength: 300,
                errorText: e?.fieldError('address'),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: BimSpacing.xs),
              Text(
                q?.available ?? false
                    ? 'Frais : ${formatFcfa(q!.feeFcfa!)} · trajet estimé ${q.minutes} min'
                    : 'Livraison ${_mode == 'express' ? 'rapide' : 'économique'} : ${_unavailable(q)}.',
                key: const ValueKey('checkout-mode-info'),
                style: TextStyle(color: q?.available ?? false ? null : BimColors.red),
              ),
            ],
            const SizedBox(height: BimSpacing.lg),
            Text('Paiement prévu', style: theme.textTheme.titleMedium),
            const SizedBox(height: BimSpacing.sm),
            Wrap(
              spacing: BimSpacing.sm,
              children: [
                ChoiceChip(key: const ValueKey('pay-mobile_money'), label: const Text('Mobile Money'), selected: _payment == 'mobile_money', onSelected: (_) => setState(() => _payment = 'mobile_money')),
                // Espèces : au retrait, ou en livraison par un livreur employé de la boutique (L7-07).
                ChoiceChip(key: const ValueKey('pay-cash'), label: const Text('Espèces'), selected: _payment == 'cash', onSelected: _cashAllowed ? (_) => setState(() => _payment = 'cash') : null),
              ],
            ),
            const SizedBox(height: BimSpacing.xs),
            Text(
              'Tu paies à la remise, après avoir vérifié l’article. BIM ne prélève rien et ne fait aucun paiement à ta place.',
              style: theme.textTheme.bodySmall,
            ),
            const Divider(height: BimSpacing.xl),
            _row('Articles', formatFcfa(itemsTotal)),
            if (_mode != 'pickup') _row('Livraison', _fee == null ? '—' : formatFcfa(_fee!)),
            _row('Total', _total == null ? '—' : formatFcfa(_total!), key: const ValueKey('checkout-total'), bold: true),
            if (wait != null && _mode != 'pickup') ...[
              const SizedBox(height: BimSpacing.xs),
              Text(wait.text, key: const ValueKey('checkout-wait'), style: theme.textTheme.bodySmall),
            ],
            if (a.isProposal) Text('La proposition vaut confirmation de la boutique.', style: theme.textTheme.bodySmall),
            if (e != null && e.details['fields'] is! Map) ...[
              const SizedBox(height: BimSpacing.md),
              Text(e.message, key: const ValueKey('checkout-error'), style: const TextStyle(color: BimColors.red)),
            ],
            const SizedBox(height: BimSpacing.lg),
            BimButton(
              key: const ValueKey('checkout-confirm'),
              label: a.isProposal ? 'Accepter et confirmer' : 'Confirmer la commande',
              loading: _busy,
              onPressed: _ready && !_busy ? _confirm : null,
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {Key? key, bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          children: [
            Expanded(child: Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400))),
            Text(value, key: key, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
          ],
        ),
      );
}
