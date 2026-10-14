import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_text_field.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/session_controller.dart';
import '../data/auth_api.dart';
import '../data/models.dart';

/// Écran 03 — Connexion par e-mail, téléphone ou @nom d'utilisateur + mot de passe (Q12).
/// Google, Apple et Facebook sont affichés comme sur la maquette mais annoncés « bientôt disponibles »
/// tant que le serveur ne les déclare pas opérationnels (/v1/auth/providers).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _hidden = true;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_identifier.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Renseigne ton identifiant et ton mot de passe.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ref.read(authApiProvider).login(_identifier.text.trim(), _password.text);
      await ref.read(sessionProvider.notifier).completeSignIn(result);
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (e.code == 'CONTACT_NOT_VERIFIED' && e.details['verification'] is Map<String, dynamic>) {
        final challenge = Challenge.fromJson(e.details['verification'] as Map<String, dynamic>);
        if (mounted) unawaited(context.push('/verify', extra: challenge));
      } else if (mounted) {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _social(String provider) async {
    try {
      final available = await ref.read(authApiProvider).socialProviders();
      if (available[provider] != true && mounted) {
        await showComingSoon(context, feature: 'La connexion avec ${provider[0].toUpperCase()}${provider.substring(1)}');
      }
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: AutofillGroup(
          child: ListView(
            padding: const EdgeInsets.all(BimSpacing.screen),
            children: [
              const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
              const SizedBox(height: BimSpacing.lg),
              const Align(alignment: Alignment.centerLeft, child: BimLogo(height: 48)),
              const SizedBox(height: BimSpacing.lg),
              Text('Content de te revoir', style: theme.textTheme.headlineMedium),
              const SizedBox(height: BimSpacing.xs),
              Text('Connecte-toi pour continuer ton BIM.', style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              const SizedBox(height: BimSpacing.xl),
              BimTextField(
                controller: _identifier,
                hint: 'E-mail, téléphone ou @nom d’utilisateur',
                icon: Icons.person_outline_rounded,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.username],
              ),
              const SizedBox(height: BimSpacing.md),
              BimTextField(
                controller: _password,
                hint: 'Mot de passe',
                icon: Icons.lock_outline_rounded,
                obscure: _hidden,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.password],
                onSubmitted: (_) => _submit(),
                errorText: _error,
                suffix: IconButton(
                  tooltip: _hidden ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                  icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                  onPressed: () => setState(() => _hidden = !_hidden),
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => context.push('/forgot'),
                  style: TextButton.styleFrom(foregroundColor: BimColors.red, minimumSize: const Size(0, kBimMinTouch)),
                  child: const Text('Mot de passe oublié ?', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(height: BimSpacing.sm),
              BimButton(label: 'Se connecter', variant: BimButtonVariant.dark, loading: _loading, onPressed: _submit),
              const SizedBox(height: BimSpacing.xl),
              Row(
                children: [
                  const Expanded(child: Divider()),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: BimSpacing.md),
                    child: Text('ou continuer avec', style: theme.textTheme.bodyMedium),
                  ),
                  const Expanded(child: Divider()),
                ],
              ),
              const SizedBox(height: BimSpacing.lg),
              Row(
                children: [
                  _SocialButton(label: 'Google', text: 'G', onTap: () => _social('google')),
                  const SizedBox(width: BimSpacing.md),
                  _SocialButton(label: 'Apple', icon: Icons.apple, onTap: () => _social('apple')),
                  const SizedBox(width: BimSpacing.md),
                  _SocialButton(label: 'Facebook', icon: Icons.facebook, color: const Color(0xFF1877F2), onTap: () => _social('facebook')),
                ],
              ),
              const SizedBox(height: BimSpacing.xxl),
              // Wrap : passe à la ligne sur les écrans étroits (débordement relevé sur émulateur Android 320 dp).
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Pas encore de compte ?', style: theme.textTheme.bodyMedium),
                  TextButton(
                    onPressed: () => context.pushReplacement('/register/1'),
                    style: TextButton.styleFrom(foregroundColor: BimColors.red),
                    child: const Text('Créer un compte', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SocialButton extends StatelessWidget {
  const _SocialButton({required this.label, required this.onTap, this.icon, this.text, this.color});

  final String label;
  final VoidCallback onTap;
  final IconData? icon;
  final String? text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Expanded(
      child: Semantics(
        button: true,
        label: 'Continuer avec $label',
        child: OutlinedButton(
          onPressed: onTap,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(0, 64),
            side: BorderSide(color: scheme.outline, width: 1.5),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BimRadius.button)),
          ),
          child: icon != null
              ? Icon(icon, size: 28, color: color ?? scheme.onSurface)
              : Text(text!, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Color(0xFF4285F4))),
        ),
      ),
    );
  }
}
