import { explainTask, ExplainInput, hourFr, weekdaysFr } from './task-explanations';

const input = (over: { task?: Partial<ExplainInput['task']>; project?: Partial<ExplainInput['project']>; reminders?: Partial<ExplainInput['reminders']>; quietNow?: boolean } = {}): ExplainInput => ({
  task: { id: 't1', title: 'Séance · Abdos', detail: 'Créée à partir de tes réponses.', timeOfDay: '15:00', weekdays: 0b1100000, origin: 'answers', ...over.task },
  project: { status: 'active', pausedUntil: null, categoryCode: 'sport', categoryLabel: 'Sport', goalLabel: 'Abdos', programTitle: null, validatedBy: null, ...over.project },
  reminders: { serviceOpen: true, enabledByPerson: true, offsets: [0, 60, 120], quiet: { start: '22:00', end: '06:00' }, ...over.reminders },
  quietNow: over.quietNow ?? false,
});
const section = (e: ReturnType<typeof explainTask>, id: string) => e.sections.find((s) => s.id === id)!.answer;

describe('Peni explique une tâche (lot 3, écran 24)', () => {
  it('cinq questions courtes, dans le même ordre', () => {
    const e = explainTask(input());
    expect(e.sections.map((s) => s.question)).toEqual(['C’est quoi ?', 'Quand ?', 'Comment m’y prendre ?', 'Et si je ne peux pas ?', 'Vais-je avoir un rappel ?']);
    expect(e).toMatchObject({ taskId: 't1', title: 'Séance · Abdos', pose: 'think', version: 'v1', intro: 'Bonne question ! Voici « Séance · Abdos » expliquée simplement 👇' });
    for (const s of e.sections) expect(s.answer.length).toBeLessThan(330); // court, lisible par un débutant
  });

  it('séance construite depuis les réponses : aucun exercice inventé, la personne choisit le contenu', () => {
    const what = section(explainTask(input()), 'what');
    expect(what).toBe(
      'C’est ta séance de sport · abdos. Je l’ai préparée à partir de tes réponses. Le détail des exercices n’est pas encore rédigé par l’équipe BIM pour cette catégorie : en attendant, tu choisis ce que tu fais, à ton rythme.',
    );
    expect(section(explainTask(input()), 'how')).not.toMatch(/\d+ ?(fois|répétitions|séries|minutes de)/);
  });

  it('tâche d’un programme validé : contenu et validation repris tels quels ; tâche ajoutée par la personne', () => {
    const t = explainTask(input({ task: { origin: 'template', detail: '3 séries de 10 relevés de buste' }, project: { programTitle: 'Abdos débutant', validatedBy: 'Coach Awa' } }));
    expect(section(t, 'what')).toBe('Elle fait partie du programme type « Abdos débutant », validé par Coach Awa. Le programme prévoit : 3 séries de 10 relevés de buste');
    expect(section(explainTask(input({ task: { origin: 'user', detail: 'Marcher jusqu’au marché' } })), 'what')).toBe('C’est une tâche que tu as ajoutée toi-même : « Marcher jusqu’au marché ». C’est toi qui décides de son contenu.');
    expect(section(explainTask(input({ task: { origin: 'user', detail: null } })), 'what')).toBe('C’est une tâche que tu as ajoutée toi-même : c’est toi qui décides de son contenu.');
  });

  it('quand : heure et jours en français courant', () => {
    expect(section(explainTask(input()), 'when')).toBe('À 15 h, le samedi et le dimanche : 2 fois par semaine.');
    expect(section(explainTask(input({ task: { weekdays: 127, timeOfDay: '07:30' } })), 'when')).toBe('À 7 h 30, tous les jours.');
    expect(weekdaysFr(0b0010101)).toBe('le lundi, le mercredi et le vendredi');
    expect(weekdaysFr(1)).toBe('le lundi');
    expect(hourFr('21:05')).toBe('21 h 05');
  });

  it('sport : prudence et renvoi vers un professionnel (aucun avis médical) ; autres catégories : conseils généraux', () => {
    const how = section(explainTask(input()), 'how');
    expect(how).toContain('arrête-toi si tu as mal');
    expect(how).toContain('professionnel de santé');
    expect(how).toContain('coche la tâche dans ta journée');
    expect(section(explainTask(input({ project: { categoryCode: 'maquillage', categoryLabel: 'Maquillage', goalLabel: null } })), 'how')).toContain('démaquiller');
    expect(section(explainTask(input({ project: { categoryCode: 'nouvelle', categoryLabel: 'Nouvelle', goalLabel: null } })), 'how')).toContain('Va à ton rythme');
  });

  it('jamais culpabilisant si la tâche n’est pas faite', () => {
    const missed = section(explainTask(input()), 'missed');
    expect(missed).toContain('Pas grave');
    expect(missed).toContain('70 %');
    for (const s of explainTask(input()).sections) expect(s.answer).not.toMatch(/rat[ée]|échec|honte|déçu|dommage|tu dois/i);
  });

  it('rappels : selon le service, le choix de la personne et ses heures calmes (relances bloquées, option B)', () => {
    expect(section(explainTask(input()), 'reminders')).toBe('Je te rappelle à 15 h, puis à 16 h et 17 h si la tâche n’est pas cochée.');
    expect(section(explainTask(input({ task: { timeOfDay: '21:30' } })), 'reminders')).toBe('Je te rappelle à 21 h 30. Pas de relance ensuite : elles tomberaient pendant tes heures calmes (22 h – 6 h).');
    expect(section(explainTask(input({ task: { timeOfDay: '20:30' } })), 'reminders')).toBe('Je te rappelle à 20 h 30, puis à 21 h 30 si la tâche n’est pas cochée. Pas d’autre relance : elle tomberait pendant tes heures calmes (22 h – 6 h).');
    expect(section(explainTask(input({ reminders: { quiet: { start: '14:00', end: '16:30' } } })), 'reminders')).toBe('Je te rappelle à 15 h, puis à 17 h si la tâche n’est pas cochée. Pas d’autre relance : elle tomberait pendant tes heures calmes (14 h – 16 h 30).');
    expect(section(explainTask(input({ reminders: { enabledByPerson: false } })), 'reminders')).toBe('Tes rappels sont désactivés. Tu peux les activer quand tu veux dans Paramètres → Rappels.');
    expect(section(explainTask(input({ reminders: { serviceOpen: false, enabledByPerson: true } })), 'reminders')).toContain('pas encore en service');
  });

  it('pause : la tâche reprendra ensuite, aucun rappel pendant la pause', () => {
    const e = explainTask(input({ project: { status: 'paused', pausedUntil: '2026-10-20' } }));
    expect(e.intro).toBe('Ton projet est en pause jusqu’au 20 octobre inclus : « Séance · Abdos » reprendra ensuite. Voici ce qu’il faut savoir 👇');
    expect(section(e, 'reminders')).toBe('Aucun rappel pendant la pause. Ils reprendront avec ton projet.');
    expect(section(e, 'when')).toContain('Rien n’est prévu pendant la pause.');
    expect(e.pose).toBe('happy');
    expect(explainTask(input({ project: { status: 'paused', pausedUntil: '2026-11-01' } })).intro).toContain('jusqu’au 1er novembre');
  });

  it('heures calmes au moment de la question : aucune invitation à faire la tâche maintenant', () => {
    const e = explainTask(input({ quietNow: true }));
    expect(e.intro).toBe('Voici « Séance · Abdos » expliquée simplement 👇 Il est tard : rien ne presse, on s’y remet demain 🌙');
    expect(e.pose).toBe('happy');
  });
});
