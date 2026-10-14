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

  test('libellé des jours de la semaine', () {
    const t = ProjectTask(id: 'x', title: 'T', icon: 'check', timeOfDay: '07:00', weekdays: 21);
    expect(t.weekdaysLabel, 'lun. · mer. · ven.');
  });
}
