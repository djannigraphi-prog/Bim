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
        icon: j['icon'] as String,
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

class ProjectDetail {
  const ProjectDetail({required this.summary, required this.goalLabel, required this.programSource, required this.totalSteps, required this.completedSteps, required this.bestStreak, required this.sessionsPerWeek, required this.tasks, required this.days, required this.today, this.healthNote, this.budget});

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
        tasks: (j['tasks'] as List<dynamic>).map((e) => ProjectTask.fromJson(e as Map<String, dynamic>)).toList(),
        days: (j['days'] as List<dynamic>).map((e) => ProjectDay.fromJson(e as Map<String, dynamic>)).toList(),
        today: j['today'] as String,
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
  final List<ProjectTask> tasks;
  final List<ProjectDay> days;
  final String today;

  /// Séances par semaine affichées sur l'écran 24 (la tâche la plus fréquente).
  int get perWeek => tasks.isEmpty ? 0 : tasks.map((t) => _bits(t.weekdays)).reduce((a, b) => a > b ? a : b);

  static int _bits(int v) {
    var n = 0;
    for (var i = 0; i < 7; i++) {
      if (v & (1 << i) != 0) n++;
    }
    return n;
  }
}

class DayPlan {
  const DayPlan({required this.day, required this.index, required this.durationDays, required this.state, required this.editable, required this.tasks});

  factory DayPlan.fromJson(Map<String, dynamic> j) => DayPlan(
        day: j['day'] as String,
        index: j['index'] as int?,
        durationDays: j['durationDays'] as int,
        state: j['state'] as String,
        editable: j['editable'] as bool,
        tasks: (j['tasks'] as List<dynamic>).map((e) => ProjectTask.fromJson(e as Map<String, dynamic>)).toList(),
      );

  final String day;
  final int? index;
  final int durationDays;
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
