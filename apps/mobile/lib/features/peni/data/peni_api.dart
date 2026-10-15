import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/widgets/brand.dart';
import '../../projects/application/projects_providers.dart';
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

/// Encouragement de Peni pour la journée (écran 27) ou la carte (écran 26), écrit par l'API (heures calmes respectées).
class PeniEncouragement {
  const PeniEncouragement({required this.key, required this.text, required this.pose});

  /// Situation reconnue par l'API (ex. today_done, quiet_night).
  final String key;
  final String text;
  final String pose;

  PeniPose get peniPose => PeniPose.values.where((p) => p.name == pose).firstOrNull ?? PeniPose.happy;

  factory PeniEncouragement.fromJson(Map<String, dynamic> j) =>
      PeniEncouragement(key: j['key'] as String, text: j['text'] as String, pose: j['pose'] as String? ?? 'happy');
}

/// Explication d'une tâche du programme par Peni (écran 24), écrite par l'API (sans IA).
class PeniTaskExplanation {
  const PeniTaskExplanation({required this.taskId, required this.title, required this.intro, required this.pose, required this.sections});

  final String taskId;
  final String title;
  final String intro;
  final String pose;

  /// Questions courtes et leurs réponses : what, when, how, missed, reminders.
  final List<({String id, String question, String answer})> sections;

  PeniPose get peniPose => PeniPose.values.where((p) => p.name == pose).firstOrNull ?? PeniPose.think;

  factory PeniTaskExplanation.fromJson(Map<String, dynamic> j) => PeniTaskExplanation(
        taskId: j['taskId'] as String,
        title: j['title'] as String,
        intro: j['intro'] as String,
        pose: j['pose'] as String? ?? 'think',
        sections: [
          for (final s in (j['sections'] as List<dynamic>? ?? const []))
            (id: (s as Map<String, dynamic>)['id'] as String, question: s['question'] as String, answer: s['answer'] as String),
        ],
      );
}

class PeniApi {
  PeniApi(this._api);
  final ApiClient _api;

  /// Commence une discussion : tout le projet ([purpose] « new_project », mode déjà choisi à l'écran 19 s'il y en a un)
  /// ou seulement l'objectif (« choose_goal », « Pas sûr ? » de l'écran 21, catégorie déjà choisie).
  Future<PeniTurn> start({String purpose = 'new_project', String? mode, String? budget, String? categoryCode}) async {
    final j = await _api.post('/v1/peni/conversations', body: {
      'purpose': purpose,
      if (mode != null) 'mode': mode,
      if (mode == 'premium' && budget != null) 'budget': budget,
      if (categoryCode != null) 'categoryCode': categoryCode,
    },);
    return PeniTurn(conversationId: j['id'] as String, messages: PeniTurn._messages(j), draft: PeniTurn._draft(j));
  }

  Future<PeniTaskExplanation> explainTask(String projectId, String taskId) async =>
      PeniTaskExplanation.fromJson(await _api.get('/v1/peni/projects/$projectId/tasks/$taskId/explanation'));

  Future<PeniEncouragement> encouragement(String projectId, {required String context, String? day}) async => PeniEncouragement.fromJson(
        await _api.get('/v1/peni/projects/$projectId/encouragement', query: {'context': context, if (day != null) 'day': day}),
      );

  /// Envoie un message libre ([text]) ou une réponse rapide ([choice]) ; renvoie le message de la personne et ceux de Peni.
  Future<PeniTurn> send(String conversationId, {String? text, String? choice}) async {
    final j = await _api.post('/v1/peni/conversations/$conversationId/messages', body: {if (text != null) 'text': text, if (choice != null) 'choice': choice});
    return PeniTurn(conversationId: conversationId, messages: PeniTurn._messages(j), draft: PeniTurn._draft(j));
  }
}

final peniApiProvider = Provider<PeniApi>((ref) => PeniApi(ref.watch(apiClientProvider)));

typedef EncouragementKey = ({String projectId, String context, String? day});

/// Encouragement du moment ; recalculé après chaque changement du projet (case cochée, pause…). En cas d'erreur,
/// null : l'écran garde son message habituel (l'encouragement n'est jamais bloquant).
final peniEncouragementProvider = FutureProvider.autoDispose.family<PeniEncouragement?, EncouragementKey>((ref, k) async {
  ref.watch(projectsRevisionProvider);
  try {
    return await ref.watch(peniApiProvider).encouragement(k.projectId, context: k.context, day: k.day);
  } catch (_) {
    return null;
  }
});
