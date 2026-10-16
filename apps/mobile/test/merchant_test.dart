import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/merchant/data/merchant_api.dart';
import 'package:bim/features/merchant/presentation/merchant_apply_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

ApiClient _client() => ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9');

MerchantApplication _app({String status = 'draft', bool identity = false, bool selfie = false, bool payout = false, String? reason}) => MerchantApplication(
      id: 'a1',
      status: status,
      shopName: 'Boutique Élégance',
      city: 'Abidjan',
      identity: identity,
      selfie: selfie,
      payout: payout,
      address: false,
      ready: identity && selfie && payout,
      idDocType: identity ? 'cni' : null,
      payoutOperator: payout ? 'wave' : null,
      payoutPhoneEnd: payout ? '04' : null,
      rejectionReason: reason,
    );

/// API simulée de l'ouverture de boutique (les règles sont testées côté API).
class _FakeMerchant extends MerchantApi {
  _FakeMerchant(this.current, {this.createError}) : super(_client());

  MerchantApplication? current;
  final ApiException? createError;
  final calls = <String>[];

  @override
  Future<({MerchantApplication? application, bool available})> mine() async => (application: current, available: true);

  @override
  Future<MerchantApplication> create({required String name, required String city, String? commune, String? description}) async {
    calls.add('create $name $city');
    if (createError != null) throw createError!;
    return current = _app();
  }

  @override
  Future<MerchantApplication> submit(String id) async {
    calls.add('submit $id');
    return current = _app(status: 'submitted', identity: true, selfie: true, payout: true);
  }
}

Future<void> _pump(WidgetTester tester, _FakeMerchant api) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(routes: [GoRoute(path: '/', builder: (_, __) => const MerchantApplyScreen())]);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), merchantApiProvider.overrideWithValue(api)],
    child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('étape 1 : « Continuer » actif seulement avec un nom ; la demande créée ouvre « Sécurise ta boutique »', (tester) async {
    final api = _FakeMerchant(null);
    await _pump(tester, api);
    expect(find.text('Présente ta boutique'), findsOneWidget);
    FilledButton cont() => tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Continuer'));
    expect(cont().onPressed, isNull);
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('shop-name')), matching: find.byType(TextField)), 'Boutique Élégance');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Continuer'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(api.calls, ['create Boutique Élégance Abidjan']);
    expect(find.text('Sécurise ta boutique'), findsOneWidget);
    expect(find.text('Pièce d’identité'), findsOneWidget);
    expect(find.text('Facultatif'), findsOneWidget); // adresse
  });

  testWidgets('âge minimum des marchands non décidé : « Bientôt disponible », rien d’autre', (tester) async {
    final api = _FakeMerchant(null, createError: const ApiException(code: 'RULE_NOT_DECIDED', message: "Cette fonctionnalité n'est pas encore ouverte.", status: 503));
    await _pump(tester, api);
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('shop-name')), matching: find.byType(TextField)), 'Ma boutique');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Continuer'));
    await tester.pump();
    expect(find.text('Bientôt disponible'), findsOneWidget);
  });

  testWidgets('écran 07 : envoi impossible tant que la liste n’est pas complète ; motif d’un refus affiché', (tester) async {
    await _pump(tester, _FakeMerchant(_app(status: 'rejected', identity: true, selfie: false, payout: true, reason: 'Le selfie est flou.')));
    expect(find.text('À corriger : Le selfie est flou.'), findsOneWidget);
    expect(find.text('Wave · se terminant par 04'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('submit-application')), 300);
    expect(tester.widget<FilledButton>(find.descendant(of: find.byKey(const ValueKey('submit-application')), matching: find.byType(FilledButton))).onPressed, isNull);
  });

  testWidgets('écran 07 complet : envoi pour validation, puis écran 09 (vérification par l’équipe)', (tester) async {
    final api = _FakeMerchant(_app(identity: true, selfie: true, payout: true));
    await _pump(tester, api);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('submit-application')), 300);
    await tester.tap(find.byKey(const ValueKey('submit-application')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(api.calls, ['submit a1']);
    expect(find.text('L’équipe BIM vérifie tes infos…'), findsOneWidget);
    expect(find.text('Numéro Mobile Money confirmé'), findsOneWidget);
  });
}
