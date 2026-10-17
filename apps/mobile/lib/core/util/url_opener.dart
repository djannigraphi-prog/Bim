import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Ouvre une adresse dans le navigateur du téléphone (page de paiement du prestataire, lot 8). Remplaçable en test.
typedef UrlOpener = Future<bool> Function(Uri url);

final urlOpenerProvider = Provider<UrlOpener>((ref) => (url) => launchUrl(url, mode: LaunchMode.externalApplication));
