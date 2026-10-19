import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/theme_controller.dart';
import '../../../core/theme/tokens.dart';
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
    final scheme = theme.colorScheme;
    final me = session is SessionSignedIn ? session.me : null;
    Widget section(String label) => Padding(
          padding: const EdgeInsets.fromLTRB(0, BimSpacing.lg, 0, BimSpacing.xs),
          child: Text(label, style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.4)),
        );
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, BimSpacing.xxl),
          children: [
            // Maquette 62 : retour à gauche, titre centré.
            SizedBox(
              height: 56,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
                  Text('Paramètres', style: theme.textTheme.titleMedium?.copyWith(fontSize: 18, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
            const SizedBox(height: BimSpacing.md),
            if (me != null)
              Material(
                color: scheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(BimRadius.card),
                child: ListTile(
                  key: const ValueKey('account-profile'),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.card)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: BimSpacing.md, vertical: BimSpacing.sm),
                  leading: CircleAvatar(
                    radius: 26,
                    backgroundColor: BimColors.redSoft,
                    child: Text(me.fullName.isEmpty ? '?' : me.fullName.trim().split(RegExp(r'\s+')).take(2).map((w) => w[0].toUpperCase()).join(), style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
                  ),
                  title: Text(me.fullName, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  subtitle: Text('@${me.username} · compte utilisateur', style: theme.textTheme.bodySmall),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.push('/people/${me.username}'),
                ),
              ),
            section('APPARENCE'),
            _Row(
              icon: Icons.dark_mode_outlined,
              title: 'Thème',
              trailing: _ThemeSwitch(mode: mode, onChanged: (m) => _setTheme(ref, m)),
            ),
            const _Row(icon: Icons.translate_rounded, title: 'Langue', value: 'Français'),
            section('SÉCURITÉ ET PROFILS'),
            _Row(icon: Icons.swap_horiz_rounded, title: 'Changer de profil', subtitle: 'Utilisateur, boutiques, compte livreur', onTap: () => showSpacesSheet(context)),
            _Row(icon: Icons.contact_phone_outlined, title: 'Téléphone et e-mail', onTap: () => context.push('/account/contacts')),
            _Row(icon: Icons.block_rounded, title: 'Personnes bloquées', onTap: () => context.push('/account/blocked')),
            _Row(icon: Icons.lock_outline_rounded, title: 'Mot de passe', onTap: () => context.push('/account/password')),
            _Row(icon: Icons.devices_outlined, title: 'Appareils connectés', onTap: () => context.push('/account/devices')),
            section('PIÈCES ET PREMIUM'),
            _Row(key: const ValueKey('account-wallet'), icon: Icons.monetization_on_outlined, title: 'Mes pièces', subtitle: 'Solde, achat, retrait', onTap: () => context.push('/wallet')),
            _Row(icon: Icons.workspace_premium_outlined, title: 'Premium', subtitle: 'Recevoir des pièces, sans publicité', onTap: () => context.push('/premium')),
            section('NOTIFICATIONS'),
            _Row(icon: Icons.notifications_none_rounded, title: 'Rappels', subtitle: 'Rappels de Peni et heures calmes', onTap: () => context.push('/account/reminders')),
            section('AIDE'),
            _Row(icon: Icons.help_outline_rounded, title: 'Résoudre un problème', subtitle: 'Avec l’application, un produit ou un service', onTap: () => reportProblem(context)),
            _Row(icon: Icons.forum_outlined, title: 'Mes signalements', subtitle: 'Statut et réponses de l’équipe BIM', onTap: () => context.push('/reports')),
            _Row(
              icon: Icons.logout_rounded,
              iconColor: BimColors.red,
              title: 'Se déconnecter',
              divider: false,
              onTap: () async {
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

/// Ligne de la maquette 62 : icône dans un carré gris arrondi, titre, valeur ou flèche, séparateur.
class _Row extends StatelessWidget {
  const _Row({super.key, required this.icon, required this.title, this.subtitle, this.value, this.trailing, this.onTap, this.iconColor, this.divider = true});

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? value;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      children: [
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BimRadius.chip),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(12)),
                  child: Icon(icon, size: 22, color: iconColor ?? scheme.onSurface),
                ),
                const SizedBox(width: BimSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                      if (subtitle != null) Text(subtitle!, style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                // Écran étroit : le choix du thème ou la valeur se réduisent au lieu de déborder.
                if (trailing != null)
                  Flexible(child: Align(alignment: Alignment.centerRight, child: FittedBox(fit: BoxFit.scaleDown, child: trailing))),
                if (value != null) Flexible(child: Text(value!, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.end, style: theme.textTheme.bodyMedium)),
                if (onTap != null && trailing == null) Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
              ],
            ),
          ),
        ),
        if (divider) Divider(height: 1, indent: 52, color: scheme.outline),
      ],
    );
  }
}

/// Choix du thème compact (maquette 62 : « Clair · Sombre »), plus « Auto » (réglage du téléphone).
class _ThemeSwitch extends StatelessWidget {
  const _ThemeSwitch({required this.mode, required this.onChanged});

  final ThemeMode mode;
  final ValueChanged<ThemeMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget option(ThemeMode m, IconData icon, String label) {
      final on = mode == m;
      return Semantics(
        selected: on,
        button: true,
        child: GestureDetector(
          key: ValueKey('theme-${m.name}'),
          onTap: () => onChanged(m),
          child: AnimatedContainer(
            duration: BimDurations.fast,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: on ? scheme.surface : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              boxShadow: on ? const [BoxShadow(color: Color(0x14000000), blurRadius: 4, offset: Offset(0, 1))] : null,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: on ? scheme.onSurface : scheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Text(label, style: TextStyle(fontSize: 13, fontWeight: on ? FontWeight.w600 : FontWeight.w500, color: on ? scheme.onSurface : scheme.onSurfaceVariant)),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(12)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          option(ThemeMode.light, Icons.light_mode_outlined, 'Clair'),
          option(ThemeMode.dark, Icons.dark_mode_outlined, 'Sombre'),
          option(ThemeMode.system, Icons.brightness_auto_outlined, 'Auto'),
        ],
      ),
    );
  }
}
