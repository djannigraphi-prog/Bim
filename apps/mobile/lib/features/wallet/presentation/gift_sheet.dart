import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../orders/data/orders_api.dart' show newIdempotencyKey;
import '../data/wallet_api.dart';

/// Bandeau du prototype : rien n'est payé, rien n'est versé.
class DemoNotice extends StatelessWidget {
  const DemoNotice({super.key});

  @override
  Widget build(BuildContext context) => Container(
        key: const ValueKey('demo-notice'),
        width: double.infinity,
        padding: const EdgeInsets.all(BimSpacing.sm),
        decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
        child: const Text('Mode démo : aucun argent réel, rien n’est payé ni versé.', style: TextStyle(fontWeight: FontWeight.w600)),
      );
}

/// Image d'un cadeau (ou une pièce si le code est inconnu).
class GiftArt extends StatelessWidget {
  const GiftArt({super.key, required this.code, this.size = 44});

  final String code;
  final double size;

  @override
  Widget build(BuildContext context) {
    final asset = giftAsset(code);
    return asset == null ? Icon(Icons.monetization_on_rounded, color: BimColors.coin, size: size) : SvgPicture.asset(asset, width: size, height: size);
  }
}

/// Bouton « pièces » d'une publication ou d'un commentaire : total reçu ; ouvre « Encourager » si c'est possible.
class CoinButton extends StatelessWidget {
  const CoinButton({super.key, required this.count, required this.canGift, required this.onTap, this.compact = false});

  final int count;
  final bool canGift;
  final VoidCallback? onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: canGift ? 'Encourager avec des pièces' : 'Pièces reçues',
      child: InkWell(
        borderRadius: BorderRadius.circular(BimRadius.chip),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(compact ? BimSpacing.xs : BimSpacing.sm),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.monetization_on_outlined, color: canGift ? BimColors.coin : scheme.onSurface, size: compact ? 18 : 24),
              const SizedBox(width: 4),
              Text(coinsLabel(count), style: TextStyle(fontWeight: FontWeight.w600, color: scheme.onSurface, fontSize: compact ? 12 : null)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Écran 13 « Encourager » : 8 cadeaux, quantité, envoi anonyme, solde. Renvoie le nouveau total de la cible.
Future<int?> showGiftSheet(BuildContext context, {required String targetType, required String targetId, required String recipientName}) =>
    showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => GiftSheet(targetType: targetType, targetId: targetId, recipientName: recipientName),
    );

class GiftSheet extends ConsumerStatefulWidget {
  const GiftSheet({super.key, required this.targetType, required this.targetId, required this.recipientName});

  final String targetType;
  final String targetId;
  final String recipientName;

  @override
  ConsumerState<GiftSheet> createState() => _GiftSheetState();
}

class _GiftSheetState extends ConsumerState<GiftSheet> {
  String? _code;
  int _qty = 1;
  bool _anonymous = false;
  bool _busy = false;
  final String _key = newIdempotencyKey();

  Future<void> _send(GiftOption g) async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(walletApiProvider).gift(targetType: widget.targetType, targetId: widget.targetId, giftCode: g.code, quantity: _qty, anonymous: _anonymous, idempotencyKey: _key);
      ref.invalidate(walletProvider);
      if (!mounted) return;
      showBimSnack(context, '${coinsLabel(g.coins * _qty)} pièces envoyées à ${widget.recipientName}. Merci !');
      Navigator.of(context).pop(r.targetCoinCount);
    } on ApiException catch (e) {
      // Même clé conservée : si la réponse s'est perdue alors que l'envoi a réussi, le nouvel essai ne paie pas deux fois.
      if (mounted) {
        setState(() => _busy = false);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(walletProvider);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
        child: async.when(
          loading: () => const SizedBox(height: 200, child: Center(child: CircularProgressIndicator())),
          error: (e, _) => Text(e is ApiException ? e.message : ApiException.unknown.message),
          data: (w) {
            final gift = w.gifts.where((g) => g.code == _code).firstOrNull;
            final total = (gift?.coins ?? 0) * _qty;
            final enough = total <= w.balance.total;
            return SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Encourager ${widget.recipientName}', style: theme.textTheme.titleLarge),
                  const SizedBox(height: BimSpacing.xs),
                  Text('Ton solde : ${coinsLabel(w.balance.total)} pièces', key: const ValueKey('gift-balance')),
                  if (w.demo) ...[const SizedBox(height: BimSpacing.sm), const DemoNotice()],
                  const SizedBox(height: BimSpacing.md),
                  GridView.count(
                    crossAxisCount: 4,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: BimSpacing.sm,
                    crossAxisSpacing: BimSpacing.sm,
                    childAspectRatio: 0.78,
                    children: [
                      for (final g in w.gifts)
                        InkWell(
                          key: ValueKey('gift-${g.code}'),
                          borderRadius: BorderRadius.circular(BimRadius.chip),
                          onTap: () => setState(() => _code = g.code),
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(BimRadius.chip),
                              border: Border.all(color: g.code == _code ? BimColors.red : BimColors.grey200, width: g.code == _code ? 2 : 1),
                            ),
                            padding: const EdgeInsets.all(BimSpacing.xs),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                GiftArt(code: g.code, size: 36),
                                const SizedBox(height: 4),
                                Text(g.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall),
                                Text(coinsLabel(g.coins), style: const TextStyle(fontWeight: FontWeight.w700)),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: BimSpacing.md),
                  Row(
                    children: [
                      const Text('Quantité'),
                      const Spacer(),
                      IconButton(key: const ValueKey('gift-minus'), onPressed: _qty > 1 ? () => setState(() => _qty -= 1) : null, icon: const Icon(Icons.remove_circle_outline)),
                      Text('$_qty', key: const ValueKey('gift-qty'), style: theme.textTheme.titleMedium),
                      IconButton(key: const ValueKey('gift-plus'), onPressed: _qty < 99 ? () => setState(() => _qty += 1) : null, icon: const Icon(Icons.add_circle_outline)),
                    ],
                  ),
                  SwitchListTile(
                    key: const ValueKey('gift-anonymous'),
                    contentPadding: EdgeInsets.zero,
                    value: _anonymous,
                    onChanged: (v) => setState(() => _anonymous = v),
                    title: const Text('Envoyer anonymement'),
                    subtitle: const Text('Ton nom n’apparaît pas dans la liste des donateurs.'),
                  ),
                  const SizedBox(height: BimSpacing.sm),
                  if (gift != null && !enough) ...[
                    Text('Il te manque ${coinsLabel(total - w.balance.total)} pièces.', key: const ValueKey('gift-missing')),
                    const SizedBox(height: BimSpacing.sm),
                    BimButton(
                      label: 'Acheter des pièces',
                      variant: BimButtonVariant.outline,
                      onPressed: () async {
                        await showBuyCoinsSheet(context);
                        ref.invalidate(walletProvider);
                      },
                    ),
                  ] else
                    BimButton(
                      key: const ValueKey('gift-send'),
                      label: gift == null ? 'Choisis un cadeau' : 'Envoyer ${coinsLabel(total)} pièces',
                      loading: _busy,
                      onPressed: gift == null || _busy ? null : () => _send(gift),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Écran 60 « Acheter des pièces » : packs, prix = nombre de pièces. Prototype : achat simulé.
Future<void> showBuyCoinsSheet(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const BuyCoinsSheet(),
    );

class BuyCoinsSheet extends ConsumerStatefulWidget {
  const BuyCoinsSheet({super.key});

  @override
  ConsumerState<BuyCoinsSheet> createState() => _BuyCoinsSheetState();
}

class _BuyCoinsSheetState extends ConsumerState<BuyCoinsSheet> {
  int? _busy;

  Future<void> _custom(int min, int max) async {
    final coins = await showDialog<int>(context: context, builder: (_) => _CustomAmountDialog(min: min, max: max));
    if (coins != null && mounted) await _buy(coins);
  }

  Future<void> _buy(int coins) async {
    setState(() => _busy = coins);
    try {
      await ref.read(walletApiProvider).buy(coins, idempotencyKey: newIdempotencyKey());
      ref.invalidate(walletProvider);
      if (!mounted) return;
      showBimSnack(context, '${coinsLabel(coins)} pièces ajoutées (démo, rien n’a été payé).');
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = null);
        showApiError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(walletProvider);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
        child: async.when(
          loading: () => const SizedBox(height: 160, child: Center(child: CircularProgressIndicator())),
          error: (e, _) => Text(e is ApiException ? e.message : ApiException.unknown.message),
          data: (w) => SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Acheter des pièces', style: theme.textTheme.titleLarge),
                const SizedBox(height: BimSpacing.xs),
                const Text('1 pièce = 1 F. Les pièces achetées s’envoient ; seules les pièces reçues peuvent être retirées.'),
                const SizedBox(height: BimSpacing.sm),
                const DemoNotice(),
                const SizedBox(height: BimSpacing.md),
                for (final p in w.packs)
                  ListTile(
                    key: ValueKey('pack-$p'),
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.monetization_on_rounded, color: BimColors.coin),
                    title: Text('${coinsLabel(p)} pièces', style: const TextStyle(fontWeight: FontWeight.w700)),
                    trailing: _busy == p ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text('${coinsLabel(p)} F'),
                    onTap: _busy == null ? () => _buy(p) : null,
                  ),
                // V1 : la personne choisit elle-même le nombre de pièces.
                if (w.customMin != null && w.customMax != null)
                  ListTile(
                    key: const ValueKey('pack-custom'),
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.edit_outlined),
                    title: const Text('Autre montant', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('De ${coinsLabel(w.customMin!)} à ${coinsLabel(w.customMax!)} pièces'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _busy == null ? () => _custom(w.customMin!, w.customMax!) : null,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Donateurs d'une publication (les envois anonymes sont regroupés, sans nom).
Future<void> showDonorsSheet(BuildContext context, String postId) => showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => _DonorsSheet(postId: postId),
    );

final _donorsProvider = FutureProvider.autoDispose.family<DonorsInfo, String>((ref, id) => ref.watch(walletApiProvider).donors(id));

class _DonorsSheet extends ConsumerWidget {
  const _DonorsSheet({required this.postId});

  final String postId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(_donorsProvider(postId));
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
        child: async.when(
          loading: () => const SizedBox(height: 120, child: Center(child: CircularProgressIndicator())),
          error: (e, _) => Text(e is ApiException ? e.message : ApiException.unknown.message),
          data: (d) => ListView(
            shrinkWrap: true,
            children: [
              Text('${coinsLabel(d.total)} pièces reçues', style: theme.textTheme.titleLarge),
              const SizedBox(height: BimSpacing.sm),
              for (final x in d.donors)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(x.fullName),
                  subtitle: Text('@${x.username}'),
                  trailing: Text('${coinsLabel(x.coins)} pièces'),
                  onTap: () => context.push('/people/${x.username}'),
                ),
              if (d.anonymousCoins > 0)
                ListTile(contentPadding: EdgeInsets.zero, title: const Text('Envois anonymes'), trailing: Text('${coinsLabel(d.anonymousCoins)} pièces')),
              if (d.donors.isEmpty && d.anonymousCoins == 0) const Text('Pas encore de pièces sur cette publication.'),
            ],
          ),
        ),
      ),
    );
  }
}

/// V1 — « Autre montant » : nombre de pièces choisi par la personne (1 pièce = 1 F), dans les bornes réglées.
class _CustomAmountDialog extends StatefulWidget {
  const _CustomAmountDialog({required this.min, required this.max});
  final int min;
  final int max;

  @override
  State<_CustomAmountDialog> createState() => _CustomAmountDialogState();
}

class _CustomAmountDialogState extends State<_CustomAmountDialog> {
  final _controller = TextEditingController();

  int? get _value => int.tryParse(_controller.text.replaceAll(RegExp(r'\s'), ''));
  bool get _valid => _value != null && _value! >= widget.min && _value! <= widget.max;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Autre montant'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              key: const ValueKey('custom-coins'),
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(labelText: 'Nombre de pièces', helperText: 'Entre ${coinsLabel(widget.min)} et ${coinsLabel(widget.max)}'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: BimSpacing.sm),
            Text(_value == null ? '1 pièce = 1 F' : 'Prix : ${coinsLabel(_value!)} F', key: const ValueKey('custom-price')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          TextButton(key: const ValueKey('custom-buy'), onPressed: _valid ? () => Navigator.pop(context, _value) : null, child: const Text('Acheter')),
        ],
      );
}
