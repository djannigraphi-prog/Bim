import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/registration_controller.dart';
import '../data/auth_api.dart';
import '../data/models.dart';

final interestsProvider = FutureProvider<List<Interest>>((ref) => ref.watch(authApiProvider).interests());

const _minInterests = 3;

/// Écran 05 — Inscription, étape 2 sur 2 : photo (facultative) et centres d'intérêt (au moins 3).
/// La liste des thèmes vient du serveur (administrable) ; le serveur revérifie le minimum.
class RegisterStep2Screen extends ConsumerStatefulWidget {
  const RegisterStep2Screen({super.key});

  @override
  ConsumerState<RegisterStep2Screen> createState() => _RegisterStep2ScreenState();
}

class _RegisterStep2ScreenState extends ConsumerState<RegisterStep2Screen> {
  bool _loading = false;

  static const _step1Fields = {'fullName', 'username', 'birthDate', 'city', 'phone', 'email', 'password', 'gender'};

  Future<void> _submit() async {
    setState(() => _loading = true);
    try {
      final challenge = await ref.read(authApiProvider).register(ref.read(registrationProvider));
      if (mounted) unawaited(context.push('/verify', extra: challenge));
    } on ApiException catch (e) {
      final fields = <String, String>{};
      for (final f in [..._step1Fields, 'interests']) {
        final m = e.fieldError(f);
        if (m != null) fields[f] = m;
      }
      if (e.code == 'USERNAME_TAKEN') fields['username'] = e.message;
      if (e.code == 'CONTACT_TAKEN') fields['phone'] = e.message;
      if (e.code == 'AGE_REQUIREMENT_NOT_MET') fields['birthDate'] = e.message;
      ref.read(registrationErrorsProvider.notifier).set(fields);
      if (!mounted) return;
      if (fields.keys.any(_step1Fields.contains)) {
        showBimSnack(context, 'Vérifie les informations de l’étape 1.');
        context.pop();
      } else {
        showApiError(context, e);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final selected = ref.watch(registrationProvider).interests;
    final interests = ref.watch(interestsProvider);
    final serverError = ref.watch(registrationErrorsProvider)['interests'];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
              child: StepHeader(step: 2, total: 2, onBack: () => context.pop()),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(BimSpacing.screen),
                children: [
                  _PhotoTile(onTap: () => showComingSoon(context, feature: 'L’ajout de photo de profil')),
                  const SizedBox(height: BimSpacing.xl),
                  Text('Qu’est-ce qui t’intéresse ?', style: theme.textTheme.headlineMedium),
                  const SizedBox(height: BimSpacing.xs),
                  Text.rich(
                    TextSpan(
                      text: 'Choisis au moins $_minInterests thèmes',
                      style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      children: const [TextSpan(text: ' *', style: TextStyle(color: BimColors.red, fontWeight: FontWeight.w700))],
                    ),
                  ),
                  const SizedBox(height: BimSpacing.lg),
                  interests.when(
                    loading: () => const Padding(padding: EdgeInsets.all(BimSpacing.xl), child: Center(child: CircularProgressIndicator())),
                    error: (e, _) => _RetryBox(message: e is ApiException ? e.message : ApiException.unknown.message, onRetry: () => ref.invalidate(interestsProvider)),
                    data: (items) => Wrap(
                      spacing: BimSpacing.sm,
                      runSpacing: BimSpacing.sm,
                      children: [
                        for (final i in items)
                          _InterestChip(
                            interest: i,
                            selected: selected.contains(i.code),
                            onTap: () => ref.read(registrationProvider.notifier).toggleInterest(i.code),
                          ),
                      ],
                    ),
                  ),
                  if (serverError != null) ...[
                    const SizedBox(height: BimSpacing.sm),
                    Text(serverError, style: const TextStyle(color: BimColors.red)),
                  ],
                  const SizedBox(height: BimSpacing.xl),
                  AnimatedSwitcher(
                    duration: BimDurations.normal,
                    child: selected.length >= _minInterests
                        ? _PeniBanner(key: const ValueKey('ok'), count: selected.length)
                        : const SizedBox.shrink(key: ValueKey('none')),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
              child: BimButton(
                label: 'Terminer l’inscription',
                loading: _loading,
                onPressed: selected.length >= _minInterests ? _submit : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _iconFor(String icon) => switch (icon) {
      'shirt' => Icons.checkroom_outlined,
      'dumbbell' => Icons.fitness_center,
      'sparkles' => Icons.auto_awesome_outlined,
      'flower' => Icons.local_florist_outlined,
      'scissors' => Icons.content_cut,
      'brush' => Icons.brush_outlined,
      'hand' => Icons.back_hand_outlined,
      'leaf' => Icons.eco_outlined,
      'camera' => Icons.photo_camera_outlined,
      'glasses' => Icons.diamond_outlined,
      _ => Icons.star_outline,
    };

class _InterestChip extends StatelessWidget {
  const _InterestChip({required this.interest, required this.selected, required this.onTap});

  final Interest interest;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BimRadius.chip),
        child: AnimatedContainer(
          duration: BimDurations.fast,
          constraints: const BoxConstraints(minHeight: kBimMinTouch),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? BimColors.red : scheme.surface,
            borderRadius: BorderRadius.circular(BimRadius.chip),
            border: Border.all(color: selected ? BimColors.red : scheme.outline, width: 1.5),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(_iconFor(interest.icon), size: 20, color: selected ? BimColors.white : scheme.onSurface),
              const SizedBox(width: BimSpacing.sm),
              Text(
                interest.label,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: selected ? BimColors.white : scheme.onSurface),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(BimRadius.card),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
                child: Icon(Icons.photo_camera_outlined, size: 30, color: theme.colorScheme.onSurfaceVariant),
              ),
              Positioned(
                right: -6,
                bottom: -6,
                child: Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(color: BimColors.red, borderRadius: BorderRadius.circular(8), border: Border.all(color: theme.colorScheme.surface, width: 2)),
                  child: const Icon(Icons.add, size: 16, color: BimColors.white),
                ),
              ),
            ],
          ),
          const SizedBox(width: BimSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Photo de profil', style: theme.textTheme.titleMedium),
                Text('Facultatif · tu pourras l’ajouter plus tard', style: theme.textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PeniBanner extends StatelessWidget {
  const _PeniBanner({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(BimSpacing.lg),
        decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(BimRadius.card)),
        child: Row(
          children: [
            const Peni(pose: PeniPose.happy, size: 48),
            const SizedBox(width: BimSpacing.md),
            Expanded(
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: '$count thèmes choisis ! ', style: const TextStyle(fontWeight: FontWeight.w800)),
                    const TextSpan(text: 'Ils serviront à personnaliser ton fil « Pour toi ».'),
                  ],
                ),
                style: const TextStyle(color: BimColors.black, fontSize: 15),
              ),
            ),
          ],
        ),
      );
}

class _RetryBox extends StatelessWidget {
  const _RetryBox({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Text(message, textAlign: TextAlign.center),
          TextButton(onPressed: onRetry, child: const Text('Réessayer')),
        ],
      );
}
