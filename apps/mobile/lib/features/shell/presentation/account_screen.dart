import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/step_header.dart';
import '../../auth/application/session_controller.dart';

/// Version minimale de l'écran 62 (Paramètres) pour le lot 0 : identité, thème clair / sombre, déconnexion.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  Future<void> _setTheme(WidgetRef ref, ThemeMode mode) async {
    ref.read(themeModeProvider.notifier).set(mode);
    final value = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    };
    try {
      await ref.read(apiClientProvider).patch('/v1/me/preferences', body: {'theme': value});
    } catch (_) {
      // Préférence gardée localement ; elle sera renvoyée au prochain changement.
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final mode = ref.watch(themeModeProvider);
    final theme = Theme.of(context);
    final me = session is SessionSignedIn ? session.me : null;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.lg),
            Text('Paramètres', style: theme.textTheme.headlineMedium),
            const SizedBox(height: BimSpacing.lg),
            if (me != null)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(radius: 28, child: Icon(Icons.person_outline)),
                title: Text(me.fullName, style: theme.textTheme.titleMedium),
                subtitle: Text('@${me.username} · compte utilisateur'),
              ),
            const SizedBox(height: BimSpacing.lg),
            Text('APPARENCE', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: BimSpacing.sm),
            SegmentedButton<ThemeMode>(
              segments: const [
                ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode_outlined), label: Text('Clair')),
                ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode_outlined), label: Text('Sombre')),
                ButtonSegment(value: ThemeMode.system, icon: Icon(Icons.settings_suggest_outlined), label: Text('Système')),
              ],
              selected: {mode},
              onSelectionChanged: (s) => _setTheme(ref, s.first),
            ),
            const SizedBox(height: BimSpacing.xxl),
            BimButton(
              label: 'Se déconnecter',
              variant: BimButtonVariant.subtle,
              icon: Icons.logout_rounded,
              onPressed: () async {
                await ref.read(sessionProvider.notifier).signOut();
                if (context.mounted) context.go('/welcome');
              },
            ),
          ],
        ),
      ),
    );
  }
}
