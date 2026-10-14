import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/bim_button.dart';
import '../../../core/widgets/bim_icons.dart';
import '../../../core/widgets/bim_text_field.dart';
import '../../../core/widgets/brand.dart';
import '../../../core/widgets/feedback.dart';
import '../../../core/widgets/step_header.dart';
import '../application/projects_providers.dart';
import '../data/projects_api.dart';
import '../data/projects_models.dart';
import 'project_widgets.dart';

/// Écrans 19 à 23 — « Nouveau projet », en 5 étapes. Le programme est créé par le serveur à la fin (écran 24).
class NewProjectScreen extends ConsumerStatefulWidget {
  const NewProjectScreen({super.key});

  @override
  ConsumerState<NewProjectScreen> createState() => _NewProjectScreenState();
}

class _NewProjectScreenState extends ConsumerState<NewProjectScreen> {
  int _step = 1;
  bool _loading = false;
  String? _error;
  Map<String, String> _fieldErrors = {};

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(projectDraftProvider.notifier).reset());
  }

  void _update(ProjectDraft Function(ProjectDraft d) f) => ref.read(projectDraftProvider.notifier).update(f);

  bool _canContinue(ProjectDraft d, ProjectCatalog c) {
    switch (_step) {
      case 1:
        return d.mode == 'eco' || (d.mode == 'premium' && d.budget != null);
      case 2:
        return d.categoryCode != null;
      case 3:
        final cat = c.categories.where((x) => x.code == d.categoryCode).firstOrNull;
        final goal = cat?.goals.where((g) => g.code == d.goalCode).firstOrNull;
        if (goal != null) return goal.quantityUnit == null || d.targetQuantity != null;
        return d.description.trim().length >= 3;
      default:
        return true;
    }
  }

  void _back() {
    if (_step == 1) {
      context.pop();
    } else {
      setState(() => _step--);
    }
  }

  Future<void> _create(ProjectCatalog catalog) async {
    final d = ref.read(projectDraftProvider);
    final cat = catalog.categories.firstWhere((c) => c.code == d.categoryCode);
    final draft = cat.hasValidatedPrograms || d.durationDays != null ? d : d.copyWith(durationDays: catalog.durationsDays.first);
    setState(() {
      _loading = true;
      _error = null;
      _fieldErrors = {};
    });
    try {
      final project = await ref.read(projectsApiProvider).create(draft);
      ref.invalidate(myProjectsProvider);
      if (mounted) unawaited(context.pushReplacement('/projects/${project.summary.id}/program'));
    } on ApiException catch (e) {
      final fields = <String, String>{};
      for (final f in ['budget', 'categoryCode', 'goalCode', 'targetQuantity', 'description', 'durationDays', 'heightCm', 'weightKg', 'healthNote']) {
        final m = e.fieldError(f);
        if (m != null) fields[f] = m;
      }
      setState(() {
        _fieldErrors = fields;
        _error = fields.isEmpty ? e.message : fields.values.first;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(projectCatalogProvider);
    final draft = ref.watch(projectDraftProvider);
    return PopScope(
      canPop: _step == 1,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        body: SafeArea(
          child: catalog.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(BimSpacing.xl),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(e is ApiException ? e.message : ApiException.unknown.message, textAlign: TextAlign.center),
                    const SizedBox(height: BimSpacing.lg),
                    BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(projectCatalogProvider)),
                  ],
                ),
              ),
            ),
            data: (c) => Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(BimSpacing.screen, BimSpacing.sm, BimSpacing.screen, 0),
                  child: StepHeader(
                    step: _step,
                    total: 5,
                    title: 'Nouveau projet · $_step/5',
                    onBack: _back,
                    trailing: IconButton(tooltip: 'Fermer', icon: const Icon(Icons.close_rounded), onPressed: () => context.pop()),
                  ),
                ),
                Expanded(
                  child: switch (_step) {
                    1 => _ModeStep(draft: draft, catalog: c, onChanged: _update),
                    2 => _CategoryStep(draft: draft, catalog: c, onChanged: _update),
                    3 => _GoalStep(draft: draft, catalog: c, onChanged: _update),
                    4 => const _PhotoStep(),
                    _ => _QuestionsStep(draft: draft, catalog: c, onChanged: _update, errors: _fieldErrors),
                  },
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_error != null && _step == 5)
                        Padding(
                          padding: const EdgeInsets.only(bottom: BimSpacing.sm),
                          child: Text(_error!, style: const TextStyle(color: BimColors.red), textAlign: TextAlign.center),
                        ),
                      if (_step == 4)
                        BimButton(label: 'Passer cette étape', variant: BimButtonVariant.subtle, onPressed: () => setState(() => _step = 5))
                      else if (_step == 5)
                        BimButton(label: 'Créer mon programme', loading: _loading, onPressed: () => _create(c))
                      else
                        BimButton(
                          label: 'Continuer',
                          variant: BimButtonVariant.dark,
                          onPressed: _canContinue(draft, c) ? () => setState(() => _step++) : null,
                        ),
                      if (_step == 1)
                        TextButton.icon(
                          onPressed: () => showComingSoon(context, feature: 'La discussion avec Peni'),
                          icon: const Peni(pose: PeniPose.happy, size: 28),
                          label: const Text('Je préfère en parler avec Peni'),
                          style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.onSurface, minimumSize: const Size(0, kBimMinTouch)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

typedef _Update = void Function(ProjectDraft Function(ProjectDraft d) f);

class _StepBody extends StatelessWidget {
  const _StepBody({required this.title, this.subtitle, required this.children, this.badge});

  final String title;
  final String? subtitle;
  final Widget? badge;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        if (badge != null) ...[Align(alignment: Alignment.centerLeft, child: badge), const SizedBox(height: BimSpacing.sm)],
        Text(title, style: theme.textTheme.headlineMedium),
        if (subtitle != null) ...[
          const SizedBox(height: BimSpacing.xs),
          Text(subtitle!, style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ],
        const SizedBox(height: BimSpacing.xl),
        ...children,
      ],
    );
  }
}

// ------------------------------------------------------------------ Écran 19

class _ModeStep extends StatelessWidget {
  const _ModeStep({required this.draft, required this.catalog, required this.onChanged});

  final ProjectDraft draft;
  final ProjectCatalog catalog;
  final _Update onChanged;

  @override
  Widget build(BuildContext context) {
    const budgets = [('small', 'Petit'), ('medium', 'Moyen'), ('boosted', 'Boosté')];
    return _StepBody(
      title: 'Comment veux-tu avancer ?',
      subtitle: 'Tu pourras changer de mode plus tard.',
      children: [
        _ModeCard(
          icon: Icons.eco_outlined,
          iconColor: BimColors.success,
          title: 'Mode Éco',
          badge: 'Gratuit',
          text: 'Astuces maison, programmes connus qui marchent, conseils de Peni. Aucun achat.',
          selected: draft.mode == 'eco',
          onTap: () => onChanged((d) => d.copyWith(mode: 'eco', clearBudget: true)),
        ),
        const SizedBox(height: BimSpacing.md),
        _ModeCard(
          icon: Icons.workspace_premium_outlined,
          iconColor: BimColors.red,
          title: 'Mode Premium',
          text: 'Produits, salle de sport, coach ou soins recommandés par des marchands vérifiés. '
              'Les achats se font sur le BimShop, jamais dans le projet.',
          selected: draft.mode == 'premium',
          onTap: () => onChanged((d) => d.copyWith(mode: 'premium')),
          footer: draft.mode != 'premium'
              ? null
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Divider(height: BimSpacing.xl),
                    Text('Ton budget indicatif', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: BimSpacing.sm),
                    Row(
                      children: [
                        for (final (code, label) in budgets) ...[
                          Expanded(
                            child: _BudgetButton(
                              label: label,
                              hint: catalog.budgetTiers[code] ?? '',
                              selected: draft.budget == code,
                              onTap: () => onChanged((d) => d.copyWith(budget: code)),
                            ),
                          ),
                          if (code != 'boosted') const SizedBox(width: BimSpacing.sm),
                        ],
                      ],
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.text,
    required this.selected,
    required this.onTap,
    this.badge,
    this.footer,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String text;
  final String? badge;
  final bool selected;
  final VoidCallback onTap;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BimRadius.card),
        child: AnimatedContainer(
          duration: BimDurations.fast,
          padding: const EdgeInsets.all(BimSpacing.lg),
          decoration: BoxDecoration(
            color: selected ? BimColors.redSoft.withValues(alpha: theme.brightness == Brightness.dark ? 0.15 : 0.5) : scheme.surface,
            borderRadius: BorderRadius.circular(BimRadius.card),
            border: Border.all(color: selected ? BimColors.red : scheme.outline, width: selected ? 2 : 1.5),
          ),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(color: iconColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(BimRadius.chip)),
                    child: Icon(icon, color: iconColor),
                  ),
                  const SizedBox(width: BimSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: BimSpacing.sm,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(title, style: theme.textTheme.titleLarge),
                            if (badge != null)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: BimColors.success.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                                child: Text(badge!, style: const TextStyle(color: BimColors.success, fontWeight: FontWeight.w700, fontSize: 13)),
                              ),
                          ],
                        ),
                        const SizedBox(height: BimSpacing.xs),
                        Text(text, style: theme.textTheme.bodyMedium),
                      ],
                    ),
                  ),
                  const SizedBox(width: BimSpacing.sm),
                  Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off, color: selected ? BimColors.red : scheme.outline),
                ],
              ),
              if (footer != null) footer!,
            ],
          ),
        ),
      ),
    );
  }
}

class _BudgetButton extends StatelessWidget {
  const _BudgetButton({required this.label, required this.hint, required this.selected, required this.onTap});

  final String label;
  final String hint;
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
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? scheme.onSurface : scheme.surface,
            borderRadius: BorderRadius.circular(BimRadius.chip),
            border: Border.all(color: selected ? scheme.onSurface : scheme.outline),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: TextStyle(fontWeight: FontWeight.w700, color: selected ? scheme.surface : scheme.onSurface)),
              if (hint.isNotEmpty)
                FittedBox(
                  child: Text(hint, style: TextStyle(fontSize: 12, color: selected ? scheme.surface : scheme.onSurfaceVariant)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ Écran 20

class _CategoryStep extends StatelessWidget {
  const _CategoryStep({required this.draft, required this.catalog, required this.onChanged});

  final ProjectDraft draft;
  final ProjectCatalog catalog;
  final _Update onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return _StepBody(
      title: 'Sur quoi veux-tu travailler ?',
      subtitle: 'Choisis une catégorie.',
      children: [
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: BimSpacing.md,
          crossAxisSpacing: BimSpacing.md,
          childAspectRatio: 1.3,
          children: [
            for (final c in catalog.categories)
              _CategoryTile(
                category: c,
                tint: dark ? scheme.surfaceContainerLow : hexColor(c.tint, scheme.surfaceContainerLow),
                selected: draft.categoryCode == c.code,
                onTap: () => onChanged((d) => d.copyWith(categoryCode: c.code, clearGoal: d.categoryCode != c.code)),
              ),
            InkWell(
              borderRadius: BorderRadius.circular(BimRadius.card),
              onTap: () => showComingSoon(context, feature: 'L’aide de Peni pour choisir'),
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(BimRadius.card),
                  border: Border.all(color: scheme.outline, width: 1.5),
                ),
                padding: const EdgeInsets.all(BimSpacing.md),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Peni(pose: PeniPose.think, size: 44),
                    const SizedBox(height: BimSpacing.xs),
                    Text('Pas sûr ? Demande à Peni', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({required this.category, required this.tint, required this.selected, required this.onTap});

  final ProjectCategory category;
  final Color tint;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      selected: selected,
      button: true,
      label: category.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BimRadius.card),
        child: AnimatedContainer(
          duration: BimDurations.fast,
          padding: const EdgeInsets.all(BimSpacing.md),
          decoration: BoxDecoration(
            color: tint,
            borderRadius: BorderRadius.circular(BimRadius.card),
            border: Border.all(color: selected ? BimColors.red : Colors.transparent, width: 2),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CategoryIcon(icon: category.icon, size: 44, background: scheme.surface),
                  const Spacer(),
                  if (selected) const Icon(Icons.check_circle, color: BimColors.red),
                ],
              ),
              const Spacer(),
              Text(category.label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700), maxLines: 2),
            ],
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ Écran 21

class _GoalStep extends StatefulWidget {
  const _GoalStep({required this.draft, required this.catalog, required this.onChanged});

  final ProjectDraft draft;
  final ProjectCatalog catalog;
  final _Update onChanged;

  @override
  State<_GoalStep> createState() => _GoalStepState();
}

class _GoalStepState extends State<_GoalStep> {
  late final _description = TextEditingController(text: widget.draft.description);

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final d = widget.draft;
    final cat = widget.catalog.categories.firstWhere((c) => c.code == d.categoryCode);
    final goal = cat.goals.where((g) => g.code == d.goalCode).firstOrNull;
    return _StepBody(
      title: 'Quel est ton objectif ?',
      badge: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: BimColors.redSoft, borderRadius: BorderRadius.circular(8)),
        child: Text(cat.label, style: const TextStyle(color: BimColors.red, fontWeight: FontWeight.w700)),
      ),
      children: [
        if (cat.goals.isNotEmpty) ...[
          Wrap(
            spacing: BimSpacing.sm,
            runSpacing: BimSpacing.sm,
            children: [
              for (final g in cat.goals)
                ChoiceChipBim(
                  label: g.label,
                  selected: g.code == d.goalCode,
                  onTap: () => widget.onChanged(
                    (x) => g.code == x.goalCode
                        ? x.copyWith(clearGoal: true)
                        : x.copyWith(clearGoal: true).copyWith(
                              goalCode: g.code,
                              targetQuantity: g.quantityUnit == null ? null : ((g.quantityMin ?? 1) + (g.quantityMax ?? 10)) ~/ 3,
                            ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: BimSpacing.lg),
        ],
        if (goal?.quantityUnit != null) ...[
          Container(
            padding: const EdgeInsets.all(BimSpacing.lg),
            decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(child: Text('Combien de ${goal!.quantityUnit} ?', style: theme.textTheme.titleMedium)),
                    Text(
                      '${goal.code.contains('perte') ? '−' : '+'}${d.targetQuantity ?? goal.quantityMin} ${goal.quantityUnit}',
                      style: const TextStyle(color: BimColors.red, fontSize: 22, fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
                Slider(
                  value: (d.targetQuantity ?? goal.quantityMin ?? 1).toDouble(),
                  min: (goal.quantityMin ?? 1).toDouble(),
                  max: (goal.quantityMax ?? 30).toDouble(),
                  divisions: (goal.quantityMax ?? 30) - (goal.quantityMin ?? 1),
                  activeColor: BimColors.red,
                  label: '${d.targetQuantity} ${goal.quantityUnit}',
                  onChanged: (v) => widget.onChanged((x) => x.copyWith(targetQuantity: v.round())),
                ),
              ],
            ),
          ),
          const SizedBox(height: BimSpacing.lg),
        ],
        BimTextField(
          label: cat.goals.isEmpty ? 'Décris ton objectif' : 'Ou décris ton objectif',
          optional: cat.goals.isNotEmpty,
          required: cat.goals.isEmpty,
          controller: _description,
          hint: 'Ex. : perdre du ventre avant mon mariage en décembre…',
          maxLength: 500,
          onChanged: (v) => widget.onChanged((x) => x.copyWith(description: v)),
        ),
        const SizedBox(height: BimSpacing.lg),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: BimSpacing.lg, vertical: BimSpacing.sm),
          decoration: BoxDecoration(border: Border.all(color: scheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.card)),
          child: SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: d.receiveMerchantOffers,
            activeTrackColor: BimColors.red,
            onChanged: (v) => widget.onChanged((x) => x.copyWith(receiveMerchantOffers: v)),
            title: Text('Recevoir les offres des marchands', style: theme.textTheme.titleMedium),
            subtitle: const Text('Ton choix est enregistré. Les offres arriveront avec le BimShop.'),
          ),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ Écran 22

class _PhotoStep extends StatelessWidget {
  const _PhotoStep();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return _StepBody(
      title: 'Ta photo « avant »',
      subtitle: 'Facultatif · elle reste privée. À la fin, on la compare avec ta photo « après ».',
      children: [
        Container(
          height: 300,
          decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(BimRadius.card)),
          padding: const EdgeInsets.all(BimSpacing.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.lock_outline_rounded, color: scheme.onSurfaceVariant),
              const SizedBox(height: BimSpacing.sm),
              Icon(Icons.person_outline_rounded, size: 96, color: scheme.outline),
              const SizedBox(height: BimSpacing.lg),
              Text(
                'La prise de photo arrive dans une prochaine version. Tu pourras l’ajouter à ce projet à ce moment-là.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ Écran 23

class _QuestionsStep extends StatefulWidget {
  const _QuestionsStep({required this.draft, required this.catalog, required this.onChanged, required this.errors});

  final ProjectDraft draft;
  final ProjectCatalog catalog;
  final _Update onChanged;
  final Map<String, String> errors;

  @override
  State<_QuestionsStep> createState() => _QuestionsStepState();
}

class _QuestionsStepState extends State<_QuestionsStep> {
  late final _height = TextEditingController(text: widget.draft.heightCm?.toString() ?? '');
  late final _weight = TextEditingController(text: widget.draft.weightKg?.toString() ?? '');
  late final _health = TextEditingController(text: widget.draft.healthNote);

  @override
  void dispose() {
    _height.dispose();
    _weight.dispose();
    _health.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = widget.draft;
    final cat = widget.catalog.categories.firstWhere((c) => c.code == d.categoryCode);
    final digits = [FilteringTextInputFormatter.digitsOnly];
    const levels = [('beginner', 'Débutant'), ('intermediate', 'Intermédiaire'), ('advanced', 'Avancé')];
    const slots = [('morning', 'Matin', Icons.wb_sunny_outlined), ('noon', 'Midi', Icons.schedule), ('afternoon', 'Après-midi', Icons.wb_twilight)];
    Widget label(String text) => Padding(
          padding: const EdgeInsets.only(top: BimSpacing.lg, bottom: BimSpacing.sm),
          child: Text(text, style: theme.textTheme.titleMedium),
        );
    final duration = d.durationDays ?? widget.catalog.durationsDays.first;
    return _StepBody(
      title: 'Dernières questions',
      subtitle: 'Pour un programme fait pour toi.',
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: BimTextField(
                label: 'Taille (cm)',
                optional: true,
                controller: _height,
                hint: '172',
                keyboardType: TextInputType.number,
                inputFormatters: digits,
                errorText: widget.errors['heightCm'],
                onChanged: (v) => widget.onChanged((x) => int.tryParse(v) == null ? x.copyWith(clearHeight: true) : x.copyWith(heightCm: int.parse(v))),
              ),
            ),
            const SizedBox(width: BimSpacing.md),
            Expanded(
              child: BimTextField(
                label: 'Poids (kg)',
                optional: true,
                controller: _weight,
                hint: '84',
                keyboardType: TextInputType.number,
                inputFormatters: digits,
                errorText: widget.errors['weightKg'],
                onChanged: (v) => widget.onChanged((x) => int.tryParse(v) == null ? x.copyWith(clearWeight: true) : x.copyWith(weightKg: int.parse(v))),
              ),
            ),
          ],
        ),
        label('Ton niveau'),
        Wrap(
          spacing: BimSpacing.sm,
          runSpacing: BimSpacing.sm,
          children: [
            for (final (code, text) in levels)
              ChoiceChipBim(label: text, selected: d.level == code, onTap: () => widget.onChanged((x) => x.copyWith(level: code))),
          ],
        ),
        label('Quand es-tu disponible ?'),
        Wrap(
          spacing: BimSpacing.sm,
          runSpacing: BimSpacing.sm,
          children: [
            for (final (code, text, icon) in slots)
              ChoiceChipBim(
                label: text,
                icon: icon,
                selected: d.availability == code,
                onTap: () => widget.onChanged((x) => x.copyWith(availability: code)),
              ),
          ],
        ),
        label('Séances par semaine'),
        Wrap(
          spacing: BimSpacing.sm,
          runSpacing: BimSpacing.sm,
          children: [
            for (var n = 1; n <= 7; n++)
              ChoiceChipBim(label: '$n', selected: d.sessionsPerWeek == n, onTap: () => widget.onChanged((x) => x.copyWith(sessionsPerWeek: n))),
          ],
        ),
        if (!cat.hasValidatedPrograms) ...[
          label('Durée du programme'),
          Wrap(
            spacing: BimSpacing.sm,
            runSpacing: BimSpacing.sm,
            children: [
              for (final days in widget.catalog.durationsDays)
                ChoiceChipBim(label: '$days jours', selected: duration == days, onTap: () => widget.onChanged((x) => x.copyWith(durationDays: days))),
            ],
          ),
        ],
        label('Un problème de santé à signaler ?'),
        BimTextField(
          controller: _health,
          hint: 'Ex. : douleur au genou, asthme…',
          maxLength: 300,
          errorText: widget.errors['healthNote'],
          onChanged: (v) => widget.onChanged((x) => x.copyWith(healthNote: v)),
        ),
        const SizedBox(height: BimSpacing.xs),
        Text(
          'Cette information reste privée. BIM ne donne pas d’avis médical : en cas de doute, demande conseil à un professionnel de santé.',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
