import 'package:bim/features/auth/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test("le brouillon d'inscription produit le JSON attendu par l'API (Q13, F16)", () {
    final draft = RegistrationDraft(
      fullName: '  Awa Koné ',
      username: 'awa.kone',
      birthDate: DateTime(1998, 3, 2),
      city: 'Cocody',
      phone: '07 00 00 00 01',
      password: 'Bim-Test-2026!',
      interests: const {'mode', 'coiffure', 'ongles'},
    );
    final json = draft.toJson();
    expect(json['fullName'], 'Awa Koné');
    expect(json['birthDate'], '1998-03-02');
    expect(json.containsKey('email'), isFalse, reason: 'un champ facultatif vide n’est pas envoyé');
    expect(json.containsKey('gender'), isFalse);
    expect((json['interests'] as List<dynamic>).length, 3);
  });

  test('copyWith peut effacer le genre (champ facultatif)', () {
    const d = RegistrationDraft(gender: 'female');
    expect(d.copyWith(clearGender: true).gender, isNull);
    expect(d.copyWith(city: 'Yopougon').gender, 'female');
  });
}
