import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/merchant/data/shop_api.dart';
import 'package:bim/features/merchant/presentation/shop_team_screen.dart';
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

/// Équipe simulée (les règles sont testées côté API : propriétaire seul, permissions contrôlées à chaque requête).
class _FakeTeam extends ShopTeamApi {
  _FakeTeam() : super(_client());

  final calls = <String>[];
  var members = <TeamMember>[
    const TeamMember(userId: 'o1', username: 'doho', fullName: 'Doho Yannick', role: 'owner', status: 'active', permissions: []),
    const TeamMember(userId: 'u2', username: 'awa.kone', fullName: 'Awa Koné', role: 'staff', status: 'active', permissions: []),
  ];

  @override
  Future<List<TeamMember>> team() async => members;

  @override
  Future<List<TeamMember>> invite(String username) async {
    calls.add('invite $username');
    members = [...members, TeamMember(userId: 'u3', username: username, fullName: 'Koffi Yao', role: 'staff', status: 'invited', permissions: const [])];
    return members;
  }

  @override
  Future<List<TeamMember>> setPermissions(String userId, List<String> permissions) async {
    calls.add('permissions $userId ${(List.of(permissions)..sort()).join(',')}');
    members = [for (final m in members) m.userId == userId ? TeamMember(userId: m.userId, username: m.username, fullName: m.fullName, role: m.role, status: m.status, permissions: permissions) : m];
    return members;
  }

  @override
  Future<List<({String shopId, String name, String? logoUrl})>> invitations() async => const [(shopId: 's1', name: 'Boutique Élégance', logoUrl: null)];

  @override
  Future<void> answer(String shopId, {required bool accept}) async => calls.add('${accept ? 'accept' : 'decline'} $shopId');
}

Future<void> _pump(WidgetTester tester, _FakeTeam api, Widget home) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(_client()), shopTeamApiProvider.overrideWithValue(api)],
    child: MaterialApp(theme: BimTheme.light(), home: home),
  ),);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('7-A : équipe — aucune permission par défaut, le propriétaire en accorde une, invite une personne', (tester) async {
    final api = _FakeTeam();
    await _pump(tester, api, const ShopTeamScreen());
    expect(find.text('Propriétaire · tous les droits'), findsOneWidget);
    expect(find.text('@awa.kone · employé'), findsOneWidget);
    // Le propriétaire n'a pas de cases : ses droits ne se modifient pas.
    expect(find.byKey(const ValueKey('perm-o1-products.edit')), findsNothing);
    final box = find.byKey(const ValueKey('perm-u2-messages.reply'));
    expect(tester.widget<CheckboxListTile>(box).value, isFalse);
    await tester.tap(box);
    await tester.pumpAndSettle();
    expect(api.calls, ['permissions u2 messages.reply']);
    expect(tester.widget<CheckboxListTile>(box).value, isTrue);

    await tester.enterText(find.byKey(const ValueKey('team-username')), '@koffi.yao');
    await tester.tap(find.byKey(const ValueKey('team-invite')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'invite koffi.yao');
    expect(find.text('@koffi.yao · invitation en attente'), findsOneWidget);
  });

  testWidgets('7-A : invitation reçue — « Rejoindre » l’accepte', (tester) async {
    final api = _FakeTeam();
    var joined = false;
    await _pump(tester, api, Scaffold(body: ShopInvitationsList(onJoined: () => joined = true)));
    expect(find.text('Boutique Élégance t’invite dans son équipe.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('join-s1')));
    await tester.pumpAndSettle();
    expect(api.calls, ['accept s1']);
    expect(joined, isTrue);
  });
}
