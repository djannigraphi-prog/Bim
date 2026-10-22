import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_text_field.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../merchant/data/shop_api.dart';
import '../data/offers_api.dart';

/// Lot 5-D — Espace marchand, « Demandes » (écran 55) : projets dont les personnes acceptent les offres,
/// dans les rubriques de la boutique. Anonymisés : ni nom, ni profil, ni photos, ni mesures.
class ShopRequestsScreen extends ConsumerWidget {
  const ShopRequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final async = ref.watch(projectRequestsProvider);
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text(e is ApiException ? e.message : ApiException.unknown.message)),
          data: (r) => RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(projectRequestsProvider);
              await ref.read(projectRequestsProvider.future);
            },
            child: ListView(
              padding: const EdgeInsets.all(BimSpacing.screen),
              children: [
                const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
                const SizedBox(height: BimSpacing.md),
                Text('Demandes de projet', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
                const SizedBox(height: BimSpacing.xs),
                Text('Des personnes de ta rubrique acceptent les offres. Tu ne vois ni leur nom ni leur profil : propose-leur ce qui peut les aider.', style: theme.textTheme.bodyMedium),
                const SizedBox(height: BimSpacing.lg),
                if (r.items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: BimSpacing.xl),
                    child: Column(
                      children: [
                        const Peni(pose: PeniPose.think, size: 100),
                        const SizedBox(height: BimSpacing.md),
                        Text(r.hint ?? 'Aucune demande pour l’instant dans tes rubriques.', textAlign: TextAlign.center),
                      ],
                    ),
                  )
                else
                  for (final q in r.items)
                    Container(
                      key: ValueKey('request-${q.id}'),
                      margin: const EdgeInsets.only(bottom: BimSpacing.md),
                      padding: const EdgeInsets.all(BimSpacing.lg),
                      decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            [q.category, if (q.mode == 'premium') 'Premium', if (q.city != null) q.city!].join(' · '),
                            style: theme.textTheme.bodySmall,
                          ),
                          const SizedBox(height: 2),
                          Text(q.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
                          Text('${q.goal ?? 'Objectif personnel'} · ${q.durationDays} jours', style: theme.textTheme.bodyMedium),
                          const SizedBox(height: BimSpacing.md),
                          if (q.offerStatus == null)
                            BimButton(
                              key: ValueKey('offer-${q.id}'),
                              label: 'Faire une offre',
                              icon: Icons.local_offer_outlined,
                              onPressed: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => _OfferSheet(request: q)),
                            )
                          else
                            Text(q.offerStatus == 'sent' ? 'Offre envoyée' : 'Offre retirée', style: const TextStyle(color: BimColors.success, fontWeight: FontWeight.w700)),
                        ],
                      ),
                    ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OfferSheet extends ConsumerStatefulWidget {
  const _OfferSheet({required this.request});

  final ProjectRequest request;

  @override
  ConsumerState<_OfferSheet> createState() => _OfferSheetState();
}

class _OfferSheetState extends ConsumerState<_OfferSheet> {
  final _message = TextEditingController();
  final _selected = <String>{};
  bool _sending = false;
  ApiException? _error;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(offersApiProvider).sendOffer(widget.request.id, message: _message.text.trim(), productIds: _selected.toList());
      container.invalidate(projectRequestsProvider);
      if (mounted) {
        Navigator.pop(context);
        showBimSnack(context, 'Offre envoyée');
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mine = ref.watch(shopProductsProvider('published')).valueOrNull ?? const <ProductSummary>[];
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, MediaQuery.viewInsetsOf(context).bottom + BimSpacing.lg),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Offre pour « ${widget.request.title} »', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.md),
            BimTextField(
              key: const ValueKey('offer-message'),
              label: 'Ton message',
              hint: 'Présente ce que tu proposes pour ce projet',
              controller: _message,
              required: true,
              maxLength: 500,
              errorText: _error?.fieldError('message'),
              onChanged: (_) => setState(() {}),
            ),
            if (mine.isNotEmpty) ...[
              const SizedBox(height: BimSpacing.md),
              Text('Joindre des articles (3 au plus)', style: theme.textTheme.titleMedium),
              for (final p in mine)
                CheckboxListTile(
                  key: ValueKey('offer-product-${p.id}'),
                  contentPadding: EdgeInsets.zero,
                  value: _selected.contains(p.id),
                  title: Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(formatFcfa(p.priceFcfa)),
                  onChanged: !_selected.contains(p.id) && _selected.length >= 3 ? null : (v) => setState(() => v == true ? _selected.add(p.id) : _selected.remove(p.id)),
                ),
            ],
            if (_error != null && _error!.fieldError('message') == null) ...[
              const SizedBox(height: BimSpacing.sm),
              Text(_error!.fieldError('productIds') ?? _error!.message, style: const TextStyle(color: BimColors.red)),
            ],
            const SizedBox(height: BimSpacing.lg),
            BimButton(key: const ValueKey('send-offer'), label: 'Envoyer l’offre', loading: _sending, onPressed: _message.text.trim().length < 10 || _sending ? null : _send),
          ],
        ),
      ),
    );
  }
}
