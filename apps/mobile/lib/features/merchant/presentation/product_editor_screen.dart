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
import '../../projects/application/photo_source.dart';
import '../../reels/data/reels_api.dart' show checkVideoSize, videoSourceProvider;
import '../data/shop_api.dart';

const _maxPhotos = 6;

/// Lot 5-B — Ajouter ou modifier un article ou une prestation (« + » de l'écran 55).
/// Brouillon d'abord ; la publication sur le BimShop demande au moins une photo et une rubrique.
/// Lot 7-A — Référence BIM-… affichée ; masquer et republier gardent la réputation.
/// L7-04 — Nom, description et prix normal sont fixés à la création (champs en lecture seule ensuite) : les changer
/// demande une nouvelle fiche (nouvelle référence, réputation vierge). Photo et promotion se modifient librement, la
/// réputation est conservée. Rubrique, durée et variantes se règlent jusqu'à la première publication.
class ProductEditorScreen extends ConsumerStatefulWidget {
  const ProductEditorScreen({super.key, this.productId});

  final String? productId;

  @override
  ConsumerState<ProductEditorScreen> createState() => _ProductEditorScreenState();
}

class _ProductEditorScreenState extends ConsumerState<ProductEditorScreen> {
  final _title = TextEditingController();
  final _price = TextEditingController();
  final _promo = TextEditingController();
  final _duration = TextEditingController();
  final _description = TextEditingController();
  final _variants = TextEditingController();
  final _stock = <String, TextEditingController>{};

  ProductDetail? _product;
  String _kind = 'product';
  String? _category;
  bool _loading = false;
  bool _busy = false;
  ApiException? _error;
  /// Photos choisies avant le premier enregistrement (envoyées juste après la création).
  final _pending = <List<int>>[];

  @override
  void initState() {
    super.initState();
    if (widget.productId != null) _load(widget.productId!);
  }

  @override
  void dispose() {
    for (final c in [_title, _price, _promo, _duration, _description, _variants, ..._stock.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load(String id) async {
    setState(() => _loading = true);
    try {
      final p = await ref.read(shopApiProvider).product(id);
      if (mounted) _apply(p);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _apply(ProductDetail p) {
    // Écran fermé pendant l'attente : ses champs n'existent plus.
    if (!mounted) return;
    _product = p;
    _kind = p.kind;
    _category = p.categoryCode;
    _title.text = p.title;
    _price.text = '${p.normalPrice}';
    _promo.text = _promoOf(p)?.toString() ?? '';
    _duration.text = p.durationMinutes?.toString() ?? '';
    _description.text = p.description ?? '';
    final labels = p.variants.map((v) => v.label).toList();
    _variants.text = labels.length == 1 && labels.first == 'Unique' ? '' : labels.join(', ');
    for (final v in p.variants) {
      (_stock[v.id] ??= TextEditingController()).text = '${v.stock ?? 0}';
    }
    if (mounted) setState(() {});
  }

  static int? _promoOf(ProductDetail p) => p.promoPriceFcfa ?? (p.compareAtFcfa != null ? p.priceFcfa : null);

  /// Fiche créée : nom, description et prix normal ne se modifient plus.
  bool get _identityLocked => _product != null;

  /// Déjà publiée une fois : rubrique, durée et variantes sont figées aussi.
  bool get _frozen => _product?.everPublished ?? false;

  bool get _valid => _title.text.trim().length >= 2 && (int.tryParse(_price.text) ?? 0) > 0 && _category != null;

  Future<void> _run(Future<ProductDetail?> Function(ShopApi api) action, {String? done}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    // Conteneur capturé avant l'attente : les listes de la boutique sont rafraîchies même si l'écran a été fermé.
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final p = await action(ref.read(shopApiProvider));
      container
        ..invalidate(shopDashboardProvider)
        ..invalidate(shopProductsProvider);
      if (!mounted) return;
      if (p != null) _apply(p);
      if (done != null && mounted) showBimSnack(context, done);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  ProductInput get _input => ProductInput(
        kind: _kind,
        title: _title.text.trim(),
        categoryCode: _category!,
        priceFcfa: int.parse(_price.text),
        promoPriceFcfa: int.tryParse(_promo.text),
        durationMinutes: _kind == 'service' ? int.tryParse(_duration.text) : null,
        description: _description.text.trim(),
      );

  /// Ce qu'une fiche existante peut encore changer (L7-04).
  ProductChanges get _changes => ProductChanges(
        promoPriceFcfa: int.tryParse(_promo.text),
        categoryCode: _category,
        durationMinutes: int.tryParse(_duration.text),
        sendCategory: !_frozen,
        sendDuration: !_frozen && _kind == 'service',
      );

  Future<void> _save() => _run((api) async {
        final p = _product;
        if (p != null) return api.update(p.id, _changes);
        var created = await api.create(_input);
        // L'article existe désormais : un échec des photos ne doit pas conduire à le recréer (audit, M-7).
        _apply(created);
        if (_pending.isNotEmpty) {
          created = await api.addPhotos(created.id, List.of(_pending));
          _pending.clear();
        }
        return created;
      }, done: 'Enregistré',);

  /// Le formulaire diffère de la fiche enregistrée (promotion ; rubrique et durée avant la première publication).
  bool get _dirty {
    final p = _product;
    if (p == null) return false;
    return _promo.text != (_promoOf(p)?.toString() ?? '') ||
        (!_frozen && p.isService && _duration.text != (p.durationMinutes?.toString() ?? '')) ||
        (!_frozen && _category != p.categoryCode);
  }

  /// Les autres actions (publier, variantes, stock, photos) enregistrent d'abord les changements du formulaire :
  /// sinon la réponse du serveur les effacerait, ou l'ancienne version serait publiée (audit, M-8).
  Future<void> _act(Future<ProductDetail?> Function(ShopApi api, ProductDetail p) action, {String? done}) {
    final p = _product!;
    return _run((api) async {
      if (_dirty) {
        if (!_valid) throw const ApiException(code: 'VALIDATION_FAILED', message: 'Complète le nom, le prix et la rubrique avant de continuer.');
        await api.update(p.id, _changes);
      }
      return action(api, p);
    }, done: done,);
  }

  Future<void> _addPhoto() async {
    final camera = await showModalBottomSheet<bool>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Prendre une photo'), onTap: () => Navigator.pop(context, true)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choisir dans la galerie'), onTap: () => Navigator.pop(context, false)),
          ],
        ),
      ),
    );
    if (camera == null || !mounted) return;
    final bytes = await pickWithFeedback(context, () => ref.read(photoSourceProvider).pick(camera: camera));
    if (bytes == null || !mounted) return;
    final p = _product;
    if (p == null) {
      setState(() => _pending.add(bytes));
      return;
    }
    await _act((api, p) => api.addPhotos(p.id, [bytes]));
  }

  /// V1 : vidéo de l'article (galerie, 1 minute au plus, filmée en portrait ou au format carré).
  Future<void> _pickVideo() async {
    final bytes = await pickWithFeedback(context, () async {
      final b = await ref.read(videoSourceProvider).pick();
      // Vidéo trop lourde : refusée tout de suite, sans attendre un long envoi que le serveur rejetterait.
      if (b != null) checkVideoSize(b.length);
      return b;
    });
    if (bytes == null || !mounted) return;
    await _act((api, p) => api.setVideo(p.id, bytes), done: 'Vidéo ajoutée');
  }

  Future<void> _archive() async {
    final p = _product!;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Retirer cet article ?'),
        content: const Text('Il disparaît de ta boutique et ses photos sont effacées.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annuler')),
          TextButton(key: const ValueKey('confirm-archive'), onPressed: () => Navigator.pop(context, true), child: const Text('Retirer')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await _run((api) async {
      await api.archive(p.id);
      return null;
    });
    if (mounted && _error == null) context.canPop() ? context.pop() : context.go('/shop');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final p = _product;
    final e = _error;
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    // Article introuvable ou inaccessible : jamais un formulaire de création à la place (audit, M-9).
    if (widget.productId != null && p == null) {
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(BimSpacing.xl),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(e?.message ?? ApiException.unknown.message, key: const ValueKey('product-load-error'), textAlign: TextAlign.center),
                  const SizedBox(height: BimSpacing.lg),
                  BimButton(label: 'Réessayer', variant: BimButtonVariant.outline, onPressed: () => _load(widget.productId!)),
                  const SizedBox(height: BimSpacing.sm),
                  const BimBackButton(),
                ],
              ),
            ),
          ),
        ),
      );
    }
    final photoCount = p?.photos.length ?? _pending.length;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(BimSpacing.screen),
          children: [
            Row(
              children: [
                const BimBackButton(),
                const SizedBox(width: BimSpacing.sm),
                Expanded(child: Text(p == null ? 'Nouvel article' : p.title, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleLarge)),
                if (p != null) _StatusChip(status: p.status),
              ],
            ),
            if (p != null && p.reference.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: BimSpacing.xs, left: 56),
                child: Text('Réf. ${p.reference}', key: const ValueKey('product-reference'), style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700)),
              ),
            const SizedBox(height: BimSpacing.lg),
            if (p == null) ...[
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'product', label: Text('Article'), icon: Icon(Icons.checkroom_outlined)),
                  ButtonSegment(value: 'service', label: Text('Prestation'), icon: Icon(Icons.content_cut)),
                ],
                selected: {_kind},
                onSelectionChanged: (s) => setState(() => _kind = s.first),
              ),
              const SizedBox(height: BimSpacing.lg),
            ],
            Text('Photos ($photoCount/$_maxPhotos)', style: theme.textTheme.titleMedium),
            const SizedBox(height: BimSpacing.sm),
            SizedBox(
              height: 92,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  if (p != null)
                    for (final ph in p.photos)
                      _Thumb(
                        onRemove: _busy ? null : () => _act((api, p) => api.removePhoto(p.id, ph.id)),
                        child: ph.url == null ? const Icon(Icons.image_outlined) : Image.network(ph.url!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined)),
                      )
                  else
                    for (final (i, b) in _pending.indexed)
                      _Thumb(onRemove: () => setState(() => _pending.removeAt(i)), child: Image.memory(Uint8List.fromList(b), fit: BoxFit.cover)),
                  if (photoCount < _maxPhotos)
                    InkWell(
                      key: const ValueKey('add-photo'),
                      borderRadius: BorderRadius.circular(BimRadius.chip),
                      onTap: _busy ? null : _addPhoto,
                      child: Container(
                        width: 84,
                        decoration: BoxDecoration(border: Border.all(color: theme.colorScheme.outline, width: 1.5), borderRadius: BorderRadius.circular(BimRadius.chip)),
                        child: const Icon(Icons.add_a_photo_outlined),
                      ),
                    ),
                ],
              ),
            ),
            if (e?.fieldError('photos') != null) Text(e!.fieldError('photos')!, style: const TextStyle(color: BimColors.red)),
            Text('Formats : carré ou portrait (une photo en paysage est recadrée).', style: theme.textTheme.bodySmall),
            // V1 (19/10/2026) : une vidéo courte par article, au même format que les photos.
            if (p != null) ...[
              const SizedBox(height: BimSpacing.md),
              Text('Vidéo (1 minute au plus)', style: theme.textTheme.titleMedium),
              const SizedBox(height: BimSpacing.xs),
              if (p.video == null)
                OutlinedButton.icon(
                  key: const ValueKey('add-video'),
                  onPressed: _busy ? null : _pickVideo,
                  icon: const Icon(Icons.video_call_outlined),
                  label: const Text('Ajouter une vidéo'),
                )
              else
                Row(
                  children: [
                    const Icon(Icons.play_circle_outline_rounded),
                    const SizedBox(width: BimSpacing.sm),
                    Expanded(child: Text('Vidéo de ${(p.video!.durationMs / 1000).round()} s', key: const ValueKey('video-duration'))),
                    TextButton(onPressed: _busy ? null : _pickVideo, child: const Text('Remplacer')),
                    TextButton(key: const ValueKey('remove-video'), onPressed: _busy ? null : () => _act((api, p) => api.removeVideo(p.id), done: 'Vidéo retirée'), child: const Text('Retirer')),
                  ],
                ),
              Text('Filme en portrait ou au format carré : les vidéos en paysage sont refusées.', style: theme.textTheme.bodySmall),
              if (e?.fieldError('video') != null) Text(e!.fieldError('video')!, style: const TextStyle(color: BimColors.red)),
            ],
            const SizedBox(height: BimSpacing.lg),
            if (_identityLocked) ...[
              Container(
                key: const ValueKey('identity-locked'),
                padding: const EdgeInsets.all(BimSpacing.md),
                decoration: BoxDecoration(color: BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Le nom, la description et le prix normal sont fixés à la création. Pour les changer, crée une nouvelle '
                      'fiche : elle aura une nouvelle référence et une réputation vierge. Photo et promotion se modifient ici '
                      'sans toucher à la réputation.',
                    ),
                    TextButton.icon(
                      key: const ValueKey('new-sheet'),
                      onPressed: () => context.push('/shop/products/new'),
                      icon: const Icon(Icons.add),
                      label: const Text('Créer une nouvelle fiche'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: BimSpacing.md),
            ],
            BimTextField(
              key: const ValueKey('product-title'),
              label: 'Nom',
              controller: _title,
              required: !_identityLocked,
              readOnly: _identityLocked,
              maxLength: 120,
              errorText: e?.fieldError('title'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: BimSpacing.md),
            _CategoryField(value: _category, error: e?.fieldError('categoryCode'), onChanged: _frozen ? null : (c) => setState(() => _category = c)),
            const SizedBox(height: BimSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: BimTextField(
                    key: const ValueKey('product-price'),
                    label: 'Prix normal (FCFA)',
                    controller: _price,
                    required: !_identityLocked,
                    readOnly: _identityLocked,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    errorText: e?.fieldError('priceFcfa'),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: BimSpacing.sm),
                Expanded(
                  child: BimTextField(
                    key: const ValueKey('product-promo'),
                    label: 'Prix promo',
                    controller: _promo,
                    optional: true,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    errorText: e?.fieldError('promoPriceFcfa'),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              ],
            ),
            if (_kind == 'service') ...[
              const SizedBox(height: BimSpacing.md),
              BimTextField(
                label: 'Durée (minutes)',
                controller: _duration,
                optional: true,
                readOnly: _frozen,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                errorText: e?.fieldError('durationMinutes'),
              ),
            ],
            const SizedBox(height: BimSpacing.md),
            BimTextField(key: const ValueKey('product-description'), label: 'Description', controller: _description, optional: !_identityLocked, readOnly: _identityLocked, maxLength: 2000),
            if (e != null && e.details['fields'] is! Map) ...[
              const SizedBox(height: BimSpacing.md),
              Text(e.message, style: const TextStyle(color: BimColors.red)),
            ],
            const SizedBox(height: BimSpacing.lg),
            BimButton(key: const ValueKey('save-product'), label: p == null ? 'Enregistrer le brouillon' : 'Enregistrer', loading: _busy, onPressed: _valid && !_busy ? _save : null),
            if (p != null && !p.isService) ...[
              const SizedBox(height: BimSpacing.xl),
              Text('Tailles, couleurs et stock', style: theme.textTheme.titleMedium),
              const SizedBox(height: BimSpacing.sm),
              if (_frozen)
                Text('Variantes fixées depuis la publication ; le stock reste modifiable.', key: const ValueKey('variants-frozen'), style: theme.textTheme.bodySmall)
              else ...[
                BimTextField(label: 'Variantes', hint: 'S, M, L ou Rouge, Noir', controller: _variants, optional: true),
                const SizedBox(height: BimSpacing.sm),
                BimButton(
                  label: 'Mettre à jour les variantes',
                  variant: BimButtonVariant.outline,
                  onPressed: _busy
                      ? null
                      : () => _act((api, p) {
                            final labels = _variants.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toSet().toList();
                            return api.setVariants(p.id, labels);
                          },),
                ),
              ],
              const SizedBox(height: BimSpacing.md),
              for (final v in p.variants)
                Padding(
                  padding: const EdgeInsets.only(bottom: BimSpacing.sm),
                  child: Row(
                    children: [
                      Expanded(child: Text(v.label, style: const TextStyle(fontWeight: FontWeight.w600))),
                      SizedBox(
                        width: 96,
                        child: TextField(
                          key: ValueKey('stock-${v.id}'),
                          controller: _stock[v.id],
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          textAlign: TextAlign.center,
                          decoration: const InputDecoration(isDense: true, suffixText: 'pcs'),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Enregistrer le stock',
                        icon: const Icon(Icons.check),
                        onPressed: _busy ? null : () => _act((api, p) => api.setStock(p.id, v.id, int.tryParse(_stock[v.id]!.text) ?? 0), done: 'Stock mis à jour'),
                      ),
                    ],
                  ),
                ),
            ],
            if (p != null) ...[
              const SizedBox(height: BimSpacing.xl),
              if (p.status == 'published' || p.status == 'hidden')
                // 7-A : masquer en cas de rupture, republier ensuite ; référence et réputation conservées.
                SwitchListTile(
                  key: const ValueKey('product-visibility'),
                  contentPadding: EdgeInsets.zero,
                  value: p.status == 'published',
                  title: Text(p.status == 'published' ? 'Visible publiquement' : 'Visible par moi uniquement'),
                  subtitle: const Text('Masquer garde la référence, les j’aime, commentaires et recommandations.'),
                  onChanged: _busy ? null : (visible) => _act((api, p) => visible ? api.show(p.id) : api.hide(p.id), done: visible ? 'Article visible publiquement' : 'Article masqué'),
                )
              else
                BimButton(
                  key: const ValueKey('publish-product'),
                  label: 'Publier sur le BimShop',
                  variant: BimButtonVariant.dark,
                  onPressed: _busy ? null : () => _act((api, p) => api.publish(p.id), done: 'Article en ligne'),
                ),
              // Ce qui manque pour publier, rappelé à côté du bouton (la photo est en haut de l'écran).
              if (e?.fieldError('photos') ?? e?.fieldError('categoryCode') ?? (e?.code == 'SHOP_NOT_ACTIVE' ? e?.message : null) case final String why) ...[
                const SizedBox(height: BimSpacing.sm),
                Text(why, key: const ValueKey('publish-error'), style: const TextStyle(color: BimColors.red)),
              ],
              const SizedBox(height: BimSpacing.sm),
              BimButton(label: 'Retirer l’article', variant: BimButtonVariant.subtle, icon: Icons.delete_outline, onPressed: _busy ? null : _archive),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final online = status == 'published';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: BimSpacing.sm, vertical: BimSpacing.xs),
      decoration: BoxDecoration(color: online ? BimColors.success.withValues(alpha: 0.15) : BimColors.warningBg, borderRadius: BorderRadius.circular(BimRadius.chip)),
      child: Text(
        switch (status) { 'published' => 'En ligne', 'hidden' => 'Masqué', _ => 'Brouillon' },
        style: TextStyle(fontWeight: FontWeight.w700, color: online ? BimColors.success : BimColors.grey800),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.child, required this.onRemove});

  final Widget child;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: BimSpacing.sm),
        child: Stack(
          children: [
            ClipRRect(borderRadius: BorderRadius.circular(BimRadius.chip), child: SizedBox(width: 84, height: 92, child: child)),
            Positioned(
              top: 2,
              right: 2,
              child: Material(
                color: Colors.black54,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onRemove,
                  child: const Padding(padding: EdgeInsets.all(4), child: Icon(Icons.close, size: 16, color: Colors.white)),
                ),
              ),
            ),
          ],
        ),
      );
}

/// Rubrique (écran 33) : on choisit une sous-rubrique, ou la rubrique si elle n'en a pas (prestations).
class _CategoryField extends ConsumerWidget {
  const _CategoryField({required this.value, required this.onChanged, this.error});

  final String? value;
  final String? error;
  /// null : rubrique figée (fiche déjà publiée).
  final ValueChanged<String?>? onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cats = ref.watch(shopCategoriesProvider).valueOrNull ?? const <ShopCategory>[];
    final items = <DropdownMenuItem<String>>[
      for (final c in cats)
        if (c.children.isEmpty)
          DropdownMenuItem(value: c.code, child: Text(c.label))
        else
          for (final s in c.children) DropdownMenuItem(value: s.code, child: Text('${c.label} · ${s.label}', overflow: TextOverflow.ellipsis)),
    ];
    final known = items.any((i) => i.value == value);
    return DropdownButtonFormField<String>(
      key: const ValueKey('product-category'),
      // ignore: deprecated_member_use
      value: known ? value : null,
      isExpanded: true,
      items: items,
      onChanged: onChanged,
      decoration: InputDecoration(labelText: 'Rubrique *', errorText: error),
    );
  }
}
