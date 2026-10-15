import { addDays, chestReached, computePlan, PlanTask } from './plan';

/** Coffres de l'écran 26 (décision du fondateur du 15/10/2026) : 70 % des tâches prévues, semaine par semaine + final. */
describe('coffres du chemin', () => {
  const start = '2026-10-12'; // lundi
  const daily: PlanTask[] = [{ id: 'a', weekdays: 127 }];
  /** Toutes les occurrences cochées de `from` à `to` (inclus) pour la tâche `id`. */
  function ticks(id: string, from: string, to: string, skip: string[] = []): string[] {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (!skip.includes(d)) out.push(`${id}|${d}`);
    return out;
  }
  function plan(durationDays: number, tasks: PlanTask[], done: string[], today: string, pauses: { startDay: string; endDay: string }[] = []) {
    const extra = pauses.reduce((n, p) => n + (Date.parse(p.endDay) - Date.parse(p.startDay)) / 86_400_000 + 1, 0);
    return computePlan({ startDate: start, plannedEndDate: addDays(start, durationDays - 1 + extra), tasks, pauses, completions: new Set(done), today });
  }

  it('seuil de 70 % calculé en entiers, sans arrondi', () => {
    expect(chestReached(7, 10)).toBe(true);
    expect(chestReached(6, 9)).toBe(false); // 66,7 %
    expect(chestReached(5, 7)).toBe(true); // 71,4 %
    expect(chestReached(4, 6)).toBe(false); // 66,7 %
    expect(chestReached(0, 0)).toBe(false);
  });

  it.each([
    [5, 0],
    [7, 1],
    [14, 2],
    [28, 4],
    [30, 4],
    [60, 8],
    [90, 12],
  ])('programme de %i jours : %i coffres de semaine + 1 coffre final', (duration, weeks) => {
    const s = plan(duration, daily, [], start);
    expect(s.chests.filter((c) => c.kind === 'week')).toHaveLength(weeks);
    expect(s.chests.filter((c) => c.kind === 'final')).toHaveLength(1);
    const final = s.chests.find((c) => c.kind === 'final')!;
    expect(final).toMatchObject({ fromIndex: 1, toIndex: duration, due: duration });
    // Les coffres de semaine couvrent exactement 7 jours de programme ; les jours restants ne comptent que pour le final.
    for (const c of s.chests.filter((x) => x.kind === 'week')) expect(c.toIndex - c.fromIndex).toBe(6);
  });

  it('28 jours : le coffre de la semaine 4 et le coffre final tombent le même jour et restent distincts', () => {
    const s = plan(28, daily, ticks('a', start, addDays(start, 27)), addDays(start, 27));
    const sameDay = s.chests.filter((c) => c.day === addDays(start, 27));
    expect(sameDay.map((c) => c.kind)).toEqual(['week', 'final']);
    expect(sameDay.every((c) => c.state === 'open')).toBe(true);
  });

  it('semaine : 5 séances sur 7 ouvrent (71 %), 4 sur 7 non (57 %) ; le rattrapage d’un jour passé compte', () => {
    const today = addDays(start, 9);
    const five = plan(30, daily, ticks('a', start, addDays(start, 6), [addDays(start, 1), addDays(start, 3)]), today);
    expect(five.chests[0]).toMatchObject({ kind: 'week', week: 1, due: 7, done: 5, state: 'open' });
    const four = plan(30, daily, ticks('a', start, addDays(start, 6), [addDays(start, 1), addDays(start, 3), addDays(start, 5)]), today);
    expect(four.chests[0]).toMatchObject({ due: 7, done: 4, state: 'missed' });
    // Rattrapage d'un jour manqué de la semaine 1 : 5 sur 7, le coffre s'ouvre.
    const caught = plan(30, daily, [...ticks('a', start, addDays(start, 6), [addDays(start, 1), addDays(start, 3), addDays(start, 5)]), `a|${addDays(start, 5)}`], today);
    expect(caught.chests[0].state).toBe('open');
  });

  it('semaine en cours : « à venir » tant que le seuil n’est pas atteint, ouvert dès qu’il l’est', () => {
    const threeAWeek: PlanTask[] = [{ id: 's', weekdays: 0b0010101 }]; // lundi, mercredi, vendredi
    const midweek = plan(30, threeAWeek, ['s|2026-10-12', 's|2026-10-14'], '2026-10-14');
    expect(midweek.chests[0]).toMatchObject({ due: 3, done: 2, state: 'upcoming' });
    const friday = plan(30, threeAWeek, ['s|2026-10-12', 's|2026-10-14', 's|2026-10-16'], '2026-10-16');
    expect(friday.chests[0]).toMatchObject({ due: 3, done: 3, state: 'open' }); // avant dimanche : rien d'autre n'est prévu
  });

  it('les tâches non prévues ne comptent pas : tâche ajoutée en cours de route, tâche retirée, jours de repos', () => {
    const tasks: PlanTask[] = [
      { id: 'a', weekdays: 127 },
      // Ajoutée le jeudi de la semaine 1 : elle ne compte pas pour lundi, mardi, mercredi.
      { id: 'b', weekdays: 127, activeFrom: '2026-10-15' },
      // Retirée le mercredi : elle compte lundi et mardi seulement.
      { id: 'c', weekdays: 127, activeUntil: '2026-10-14' },
      // Jamais prévue un jour de cette semaine (aucun jour coché) : ne compte pas.
    ];
    const done = [...ticks('a', start, '2026-10-18'), ...ticks('b', '2026-10-15', '2026-10-18'), 'c|2026-10-12', 'c|2026-10-13'];
    const s = plan(30, tasks, done, '2026-10-19');
    // a : 7 ; b : 4 (jeudi → dimanche) ; c : 2 (lundi, mardi) = 13 prévues, 13 faites.
    expect(s.chests[0]).toMatchObject({ due: 13, done: 13, state: 'open' });
    expect(s.days[0]).toMatchObject({ due: 2, done: 2, state: 'done' }); // lundi : a et c, pas b
    expect(s.days[3]).toMatchObject({ due: 2 }); // jeudi : a et b, plus c
  });

  it('les jours de pause ne comptent pas : la semaine 1 couvre 7 jours de programme, pas 7 jours de calendrier', () => {
    const pauses = [{ startDay: '2026-10-14', endDay: '2026-10-15' }]; // mercredi et jeudi
    const s = plan(14, daily, ticks('a', start, '2026-10-20', ['2026-10-14', '2026-10-15']), '2026-10-21', pauses);
    const week1 = s.chests[0];
    expect(week1).toMatchObject({ fromIndex: 1, toIndex: 7, due: 7, done: 7, day: '2026-10-20', state: 'open' });
  });

  it('une semaine sans aucune tâche prévue n’a pas de coffre', () => {
    const onlyWeek2: PlanTask[] = [{ id: 'x', weekdays: 127, activeFrom: '2026-10-19' }];
    const s = plan(14, onlyWeek2, [], start);
    expect(s.chests.map((c) => c.week ?? 'final')).toEqual([2, 'final']);
  });

  it('coffre final : jamais ouvert avant le dernier jour, même au-dessus du seuil', () => {
    const almost = plan(10, daily, ticks('a', start, addDays(start, 8)), addDays(start, 8)); // 9 sur 10, avant-dernier jour
    expect(almost.chests.find((c) => c.kind === 'final')!.state).toBe('upcoming');
    const last = plan(10, daily, ticks('a', start, addDays(start, 8)), addDays(start, 9));
    expect(last.chests.find((c) => c.kind === 'final')).toMatchObject({ due: 10, done: 9, state: 'open' });
    const tooLow = plan(10, daily, ticks('a', start, addDays(start, 5)), addDays(start, 10));
    expect(tooLow.chests.find((c) => c.kind === 'final')).toMatchObject({ done: 6, state: 'missed' });
  });
});
