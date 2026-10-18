import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/step_header.dart';
import '../../account/presentation/account_security_screens.dart';
import '../../auth/application/session_controller.dart';
import '../../projects/presentation/report_sheet.dart';

/// Écran 62 (Paramètres) : identité, profils (53), coordonnées, mot de passe, appareils, rappels (lot 2), thème, déconnexion.
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
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => context.push('/people/${me.username}'),
              ),
            const SizedBox(height: BimSpacing.lg),
            Text('SÉCURITÉ ET PROFILS', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.swap_horiz),
              title: const Text('Changer de profil'),
              subtitle: const Text('Utilisateur, boutiques, compte livreur'),
              onTap: () => showSpacesSheet(context),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.contact_phone_outlined),
              title: const Text('Téléphone et e-mail'),
              onTap: () => context.push('/account/contacts'),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.block_rounded),
              title: const Text('Personnes bloquées'),
              onTap: () => context.push('/account/blocked'),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.lock_outline),
              title: const Text('Mot de passe'),
              onTap: () => context.push('/account/password'),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.devices_outlined),
              title: const Text('Appareils connectés'),
              onTap: () => context.push('/account/devices'),
            ),
            const SizedBox(height: BimSpacing.lg),
            Text('PIÈCES ET PREMIUM', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            ListTile(
              key: const ValueKey('account-wallet'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.monetization_on_outlined),
              title: const Text('Mes pièces'),
              subtitle: const Text('Solde, achat, retrait'),
              onTap: () => context.push('/wallet'),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.workspace_premium_outlined),
              title: const Text('Premium'),
              subtitle: const Text('Recevoir des pièces, sans publicité'),
              onTap: () => context.push('/premium'),
            ),
            const SizedBox(height: BimSpacing.lg),
            Text('NOTIFICATIONS', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.notifications_none_rounded),
              title: const Text('Rappels'),
              subtitle: const Text('Rappels de Peni et heures calmes'),
              onTap: () => context.push('/account/reminders'),
            ),
            const SizedBox(height: BimSpacing.lg),
            Text('AIDE', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.support_outlined),
              title: const Text('Résoudre un problème'),
              subtitle: const Text('Avec l’application, un produit ou un service'),
              onTap: () => reportProblem(context),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.forum_outlined),
              title: const Text('Mes signalements'),
              subtitle: const Text('Statut et réponses de l’équipe BIM'),
              onTap: () => context.push('/reports'),
            ),
            const SizedBox(height: BimSpacing.lg),
            Text('APPARENCE', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: BimSpacing.sm),
            SegmentedButton<ThemeMode>(
              showSelectedIcon: false,
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
