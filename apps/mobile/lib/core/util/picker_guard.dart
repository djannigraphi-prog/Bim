import 'package:flutter/services.dart';

import '../network/api_exception.dart';

/// Ouvre l'appareil photo ou la galerie du téléphone en traduisant ses erreurs (autorisation refusée, pas d'appareil
/// photo, sélecteur déjà ouvert…) en [ApiException] au message clair : les écrans les affichent déjà avec leurs
/// `on ApiException`, au lieu d'une erreur qui échapperait sans rien dire.
/// Un sélecteur déjà ouvert (double appui) rend simplement null.
Future<T?> guardPicker<T>(Future<T?> Function() pick) async {
  try {
    return await pick();
  } on ApiException {
    rethrow;
  } on PlatformException catch (e) {
    if (e.code == 'already_active') return null;
    throw pickerError(e.code);
  } catch (_) {
    throw pickerError('unknown');
  }
}

/// Message selon le code d'erreur du sélecteur (image_picker).
ApiException pickerError(String code) {
  final c = code.toLowerCase();
  if (c.contains('denied') || c.contains('permission') || c.contains('access')) return pickerDenied;
  if (c.contains('camera')) return const ApiException(code: 'PICKER_NO_CAMERA', message: 'Aucun appareil photo disponible sur ce téléphone.');
  return const ApiException(code: 'PICKER_FAILED', message: 'Impossible d’ouvrir l’appareil photo ou la galerie. Réessaie.');
}

/// Autorisation refusée par la personne.
const pickerDenied = ApiException(code: 'PICKER_DENIED', message: 'Autorise l’appareil photo et la galerie dans les réglages du téléphone.');
