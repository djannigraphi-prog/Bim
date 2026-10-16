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
import '../../account/presentation/code_sheets.dart';
import '../data/merchant_api.dart';

/// Lot 5-A — Ouvrir une boutique (écrans 07, 08, 09) : la boutique, puis « Sécurise ta boutique » (pièce d'identité,
/// selfie, numéro Mobile Money confirmé par SMS, adresse facultative), puis la vérification par l'équipe BIM.
/// Aucune vérification automatique du visage : une personne de l'équipe compare le selfie à la pièce d'identité.
class MerchantApplyScreen extends ConsumerWidget {
  const MerchantApplyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myApplicationProvider);
    return Scaffold(
      body: SafeArea(
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _Message(
            pose: PeniPose.sad,
            title: 'Impossible de charger ta demande',
            text: e is ApiException ? e.message : ApiException.unknown.message,
            action: BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => ref.invalidate(myApplicationProvider)),
          ),
          data: (r) {
            final a = r.application;
            if (!r.available) {
              return const _Message(pose: PeniPose.think, title: 'Bientôt disponible', text: 'L’ouverture des boutiques n’est pas encore disponible sur ce serveur.');
            }
            if (a == null) return const _ShopForm();
            return switch (a.status) {
              'submitted' => _Pending(application: a),
              'approved' => _Approved(application: a),
              _ => _Checklist(application: a),
            };
          },
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.pose, required this.title, required this.text, this.action});

  final PeniPose pose;
  final String title;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
        const SizedBox(height: BimSpacing.xxl),
        Peni(pose: pose, size: 120),
        const SizedBox(height: BimSpacing.lg),
        Text(title, textAlign: TextAlign.center, style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
        const SizedBox(height: BimSpacing.sm),
        Text(text, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
        if (action != null) ...[const SizedBox(height: BimSpacing.xl), action!],
      ],
    );
  }
}

/// Étape 1 : la boutique.
class _ShopForm extends ConsumerStatefulWidget {
  const _ShopForm();

  @override
  ConsumerState<_ShopForm> createState() => _ShopFormState();
}

class _ShopFormState extends ConsumerState<_ShopForm> {
  final _name = TextEditingController();
  final _city = TextEditingController(text: 'Abidjan');
  final _commune = TextEditingController();
  final _description = TextEditingController();
  bool _sending = false;
  ApiException? _error;

  @override
  void dispose() {
    for (final c in [_name, _city, _commune, _description]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _create() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(merchantApiProvider).create(name: _name.text.trim(), city: _city.text.trim(), commune: _commune.text.trim(), description: _description.text.trim());
      ref.invalidate(myApplicationProvider);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final e = _error;
    if (e != null && (e.code == 'RULE_NOT_DECIDED' || e.code == 'AGE_REQUIREMENT_NOT_MET')) {
      return _Message(
        pose: PeniPose.think,
        title: e.code == 'RULE_NOT_DECIDED' ? 'Bientôt disponible' : 'Pas encore possible',
        text: e.code == 'RULE_NOT_DECIDED' ? 'L’ouverture des boutiques arrive bientôt sur BIM. Merci pour ta patience !' : e.message,
      );
    }
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        const StepHeader(step: 1, total: 2, title: 'Nouvelle boutique'),
        const SizedBox(height: BimSpacing.lg),
        Text('Présente ta boutique', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
        const SizedBox(height: BimSpacing.xs),
        Text('Tu pourras modifier ces informations plus tard.', style: theme.textTheme.bodyMedium),
        const SizedBox(height: BimSpacing.lg),
        BimTextField(key: const ValueKey('shop-name'), label: 'Nom de la boutique', controller: _name, required: true, maxLength: 80, errorText: e?.fieldError('name'), onChanged: (_) => setState(() {})),
        const SizedBox(height: BimSpacing.md),
        BimTextField(label: 'Ville', controller: _city, required: true, maxLength: 80, errorText: e?.fieldError('city')),
        const SizedBox(height: BimSpacing.md),
        BimTextField(label: 'Commune ou quartier', controller: _commune, optional: true, maxLength: 80),
        const SizedBox(height: BimSpacing.md),
        BimTextField(label: 'Ce que tu proposes', hint: 'Robes de soirée, tenues corporate…', controller: _description, optional: true, maxLength: 300),
        if (e != null && e.fieldError('name') == null && e.fieldError('city') == null) ...[
          const SizedBox(height: BimSpacing.md),
          Text(e.message, style: const TextStyle(color: BimColors.red)),
        ],
        const SizedBox(height: BimSpacing.xl),
        BimButton(label: 'Continuer', loading: _sending, onPressed: _name.text.trim().length < 2 ? null : _create),
      ],
    );
  }
}

/// Écran 07 — « Sécurise ta boutique ».
class _Checklist extends ConsumerStatefulWidget {
  const _Checklist({required this.application});

  final MerchantApplication application;

  @override
  ConsumerState<_Checklist> createState() => _ChecklistState();
}

class _ChecklistState extends ConsumerState<_Checklist> {
  bool _busy = false;

  MerchantApplication get a => widget.application;

  Future<void> _run(Future<void> Function() job) async {
    setState(() => _busy = true);
    try {
      await job();
      ref.invalidate(myApplicationProvider);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _identity() async {
    final type = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(title: Text('Quelle pièce d’identité ?', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('Elle reste privée, chiffrée, vue seulement par l’équipe BIM.')),
            for (final (code, label) in const [('cni', 'Carte nationale d’identité'), ('passport', 'Passeport'), ('permis', 'Permis de conduire')])
              ListTile(key: ValueKey('doc-$code'), leading: const Icon(Icons.badge_outlined), title: Text(label), onTap: () => Navigator.pop(ctx, code)),
          ],
        ),
      ),
    );
    if (type == null || !mounted) return;
    await _run(() async {
      final api = ref.read(merchantApiProvider);
      await api.update(a.id, idDocType: type);
      for (final (kind, label) in [('id_front', 'le recto'), if (type != 'passport') ('id_back', 'le verso')]) {
        if (!mounted) return;
        final camera = await _askSource('Photographie $label de ta pièce');
        if (camera == null) return;
        final bytes = await ref.read(kycPhotoSourceProvider).document(camera: camera);
        if (bytes == null) return;
        await api.upload(a.id, kind, bytes);
      }
    });
  }

  Future<bool?> _askSource(String title) => showModalBottomSheet<bool>(
        context: context,
        builder: (ctx) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: const Text('Bien à plat, lisible, sans reflet.')),
              ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Prendre une photo'), onTap: () => Navigator.pop(ctx, true)),
              ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choisir dans la galerie'), onTap: () => Navigator.pop(ctx, false)),
            ],
          ),
        ),
      );

  Future<void> _selfie() => _run(() async {
        final bytes = await ref.read(kycPhotoSourceProvider).selfie();
        if (bytes == null) return;
        await ref.read(merchantApiProvider).upload(a.id, 'selfie', bytes);
      });

  Future<void> _payout() async {
    final r = await showModalBottomSheet<(String, String)>(context: context, isScrollControlled: true, builder: (_) => const _PayoutSheet());
    if (r == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final api = ref.read(merchantApiProvider);
      final challenge = await api.startPayout(a.id, phone: r.$2, operator: r.$1);
      if (!mounted) return;
      final ok = await askCode(
        context,
        title: 'Code reçu par SMS',
        challenge: challenge,
        submit: (code) async {
          try {
            await api.verifyPayout(a.id, challengeId: challenge.challengeId, code: code);
            return null;
          } on ApiException catch (e) {
            return e.message;
          }
        },
      );
      if (ok) ref.invalidate(myApplicationProvider);
    } on ApiException catch (e) {
      if (mounted) showApiError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _address() async {
    final c = TextEditingController(text: a.addressText ?? '');
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Adresse ou position'),
        content: TextField(controller: c, maxLength: 200, decoration: const InputDecoration(hintText: 'Boutique ou domicile, pour l’e-commerce')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
          TextButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('Enregistrer')),
        ],
      ),
    );
    c.dispose();
    if (value == null || !mounted) return;
    await _run(() => ref.read(merchantApiProvider).update(a.id, address: value.trim()));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final operator = const {'wave': 'Wave', 'orange': 'Orange Money', 'mtn': 'MTN MoMo', 'moov': 'Moov Money'}[a.payoutOperator];
    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            const StepHeader(step: 2, total: 2, title: 'Vérification'),
            const SizedBox(height: BimSpacing.lg),
            Text('Sécurise ta boutique', style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
            const SizedBox(height: BimSpacing.xs),
            Text('« ${a.shopName} ». Ces informations restent privées. Elles permettent à BIM d’identifier chaque marchand.', style: theme.textTheme.bodyMedium),
            if (a.status == 'rejected' && a.rejectionReason != null) ...[
              const SizedBox(height: BimSpacing.md),
              Container(
                key: const ValueKey('rejection'),
                padding: const EdgeInsets.all(BimSpacing.md),
                decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
                child: Text('À corriger : ${a.rejectionReason}', style: const TextStyle(color: BimColors.black)),
              ),
            ],
            const SizedBox(height: BimSpacing.lg),
            _Step(
              key: const ValueKey('step-identity'),
              icon: Icons.badge_outlined,
              title: 'Pièce d’identité',
              subtitle: a.identity ? 'Recto${a.idDocType == 'passport' ? '' : ' et verso'} ajoutés' : 'Recto et verso · CNI, passeport ou permis',
              done: a.identity,
              onTap: _busy ? null : _identity,
            ),
            _Step(key: const ValueKey('step-selfie'), icon: Icons.face_retouching_natural, title: 'Selfie', subtitle: a.selfie ? 'Ajouté' : 'Visage bien éclairé, sans lunettes', done: a.selfie, onTap: _busy ? null : _selfie),
            _Step(
              key: const ValueKey('step-payout'),
              icon: Icons.phone_iphone,
              title: 'Numéro Mobile Money',
              subtitle: a.payout ? '$operator · se terminant par ${a.payoutPhoneEnd}' : 'Wave, Orange, MTN ou Moov · code SMS',
              done: a.payout,
              onTap: _busy ? null : _payout,
            ),
            _Step(
              key: const ValueKey('step-address'),
              icon: Icons.location_on_outlined,
              title: 'Adresse ou position',
              subtitle: a.address ? a.addressText! : 'Boutique ou domicile pour l’e-commerce',
              done: a.address,
              optional: true,
              onTap: _busy ? null : _address,
            ),
            const SizedBox(height: BimSpacing.sm),
            Row(
              children: [
                const Icon(Icons.verified_user_outlined, size: 18, color: BimColors.success),
                const SizedBox(width: BimSpacing.sm),
                Expanded(child: Text('Données chiffrées, jamais visibles par les autres utilisateurs.', style: theme.textTheme.bodySmall)),
              ],
            ),
            const SizedBox(height: BimSpacing.xl),
            BimButton(
              key: const ValueKey('submit-application'),
              label: 'Envoyer pour validation',
              onPressed: a.ready && !_busy ? () => _run(() => ref.read(merchantApiProvider).submit(a.id)) : null,
            ),
            const SizedBox(height: BimSpacing.sm),
            BimButton(
              label: 'Abandonner la demande',
              variant: BimButtonVariant.subtle,
              onPressed: _busy
                  ? null
                  : () async {
                      final ok = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('Abandonner la demande ?'),
                          content: const Text('Ta boutique ne sera pas ouverte. Tes pièces d’identité et ton selfie seront effacés.'),
                          actions: [
                            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Garder')),
                            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Abandonner', style: TextStyle(color: BimColors.red))),
                          ],
                        ),
                      );
                      if (ok == true) await _run(() => ref.read(merchantApiProvider).withdraw(a.id));
                    },
            ),
          ],
        ),
        if (_busy) const Positioned.fill(child: ColoredBox(color: Color(0x33000000), child: Center(child: CircularProgressIndicator()))),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({super.key, required this.icon, required this.title, required this.subtitle, required this.done, required this.onTap, this.optional = false});

  final IconData icon;
  final String title;
  final String subtitle;
  final bool done;
  final bool optional;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: BimSpacing.md),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(BimRadius.card),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(BimSpacing.lg),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(BimRadius.card), border: Border.all(color: scheme.outline, width: 1.5)),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(12)),
                  child: Icon(icon),
                ),
                const SizedBox(width: BimSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                      Text(subtitle, style: Theme.of(context).textTheme.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
                const SizedBox(width: BimSpacing.sm),
                if (done)
                  const Icon(Icons.check_circle_rounded, color: BimColors.red, size: 30)
                else if (optional)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(8)),
                    child: Text('Facultatif', style: Theme.of(context).textTheme.bodySmall),
                  )
                else
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: BimColors.red, borderRadius: BorderRadius.circular(BimRadius.chip)),
                    child: const Text('Commencer', style: TextStyle(color: BimColors.white, fontWeight: FontWeight.w700)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PayoutSheet extends StatefulWidget {
  const _PayoutSheet();

  @override
  State<_PayoutSheet> createState() => _PayoutSheetState();
}

class _PayoutSheetState extends State<_PayoutSheet> {
  String _operator = 'wave';
  final _phone = TextEditingController();

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(BimSpacing.screen, 0, BimSpacing.screen, BimSpacing.lg + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Numéro Mobile Money', style: theme.textTheme.titleLarge),
            const SizedBox(height: BimSpacing.xs),
            Text('Le numéro sur lequel tes clients te paient. Un code va t’être envoyé par SMS.', style: theme.textTheme.bodyMedium),
            const SizedBox(height: BimSpacing.md),
            Wrap(
              spacing: BimSpacing.sm,
              children: [
                for (final (code, label) in const [('wave', 'Wave'), ('orange', 'Orange'), ('mtn', 'MTN'), ('moov', 'Moov')])
                  ChoiceChip(key: ValueKey('op-$code'), label: Text(label), selected: _operator == code, onSelected: (_) => setState(() => _operator = code)),
              ],
            ),
            const SizedBox(height: BimSpacing.md),
            BimTextField(key: const ValueKey('payout-phone'), label: 'Numéro', controller: _phone, required: true, keyboardType: TextInputType.phone, hint: '07 01 02 03 04', onChanged: (_) => setState(() {})),
            const SizedBox(height: BimSpacing.lg),
            BimButton(label: 'Recevoir un code', onPressed: _phone.text.trim().length < 8 ? null : () => Navigator.pop(context, (_operator, _phone.text.trim()))),
          ],
        ),
      ),
    );
  }
}

/// Écran 09 — vérification en cours (par une personne de l'équipe BIM).
class _Pending extends StatelessWidget {
  const _Pending({required this.application});

  final MerchantApplication application;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget line(String text) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(children: [const Icon(Icons.check_circle_outline, color: BimColors.success), const SizedBox(width: BimSpacing.sm), Expanded(child: Text(text))]),
        );
    return ListView(
      padding: const EdgeInsets.all(BimSpacing.screen),
      children: [
        const Align(alignment: Alignment.centerLeft, child: BimBackButton()),
        const SizedBox(height: BimSpacing.xl),
        const Peni(pose: PeniPose.think, size: 130),
        const SizedBox(height: BimSpacing.lg),
        Text('L’équipe BIM vérifie tes infos…', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium?.copyWith(fontSize: 24)),
        const SizedBox(height: BimSpacing.sm),
        Text(
          '« ${application.shopName} » sera ouverte dès la validation. Tu recevras une notification.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyLarge,
        ),
        const SizedBox(height: BimSpacing.xl),
        line('Pièce d’identité reçue'),
        line('Selfie reçu'),
        line('Numéro Mobile Money confirmé'),
      ],
    );
  }
}

class _Approved extends StatelessWidget {
  const _Approved({required this.application});

  final MerchantApplication application;

  @override
  Widget build(BuildContext context) => _Message(
        pose: PeniPose.cheer,
        title: 'Ta boutique est ouverte !',
        text: '« ${application.shopName} » est validée par l’équipe BIM. Passe sur ton profil boutique depuis « Changer de profil ».',
        action: BimButton(label: 'Retour à l’accueil', onPressed: () => context.go('/home')),
      );
}
