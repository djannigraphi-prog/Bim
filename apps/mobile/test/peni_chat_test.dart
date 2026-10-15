import 'package:bim/core/network/api_client.dart';
import 'package:bim/core/network/api_exception.dart';
import 'package:bim/core/storage/token_storage.dart';
import 'package:bim/core/theme/app_theme.dart';
import 'package:bim/features/peni/data/peni_api.dart';
import 'package:bim/features/peni/presentation/peni_chat_screen.dart';
import 'package:bim/features/projects/application/projects_providers.dart';
import 'package:bim/features/projects/data/projects_api.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:bim/features/projects/presentation/new_project_screen.dart';
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

PeniMessage _peni(String id, String text, {List<(String, String)> replies = const [], List<PeniSummaryRow>? summary, String? safety}) => PeniMessage(
      id: id,
      role: 'peni',
      text: text,
      quickReplies: [for (final (qid, label) in replies) PeniQuickReply(id: qid, label: label)],
      summary: summary,
      pose: 'happy',
      safety: safety,
    );
PeniMessage _user(String id, String text) => PeniMessage(id: id, role: 'user', text: text);

const _draft = ProjectDraft(mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', sessionsPerWeek: 2, availability: 'morning', durationDays: 30);

/// API simulée de Peni : rejoue un scénario court et garde les appels (les textes réels sont testés côté API).
class _FakePeni extends PeniApi {
  _FakePeni() : super(_client());

  final calls = <String>[];
  int startFailures = 0;

  String purpose = 'new_project';

  @override
  Future<PeniTurn> start({String purpose = 'new_project', String? mode, String? budget, String? categoryCode}) async {
    this.purpose = purpose;
    calls.add(purpose == 'new_project' ? 'start ${mode ?? '-'} ${budget ?? '-'}' : 'start $purpose ${categoryCode ?? '-'} ${mode ?? '-'}');
    if (startFailures > 0) {
      startFailures--;
      throw ApiException.network;
    }
    return PeniTurn(conversationId: 'c1', messages: [
      _peni('m1', 'Coucou Awa ! 🥰 Raconte-moi : qu’est-ce que tu aimerais changer ?', replies: [('cat:sport', 'Sport'), ('cat:maquillage', 'Maquillage')]),
    ], draft: null,);
  }

  @override
  Future<PeniTurn> send(String conversationId, {String? text, String? choice}) async {
    calls.add(choice != null ? 'choice $choice' : 'text $text');
    if (purpose == 'choose_goal') {
      return PeniTurn(conversationId: 'c1', messages: [
        _user('g1', text ?? choice!),
        _peni('g2', 'Voilà ton objectif 👇 Tu pourras tout ajuster ensuite.', replies: [('restart', 'Recommencer')], summary: const [(label: 'Objectif', value: 'Abdos')]),
      ], draft: const ProjectDraft(categoryCode: 'sport', goalCode: 'sport_abdos'),);
    }
    if (choice == 'cat:sport') {
      return PeniTurn(conversationId: 'c1', messages: [
        _user('m2', 'Sport'),
        _peni('m3', 'Super ! En sport, qu’est-ce que tu vises ?', replies: [('goal:sport_abdos', 'Abdos')]),
      ], draft: null,);
    }
    if (text != null && text.contains('mal au genou')) {
      return PeniTurn(conversationId: 'c1', messages: [
        _user('m4', text),
        _peni('m5', 'Merci de me le dire 💛 Je ne peux pas donner d’avis médical.', safety: 'health'),
        _peni('m6', 'Combien de fois par semaine peux-tu t’y mettre ?', replies: [('sessions:2', '2 fois')]),
      ], draft: null,);
    }
    return PeniTurn(conversationId: 'c1', messages: [
      _user('m7', text ?? choice!),
      _peni(
        'm8',
        'Top ! J’ai noté tout ça 👇',
        replies: [('restart', 'Recommencer')],
        summary: const [(label: 'Catégorie', value: 'Sport · Abdos'), (label: 'Séances', value: '2 / semaine')],
      ),
    ], draft: _draft,);
  }
}

class _FakeProjects extends ProjectsApi {
  _FakeProjects() : super(_client());

  @override
  Future<ProjectCatalog> catalog() async => ProjectCatalog.fromJson({
        'categories': [
          {
            'code': 'sport',
            'label': 'Sport',
            'icon': 'dumbbell',
            'tint': '#FDECEF',
            'hasValidatedPrograms': false,
            'goals': [
              {'code': 'sport_abdos', 'label': 'Abdos', 'quantityUnit': null, 'quantityMin': null, 'quantityMax': null},
            ],
          },
        ],
        'durationsDays': [30, 60, 90],
        'budgetTiers': {'small': '≈ 10 000 F', 'medium': '≈ 35 000 F', 'boosted': '75 000 F +'},
        'availabilityTimes': {'morning': '07:00', 'noon': '12:30', 'afternoon': '15:00'},
        'maxActive': 5,
      });
}

Future<void> _pump(WidgetTester tester, {required String initial, required _FakePeni peni, ProviderContainer? container, List<ProjectDraft?>? results}) async {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: initial, routes: [
    GoRoute(
      path: '/host',
      builder: (context, _) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () async => results?.add(await context.push<ProjectDraft>('/peni/new-project')),
            child: const Text('Ouvrir Peni'),
          ),
        ),
      ),
    ),
    GoRoute(path: '/projects/new', builder: (_, __) => const NewProjectScreen()),
    GoRoute(
      path: '/peni/new-project',
      builder: (_, s) {
        final extra = s.extra is Map<String, String?> ? s.extra! as Map<String, String?> : const <String, String?>{};
        return PeniChatScreen(mode: extra['mode'], budget: extra['budget'], purpose: extra['purpose'] ?? 'new_project', categoryCode: extra['categoryCode']);
      },
    ),
  ],);
  addTearDown(router.dispose);
  final c = container ?? ProviderContainer(overrides: [peniApiProvider.overrideWithValue(peni), projectsApiProvider.overrideWithValue(_FakeProjects())]);
  addTearDown(c.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: c, child: MaterialApp.router(theme: BimTheme.light(), routerConfig: router)));
  await tester.pump();
  await tester.pump();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  final f = find.byKey(ValueKey(key));
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('accueil de Peni, réponses rapides : le libellé choisi s’affiche, puis la question suivante', (tester) async {
    final peni = _FakePeni();
    await _pump(tester, initial: '/peni/new-project', peni: peni);
    expect(find.text('Peni'), findsOneWidget);
    expect(find.text('Ton assistante BIM'), findsOneWidget);
    expect(find.text('Coucou Awa ! 🥰 Raconte-moi : qu’est-ce que tu aimerais changer ?'), findsOneWidget);
    expect(find.byKey(const ValueKey('qr-cat:sport')), findsOneWidget);
    await _tapKey(tester, 'qr-cat:sport');
    expect(peni.calls, ['start - -', 'choice cat:sport']);
    expect(find.text('Super ! En sport, qu’est-ce que tu vises ?'), findsOneWidget);
    // Seules les réponses du dernier message de Peni restent proposées.
    expect(find.byKey(const ValueKey('qr-cat:sport')), findsNothing);
    expect(find.byKey(const ValueKey('qr-goal:sport_abdos')), findsOneWidget);
  });

  testWidgets('message libre : envoyé, champ vidé ; message de prudence santé affiché', (tester) async {
    final peni = _FakePeni();
    await _pump(tester, initial: '/peni/new-project', peni: peni);
    await tester.enterText(find.byKey(const ValueKey('peni-input')), 'Je veux maigrir mais j’ai mal au genou');
    await _tapKey(tester, 'peni-send');
    expect(peni.calls.last, 'text Je veux maigrir mais j’ai mal au genou');
    expect(find.text('Je veux maigrir mais j’ai mal au genou'), findsOneWidget);
    expect(find.text('Merci de me le dire 💛 Je ne peux pas donner d’avis médical.'), findsOneWidget);
    final field = tester.widget<TextField>(find.byKey(const ValueKey('peni-input')));
    expect(field.controller!.text, isEmpty);
    // Un message vide n'est pas envoyé.
    await _tapKey(tester, 'peni-send');
    expect(peni.calls.where((c) => c.startsWith('text')), hasLength(1));
  });

  testWidgets('résumé et « Voir mon programme » : le brouillon est rendu à l’écran appelant', (tester) async {
    final peni = _FakePeni();
    final results = <ProjectDraft?>[];
    await _pump(tester, initial: '/host', peni: peni, results: results);
    await tester.tap(find.text('Ouvrir Peni'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('peni-input')), 'des abdos 2 fois le matin, gratuit, 30 jours');
    await _tapKey(tester, 'peni-send');
    expect(find.byKey(const ValueKey('peni-summary')), findsOneWidget);
    expect(find.text('Sport · Abdos'), findsOneWidget);
    await _tapKey(tester, 'peni-see-program');
    await tester.pumpAndSettle();
    expect(results, hasLength(1));
    expect(results.single!.toJson(), _draft.toJson());
    expect(find.text('Ouvrir Peni'), findsOneWidget);
  });

  testWidgets('erreur au démarrage : message et « Réessayer »', (tester) async {
    final peni = _FakePeni()..startFailures = 1;
    await _pump(tester, initial: '/peni/new-project', peni: peni);
    expect(find.byKey(const ValueKey('peni-error')), findsOneWidget);
    await tester.tap(find.text('Réessayer'));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('Coucou Awa'), findsOneWidget);
  });

  testWidgets('écran 19 « Je préfère en parler avec Peni » : mode transmis, brouillon repris à la dernière étape', (tester) async {
    final peni = _FakePeni();
    final c = ProviderContainer(overrides: [peniApiProvider.overrideWithValue(peni), projectsApiProvider.overrideWithValue(_FakeProjects())]);
    await _pump(tester, initial: '/projects/new', peni: peni, container: c);
    await tester.pump();
    await _tapKey(tester, 'ask-peni');
    await tester.pumpAndSettle();
    expect(peni.calls.first, 'start - -');
    await tester.enterText(find.byKey(const ValueKey('peni-input')), 'des abdos 2 fois le matin, gratuit, 30 jours');
    await _tapKey(tester, 'peni-send');
    await _tapKey(tester, 'peni-see-program');
    await tester.pumpAndSettle();
    expect(find.text('Nouveau projet · 5/5'), findsOneWidget);
    expect(find.text('Créer mon programme'), findsOneWidget);
    expect(c.read(projectDraftProvider).toJson(), _draft.toJson());
    expect(find.text('Peni a rempli ton projet. Vérifie-le, puis crée ton programme.'), findsOneWidget);
  });

  testWidgets('écran 21 « Pas sûr ? Demande à Peni » : objectif seulement, repris à l’étape 3', (tester) async {
    final peni = _FakePeni();
    final c = ProviderContainer(overrides: [peniApiProvider.overrideWithValue(peni), projectsApiProvider.overrideWithValue(_FakeProjects())]);
    await _pump(tester, initial: '/projects/new', peni: peni, container: c);
    await tester.pump();
    await tester.tap(find.text('Mode Éco'));
    await tester.pump();
    await tester.tap(find.text('Continuer'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sport'));
    await tester.pump();
    await tester.tap(find.text('Continuer'));
    await tester.pumpAndSettle();
    expect(find.text('Nouveau projet · 3/5'), findsOneWidget);
    await _tapKey(tester, 'ask-peni-goal');
    await tester.pumpAndSettle();
    expect(peni.calls.first, 'start choose_goal sport eco');
    await tester.enterText(find.byKey(const ValueKey('peni-input')), 'un ventre plus plat');
    await _tapKey(tester, 'peni-send');
    expect(find.text('Choisir cet objectif'), findsOneWidget);
    await _tapKey(tester, 'peni-see-program');
    await tester.pumpAndSettle();
    expect(find.text('Nouveau projet · 3/5'), findsOneWidget);
    expect(c.read(projectDraftProvider).goalCode, 'sport_abdos');
    expect(c.read(projectDraftProvider).mode, 'eco');
    expect(find.text('Objectif noté avec Peni. Tu peux encore le modifier.'), findsOneWidget);
  });
}
