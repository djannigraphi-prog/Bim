import { addDays, computePlan, diffDays, generateTitle, isValidDay, spreadWeekdays, weekdayBit } from './plan';

describe('calendrier des projets', () => {
  it('jours de la semaine : lundi = bit 0, dimanche = bit 6', () => {
    expect(weekdayBit('2026-10-12')).toBe(1); // lundi
    expect(weekdayBit('2026-10-18')).toBe(64); // dimanche
  });

  it('répartit les séances dans la semaine', () => {
    expect(spreadWeekdays(3)).toBe(0b0010101); // lundi, mercredi, vendredi
    expect(spreadWeekdays(7)).toBe(127);
  });

  it('dates : addition, écart, validation', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-03-01', '2026-02-27')).toBe(2);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-02-28')).toBe(true);
  });

  it('progression, série et états des jours', () => {
    const tasks = [{ id: 'a', weekdays: 127 }];
    const done = new Set(['a|2026-10-12', 'a|2026-10-13', 'a|2026-10-15']);
    const s = computePlan({ startDate: '2026-10-12', plannedEndDate: '2026-10-21', tasks, pauses: [], completions: done, today: '2026-10-15' });
    expect(s.totalOccurrences).toBe(10);
    expect(s.completedOccurrences).toBe(3);
    expect(s.progress).toBe(30);
    expect(s.currentDayIndex).toBe(4);
    expect(s.days.map((d) => d.state).slice(0, 5)).toEqual(['done', 'done', 'missed', 'done', 'upcoming']);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(2);
  });

  it('aujourd’hui non terminé ne casse pas la série ; les jours de pause ne comptent pas', () => {
    const tasks = [{ id: 'a', weekdays: 127 }];
    const pauses = [{ startDay: '2026-10-13', endDay: '2026-10-14' }];
    const done = new Set(['a|2026-10-12', 'a|2026-10-15']);
    const s = computePlan({ startDate: '2026-10-12', plannedEndDate: '2026-10-18', tasks, pauses, completions: done, today: '2026-10-16' });
    expect(s.days.filter((d) => d.state === 'paused')).toHaveLength(2);
    expect(s.totalOccurrences).toBe(5);
    expect(s.streak).toBe(2);
    expect(s.currentDayIndex).toBe(3);
  });

  it('titre généré depuis l’objectif, la description ou la catégorie (E5)', () => {
    expect(generateTitle({ pattern: 'Perdre {q} kg', quantity: 10, categoryLabel: 'Sport' })).toBe('Perdre 10 kg');
    expect(generateTitle({ description: 'Une peau nette pour la rentrée', categoryLabel: 'Visage & peau' })).toBe('Une peau nette pour la rentrée');
    expect(generateTitle({ categoryLabel: 'Maquillage' })).toBe('Mon projet Maquillage');
  });
});
