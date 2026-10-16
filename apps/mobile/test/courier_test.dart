import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/courier/data/courier_api.dart';
import 'package:bim/features/courier/presentation/courier_screens.dart';
import 'package:bim/features/orders/data/orders_api.dart';
import 'package:bim/features/projects/application/photo_source.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

ApiClient _client() => ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');

class _Photos implements PhotoSource {
  @override
  Future<List<int>?> pick({required bool camera}) async => [0xff, 0xd8, 0xff, 0xe0];
}

/// Demande et espace livreur simulés (les règles — âge, chiffrement, relations — sont testées côté API).
class _FakeCourier extends CourierApi {
  _FakeCourier() : super(_client());
  final calls = <String>[];
  CourierApplication? app;
  var profileState = const CourierProfile(
    available: false,
    capacity: 1,
    communes: [],
    relations: [CourierRelation(id: 'r1', shopName: 'Boutique Élégance', relation: 'employee', status: 'pending', place: 'Cocody, Abidjan')],
  );

  CourierApplication _with({String? doc, String? vehicle, bool? identity, bool? selfie, String stage = 'draft'}) {
    final a = app!;
    final d = doc ?? a.idDocType;
    final v = vehicle ?? a.vehicle;
    return app = CourierApplication(id: 'c1', stage: stage, identity: identity ?? a.identity, selfie: selfie ?? a.selfie, details: d != null && v != null, idDocType: d, vehicle: v);
  }

  @override
  Future<({CourierApplication? application, bool available})> application() async => (application: app, available: true);
  @override
  Future<CourierApplication> apply() async {
    calls.add('apply');
    return app = const CourierApplication(id: 'c1', stage: 'draft', identity: false, selfie: false, details: false);
  }

  @override
  Future<CourierApplication> update({String? idDocType, String? vehicle}) async {
    calls.add('update ${idDocType ?? vehicle}');
    return _with(doc: idDocType, vehicle: vehicle);
  }

  int _front = 0;
  @override
  Future<CourierApplication> upload(String kind, List<int> bytes) async {
    calls.add('upload $kind');
    if (kind != 'selfie') _front++;
    return _with(identity: _front >= 2, selfie: kind == 'selfie' ? true : null);
  }

  @override
  Future<CourierApplication> submit() async {
    calls.add('submit');
    return _with(stage: 'submitted');
  }

  @override
  Future<CourierProfile> profile() async => profileState;

  @override
  Future<CourierProfile> updateProfile({bool? available, int? capacity, List<String>? communes}) async {
    calls.add('profile ${available ?? capacity ?? communes}');
    return profileState = CourierProfile(available: available ?? profileState.available, capacity: capacity ?? profileState.capacity, communes: const [], relations: profileState.relations);
  }

  @override
  Future<CourierProfile> relation(String id, String action) async {
    calls.add('$action $id');
    return profileState = CourierProfile(
      available: profileState.available,
      capacity: profileState.capacity,
      communes: const [],
      relations: const [CourierRelation(id: 'r1', shopName: 'Boutique Élégance', relation: 'employee', status: 'active')],
    );
  }
}

class _FakeShopCouriers extends ShopCouriersApi {
  _FakeShopCouriers() : super(_client());
  final calls = <String>[];
  var items = <ShopCourier>[];
  @override
  Future<List<ShopCourier>> list() async => items;
  @override
  Future<List<ShopCourier>> invite(String username, String relation) async {
    calls.add('invite $username $relation');
    return items = [ShopCourier(id: 'r9', fullName: 'Koffi Yao', username: username, relation: relation, status: 'pending')];
  }

  @override
  Future<List<ShopCourier>> end(String id) async {
    calls.add('end $id');
    return items = [];
  }
}

class _FakeOrders extends OrdersApi {
  _FakeOrders() : super(_client());
  @override
  Future<List<Commune>> communes() async => const [Commune(code: 'abidjan-cocody', city: 'Abidjan', name: 'Cocody')];
}

Future<void> _pump(WidgetTester tester, Widget home, {_FakeCourier? courier, _FakeShopCouriers? shop}) async {
  tester.view.physicalSize = const Size(1170, 3000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_client()),
      courierApiProvider.overrideWithValue(courier ?? _FakeCourier()),
      shopCouriersApiProvider.overrideWithValue(shop ?? _FakeShopCouriers()),
      ordersApiProvider.overrideWithValue(_FakeOrders()),
      photoSourceProvider.overrideWithValue(_Photos()),
    ],
    child: MaterialApp(theme: BimTheme.light(), home: home),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('7-E demande : pièce, transport, recto, verso, selfie, puis envoi (bouton actif seulement complet)', (tester) async {
    final api = _FakeCourier();
    await _pump(tester, const CourierApplyScreen(), courier: api);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('courier-start')));
    await tester.pumpAndSettle();
    FilledButton submit() => tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('courier-submit')), matching: find.byType(FilledButton)));
    expect(submit().onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('doc-cni')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('vehicle-moto')));
    await tester.pumpAndSettle();
    for (final k in ['id_front', 'id_back', 'selfie']) {
      await tester.tap(find.byKey(ValueKey('upload-$k')));
      await tester.pumpAndSettle();
    }
    expect(submit().onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('courier-submit')));
    await tester.pumpAndSettle();
    expect(api.calls, ['apply', 'update cni', 'update moto', 'upload id_front', 'upload id_back', 'upload selfie', 'submit']);
    expect(find.text('Demande envoyée : l’équipe BIM la vérifie.'), findsOneWidget);
    expect(find.byKey(const ValueKey('courier-submit')), findsNothing);
  });

  testWidgets('7-E espace livreur : disponibilité, capacité, proposition d’emploi acceptée ; aucune commande affichée', (tester) async {
    final api = _FakeCourier();
    await _pump(tester, const CourierSpaceScreen(), courier: api);
    await tester.pumpAndSettle();
    expect(find.text('Boutique Élégance'), findsOneWidget);
    expect(find.textContaining('proposition à accepter'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('courier-available')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Une de plus'));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('courier-capacity'))).data, '2');
    await tester.tap(find.byKey(const ValueKey('relation-accept-r1')));
    await tester.pumpAndSettle();
    expect(api.calls, ['profile true', 'profile 2', 'accept r1']);
    expect(find.textContaining('en cours'), findsOneWidget);
    expect(find.textContaining('Commande'), findsNothing);
  });

  testWidgets('7-E livreurs de la boutique : proposer un emploi, puis y mettre fin', (tester) async {
    final shop = _FakeShopCouriers();
    await _pump(tester, const ShopCouriersScreen(), shop: shop);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('shop-couriers-empty')), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('courier-username')), 'koffi.yao');
    await tester.tap(find.text('Employé'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('courier-invite')));
    await tester.pumpAndSettle();
    expect(find.text('@koffi.yao · Employé · en attente de son accord'), findsOneWidget);
    await tester.tap(find.text('Mettre fin'));
    await tester.pumpAndSettle();
    expect(shop.calls, ['invite koffi.yao employee', 'end r9']);
    expect(find.byKey(const ValueKey('shop-couriers-empty')), findsOneWidget);
  });
}
