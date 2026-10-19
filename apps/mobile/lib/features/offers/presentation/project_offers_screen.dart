import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../../core/widgets/certified_badge.dart';
import '../../bimshop/presentation/bimshop_widgets.dart';
import '../../messaging/presentation/messages_view.dart' show openShopConversation;
import '../data/offers_api.dart';

/// Lot 5-D — Écran 49, « Offres pour ton projet ». Les boutiques ne connaissent ni ton nom ni ton profil.
/// « Discuter » ouvre la conversation avec la boutique (6-B), après accord : la boutique saura alors qui tu es.
/// « Refuser » est définitif pour cette boutique et ce projet.
class ProjectOffersScreen extends ConsumerWidget {
  const ProjectOffersScreen({super.key, required this.projectId});

  final String projectId;

  Future<void> _run(BuildContext context, WidgetRef ref, Future<void> Function(OffersApi api) action, {String? done}) async {
    try {
      await action(ref.read(offersApiProvider));
      ref.invalidate(projectOffersProvider(projectId));
      if (done != null && context.mounted) showBimSnack(context, done);
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final async = ref.watch(projectOffersProvider(projectId));
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text(e is ApiException ? e.message : ApiException.unknown.message)),
          data: (r) => ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
              const SizedBox(height: BimSpacing.md),
              Text('Offres pour ton projet', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
              const SizedBox(height: BimSpacing.xs),
              Text('Les boutiques voient ton projet sans ton nom ni ton profil. Tu restes libre de refuser.', style: theme.textTheme.bodyMedium),
              const SizedBox(height: BimSpacing.md),
              Container(
                decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
                padding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.xs),
                child: SwitchListTile(
                  key: const ValueKey('receive-offers'),
                  contentPadding: EdgeInsets.zero,
                  value: r.receiveOffers,
                  activeTrackColor: BimColors.red,
                  title: const Text('Recevoir les offres des marchands', style: TextStyle(fontWeight: FontWeight.w700)),
                  onChanged: (v) => _run(context, ref, (api) => api.setReceive(projectId, v)),
                ),
              ),
              const SizedBox(height: BimSpacing.lg),
              if (r.items.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: BimSpacing.xl),
                  child: Column(
                    children: [
                      const Peni(pose: PeniPose.think, size: 100),
                      const SizedBox(height: BimSpacing.md),
                      Text(
                        r.receiveOffers ? 'Aucune offre pour l’instant. Les boutiques de ta catégorie peuvent t’en proposer.' : 'Tu ne reçois pas d’offres pour ce projet.',
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                )
              else
                for (final o in r.items)
                  Container(
                    key: ValueKey('offer-${o.id}'),
                    margin: const EdgeInsets.only(bottom: BimSpacing.lg),
                    padding: const EdgeInsets.all(BimSpacing.lg),
                    decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        InkWell(
                          onTap: () => context.push('/bimshop/shops/${o.shop.slug}'),
                          child: Row(
                            children: [
                              const CircleAvatar(backgroundColor: BimColors.redSoft, child: Icon(Icons.storefront_outlined, color: BimColors.red)),
                              const SizedBox(width: BimSpacing.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Flexible(child: Text(o.shop.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700))),
                                        if (o.shop.certified) const Padding(padding: EdgeInsets.only(left: 4), child: CertifiedBadge()),
                                      ],
                                    ),
                                    if (o.shop.place.isNotEmpty) Text(o.shop.place, style: theme.textTheme.bodySmall),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: BimSpacing.md),
                        Text(o.message, style: theme.textTheme.bodyLarge),
                        if (o.products.isNotEmpty) ...[
                          const SizedBox(height: BimSpacing.md),
                          ShopCardGrid(cards: o.products, showShop: false),
                        ],
                        const SizedBox(height: BimSpacing.md),
                        Row(
                          children: [
                            Expanded(
                              child: BimButton(
                                key: ValueKey('chat-${o.id}'),
                                label: 'Discuter',
                                icon: Icons.chat_bubble_outline_rounded,
                                variant: BimButtonVariant.outline,
                                onPressed: () => _chat(context, ref, o.shop.slug, o.id),
                              ),
                            ),
                            const SizedBox(width: BimSpacing.sm),
                            Expanded(
                              child: BimButton(
                                key: ValueKey('decline-${o.id}'),
                                label: 'Refuser',
                                variant: BimButtonVariant.subtle,
                                onPressed: () => _run(context, ref, (api) => api.decline(projectId, o.id), done: 'Offre refusée'),
                              ),
                            ),
                          ],
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
}

/// « Recommandé pour toi » (écran 24, projets Premium) : articles du BimShop liés à la catégorie du projet.
/// Les achats se font sur le BimShop, jamais dans le projet.
class ProjectRecommendations extends ConsumerWidget {
  const ProjectRecommendations({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final items = ref.watch(recommendationsProvider(projectId)).valueOrNull?.items ?? const [];
    if (items.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(BimSpacing.lg),
        decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Text(
          'Les articles et prestations des boutiques de ta catégorie apparaîtront ici dès qu’ils seront en ligne. '
          'Les achats se feront sur le BimShop, jamais dans ton projet.',
          style: theme.textTheme.bodyMedium,
        ),
      );
    }
    return SizedBox(
      // Photo carrée de 150 px, nom, prix (prix barré) et boutique, avec de la marge pour un texte agrandi.
      height: 300,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: BimSpacing.md),
        itemBuilder: (_, i) => SizedBox(width: 150, child: ShopCardTile(card: items[i], showShop: true, aspect: 1)),
      ),
    );
  }
}

/// L'offre a été vue sans que la boutique sache qui tu es (demande anonymisée, 5-D) : écrire la renseigne, donc on
/// demande d'abord l'accord de la personne.
Future<void> _chat(BuildContext context, WidgetRef ref, String shopSlug, String offerId) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Écrire à cette boutique ?'),
      content: const Text('La boutique verra ton nom et ta photo de profil, et saura que tu lui écris à propos de ce projet.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
        TextButton(key: const ValueKey('chat-confirm'), onPressed: () => Navigator.pop(ctx, true), child: const Text('Écrire')),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  await openShopConversation(context, ref, shopSlug, offerId: offerId);
}
