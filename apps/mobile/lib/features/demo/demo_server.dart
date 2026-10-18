import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/config/env.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/tokens.dart';

/// Version de démonstration (option gratuite) : le serveur tourne sur un ordinateur du même Wi-Fi ; son adresse
/// (ex. http://192.168.1.20:3000) est enregistrée sur le téléphone. Absent des versions publiées.
abstract final class DemoServer {
  static const _key = 'bim.demo_server_url';
  static const _storage = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  static Future<String?> load() async {
    if (!Env.isDemo) return null;
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      return null;
    }
  }

  static Future<void> save(String url) => _storage.write(key: _key, value: url);

  /// « 192.168.1.20 » ou « 192.168.1.20:3000 » → « http://192.168.1.20:3000 ».
  static String? normalize(String input) {
    var v = input.trim();
    if (v.isEmpty) return null;
    if (!v.startsWith('http://') && !v.startsWith('https://')) v = 'http://$v';
    final uri = Uri.tryParse(v);
    if (uri == null || uri.host.isEmpty) return null;
    return Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : 3000).toString();
  }
}

/// Bouton « Serveur de démo » de l'écran d'accueil (version de démonstration seulement).
class DemoServerButton extends ConsumerStatefulWidget {
  const DemoServerButton({super.key});

  @override
  ConsumerState<DemoServerButton> createState() => _DemoServerButtonState();
}

class _DemoServerButtonState extends ConsumerState<DemoServerButton> {
  Future<void> _edit() async {
    final api = ref.read(apiClientProvider);
    final ctrl = TextEditingController(text: api.baseUrl);
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Serveur de démo'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Adresse affichée sur l’ordinateur de démo (même Wi-Fi), par exemple 192.168.1.20:3000.'),
            const SizedBox(height: BimSpacing.sm),
            TextField(key: const ValueKey('demo-server-field'), controller: ctrl, keyboardType: TextInputType.url, autofocus: true),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Annuler')),
          TextButton(key: const ValueKey('demo-server-save'), onPressed: () => Navigator.of(ctx).pop(ctrl.text), child: const Text('Enregistrer')),
        ],
      ),
    );
    ctrl.dispose();
    if (url == null) return;
    final normalized = DemoServer.normalize(url);
    if (normalized == null) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Adresse non valable.')));
      return;
    }
    api.setBaseUrl(normalized);
    await DemoServer.save(normalized);
    if (!mounted) return;
    setState(() {});
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Serveur de démo : $normalized')));
  }

  @override
  Widget build(BuildContext context) {
    if (!Env.isDemo) return const SizedBox.shrink();
    return TextButton.icon(
      key: const ValueKey('demo-server'),
      onPressed: _edit,
      icon: const Icon(Icons.dns_outlined, size: 18),
      label: Text('Serveur de démo : ${ref.read(apiClientProvider).baseUrl}', overflow: TextOverflow.ellipsis),
    );
  }
}
