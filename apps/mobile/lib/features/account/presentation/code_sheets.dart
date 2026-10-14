import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../auth/data/models.dart';
import '../data/account_api.dart';

String _where(Challenge c) {
  final how = switch (c.channel) {
    'phone' => 'par SMS',
    'email' => 'par e-mail',
    _ => '',
  };
  return '$how${c.destination != null ? ' au ${c.destination}' : ''}';
}

/// Demande un code à 6 chiffres envoyé pour [challenge]. [submit] renvoie null si le code est accepté,
/// sinon le message d'erreur à afficher.
Future<bool> askCode(BuildContext context, {required String title, required Challenge challenge, required Future<String?> Function(String code) submit}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _CodeSheet(title: title, challenge: challenge, submit: submit),
  );
  return ok ?? false;
}

class _CodeSheet extends StatefulWidget {
  const _CodeSheet({required this.title, required this.challenge, required this.submit});

  final String title;
  final Challenge challenge;
  final Future<String?> Function(String code) submit;

  @override
  State<_CodeSheet> createState() => _CodeSheetState();
}

class _CodeSheetState extends State<_CodeSheet> {
  final _code = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    if (_code.text.length != 6 || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await widget.submit(_code.text);
    if (!mounted) return;
    if (err == null) {
      Navigator.pop(context, true);
    } else {
      setState(() {
        _busy = false;
        _error = err;
        _code.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, MediaQuery.viewInsetsOf(context).bottom + BimSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Peni(pose: PeniPose.think, size: 72),
          const SizedBox(height: BimSpacing.sm),
          Text(widget.title, style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: BimSpacing.xs),
          Text('Code à 6 chiffres envoyé ${_where(widget.challenge)}.', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
          const SizedBox(height: BimSpacing.lg),
          TextField(
            key: const Key('code-field'),
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            maxLength: 6,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 10),
            decoration: InputDecoration(counterText: '', hintText: '••••••', errorText: _error, errorMaxLines: 3),
            onChanged: (v) {
              if (v.length == 6) _go();
            },
          ),
          const SizedBox(height: BimSpacing.md),
          BimButton(label: 'Valider', loading: _busy, onPressed: _go),
        ],
      ),
    );
  }
}

/// Opération sensible (F16) : mot de passe, puis code reçu sur une coordonnée déjà vérifiée.
/// Renvoie l'autorisation à usage unique, ou null si la personne annule.
Future<String?> requestStepUp(BuildContext context, WidgetRef ref, StepUpScope scope) async {
  final api = ref.read(accountApiProvider);
  final challenge = await showModalBottomSheet<Challenge>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _PasswordSheet(scope: scope, api: api),
  );
  if (challenge == null || !context.mounted) return null;
  String? token;
  await askCode(
    context,
    title: 'Confirme que c’est bien toi',
    challenge: challenge,
    submit: (code) async {
      try {
        token = await api.completeStepUp(challenge.challengeId, code);
        return null;
      } on ApiException catch (e) {
        return e.message;
      }
    },
  );
  return token;
}

class _PasswordSheet extends StatefulWidget {
  const _PasswordSheet({required this.scope, required this.api});

  final StepUpScope scope;
  final AccountApi api;

  @override
  State<_PasswordSheet> createState() => _PasswordSheetState();
}

class _PasswordSheetState extends State<_PasswordSheet> {
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    if (_password.text.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final c = await widget.api.startStepUp(widget.scope, _password.text);
      if (mounted) Navigator.pop(context, c);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(BimSpacing.xl, 0, BimSpacing.xl, MediaQuery.viewInsetsOf(context).bottom + BimSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Opération protégée', style: theme.textTheme.titleLarge),
          const SizedBox(height: BimSpacing.xs),
          Text(
            'Pour protéger ton compte, saisis ton mot de passe. Un code te sera ensuite envoyé sur une coordonnée déjà vérifiée.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: BimSpacing.lg),
          TextField(
            key: const Key('stepup-password'),
            controller: _password,
            obscureText: true,
            autofocus: true,
            autofillHints: const [AutofillHints.password],
            decoration: InputDecoration(hintText: 'Mot de passe', errorText: _error),
            onSubmitted: (_) => _go(),
          ),
          const SizedBox(height: BimSpacing.md),
          BimButton(label: 'Recevoir un code', variant: BimButtonVariant.dark, loading: _busy, onPressed: _go),
        ],
      ),
    );
  }
}
