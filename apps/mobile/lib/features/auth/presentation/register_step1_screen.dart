import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_text_field.dart';
import '../../../core/widgets/step_header.dart';
import '../application/registration_controller.dart';

/// Écran 04 — Inscription, étape 1 sur 2 (Q13).
/// Obligatoires : nom et prénom, nom d'utilisateur, date de naissance, ville / commune, mot de passe.
/// Facultatifs : téléphone, e-mail, genre — mais au moins un téléphone ou un e-mail (F16, téléphone privilégié).
/// Écart avec la maquette : le champ « Mot de passe » est ajouté ici, la maquette n'en prévoyant pas alors que
/// la connexion (écran 03) en demande un.
class RegisterStep1Screen extends ConsumerStatefulWidget {
  const RegisterStep1Screen({super.key});

  @override
  ConsumerState<RegisterStep1Screen> createState() => _RegisterStep1ScreenState();
}

class _RegisterStep1ScreenState extends ConsumerState<RegisterStep1Screen> {
  late final TextEditingController _name;
  late final TextEditingController _username;
  late final TextEditingController _birth;
  late final TextEditingController _city;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _password;
  bool _hidden = true;
  Map<String, String> _local = {};

  @override
  void initState() {
    super.initState();
    final d = ref.read(registrationProvider);
    _name = TextEditingController(text: d.fullName);
    _username = TextEditingController(text: d.username);
    _birth = TextEditingController(text: d.birthDate == null ? '' : _format(d.birthDate!));
    _city = TextEditingController(text: d.city);
    _phone = TextEditingController(text: d.phone);
    _email = TextEditingController(text: d.email);
    _password = TextEditingController(text: d.password);
  }

  @override
  void dispose() {
    for (final c in [_name, _username, _birth, _city, _phone, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  static String _format(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final current = ref.read(registrationProvider).birthDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? DateTime(now.year - 20),
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'Date de naissance',
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) {
      ref.read(registrationProvider.notifier).update((d) => d.copyWith(birthDate: picked));
      _birth.text = _format(picked);
    }
  }

  void _continue() {
    final notifier = ref.read(registrationProvider.notifier);
    notifier.update((d) => d.copyWith(
          fullName: _name.text,
          username: _username.text.replaceFirst('@', ''),
          city: _city.text,
          phone: _phone.text,
          email: _email.text,
          password: _password.text,
        ),
    );
    final d = ref.read(registrationProvider);
    // Contrôles de confort uniquement : le serveur revalide tout et reste la référence.
    final errors = <String, String>{};
    if (d.fullName.trim().length < 2) errors['fullName'] = 'Indique ton nom et ton prénom.';
    if (d.username.trim().length < 3) errors['username'] = '3 caractères minimum.';
    if (d.birthDate == null) errors['birthDate'] = 'Indique ta date de naissance.';
    if (d.city.trim().length < 2) errors['city'] = 'Indique ta ville ou ta commune.';
    if (d.phone.trim().isEmpty && d.email.trim().isEmpty) {
      errors['phone'] = 'Indique un téléphone ou un e-mail pour pouvoir récupérer ton compte.';
    }
    if (d.password.length < 8) errors['password'] = '8 caractères minimum.';
    setState(() => _local = errors);
    if (errors.isEmpty) {
      ref.read(registrationErrorsProvider.notifier).clear();
      context.push('/register/2');
    }
  }

  @override
  Widget build(BuildContext context) {
    final draft = ref.watch(registrationProvider);
    final server = ref.watch(registrationErrorsProvider);
    String? err(String f) => _local[f] ?? server[f];
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
              child: StepHeader(step: 1, total: 2, onBack: () => context.pop()),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(BimSpacing.screen),
                children: [
                  Text('Crée ton compte', style: theme.textTheme.headlineMedium),
                  const SizedBox(height: BimSpacing.xl),
                  BimTextField(label: 'Nom et prénom', required: true, controller: _name, icon: Icons.person_outline_rounded, hint: 'Ex. Awa Koné', errorText: err('fullName'), textInputAction: TextInputAction.next, autofillHints: const [AutofillHints.name]),
                  const SizedBox(height: BimSpacing.lg),
                  BimTextField(label: 'Nom d’utilisateur', required: true, controller: _username, icon: Icons.alternate_email_rounded, hint: 'awa.kone', errorText: err('username'), textInputAction: TextInputAction.next, maxLength: 31),
                  const SizedBox(height: BimSpacing.lg),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: BimTextField(label: 'Date de naissance', required: true, controller: _birth, icon: Icons.calendar_today_outlined, hint: 'JJ/MM/AAAA', readOnly: true, onTap: _pickBirthDate, errorText: err('birthDate')),
                      ),
                      const SizedBox(width: BimSpacing.md),
                      Expanded(
                        child: BimTextField(label: 'Ville / commune', required: true, controller: _city, icon: Icons.place_outlined, hint: 'Cocody', errorText: err('city'), textInputAction: TextInputAction.next),
                      ),
                    ],
                  ),
                  const SizedBox(height: BimSpacing.xs),
                  Text('Ta date de naissance reste privée.', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(height: BimSpacing.lg),
                  BimTextField(label: 'Téléphone', optional: true, controller: _phone, icon: Icons.phone_outlined, hint: '+225 07 00 00 00 00', keyboardType: TextInputType.phone, errorText: err('phone'), textInputAction: TextInputAction.next, autofillHints: const [AutofillHints.telephoneNumber]),
                  const SizedBox(height: BimSpacing.lg),
                  BimTextField(label: 'E-mail', optional: true, controller: _email, icon: Icons.mail_outline_rounded, hint: 'nom@exemple.com', keyboardType: TextInputType.emailAddress, errorText: err('email'), textInputAction: TextInputAction.next, autofillHints: const [AutofillHints.email]),
                  const SizedBox(height: BimSpacing.xs),
                  Text(
                    'Téléphone ou e-mail : au moins l’un des deux, pour pouvoir récupérer ton compte. Le téléphone est recommandé.',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: BimSpacing.lg),
                  BimTextField(
                    label: 'Mot de passe',
                    required: true,
                    controller: _password,
                    icon: Icons.lock_outline_rounded,
                    hint: '8 caractères minimum',
                    obscure: _hidden,
                    errorText: err('password'),
                    autofillHints: const [AutofillHints.newPassword],
                    suffix: IconButton(
                      tooltip: _hidden ? 'Afficher le mot de passe' : 'Masquer le mot de passe',
                      icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      onPressed: () => setState(() => _hidden = !_hidden),
                    ),
                  ),
                  const SizedBox(height: BimSpacing.lg),
                  Row(children: [Text('Genre', style: theme.textTheme.titleMedium), const SizedBox(width: BimSpacing.sm), const OptionalBadge()]),
                  const SizedBox(height: BimSpacing.sm),
                  _GenderSelector(
                    value: draft.gender,
                    onChanged: (g) => ref.read(registrationProvider.notifier).update((d) => d.copyWith(gender: g, clearGender: g == null)),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
              child: BimButton(label: 'Continuer', variant: BimButtonVariant.dark, onPressed: _continue),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sélecteur segmenté « Femme / Homme / Ne pas dire » ; toucher l'option choisie la désélectionne (champ facultatif).
class _GenderSelector extends StatelessWidget {
  const _GenderSelector({required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const options = [('female', 'Femme'), ('male', 'Homme'), ('undisclosed', 'Ne pas dire')];
    return Container(
      padding: const EdgeInsets.all(BimSpacing.xs),
      decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.field)),
      child: Row(
        children: [
          for (final (code, label) in options)
            Expanded(
              child: Semantics(
                selected: value == code,
                button: true,
                child: GestureDetector(
                  onTap: () => onChanged(value == code ? null : code),
                  child: AnimatedContainer(
                    duration: BimDurations.fast,
                    height: kBimMinTouch,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: value == code ? scheme.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(BimRadius.chip),
                      boxShadow: value == code ? const [BoxShadow(color: Color(0x14000000), blurRadius: 8)] : null,
                    ),
                    child: Text(
                      label,
                      style: TextStyle(
                        fontWeight: value == code ? FontWeight.w700 : FontWeight.w500,
                        color: value == code ? scheme.onSurface : scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
