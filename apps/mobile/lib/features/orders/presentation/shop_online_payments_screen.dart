import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/step_header.dart';
import '../data/orders_api.dart';

final shopOnlineTermsProvider = FutureProvider.autoDispose<ShopOnlineTerms>((ref) => ref.watch(shopOrdersApiProvider).onlineTerms());

/// Lot 8 (L8-02) — Paiement en ligne vu par la boutique : l'argent va directement à la boutique, les frais du prestataire
/// sont à sa charge, BIM ne prélève aucune commission et le client paie le prix affiché. Les frais applicables sont
/// publiés ici avant toute activation.
class ShopOnlinePaymentsScreen extends ConsumerWidget {
  const ShopOnlinePaymentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(shopOnlineTermsProvider);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(children: [const BimBackButton(), const SizedBox(width: BimSpacing.sm), Expanded(child: Text('Paiement en ligne', style: theme.textTheme.titleLarge))]),
            const SizedBox(height: BimSpacing.md),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [
                Text(e is ApiException ? e.message : ApiException.unknown.message),
                const SizedBox(height: BimSpacing.sm),
                BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(shopOnlineTermsProvider)),
              ],
              data: (t) => [
                Text(
                  t.open ? 'Ouvert : tes clients peuvent payer en ligne (${operatorsLabel(t.operators)}).' : 'Pas encore ouvert. Tes clients paient comme aujourd’hui et tu confirmes toi-même chaque paiement.',
                  key: const ValueKey('online-terms-state'),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: BimSpacing.md),
                const Text('• L’argent va directement sur ton compte, jamais sur un compte de BIM.'),
                Text('• BIM ne prend aucune commission sur tes ventes (${t.bimCommissionPercent} %).', key: const ValueKey('online-terms-commission')),
                const Text('• Les frais du prestataire de paiement sont à ta charge.'),
                const Text('• Ton client paie le prix affiché, sans supplément.'),
                const SizedBox(height: BimSpacing.md),
                Text('Frais applicables', style: theme.textTheme.titleMedium),
                Text(t.feeTerms ?? 'Ils seront publiés ici avant l’ouverture du paiement en ligne.', key: const ValueKey('online-terms-fees')),
                const SizedBox(height: BimSpacing.md),
                Text(
                  t.accountActive ? 'Ton compte de paiement est enregistré.' : 'Aucun compte de paiement enregistré pour ta boutique.',
                  key: const ValueKey('online-terms-account'),
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
