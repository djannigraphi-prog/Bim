/// Modèles des projets BIM (lot 1), alignés sur packages/api-contract/openapi.json (/v1/projects).
/// Toutes les règles (limites, durées, progression) sont calculées par le serveur.
library;

class ProjectGoal {
  const ProjectGoal({required this.code, required this.label, this.quantityUnit, this.quantityMin, this.quantityMax});

  factory ProjectGoal.fromJson(Map<String, dynamic> j) => ProjectGoal(
        code: j['code'] as String,
        label: j['label'] as String,
        quantityUnit: j['quantityUnit'] as String?,
        quantityMin: j['quantityMin'] as int?,
        quantityMax: j['quantityMax'] as int?,
      );

  final String code;
  final String label;
  final String? quantityUnit;
  final int? quantityMin;
  final int? quantityMax;
}

class ProjectCategory {
  const ProjectCategory({required this.code, required this.label, required this.icon, required this.tint, required this.goals, this.hasValidatedPrograms = false});

  factory ProjectCategory.fromJson(Map<String, dynamic> j) => ProjectCategory(
        code: j['code'] as String,
        label: j['label'] as String,
        icon: j['icon'] as String,
        tint: j['tint'] as String,
        goals: (j['goals'] as List<dynamic>).map((e) => ProjectGoal.fromJson(e as Map<String, dynamic>)).toList(),
        hasValidatedPrograms: (j['hasValidatedPrograms'] ?? false) as bool,
      );

  final String code;
  final String label;
  final String icon;
  final String tint;
  final List<ProjectGoal> goals;
  /// Un programme type validé par BIM existe : sa durée s'applique.
  final bool hasValidatedPrograms;
}

class ProjectCatalog {
  const ProjectCatalog({
    required this.categories,
    required this.durationsDays,
    required this.budgetTiers,
    required this.availabilityTimes,
    this.maxActive,
  });

  factory ProjectCatalog.fromJson(Map<String, dynamic> j) => ProjectCatalog(
        categories: (j['categories'] as List<dynamic>).map((e) => ProjectCategory.fromJson(e as Map<String, dynamic>)).toList(),
        durationsDays: (j['durationsDays'] as List<dynamic>).cast<int>(),
        budgetTiers: (j['budgetTiers'] as Map<String, dynamic>).map((k, v) => MapEntry(k, v.toString())),
        availabilityTimes: (j['availabilityTimes'] as Map<String, dynamic>).map((k, v) => MapEntry(k, v.toString())),
        maxActive: j['maxActive'] as int?,
      );

  final List<ProjectCategory> categories;
  final List<int> durationsDays;
  final Map<String, String> budgetTiers;
  final Map<String, String> availabilityTimes;
  final int? maxActive;
}

class ProjectSummary {
  const ProjectSummary({
    required this.id,
    required this.title,
    required this.categoryLabel,
    required this.icon,
    required this.mode,
    required this.status,
    required this.isPublic,
    required this.durationDays,
    required this.currentDay,
    required this.progress,
    required this.streak,
    required this.plannedEndDate,
    this.pausedUntil,
    this.nextTask,
  });

  factory ProjectSummary.fromJson(Map<String, dynamic> j) => ProjectSummary(
        id: j['id'] as String,
        title: j['title'] as String,
        categoryLabel: j['categoryLabel'] as String,
        icon: j['icon'] as String,
        mode: j['mode'] as String,
        status: j['status'] as String,
        isPublic: j['isPublic'] as bool,
        durationDays: j['durationDays'] as int,
        currentDay: j['currentDay'] as int,
        progress: j['progress'] as int,
        streak: j['streak'] as int,
        plannedEndDate: j['plannedEndDate'] as String,
        pausedUntil: j['pausedUntil'] as String?,
        nextTask: j['nextTask'] == null ? null : ProjectTask.fromJson(j['nextTask'] as Map<String, dynamic>),
      );

  final String id;
  final String title;
  final String categoryLabel;
  final String icon;
  final String mode;
  final String status;
  final bool isPublic;
  final int durationDays;
  final int currentDay;
  final int progress;
  final int streak;
  final String plannedEndDate;
  final String? pausedUntil;
  /// Prochaine tâche du jour encore à faire (écrans 18 et 26).
  final ProjectTask? nextTask;

  bool get isCompleted => status == 'completed';
  bool get isPaused => status == 'paused';
  String get modeLabel => mode == 'premium' ? 'Projet Premium' : 'Projet économique';
}

class ProjectList {
  const ProjectList({required this.items, required this.activeCount, this.maxActive, required this.today});

  factory ProjectList.fromJson(Map<String, dynamic> j) => ProjectList(
        items: (j['items'] as List<dynamic>).map((e) => ProjectSummary.fromJson(e as Map<String, dynamic>)).toList(),
        activeCount: j['activeCount'] as int,
        maxActive: j['maxActive'] as int?,
        today: j['today'] as String,
      );

  final List<ProjectSummary> items;
  final int activeCount;
  final int? maxActive;
  final String today;
}

class ProjectTask {
  const ProjectTask({required this.id, required this.title, this.detail, required this.icon, required this.timeOfDay, this.weekdays = 127, this.origin = 'user', this.done = false});

  factory ProjectTask.fromJson(Map<String, dynamic> j) => ProjectTask(
        id: j['id'] as String,
        title: j['title'] as String,
        detail: j['detail'] as String?,
        icon: (j['icon'] ?? 'check') as String,
        timeOfDay: j['timeOfDay'] as String,
        weekdays: (j['weekdays'] ?? 127) as int,
        origin: (j['origin'] ?? 'user') as String,
        done: (j['done'] ?? false) as bool,
      );

  final String id;
  final String title;
  final String? detail;
  final String icon;
  final String timeOfDay;
  final int weekdays;
  final String origin;
  final bool done;

  static const _days = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

  String get weekdaysLabel {
    if (weekdays == 127) return 'Tous les jours';
    return [for (var i = 0; i < 7; i++) if (weekdays & (1 << i) != 0) _days[i]].join(' · ');
  }
}

class ProjectDay {
  const ProjectDay({required this.day, required this.index, required this.due, required this.done, required this.state});

  factory ProjectDay.fromJson(Map<String, dynamic> j) => ProjectDay(
        day: j['day'] as String,
        index: j['index'] as int?,
        due: j['due'] as int,
        done: j['done'] as int,
        state: j['state'] as String,
      );

  final String day;
  final int? index;
  final int due;
  final int done;
  /// done · missed · partial · today · upcoming · rest · paused
  final String state;
}

/// Coffre du chemin (écran 26, décision du 15/10/2026) : récompense symbolique (badge et message de Peni),
/// jamais financière. S'ouvre à 70 % des tâches prévues de la semaine (ou du programme pour le coffre final).
class ProjectChest {
  const ProjectChest({required this.kind, this.week, required this.day, required this.due, required this.done, required this.state});

  factory ProjectChest.fromJson(Map<String, dynamic> j) => ProjectChest(
        kind: j['kind'] as String,
        week: j['week'] as int?,
        day: j['day'] as String,
        due: j['due'] as int,
        done: j['done'] as int,
        state: j['state'] as String,
      );

  /// week ou final.
  final String kind;
  final int? week;
  final String day;
  final int due;
  final int done;
  /// open · upcoming · missed
  final String state;

  bool get isOpen => state == 'open';
  bool get isFinal => kind == 'final';

  /// Nombre de tâches à faire pour ouvrir le coffre (70 %, arrondi au-dessus, comme le serveur).
  int get needed => (due * 70 + 99) ~/ 100;

  String get badge => isFinal ? 'Programme terminé' : 'Semaine $week tenue';
}

class ProjectDetail {
  const ProjectDetail({required this.summary, required this.goalLabel, required this.programSource, required this.totalSteps, required this.completedSteps, required this.bestStreak, required this.sessionsPerWeek, required this.tasks, required this.days, required this.today, this.healthNote, this.budget, this.programTitle, this.validatedBy, this.measurement, this.chests = const []});

  factory ProjectDetail.fromJson(Map<String, dynamic> j) => ProjectDetail(
        summary: ProjectSummary.fromJson(j),
        goalLabel: (j['goal'] as Map<String, dynamic>?)?['label'] as String?,
        programSource: j['programSource'] as String,
        totalSteps: j['totalSteps'] as int,
        completedSteps: j['completedSteps'] as int,
        bestStreak: j['bestStreak'] as int,
        sessionsPerWeek: j['sessionsPerWeek'] as int?,
        healthNote: j['healthNote'] as String?,
        budget: j['budget'] as String?,
        programTitle: (j['program'] as Map<String, dynamic>?)?['title'] as String?,
        validatedBy: (j['program'] as Map<String, dynamic>?)?['validatedBy'] as String?,
        measurement: j['measurement'] == null ? null : Measurement.fromJson(j['measurement'] as Map<String, dynamic>),
        tasks: (j['tasks'] as List<dynamic>).map((e) => ProjectTask.fromJson(e as Map<String, dynamic>)).toList(),
        days: (j['days'] as List<dynamic>).map((e) => ProjectDay.fromJson(e as Map<String, dynamic>)).toList(),
        today: j['today'] as String,
        chests: ((j['chests'] as List<dynamic>?) ?? const []).map((e) => ProjectChest.fromJson(e as Map<String, dynamic>)).toList(),
      );

  final ProjectSummary summary;
  final String? goalLabel;
  /// template (modèle validé par BIM) ou answers (construit depuis les réponses).
  final String programSource;
  final int totalSteps;
  final int completedSteps;
  final int bestStreak;
  final int? sessionsPerWeek;
  final String? healthNote;
  /// Budget indicatif du projet Premium (aucun paiement).
  final String? budget;
  /// Programme type validé par BIM (null : programme construit depuis les réponses).
  final String? programTitle;
  final String? validatedBy;
  /// Suivi chiffré (ex. poids) si l'objectif en a un.
  final Measurement? measurement;
  final List<ProjectTask> tasks;
  final List<ProjectDay> days;
  final String today;
  final List<ProjectChest> chests;

  /// Séances par semaine affichées sur l'écran 24 : la réponse de la personne si elle existe,
  /// sinon la tâche la plus fréquente (une habitude quotidienne ne compte pas comme 7 séances choisies).
  int get perWeek => sessionsPerWeek ?? (tasks.isEmpty ? 0 : tasks.map((t) => _bits(t.weekdays)).reduce((a, b) => a > b ? a : b));

  static int _bits(int v) {
    var n = 0;
    for (var i = 0; i < 7; i++) {
      if (v & (1 << i) != 0) n++;
    }
    return n;
  }
}

class DayPlan {
  const DayPlan({required this.day, required this.index, required this.durationDays, required this.state, required this.editable, required this.tasks, this.tipText, this.tipValidatedBy});

  factory DayPlan.fromJson(Map<String, dynamic> j) => DayPlan(
        day: j['day'] as String,
        index: j['index'] as int?,
        durationDays: j['durationDays'] as int,
        state: j['state'] as String,
        editable: j['editable'] as bool,
        tasks: (j['tasks'] as List<dynamic>).map((e) => ProjectTask.fromJson(e as Map<String, dynamic>)).toList(),
        tipText: (j['tip'] as Map<String, dynamic>?)?['text'] as String?,
        tipValidatedBy: (j['tip'] as Map<String, dynamic>?)?['validatedBy'] as String?,
      );

  final String day;
  final int? index;
  final int durationDays;
  /// « Habitude du jour » : uniquement depuis un programme type validé.
  final String? tipText;
  final String? tipValidatedBy;
  final String state;
  final bool editable;
  final List<ProjectTask> tasks;
}

/// Réponses du parcours « Nouveau projet » (écrans 19 à 23).
class ProjectDraft {
  const ProjectDraft({
    this.mode,
    this.budget,
    this.categoryCode,
    this.goalCode,
    this.targetQuantity,
    this.description = '',
    this.receiveMerchantOffers = false,
    this.heightCm,
    this.weightKg,
    this.level,
    this.availability,
    this.sessionsPerWeek = 3,
    this.healthNote = '',
    this.durationDays,
  });

  /// Brouillon proposé par Peni (lot 3), au format de POST /v1/projects. Les champs absents gardent leur valeur par défaut.
  factory ProjectDraft.fromJson(Map<String, dynamic> j) => ProjectDraft(
        mode: j['mode'] as String?,
        budget: j['budget'] as String?,
        categoryCode: j['categoryCode'] as String?,
        goalCode: j['goalCode'] as String?,
        targetQuantity: (j['targetQuantity'] as num?)?.toInt(),
        description: j['description'] as String? ?? '',
        availability: j['availability'] as String?,
        sessionsPerWeek: (j['sessionsPerWeek'] as num?)?.toInt() ?? 3,
        durationDays: (j['durationDays'] as num?)?.toInt(),
      );

  final String? mode;
  final String? budget;
  final String? categoryCode;
  final String? goalCode;
  final int? targetQuantity;
  final String description;
  final bool receiveMerchantOffers;
  final int? heightCm;
  final int? weightKg;
  final String? level;
  final String? availability;
  final int sessionsPerWeek;
  final String healthNote;
  final int? durationDays;

  ProjectDraft copyWith({
    String? mode,
    String? budget,
    bool clearBudget = false,
    String? categoryCode,
    String? goalCode,
    bool clearGoal = false,
    int? targetQuantity,
    String? description,
    bool? receiveMerchantOffers,
    int? heightCm,
    bool clearHeight = false,
    int? weightKg,
    bool clearWeight = false,
    String? level,
    String? availability,
    int? sessionsPerWeek,
    String? healthNote,
    int? durationDays,
  }) =>
      ProjectDraft(
        mode: mode ?? this.mode,
        budget: clearBudget ? null : (budget ?? this.budget),
        categoryCode: categoryCode ?? this.categoryCode,
        goalCode: clearGoal ? null : (goalCode ?? this.goalCode),
        targetQuantity: clearGoal ? null : (targetQuantity ?? this.targetQuantity),
        description: description ?? this.description,
        receiveMerchantOffers: receiveMerchantOffers ?? this.receiveMerchantOffers,
        heightCm: clearHeight ? null : (heightCm ?? this.heightCm),
        weightKg: clearWeight ? null : (weightKg ?? this.weightKg),
        level: level ?? this.level,
        availability: availability ?? this.availability,
        sessionsPerWeek: sessionsPerWeek ?? this.sessionsPerWeek,
        healthNote: healthNote ?? this.healthNote,
        durationDays: durationDays ?? this.durationDays,
      );

  Map<String, dynamic> toJson() => {
        'mode': mode,
        if (mode == 'premium' && budget != null) 'budget': budget,
        'categoryCode': categoryCode,
        if (goalCode != null) 'goalCode': goalCode,
        if (goalCode != null && targetQuantity != null) 'targetQuantity': targetQuantity,
        if (description.trim().isNotEmpty) 'description': description.trim(),
        'receiveMerchantOffers': receiveMerchantOffers,
        if (heightCm != null) 'heightCm': heightCm,
        if (weightKg != null) 'weightKg': weightKg,
        if (level != null) 'level': level,
        if (availability != null) 'availability': availability,
        'sessionsPerWeek': sessionsPerWeek,
        if (healthNote.trim().isNotEmpty) 'healthNote': healthNote.trim(),
        if (durationDays != null) 'durationDays': durationDays,
      };
}

class Measurement {
  const Measurement({required this.unit, required this.items, this.start, this.latest, this.change});

  factory Measurement.fromJson(Map<String, dynamic> j) => Measurement(
        unit: j['unit'] as String,
        items: (j['items'] as List<dynamic>)
            .map((e) => (day: (e as Map<String, dynamic>)['day'] as String, value: (e['value'] as num).toDouble()))
            .toList(),
        start: (j['start'] as num?)?.toDouble(),
        latest: (j['latest'] as num?)?.toDouble(),
        change: (j['change'] as num?)?.toDouble(),
      );

  final String unit;
  final List<({String day, double value})> items;
  final double? start;
  final double? latest;
  final double? change;
}

/// Nombre à la française : 10,4 ; 84.
String frNumber(double v) => (v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1)).replaceAll('.', ',');

class ProjectPhoto {
  const ProjectPhoto({required this.id, required this.kind, required this.takenDay, required this.url});

  factory ProjectPhoto.fromJson(Map<String, dynamic> j) =>
      ProjectPhoto(id: j['id'] as String, kind: j['kind'] as String, takenDay: j['takenDay'] as String, url: j['url'] as String);

  final String id;
  final String kind;
  final String takenDay;
  final String url;
}

/// Signalement (écrans 21 et 27) : lié à un projet ou général (« Résoudre un problème »), image facultative.
class ProjectReport {
  const ProjectReport({
    required this.id,
    this.context = 'project',
    this.projectId,
    this.projectTitle,
    this.day,
    required this.reason,
    this.message,
    this.imageUrl,
    required this.status,
    this.resolution,
    this.createdAt,
  });

  factory ProjectReport.fromJson(Map<String, dynamic> j) => ProjectReport(
        id: j['id'] as String,
        context: (j['context'] ?? 'project') as String,
        projectId: j['projectId'] as String?,
        projectTitle: j['projectTitle'] as String?,
        day: j['day'] as String?,
        reason: j['reason'] as String,
        message: j['message'] as String?,
        imageUrl: (j['image'] as Map<String, dynamic>?)?['url'] as String?,
        status: j['status'] as String,
        resolution: j['resolution'] as String?,
        createdAt: j['createdAt'] == null ? null : DateTime.parse(j['createdAt'] as String),
      );

  final String id;
  /// project ou general.
  final String context;
  final String? projectId;
  final String? projectTitle;
  final String? day;
  final String reason;
  final String? message;
  /// Lien temporaire vers l'image jointe (privée).
  final String? imageUrl;
  final String status;
  final String? resolution;
  final DateTime? createdAt;

  bool get isGeneral => context == 'general';

  /// Motifs depuis la journée d'un projet (écran 27).
  static const reasons = {
    'unavailable': 'Lieu ou intervenant indisponible',
    'too_hard': 'Trop difficile pour moi',
    'health': 'Douleur ou malaise',
    'content': 'Tâche inadaptée',
    'other': 'Autre problème',
  };

  /// Motifs d'un problème général (« Résoudre un problème »).
  static const generalReasons = {
    'app': 'Difficulté avec l’application',
    'product': 'Problème avec un produit ou un service',
    'health': 'Douleur ou malaise',
    'other': 'Autre problème',
  };

  static String label(String reason) => reasons[reason] ?? generalReasons[reason] ?? reason;
}
