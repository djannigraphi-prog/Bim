import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/registration_controller.dart';
import '../application/session_controller.dart';
import '../data/auth_api.dart';
import '../data/models.dart';

/// Écran ajouté (absent des maquettes) — saisie du code reçu par SMS ou e-mail pour activer le compte (F16).
/// Même style que les écrans 03-05. Le renvoi n'est possible qu'après le délai fixé par le serveur.
class VerifyCodeScreen extends ConsumerStatefulWidget {
  const VerifyCodeScreen({super.key, required this.challenge});

  final Challenge challenge;

  @override
  ConsumerState<VerifyCodeScreen> createState() => _VerifyCodeScreenState();
}

class _VerifyCodeScreenState extends ConsumerState<VerifyCodeScreen> {
  final _code = TextEditingController();
  late Challenge _challenge = widget.challenge;
  bool _loading = false;
  String? _error;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _code.dispose();
    super.dispose();
  }

  int get _secondsBeforeResend => _challenge.resendAvailableAt.difference(DateTime.now()).inSeconds.clamp(0, 600);

  Future<void> _verify() async {
    if (_code.text.length != 6) {
      setState(() => _error = 'Le code contient 6 chiffres.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    // Conteneur capturé avant les attentes : l'inscription est effacée même si l'écran a été fermé entre-temps.
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final result = await ref.read(authApiProvider).verifySignup(_challenge.challengeId, _code.text);
      await container.read(sessionProvider.notifier).completeSignIn(result);
      container.read(registrationProvider.notifier).reset();
      container.read(registrationErrorsProvider.notifier).clear();
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resend() async {
    try {
      final next = await ref.read(authApiProvider).resend(_challenge.challengeId);
      if (!mounted) return;
      setState(() {
        _challenge = next;
        _error = null;
      });
      if (mounted) showBimSnack(context, 'Nouveau code envoyé.');
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final where = switch (_challenge.channel) {
      'phone' => 'par SMS',
      'email' => 'par e-mail',
      _ => 'par SMS ou par e-mail',
    };
    final wait = _secondsBeforeResend;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
            const SizedBox(height: BimSpacing.xl),
            const Center(child: Peni(pose: PeniPose.wave, size: 96)),
            const SizedBox(height: BimSpacing.lg),
            Text('Entre ton code', style: theme.textTheme.headlineMedium, textAlign: TextAlign.center),
            const SizedBox(height: BimSpacing.sm),
            Text(
              'Je t’ai envoyé un code à 6 chiffres $where${_challenge.destination != null ? ' au ${_challenge.destination}' : ''}.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: BimSpacing.xl),
            TextField(
              controller: _code,
              autofocus: true,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              maxLength: 6,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: 12),
              decoration: InputDecoration(counterText: '', hintText: '••••••', errorText: _error, errorMaxLines: 3),
              onChanged: (v) {
                if (v.length == 6 && !_loading) _verify();
              },
            ),
            const SizedBox(height: BimSpacing.xl),
            BimButton(label: 'Valider', loading: _loading, onPressed: _verify),
            const SizedBox(height: BimSpacing.md),
            Center(
              child: TextButton(
                onPressed: wait == 0 ? _resend : null,
                style: TextButton.styleFrom(foregroundColor: BimColors.red, minimumSize: const Size(0, kBimMinTouch)),
                child: Text(wait == 0 ? 'Renvoyer le code' : 'Renvoyer le code dans $wait s'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
