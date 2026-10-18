import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../account/data/account_api.dart' show StepUpScope;
import '../../account/presentation/code_sheets.dart' show requestStepUp;
import '../../orders/data/orders_api.dart' show newIdempotencyKey;
import '../data/wallet_api.dart';
import 'gift_sheet.dart';

const _ledgerLabels = {
  'purchase': 'Achat de pièces',
  'gift_sent': 'Pièces envoyées',
  'gift_received': 'Pièces reçues',
  'withdrawal': 'Retrait',
  'withdrawal_refund': 'Retrait refusé, pièces rendues',
};

const _withdrawalStatus = {'review': 'Vérification par l’équipe', 'paid': 'Versé (démo)', 'rejected': 'Refusé, pièces rendues'};

String _day(DateTime? d) => d == null ? '' : '${d.toLocal().day.toString().padLeft(2, '0')}/${d.toLocal().month.toString().padLeft(2, '0')}/${d.toLocal().year}';

/// Écran 58 — Portefeuille : solde (pièces achetées et reçues), équivalent en F, Acheter, Retirer, Premium, historique.
class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(walletProvider);
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(walletProvider),
          child: ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text('Mes pièces', style: theme.textTheme.titleLarge))]),
              const SizedBox(height: BimSpacing.md),
              ...async.when(
                loading: () => [const Center(child: CircularProgressIndicator())],
                error: (e, _) => [
                  Text(e is ApiException ? e.message : ApiException.unknown.message),
                  const SizedBox(height: BimSpacing.sm),
                  BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(walletProvider)),
                ],
                data: (w) => _content(context, ref, w),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _content(BuildContext context, WidgetRef ref, WalletInfo w) {
    final theme = Theme.of(context);
    if (!w.available) {
      return [
        const Text('Les pièces arrivent bientôt sur BIM.', key: ValueKey('wallet-closed')),
        const SizedBox(height: BimSpacing.sm),
        Text('Solde : ${coinsLabel(w.balance.total)} pièces', style: theme.textTheme.bodySmall),
      ];
    }
    return [
      if (w.demo) ...[const DemoNotice(), const SizedBox(height: BimSpacing.md)],
      Container(
        padding: const EdgeInsets.all(BimSpacing.lg),
        decoration: BoxDecoration(color: BimColors.black, borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Solde', style: TextStyle(color: BimColors.white)),
            Row(
              children: [
                const Icon(Icons.monetization_on_rounded, color: BimColors.coin, size: 32),
                const SizedBox(width: BimSpacing.sm),
                Text(
                  coinsLabel(w.balance.total),
                  key: const ValueKey('wallet-total'),
                  style: theme.textTheme.headlineMedium?.copyWith(color: BimColors.white, fontWeight: FontWeight.w800),
                ),
              ],
            ),
            Text('≈ ${coinsLabel(w.balance.total)} F', style: const TextStyle(color: BimColors.grey200)),
            const SizedBox(height: BimSpacing.sm),
            Text(
              'Reçues (retirables) : ${coinsLabel(w.balance.withdrawable)} · achetées : ${coinsLabel(w.balance.purchased)}',
              key: const ValueKey('wallet-split'),
              style: const TextStyle(color: BimColors.grey200),
            ),
          ],
        ),
      ),
      const SizedBox(height: BimSpacing.md),
      Row(
        children: [
          Expanded(
            child: BimButton(
              label: 'Acheter',
              icon: Icons.add_rounded,
              onPressed: () => showBuyCoinsSheet(context),
            ),
          ),
          const SizedBox(width: BimSpacing.sm),
          Expanded(
            child: BimButton(
              key: const ValueKey('wallet-withdraw'),
              label: 'Retirer',
              variant: BimButtonVariant.dark,
              icon: Icons.account_balance_wallet_outlined,
              onPressed: () => showWithdrawSheet(context, w),
            ),
          ),
        ],
      ),
      const SizedBox(height: BimSpacing.lg),
      ListTile(
        key: const ValueKey('wallet-premium'),
        contentPadding: EdgeInsets.zero,
        leading: Icon(Icons.workspace_premium_rounded, color: w.premiumActive ? BimColors.coin : null),
        title: Text(w.premiumActive ? 'Premium actif' : 'Passer à Premium'),
        subtitle: Text(w.premiumActive ? 'Jusqu’au ${_day(w.premiumUntil)} : tu peux recevoir des pièces.' : 'Nécessaire pour recevoir des pièces sur tes publications.'),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => context.push('/premium'),
      ),
      Text('Reçues au total : ${coinsLabel(w.receivedTotal)} · envoyées : ${coinsLabel(w.sentTotal)}', style: theme.textTheme.bodySmall),
      if (w.withdrawals.isNotEmpty) ...[
        const SizedBox(height: BimSpacing.lg),
        Text('Retraits', style: theme.textTheme.titleMedium),
        for (final x in w.withdrawals)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${coinsLabel(x.coins)} pièces → ${coinsLabel(x.netFcfa)} F (${operatorLabels[x.operator] ?? x.operator})'),
            subtitle: Text('${_withdrawalStatus[x.status] ?? x.status}${x.rejectReason == null ? '' : ' : ${x.rejectReason}'} · ${_day(x.at)}'),
          ),
      ],
      const SizedBox(height: BimSpacing.lg),
      Text('Historique', style: theme.textTheme.titleMedium),
      if (w.history.isEmpty) const Text('Aucun mouvement pour l’instant.'),
      for (final l in w.history)
        ListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text(_ledgerLabels[l.kind] ?? l.kind),
          subtitle: Text(_day(l.at)),
          trailing: Text(
            '${l.delta > 0 ? '+' : '−'}${coinsLabel(l.delta.abs())}',
            style: TextStyle(fontWeight: FontWeight.w700, color: l.delta > 0 ? BimColors.success : null),
          ),
        ),
    ];
  }
}

/// Retrait des pièces reçues vers le Mobile Money de mon téléphone vérifié (prototype : versement simulé).
Future<void> showWithdrawSheet(BuildContext context, WalletInfo w) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => WithdrawSheet(wallet: w),
    );

class WithdrawSheet extends ConsumerStatefulWidget {
  const WithdrawSheet({super.key, required this.wallet});

  final WalletInfo wallet;

  @override
  ConsumerState<WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends ConsumerState<WithdrawSheet> {
  final _amount = TextEditingController();
  String _operator = 'orange';
  bool _busy = false;
  String _key = newIdempotencyKey();

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final coins = int.tryParse(_amount.text.replaceAll(' ', '')) ?? 0;
    // Opération sensible : mot de passe puis code, comme pour changer de mot de passe.
    final token = await requestStepUp(context, ref, StepUpScope.withdrawal);
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await ref.read(walletApiProvider).withdraw(coins, operator: _operator, idempotencyKey: _key, stepUpToken: token);
      ref.invalidate(walletProvider);
      if (!mounted) return;
      showBimSnack(context, r.status == 'review' ? 'Demande envoyée : l’équipe BIM la vérifie.' : 'Retrait enregistré (démo : rien n’est versé).');
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      _key = newIdempotencyKey();
      if (mounted) {
        setState(() => _busy = false);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rules = widget.wallet.rules;
    final coins = int.tryParse(_amount.text.replaceAll(' ', '')) ?? 0;
    final fee = rules.feeFor(coins);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg + MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Retirer mes pièces', style: theme.textTheme.titleLarge),
              const SizedBox(height: BimSpacing.xs),
              Text('Retirables : ${coinsLabel(widget.wallet.balance.withdrawable)} pièces (seules les pièces reçues).', key: const ValueKey('withdraw-available')),
              const SizedBox(height: BimSpacing.sm),
              if (widget.wallet.demo) const DemoNotice(),
              const SizedBox(height: BimSpacing.md),
              TextField(
                key: const ValueKey('withdraw-amount'),
                controller: _amount,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: 'Nombre de pièces', helperText: 'Minimum ${coinsLabel(rules.min)}'),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: BimSpacing.md),
              Wrap(
                spacing: BimSpacing.sm,
                children: [
                  for (final o in rules.operators)
                    ChoiceChip(label: Text(operatorLabels[o] ?? o), selected: _operator == o, onSelected: (_) => setState(() => _operator = o)),
                ],
              ),
              const SizedBox(height: BimSpacing.md),
              Text(
                'Frais de l’opérateur : ${coinsLabel(fee)} F · tu reçois ${coinsLabel(coins > fee ? coins - fee : 0)} F · commission BIM : 0 F',
                key: const ValueKey('withdraw-fee'),
              ),
              const SizedBox(height: BimSpacing.xs),
              Text(
                'Envoyé sur ton numéro de téléphone vérifié. Le premier retrait et ceux au-delà de ${coinsLabel(rules.instantMax)} pièces sont vérifiés par l’équipe.',
                style: theme.textTheme.bodySmall,
              ),
              const SizedBox(height: BimSpacing.md),
              BimButton(key: const ValueKey('withdraw-submit'), label: 'Demander le retrait', loading: _busy, onPressed: coins <= 0 || _busy ? null : _submit),
            ],
          ),
        ),
      ),
    );
  }
}

/// Premium utilisateur : recevoir des pièces, pas de publicité. Prototype : abonnement simulé.
class PremiumScreen extends ConsumerStatefulWidget {
  const PremiumScreen({super.key});

  @override
  ConsumerState<PremiumScreen> createState() => _PremiumScreenState();
}

class _PremiumScreenState extends ConsumerState<PremiumScreen> {
  bool _busy = false;

  Future<void> _run(Future<PremiumInfo> Function() call, String done) async {
    setState(() => _busy = true);
    try {
      await call();
      ref
        ..invalidate(premiumProvider)
        ..invalidate(walletProvider);
      if (mounted) showBimSnack(context, done);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(premiumProvider);
    final api = ref.read(walletApiProvider);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text('Premium', style: theme.textTheme.titleLarge))]),
            const SizedBox(height: BimSpacing.md),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [Text(e is ApiException ? e.message : ApiException.unknown.message)],
              data: (p) => [
                const Icon(Icons.workspace_premium_rounded, color: BimColors.coin, size: 56),
                const SizedBox(height: BimSpacing.sm),
                Text('${coinsLabel(p.priceFcfa)} F par mois', key: const ValueKey('premium-price'), style: theme.textTheme.headlineSmall),
                const SizedBox(height: BimSpacing.md),
                const Text('• Recevoir des pièces sur tes publications et tes commentaires'),
                const Text('• Retirer les pièces reçues vers ton Mobile Money'),
                const Text('• Pas de publicité'),
                const SizedBox(height: BimSpacing.md),
                if (p.demo) ...[const DemoNotice(), const SizedBox(height: BimSpacing.md)],
                if (!p.available)
                  const Text('Premium arrive bientôt sur BIM.', key: ValueKey('premium-closed'))
                else if (p.active) ...[
                  Text(
                    p.autoRenew ? 'Premium actif jusqu’au ${_day(p.until)}, renouvelé automatiquement.' : 'Premium actif jusqu’au ${_day(p.until)}, sans renouvellement.',
                    key: const ValueKey('premium-state'),
                  ),
                  const SizedBox(height: BimSpacing.md),
                  if (p.autoRenew)
                    BimButton(label: 'Résilier', variant: BimButtonVariant.outline, loading: _busy, onPressed: _busy ? null : () => _run(api.cancelPremium, 'Résilié : Premium reste actif jusqu’à la fin de la période.'))
                  else
                    BimButton(label: 'Reprendre le renouvellement', loading: _busy, onPressed: _busy ? null : () => _run(api.subscribe, 'Renouvellement repris.')),
                ] else
                  BimButton(
                    key: const ValueKey('premium-subscribe'),
                    label: 'S’abonner (démo)',
                    loading: _busy,
                    onPressed: _busy ? null : () => _run(api.subscribe, 'Bienvenue dans Premium ! (démo : rien n’a été payé)'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
