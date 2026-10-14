import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_text_field.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../data/auth_api.dart';
import '../data/models.dart';

/// Écran ajouté (absent des maquettes) — « Mot de passe oublié ? » de l'écran 03.
/// 1) identifiant → code envoyé sur une coordonnée vérifiée (téléphone privilégié, F16) ;
/// 2) code + nouveau mot de passe. Le message est identique que le compte existe ou non.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _identifier = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  Challenge? _challenge;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _request() async {
    if (_identifier.text.trim().isEmpty) return;
    setState(() => _loading = true);
    try {
      final c = await ref.read(authApiProvider).forgotPassword(_identifier.text.trim());
      if (!mounted) return;
      setState(() {
        _challenge = c;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _reset() async {
    setState(() => _loading = true);
    try {
      await ref.read(authApiProvider).resetPassword(_challenge!.challengeId, _code.text, _password.text);
      if (!mounted) return;
      showBimSnack(context, 'Mot de passe modifié. Connecte-toi avec ton nouveau mot de passe.');
      context.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.fieldError('newPassword') ?? e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final step2 = _challenge != null;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.xl),
            Text('Mot de passe oublié', style: theme.textTheme.headlineMedium),
            const SizedBox(height: BimSpacing.sm),
            Text(
              step2
                  ? 'Si un compte correspond, un code vient d’être envoyé sur son téléphone ou son e-mail vérifié.'
                  : 'Indique ton e-mail, ton téléphone ou ton nom d’utilisateur.',
              style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: BimSpacing.xl),
            if (!step2) ...[
              BimTextField(controller: _identifier, hint: 'E-mail, téléphone ou @nom d’utilisateur', icon: Icons.person_outline_rounded, errorText: _error),
              const SizedBox(height: BimSpacing.xl),
              BimButton(label: 'Recevoir un code', variant: BimButtonVariant.dark, loading: _loading, onPressed: _request),
            ] else ...[
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(hintText: 'Code à 6 chiffres', counterText: '', prefixIcon: Icon(Icons.pin_outlined)),
              ),
              const SizedBox(height: BimSpacing.md),
              BimTextField(controller: _password, hint: 'Nouveau mot de passe (8 caractères minimum)', icon: Icons.lock_outline_rounded, obscure: true, errorText: _error, autofillHints: const [AutofillHints.newPassword]),
              const SizedBox(height: BimSpacing.xl),
              BimButton(label: 'Changer mon mot de passe', loading: _loading, onPressed: _reset),
            ],
          ],
        ),
      ),
    );
  }
}
