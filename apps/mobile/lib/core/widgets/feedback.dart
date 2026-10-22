import 'package:flutter/material.dart';

import '../network/api_exception.dart';
import '../theme/tokens.dart';
import '../util/picker_guard.dart';
import 'brand.dart';

void showBimSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

void showApiError(BuildContext context, Object error) {
  showBimSnack(context, error is ApiException ? error.message : ApiException.unknown.message);
}

/// Choix d'une photo ou d'une vidéo : une erreur (autorisation refusée, vidéo trop lourde…) est affichée
/// à la personne et null est rendu, au lieu d'une erreur qui échapperait sans rien dire.
Future<T?> pickWithFeedback<T>(BuildContext context, Future<T?> Function() pick) async {
  try {
    // Erreurs du sélecteur du téléphone (autorisation refusée…) traduites en message clair.
    return await guardPicker(pick);
  } catch (e) {
    if (context.mounted) showApiError(context, e);
    return null;
  }
}

/// Fonction pas encore intégrée : on le dit clairement au lieu de simuler (règle n°31 du cahier des charges).
Future<void> showComingSoon(BuildContext context, {required String feature}) {
  return showModalBottomSheet<void>(
    context: context,
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, BimSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Peni(pose: PeniPose.think, size: 96),
            const SizedBox(height: BimSpacing.lg),
            Text('Bientôt disponible', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: BimSpacing.sm),
            Text(
              '$feature arrive dans une prochaine version de BIM.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    ),
  );
}
