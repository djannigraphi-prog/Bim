// Sonde de diagnostic (lot 2, enquête sur la perte de l'émulateur de la CI le 15/10/2026).
//
// Observation : sur l'émulateur Android de la CI, un glissement au-delà du haut d'une liste (effet d'étirement
// d'Android) a été suivi, à chaque essai, de la perte de l'émulateur entier. Cette sonde reproduit le même geste dans
// trois situations, lancées séparément (workflow « Sonde émulateur ») :
//   PROBE=plain  liste Flutter simple, sans aucun code de BIM ;
//   PROBE=bim    écran « Rappels » de BIM (données simulées, sans réseau) ;
//   PROBE=none   témoin : même écran simple, même durée, sans le geste.
// Si « plain » fait aussi tomber l'émulateur, l'origine est l'environnement (émulateur, rendu graphique), pas BIM.
// Ce n'est pas un test de l'application : il ne remplace ni n'affaiblit le parcours de bout en bout.
import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/notifications/data/notification_preferences_api.dart';
import 'package:bim/features/notifications/presentation/reminder_preferences_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const _probe = String.fromEnvironment('PROBE', defaultValue: 'plain');

class _NoTokens extends TokenStorage {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refreshToken() async => null;
}

/// Préférences simulées (aucun appel réseau) pour afficher l'écran Rappels.
class _OfflinePrefs extends NotificationPreferencesApi {
  _OfflinePrefs() : super(ApiClient(storage: _NoTokens(), onSessionExpired: () async {}, baseUrl: 'http://127.0.0.1:9'));

  @override
  Future<NotificationPreferences> load() async => const NotificationPreferences(
        remindersEnabled: false,
        quietHours: QuietHours(start: '22:00', end: '06:00'),
        quietHoursArePersonal: false,
        remindersAvailable: false,
      );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('sonde : glissement au-delà du haut d’une liste ($_probe)', (tester) async {
    final Widget home = _probe == 'bim'
        ? const ReminderPreferencesScreen()
        : Scaffold(body: ListView(children: [for (var i = 0; i < 60; i++) ListTile(title: Text('Ligne $i'))]));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [notificationPreferencesApiProvider.overrideWithValue(_OfflinePrefs())],
        child: MaterialApp(theme: BimTheme.light(), home: home),
      ),
    );
    for (var k = 0; k < 20; k++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    final list = find.byType(Scrollable).first;
    // Même situation que dans le parcours : liste un peu descendue, puis glissement vers le bas au-delà du haut.
    await tester.drag(list, const Offset(0, -60));
    await tester.pump(const Duration(milliseconds: 300));
    for (var i = 0; i < 5; i++) {
      if (_probe != 'none') await tester.drag(list, const Offset(0, 300));
      for (var k = 0; k < 20; k++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
    }
    await tester.pump(const Duration(seconds: 3));
    // Arrivé ici, l'application (et donc l'émulateur) répond encore.
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
