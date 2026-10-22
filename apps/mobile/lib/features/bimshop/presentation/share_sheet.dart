import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/feedback.dart';
import '../../auth/application/session_controller.dart';
import '../../auth/presentation/visitor_gate_sheet.dart';
import '../../messaging/data/messaging_api.dart';
import '../data/bimshop_api.dart';
import 'bimshop_widgets.dart' show formatPriceF;

/// Texte envoyé aux autres applications (pas encore de site web : nom, prix et boutique).
String shareText(ShopCard c) => '${c.title} · ${formatPriceF(c.priceFcfa)} · ${c.shop.name}, à voir sur BIM';

/// Partage vers les autres applications ; remplaçable dans les tests. [origin] : zone du bouton « Partager »,
/// obligatoire sur iPad (la feuille de partage s'y ouvre en bulle au-dessus du bouton, sinon l'app plante).
final systemShareProvider = Provider<Future<void> Function(String text, Rect? origin)>(
  (ref) => (text, origin) async {
    await SharePlus.instance.share(ShareParams(text: text, sharePositionOrigin: origin));
  },
);

/// Zone à l'écran du widget [context] (bouton « Partager »), pour placer la feuille de partage sur iPad.
Rect? shareOrigin(BuildContext context) {
  final box = context.findRenderObject();
  if (box is! RenderBox || !box.hasSize) return null;
  return box.localToGlobal(Offset.zero) & box.size;
}

/// V1 (19/10/2026) — « Partager » un article : à quelqu'un dans BIM (une conversation) ou vers une autre application.
Future<void> showShareProductSheet(BuildContext context, WidgetRef ref, ShopCard card, {Rect? origin}) async {
  final anchor = origin ?? shareOrigin(context);
  final choice = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            key: const ValueKey('share-in-bim'),
            leading: const Icon(Icons.send_rounded),
            title: const Text('Envoyer dans BIM'),
            subtitle: const Text('À une personne ou un groupe de tes messages'),
            onTap: () => Navigator.pop(ctx, 'bim'),
          ),
          ListTile(
            key: const ValueKey('share-system'),
            leading: const Icon(Icons.ios_share_rounded),
            title: const Text('Autres applications'),
            subtitle: const Text('WhatsApp, SMS…'),
            onTap: () => Navigator.pop(ctx, 'system'),
          ),
        ],
      ),
    ),
  );
  if (!context.mounted || choice == null) return;
  if (choice == 'system') {
    try {
      await ref.read(systemShareProvider)(shareText(card), anchor);
    } catch (_) {
      if (context.mounted) showBimSnack(context, 'Impossible d’ouvrir le partage. Réessaie.');
    }
    return;
  }
  if (ref.read(sessionProvider) is! SessionSignedIn) {
    await showVisitorGate(context, ref);
    return;
  }
  final picked = await showModalBottomSheet<ConversationSummary>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _PickConversation(),
  );
  if (!context.mounted || picked == null) return;
  final container = ProviderScope.containerOf(context, listen: false);
  try {
    await container.read(messagingApiProvider).sendProduct(picked.id, card.id);
    container.invalidate(conversationsProvider);
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Envoyé à ${picked.title}')));
  } on ApiException catch (e) {
    if (context.mounted) showApiError(context, e);
  }
}

class _PickConversation extends ConsumerWidget {
  const _PickConversation();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(conversationsProvider(false));
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.sm),
              child: Text('Envoyer à…', style: Theme.of(context).textTheme.titleMedium),
            ),
            Flexible(
              child: async.when(
                loading: () => const Padding(padding: EdgeInsets.all(BimSpacing.xl), child: Center(child: CircularProgressIndicator())),
                error: (e, _) => Padding(padding: const EdgeInsets.all(BimSpacing.xl), child: Text(e is ApiException ? e.message : ApiException.unknown.message)),
                data: (page) => page.items.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.all(BimSpacing.xl),
                        child: Text('Aucune conversation pour l’instant. Écris d’abord à quelqu’un depuis Messages.', textAlign: TextAlign.center),
                      )
                    : ListView(
                        shrinkWrap: true,
                        children: [
                          for (final c in page.items)
                            ListTile(
                              key: ValueKey('share-to-${c.id}'),
                              leading: CircleAvatar(child: Text(c.title.isEmpty ? '?' : c.title[0].toUpperCase())),
                              title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                              subtitle: Text(c.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                              onTap: () => Navigator.pop(context, c),
                            ),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
