import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../../auth/application/session_controller.dart';
import '../../merchant/presentation/shop_team_screen.dart' show ShopInvitationsList;
import '../data/account_api.dart';
import 'code_sheets.dart';

class _Page extends StatelessWidget {
  const _Page({required this.title, required this.children, this.subtitle});

  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.lg),
            Text(title, style: theme.textTheme.headlineMedium),
            if (subtitle != null) ...[const SizedBox(height: BimSpacing.xs), Text(subtitle!, style: theme.textTheme.bodyMedium)],
            const SizedBox(height: BimSpacing.lg),
            ...children,
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ Coordonnées de récupération (F16)

/// Téléphones et e-mails du compte. Au moins une coordonnée vérifiée est toujours conservée (F16) ;
/// ajouter ou retirer une coordonnée est une opération protégée.
class ContactsScreen extends ConsumerWidget {
  const ContactsScreen({super.key});

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final input = await showModalBottomSheet<({String type, String value})>(context: context, isScrollControlled: true, builder: (_) => const _NewContactSheet());
    if (input == null || !context.mounted) return;
    final token = await requestStepUp(context, ref, StepUpScope.contactChange);
    if (token == null || !context.mounted) return;
    final api = ref.read(accountApiProvider);
    try {
      final challenge = await api.addContact(input.type, input.value, token);
      if (!context.mounted) return;
      final ok = await askCode(
        context,
        title: input.type == 'phone' ? 'Vérifie ce numéro' : 'Vérifie cette adresse',
        challenge: challenge,
        submit: (code) async {
          try {
            ref.read(sessionProvider.notifier).updateMe(await api.verifyContact(challenge.challengeId, code));
            return null;
          } on ApiException catch (e) {
            return e.message;
          }
        },
      );
      if (ok && context.mounted) showBimSnack(context, 'Coordonnée vérifiée et ajoutée.');
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  Future<void> _remove(BuildContext context, WidgetRef ref, String id) async {
    final token = await requestStepUp(context, ref, StepUpScope.contactChange);
    if (token == null || !context.mounted) return;
    try {
      ref.read(sessionProvider.notifier).updateMe(await ref.read(accountApiProvider).removeContact(id, token));
      if (context.mounted) showBimSnack(context, 'Coordonnée retirée.');
    } on ApiException catch (e) {
      if (context.mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final contacts = session is SessionSignedIn ? session.me.contacts : const <({String id, String type, String value, bool verified})>[];
    final verifiedCount = contacts.where((c) => c.verified).length;
    return _Page(
      title: 'Téléphone et e-mail',
      subtitle: 'Ils servent à récupérer ton compte et à confirmer les opérations sensibles. Garde au moins une coordonnée vérifiée ; le téléphone est recommandé.',
      children: [
        for (final c in contacts)
          Card(
            elevation: 0,
            margin: const EdgeInsets.only(bottom: BimSpacing.sm),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.card), side: BorderSide(color: Theme.of(context).colorScheme.outline, width: 1.5)),
            child: ListTile(
              leading: Icon(c.type == 'phone' ? Icons.phone_outlined : Icons.mail_outline),
              title: Text(c.value),
              subtitle: Text(c.verified ? 'Vérifié' : 'Non vérifié'),
              trailing: (c.verified && verifiedCount <= 1)
                  ? const Tooltip(message: 'Dernière coordonnée vérifiée : ajoute-en une autre avant de la retirer.', child: Icon(Icons.lock_outline))
                  : IconButton(tooltip: 'Retirer ${c.value}', icon: const Icon(Icons.delete_outline), onPressed: () => _remove(context, ref, c.id)),
            ),
          ),
        const SizedBox(height: BimSpacing.md),
        BimButton(label: 'Ajouter une coordonnée', icon: Icons.add, variant: BimButtonVariant.dark, onPressed: () => _add(context, ref)),
      ],
    );
  }
}

class _NewContactSheet extends StatefulWidget {
  const _NewContactSheet();

  @override
  State<_NewContactSheet> createState() => _NewContactSheetState();
}

class _NewContactSheetState extends State<_NewContactSheet> {
  String _type = 'phone';
  final _value = TextEditingController();

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, MediaQuery.viewInsetsOf(context).bottom + BimSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Nouvelle coordonnée', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: BimSpacing.md),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'phone', icon: Icon(Icons.phone_outlined), label: Text('Téléphone')),
              ButtonSegment(value: 'email', icon: Icon(Icons.mail_outline), label: Text('E-mail')),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: BimSpacing.md),
          TextField(
            key: const Key('new-contact-value'),
            controller: _value,
            keyboardType: _type == 'phone' ? TextInputType.phone : TextInputType.emailAddress,
            decoration: InputDecoration(hintText: _type == 'phone' ? '+225 07 00 00 00 00' : 'nom@exemple.com'),
          ),
          const SizedBox(height: BimSpacing.md),
          BimButton(
            label: 'Continuer',
            onPressed: () {
              if (_value.text.trim().length < 3) return;
              Navigator.pop(context, (type: _type, value: _value.text.trim()));
            },
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ Mot de passe

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _p1 = TextEditingController();
  final _p2 = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _p1.dispose();
    _p2.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    if (_p1.text.length < 8 || _p1.text != _p2.text) {
      setState(() => _error = _p1.text.length < 8 ? '8 caractères minimum.' : 'Les deux mots de passe sont différents.');
      return;
    }
    setState(() => _error = null);
    final token = await requestStepUp(context, ref, StepUpScope.passwordChange);
    if (token == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(accountApiProvider).changePassword(_p1.text, token);
      if (!mounted) return;
      showBimSnack(context, 'Mot de passe modifié. Tes autres appareils ont été déconnectés.');
      Navigator.of(context).maybePop();
    } on ApiException catch (e) {
      setState(() => _error = e.fieldError('newPassword') ?? e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Page(
      title: 'Mot de passe',
      subtitle: 'Après le changement, tes autres appareils sont déconnectés.',
      children: [
        TextField(key: const Key('new-password'), controller: _p1, obscureText: true, autofillHints: const [AutofillHints.newPassword], decoration: const InputDecoration(hintText: 'Nouveau mot de passe')),
        const SizedBox(height: BimSpacing.md),
        TextField(key: const Key('new-password-2'), controller: _p2, obscureText: true, decoration: InputDecoration(hintText: 'Confirme le mot de passe', errorText: _error, errorMaxLines: 3)),
        const SizedBox(height: BimSpacing.lg),
        BimButton(label: 'Changer le mot de passe', variant: BimButtonVariant.dark, loading: _busy, onPressed: _go),
      ],
    );
  }
}

// ------------------------------------------------------------------ Appareils connectés

final _sessionsProvider = FutureProvider.autoDispose<List<DeviceSession>>((ref) => ref.watch(accountApiProvider).sessions());

class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_sessionsProvider);
    return _Page(
      title: 'Appareils connectés',
      subtitle: 'Déconnecte un appareil que tu ne reconnais pas, puis change ton mot de passe.',
      children: [
        ...async.when(
          loading: () => [const Center(child: CircularProgressIndicator())],
          error: (e, _) => [Text(e is ApiException ? e.message : ApiException.unknown.message)],
          data: (items) => [
            for (final s in items)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(s.label == 'Navigateur' ? Icons.computer : Icons.smartphone),
                title: Text(s.current ? '${s.label} · cet appareil' : s.label),
                subtitle: Text('Dernière activité : ${_ago(s.lastUsedAt)}'),
                trailing: s.current
                    ? null
                    : TextButton(
                        onPressed: () async {
                          try {
                            await ref.read(accountApiProvider).revokeSession(s.id);
                            ref.invalidate(_sessionsProvider);
                          } on ApiException catch (e) {
                            if (context.mounted) showApiError(context, e);
                          }
                        },
                        style: TextButton.styleFrom(foregroundColor: BimColors.red),
                        child: const Text('Déconnecter'),
                      ),
              ),
          ],
        ),
      ],
    );
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t.toLocal());
    if (d.inMinutes < 2) return 'à l’instant';
    if (d.inHours < 1) return 'il y a ${d.inMinutes} min';
    if (d.inDays < 1) return 'il y a ${d.inHours} h';
    return 'il y a ${d.inDays} j';
  }
}

// ------------------------------------------------------------------ Écran 53 — Changer de profil

final _spacesProvider = FutureProvider.autoDispose<List<SpaceItem>>((ref) => ref.watch(accountApiProvider).spaces());

Future<void> showSpacesSheet(BuildContext context) =>
    showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => const _SpacesSheet());

class _SpacesSheet extends ConsumerWidget {
  const _SpacesSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(_spacesProvider);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, BimSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Changer de profil', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
            const SizedBox(height: BimSpacing.lg),
            ...async.when(
              loading: () => [const Center(child: CircularProgressIndicator())],
              error: (e, _) => [Text(e is ApiException ? e.message : ApiException.unknown.message)],
              data: (items) => [for (final s in items) _SpaceTile(space: s)],
            ),
            // 7-A : invitation à rejoindre l'équipe d'une boutique (aucun accès avant l'accord).
            ShopInvitationsList(onJoined: () => ref.invalidate(_spacesProvider)),
            const SizedBox(height: BimSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: BimButton(
                    label: 'Boutique',
                    icon: Icons.add_business_outlined,
                    variant: BimButtonVariant.subtle,
                    key: const ValueKey('new-shop'),
                    onPressed: () {
                      Navigator.pop(context);
                      context.push('/merchant/apply');
                    },
                  ),
                ),
                const SizedBox(width: BimSpacing.sm),
                Expanded(
                  child: BimButton(
                    label: 'Livreur',
                    icon: Icons.pedal_bike,
                    variant: BimButtonVariant.subtle,
                    onPressed: () => showComingSoon(context, feature: 'Le compte livreur'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SpaceTile extends ConsumerWidget {
  const _SpaceTile({required this.space});

  final SpaceItem space;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final s = space;
    final kind = switch (s.type) {
      'merchant' => 'Marchand',
      'courier' => 'Livreur',
      _ => 'Utilisateur · compte principal',
    };
    final status = s.usable ? '' : ' · ${const {'pending_verification': 'en vérification', 'draft': 'demande à compléter', 'suspended': 'suspendue'}[s.status] ?? s.status}';
    return Padding(
      padding: const EdgeInsets.only(bottom: BimSpacing.sm),
      child: Semantics(
        selected: s.active,
        button: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(BimRadius.card),
          onTap: s.active
              ? null
              : !s.usable
                  // Boutique en préparation, en vérification ou à corriger : on reprend la demande.
                  ? (s.type == 'merchant'
                      ? () {
                          Navigator.pop(context);
                          context.push('/merchant/apply');
                        }
                      : null)
                  : () async {
                  try {
                    final token = await ref.read(accountApiProvider).switchSpace(s.type, s.id);
                    await ref.read(tokenStorageProvider).saveAccess(token);
                    ref.invalidate(_spacesProvider);
                    // Lot 5-B : l'espace actif décide de l'accueil (espace marchand ou accueil utilisateur).
                    await ref.read(sessionProvider.notifier).refreshMe();
                    if (context.mounted) {
                      Navigator.pop(context);
                      context.go(s.type == 'merchant' ? '/shop' : '/home');
                    }
                  } on ApiException catch (e) {
                    if (context.mounted) showApiError(context, e);
                  }
                },
          child: Container(
            padding: const EdgeInsets.all(BimSpacing.lg),
            decoration: BoxDecoration(
              color: s.active ? BimColors.redSoft.withValues(alpha: 0.4) : null,
              borderRadius: BorderRadius.circular(BimRadius.card),
              border: Border.all(color: s.active ? BimColors.red : scheme.outline, width: s.active ? 2 : 1.5),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  child: Icon(switch (s.type) { 'merchant' => Icons.storefront_outlined, 'courier' => Icons.pedal_bike, _ => Icons.person_outline }),
                ),
                const SizedBox(width: BimSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.label, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                      Text('$kind$status', style: Theme.of(context).textTheme.bodyMedium),
                    ],
                  ),
                ),
                Icon(s.active ? Icons.radio_button_checked : Icons.radio_button_off, color: s.active ? BimColors.red : scheme.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
