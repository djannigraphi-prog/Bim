/// Modèles de l'authentification, alignés sur packages/api-contract/openapi.json.
/// Les valeurs métier (âges, règles) viennent toujours du serveur.

class Challenge {
  const Challenge({required this.challengeId, required this.channel, this.destination, required this.expiresAt, required this.resendAvailableAt});

  factory Challenge.fromJson(Map<String, dynamic> j) => Challenge(
        challengeId: j['challengeId'] as String,
        channel: j['channel'] as String?,
        destination: j['destination'] as String?,
        expiresAt: DateTime.parse(j['expiresAt'] as String),
        resendAvailableAt: DateTime.parse(j['resendAvailableAt'] as String),
      );

  final String challengeId;
  /// « phone » ou « email » ; absent quand le serveur ne le révèle pas (mot de passe oublié par @nom d'utilisateur).
  final String? channel;
  /// Coordonnée masquée ; absente pour « mot de passe oublié ».
  final String? destination;
  final DateTime expiresAt;
  final DateTime resendAvailableAt;
}

class Tokens {
  const Tokens({required this.accessToken, required this.refreshToken});

  factory Tokens.fromJson(Map<String, dynamic> j) =>
      Tokens(accessToken: j['accessToken'] as String, refreshToken: j['refreshToken'] as String);

  final String accessToken;
  final String refreshToken;
}

class Interest {
  const Interest({required this.code, required this.label, required this.icon});

  factory Interest.fromJson(Map<String, dynamic> j) =>
      Interest(code: j['code'] as String, label: j['label'] as String, icon: (j['icon'] ?? '') as String);

  final String code;
  final String label;
  final String icon;
}

class Me {
  const Me({
    required this.id,
    required this.fullName,
    required this.username,
    required this.city,
    required this.theme,
    required this.contacts,
  });

  factory Me.fromJson(Map<String, dynamic> j) => Me(
        id: j['id'] as String,
        fullName: j['fullName'] as String,
        username: j['username'] as String,
        city: j['city'] as String,
        theme: ((j['preferences'] as Map<String, dynamic>?)?['theme'] ?? 'system') as String,
        contacts: ((j['contacts'] as List<dynamic>?) ?? const [])
            .map((c) => (c as Map<String, dynamic>))
            .map((c) => (type: c['type'] as String, value: c['value'] as String, verified: c['verified'] as bool))
            .toList(),
      );

  final String id;
  final String fullName;
  final String username;
  final String city;
  final String theme;
  final List<({String type, String value, bool verified})> contacts;
}

/// Données saisies sur les écrans 04 puis 05, envoyées ensemble à la fin de l'inscription.
class RegistrationDraft {
  const RegistrationDraft({
    this.fullName = '',
    this.username = '',
    this.birthDate,
    this.city = '',
    this.phone = '',
    this.email = '',
    this.gender,
    this.password = '',
    this.interests = const {},
  });

  final String fullName;
  final String username;
  final DateTime? birthDate;
  final String city;
  final String phone;
  final String email;
  /// « female », « male », « undisclosed » ou null (facultatif, Q13).
  final String? gender;
  final String password;
  final Set<String> interests;

  RegistrationDraft copyWith({
    String? fullName,
    String? username,
    DateTime? birthDate,
    String? city,
    String? phone,
    String? email,
    String? gender,
    bool clearGender = false,
    String? password,
    Set<String>? interests,
  }) =>
      RegistrationDraft(
        fullName: fullName ?? this.fullName,
        username: username ?? this.username,
        birthDate: birthDate ?? this.birthDate,
        city: city ?? this.city,
        phone: phone ?? this.phone,
        email: email ?? this.email,
        gender: clearGender ? null : (gender ?? this.gender),
        password: password ?? this.password,
        interests: interests ?? this.interests,
      );

  Map<String, dynamic> toJson() {
    final d = birthDate!;
    String two(int v) => v.toString().padLeft(2, '0');
    return {
      'fullName': fullName.trim(),
      'username': username.trim(),
      'birthDate': '${d.year}-${two(d.month)}-${two(d.day)}',
      'city': city.trim(),
      if (phone.trim().isNotEmpty) 'phone': phone.trim(),
      if (email.trim().isNotEmpty) 'email': email.trim(),
      if (gender != null) 'gender': gender,
      'password': password,
      'interests': interests.toList(),
    };
  }
}
