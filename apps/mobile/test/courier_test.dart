import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/courier/data/courier_api.dart';
import 'package:bim/features/courier/presentation/courier_courses.dart';
import 'package:bim/features/courier/presentation/courier_screens.dart';
import 'package:bim/features/merchant/data/shop_api.dart' show formatFcfa;
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
  Future<CourierProfile> updateProfile({bool? available, int? capacity, List<String>? communes, String? payoutOperator}) async {
    calls.add('profile ${available ?? capacity ?? communes ?? payoutOperator}');
    return profileState = CourierProfile(
      available: available ?? profileState.available,
      capacity: capacity ?? profileState.capacity,
      communes: const [],
      relations: profileState.relations,
      payoutOperator: payoutOperator ?? profileState.payoutOperator,
    );
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

  // 7-F — missions et courses simulées.
  var missionList = <Mission>[];
  var current = <Mission>[];
  CourseDetail? detail;

  @override
  Future<List<Mission>> missions() async => missionList;
  @override
  Future<List<Mission>> courses({bool history = false}) async => history ? const [] : current;
  @override
  Future<void> accept(String offerId) async {
    calls.add('accept mission $offerId');
    final m = missionList.single;
    missionList = [];
    current = [Mission(id: '', deliveryId: m.deliveryId, mode: m.mode, fromShop: m.fromShop, toPlace: m.toPlace, itemsCount: m.itemsCount, status: 'accepted', number: 'CMD-000042')];
  }

  @override
  Future<void> decline(String offerId) async {
    calls.add('decline mission $offerId');
    missionList = [];
  }

  @override
  Future<CourseDetail> course(String deliveryId) async => detail!;

  CourseDetail _detail(String status, List<String> actions, {bool cashDone = false}) => detail = CourseDetail(
        mission: const Mission(id: '', deliveryId: 'd1', mode: 'express', fromShop: 'Boutique Élégance', toPlace: 'Yopougon, Abidjan', itemsCount: 2, number: 'CMD-000042'),
        status: status,
        category: 'employee',
        clientName: 'Awa',
        clientPhone: '+2250700000000',
        address: 'Rue des jardins',
        items: const [(title: 'Robe soirée à plumes', variant: 'M', quantity: 2)],
        paymentMethod: 'cash',
        amountToCollectFcfa: 40000,
        cashReceived: cashDone,
        actions: actions,
      );

  @override
  Future<CourseDetail> step(String deliveryId, String step) async {
    calls.add('step $step');
    return switch (step) {
      'picked-up' => _detail('picked_up', const ['arrived']),
      'arrived' => _detail('arrived', const ['validate_code', 'client_absent', 'report_incident']),
      _ => _detail('closed', const []),
    };
  }

  @override
  Future<CourseDetail> code(String deliveryId, String code) async {
    calls.add('code $code');
    if (code != '4821') throw const ApiException(code: 'HANDOVER_CODE_INVALID', message: 'Code incorrect.', status: 400, details: {'remaining': 4});
    return _detail('code_validated', const ['cash_received', 'close', 'report_incident']);
  }

  @override
  Future<CourseDetail> cash(String deliveryId, int amountFcfa) async {
    calls.add('cash $amountFcfa');
    return _detail('code_validated', const ['close', 'report_incident'], cashDone: true);
  }

  @override
  Future<void> release(String deliveryId, String reason) async => calls.add('release $reason');

  @override
  Future<void> answerReassign(String deliveryId, bool accept) async => calls.add('reassign $accept');

  @override
  Future<CourseDetail> deliveryFee(String deliveryId, String decision, {String? reason}) async {
    calls.add('fee $decision ${reason ?? ''}'.trim());
    return detail = CourseDetail(mission: detail!.mission, status: 'closed', items: detail!.items, actions: const [], category: 'independent', feeAmountFcfa: 1500, feeStatus: decision == 'confirm' ? 'confirmed_by_courier' : 'contested_by_courier');
  }

  @override
  Future<void> incident(String deliveryId, String reason, {String? description}) async => calls.add('incident $reason ${description ?? ''}'.trim());
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

  testWidgets('7-F missions : proposée sans adresse ni client, acceptée, puis course en cours ; refus possible', (tester) async {
    final api = _FakeCourier()
      ..missionList = [
        Mission(id: 'of1', deliveryId: 'd1', mode: 'express', fromShop: 'Boutique Élégance', fromPlace: 'Cocody, Abidjan', toPlace: 'Yopougon, Abidjan', itemsCount: 2, feeFcfa: 1700, estimatedMinutes: 30, expiresAt: DateTime.utc(2026, 10, 16, 10)),
      ];
    await _pump(tester, const CourierSpaceScreen(), courier: api);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('mission-of1')), findsOneWidget);
    expect(find.textContaining('Rue des jardins'), findsNothing);
    expect(find.textContaining(formatFcfa(1700)), findsOneWidget);
    expect(find.byKey(const ValueKey('courses-empty')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('mission-accept-of1')));
    await tester.pumpAndSettle();
    expect(api.calls, ['accept mission of1']);
    expect(find.byKey(const ValueKey('missions-empty')), findsOneWidget);
    expect(find.byKey(const ValueKey('course-d1')), findsOneWidget);
  });

  testWidgets('7-F course : prise en charge, arrivée, code faux puis bon, espèces (employé), clôture ; incident', (tester) async {
    final api = _FakeCourier();
    api._detail('accepted', const ['picked_up']);
    await _pump(tester, const CourseScreen(deliveryId: 'd1'), courier: api);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('course-client')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('course-picked-up')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('course-arrived')));
    await tester.pumpAndSettle();
    expect(find.textContaining('n’est pas une preuve de paiement'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('course-code-input')), '1111');
    await tester.tap(find.byKey(const ValueKey('course-code')));
    await tester.pumpAndSettle();
    expect(find.text('Code incorrect. Essais restants : 4.'), findsOneWidget);
    // Incident : « Autre » exige une description.
    await tester.tap(find.byKey(const ValueKey('course-incident')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('incident-other')));
    await tester.pump();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('incident-send'))).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('incident-description')), 'Portail fermé');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('incident-send')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('course-code-input')), '4821');
    await tester.tap(find.byKey(const ValueKey('course-code')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('course-close')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('course-cash')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('course-cash')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('course-close')));
    await tester.pumpAndSettle();
    expect(api.calls, ['step picked-up', 'step arrived', 'code 1111', 'incident other Portail fermé', 'code 4821', 'cash 40000', 'step close']);
    expect(tester.widget<Text>(find.byKey(const ValueKey('course-status'))).data, 'Livraison terminée');
  });

  testWidgets('7-F désistement avant prise en charge : motif obligatoire, puis course rendue', (tester) async {
    final api = _FakeCourier();
    api._detail('accepted', const ['picked_up', 'release']);
    await _pump(tester, const CourseScreen(deliveryId: 'd1'), courier: api);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('course-release')));
    await tester.pumpAndSettle();
    expect(tester.widget<TextButton>(find.byKey(const ValueKey('release-send'))).onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('release-reason')), 'Moto en panne');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('release-send')));
    await tester.pumpAndSettle();
    expect(api.calls, ['release Moto en panne']);
    expect(find.byKey(const ValueKey('course-released')), findsOneWidget);
  });

  testWidgets('V1 changement de livreur demandé par la boutique : motif affiché, accord puis course rendue', (tester) async {
    final api = _FakeCourier();
    api.detail = const CourseDetail(
      mission: Mission(id: '', deliveryId: 'd1', mode: 'express', fromShop: 'Boutique Élégance', toPlace: 'Yopougon, Abidjan', itemsCount: 1, number: 'CMD-000042'),
      status: 'picked_up',
      items: [(title: 'Robe', variant: 'M', quantity: 1)],
      actions: ['accept_reassign', 'refuse_reassign', 'report_incident'],
      reassignReason: 'Retard de 40 minutes',
    );
    await _pump(tester, const CourseScreen(deliveryId: 'd1'), courier: api);
    await tester.pumpAndSettle();
    expect(find.textContaining('Retard de 40 minutes'), findsOneWidget);
    expect(find.byKey(const ValueKey('course-arrived')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('course-reassign-accept')));
    await tester.pumpAndSettle();
    expect(api.calls, ['reassign true']);
    expect(find.byKey(const ValueKey('course-released')), findsOneWidget);
  });

  testWidgets('7-F désistement absent une fois le colis pris en charge', (tester) async {
    final api = _FakeCourier();
    api._detail('picked_up', const ['arrived']);
    await _pump(tester, const CourseScreen(deliveryId: 'd1'), courier: api);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('course-release')), findsNothing);
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

  testWidgets('A3-b livreur indépendant : frais payés par le client, « Frais reçus » ou contestation motivée', (tester) async {
    final api = _FakeCourier();
    final base = api._detail('closed', const []);
    api.detail = CourseDetail(mission: base.mission, status: 'closed', items: base.items, actions: const [], category: 'independent', feeAmountFcfa: 1500, feeStatus: 'declared_by_customer', feeActions: const ['confirm_delivery_fee', 'contest_delivery_fee']);
    await _pump(tester, const CourseScreen(deliveryId: 'd1'), courier: api);
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const ValueKey('course-fee'))).data, 'Frais de livraison : ${formatFcfa(1500)} — Le client indique avoir payé');
    await tester.tap(find.byKey(const ValueKey('course-fee-contest')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('release-reason')), 'Rien reçu sur Wave');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('release-send')));
    await tester.pumpAndSettle();
    expect(api.calls, ['fee contest Rien reçu sur Wave']);
    expect(find.byKey(const ValueKey('course-fee-confirm')), findsNothing);
  });
}
