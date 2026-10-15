import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../projects/data/projects_models.dart';

/// Réponse rapide proposée par Peni (bouton sous son message).
class PeniQuickReply {
  const PeniQuickReply({required this.id, required this.label});
  final String id;
  final String label;

  factory PeniQuickReply.fromJson(Map<String, dynamic> j) => PeniQuickReply(id: j['id'] as String, label: j['label'] as String);
}

/// Ligne du résumé de projet (« Catégorie · Sport · Abdos »).
typedef PeniSummaryRow = ({String label, String value});

/// Un message de la discussion (écran 25). Le texte de Peni est produit par l'API (réponses écrites, sans IA).
class PeniMessage {
  const PeniMessage({
    required this.id,
    required this.role,
    required this.text,
    this.quickReplies = const [],
    this.summary,
    this.pose,
    this.safety,
  });

  final String id;

  /// peni ou user.
  final String role;
  final String text;
  final List<PeniQuickReply> quickReplies;
  final List<PeniSummaryRow>? summary;

  /// cheer, happy, sad, think ou wave.
  final String? pose;

  /// health ou urgent : message de prudence.
  final String? safety;

  bool get fromPeni => role == 'peni';

  factory PeniMessage.fromJson(Map<String, dynamic> j) => PeniMessage(
        id: j['id'] as String,
        role: j['role'] as String,
        text: j['text'] as String,
        quickReplies: [for (final q in (j['quickReplies'] as List<dynamic>? ?? const [])) PeniQuickReply.fromJson(q as Map<String, dynamic>)],
        summary: (j['summary'] as List<dynamic>?)
            ?.map((r) => (label: (r as Map<String, dynamic>)['label'] as String, value: r['value'] as String))
            .toList(),
        pose: j['pose'] as String?,
        safety: j['safety'] as String?,
      );
}

/// Discussion complète, ou nouveaux messages après une réponse.
class PeniTurn {
  const PeniTurn({required this.conversationId, required this.messages, required this.draft});
  final String conversationId;
  final List<PeniMessage> messages;

  /// Brouillon de projet (format de POST /v1/projects) quand Peni a tout noté.
  final ProjectDraft? draft;

  static List<PeniMessage> _messages(Map<String, dynamic> j) =>
      [for (final m in (j['messages'] as List<dynamic>? ?? const [])) PeniMessage.fromJson(m as Map<String, dynamic>)];

  static ProjectDraft? _draft(Map<String, dynamic> j) => j['draft'] is Map<String, dynamic> ? ProjectDraft.fromJson(j['draft'] as Map<String, dynamic>) : null;
}

class PeniApi {
  PeniApi(this._api);
  final ApiClient _api;

  /// Commence une discussion pour construire un projet (mode déjà choisi à l'écran 19, s'il y en a un).
  Future<PeniTurn> start({String? mode, String? budget}) async {
    final j = await _api.post('/v1/peni/conversations', body: {'purpose': 'new_project', if (mode != null) 'mode': mode, if (mode == 'premium' && budget != null) 'budget': budget});
    return PeniTurn(conversationId: j['id'] as String, messages: PeniTurn._messages(j), draft: PeniTurn._draft(j));
  }

  /// Envoie un message libre ([text]) ou une réponse rapide ([choice]) ; renvoie le message de la personne et ceux de Peni.
  Future<PeniTurn> send(String conversationId, {String? text, String? choice}) async {
    final j = await _api.post('/v1/peni/conversations/$conversationId/messages', body: {if (text != null) 'text': text, if (choice != null) 'choice': choice});
    return PeniTurn(conversationId: conversationId, messages: PeniTurn._messages(j), draft: PeniTurn._draft(j));
  }
}

final peniApiProvider = Provider<PeniApi>((ref) => PeniApi(ref.watch(apiClientProvider)));
