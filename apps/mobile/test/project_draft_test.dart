import 'package:bim/core/util/date_fr.dart';
import 'package:bim/features/projects/data/projects_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('le brouillon de projet produit le JSON attendu par l’API (aucun montant)', () {
    const d = ProjectDraft(mode: 'premium', budget: 'medium', categoryCode: 'sport', goalCode: 'sport_perte_poids', targetQuantity: 10, sessionsPerWeek: 3);
    expect(d.toJson(), {
      'mode': 'premium',
      'budget': 'medium',
      'categoryCode': 'sport',
      'goalCode': 'sport_perte_poids',
      'targetQuantity': 10,
      'receiveMerchantOffers': false,
      'sessionsPerWeek': 3,
    });
  });

  test('le mode Éco n’envoie pas de budget ; changer d’objectif efface la quantité', () {
    const d = ProjectDraft(mode: 'eco', budget: 'small', categoryCode: 'maquillage', description: ' Un teint naturel ');
    expect(d.toJson().containsKey('budget'), isFalse);
    expect(d.toJson()['description'], 'Un teint naturel');
    final e = const ProjectDraft(goalCode: 'a', targetQuantity: 5).copyWith(clearGoal: true);
    expect(e.goalCode, isNull);
    expect(e.targetQuantity, isNull);
  });

  test('C6 : le mode du projet est un simple choix, sans abonnement ni paiement', () {
    for (final mode in ['eco', 'premium']) {
      final json = ProjectDraft(mode: mode, budget: mode == 'premium' ? 'small' : null, categoryCode: 'sport', goalCode: 'sport_abdos').toJson();
      expect(json['mode'], mode);
      expect(json.keys.where((k) => RegExp('subscri|abonnement|payment|paiement|price|amount|premiumUser', caseSensitive: false).hasMatch(k)), isEmpty);
    }
    const s = ProjectSummary(
      id: 'x', title: 'T', categoryLabel: 'Sport', icon: 'dumbbell', mode: 'premium', status: 'active', isPublic: false,
      durationDays: 30, currentDay: 1, progress: 0, streak: 0, plannedEndDate: '2026-11-12',
    );
    expect(s.modeLabel, 'Projet Premium');
  });

  test('libellé des jours de la semaine', () {
    const t = ProjectTask(id: 'x', title: 'T', icon: 'check', timeOfDay: '07:00', weekdays: 21);
    expect(t.weekdaysLabel, 'lun. · mer. · ven.');
  });

  test('mesures, nombres et heures à la française', () {
    final m = Measurement.fromJson({
      'unit': 'kg',
      'items': [
        {'day': '2026-08-14', 'value': 84},
        {'day': '2026-10-13', 'value': 73.6},
      ],
      'start': 84,
      'latest': 73.6,
      'change': -10.4,
    });
    expect(m.change, -10.4);
    expect(frNumber(m.change!.abs()), '10,4');
    expect(frNumber(84), '84');
    expect(hourFr('15:00'), '15 h');
    expect(hourFr('07:30'), '7 h 30');
  });

  test('écran 24 : « par semaine » reprend les séances choisies, pas une habitude quotidienne', () {
    const summary = ProjectSummary(
      id: 'p', title: 'Perdre 10 kg', categoryLabel: 'Sport', icon: 'dumbbell', mode: 'eco', status: 'active', isPublic: false,
      durationDays: 60, currentDay: 5, progress: 42, streak: 3, plannedEndDate: '2026-12-09',
    );
    const tasks = [
      ProjectTask(id: 'a', title: 'Séance', icon: 'dumbbell', timeOfDay: '15:00', weekdays: 0x15),
      ProjectTask(id: 'b', title: 'Étirements', icon: 'check', timeOfDay: '21:00'),
    ];
    ProjectDetail detail(int? perWeek) => ProjectDetail(
          summary: summary, goalLabel: null, programSource: 'answers', totalSteps: 48, completedSteps: 0, bestStreak: 0,
          sessionsPerWeek: perWeek, tasks: tasks, days: const [], today: '2026-10-15',
        );
    expect(detail(3).perWeek, 3);
    expect(detail(null).perWeek, 7);
  });
}
