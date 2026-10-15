import { dueReminders, inQuietHours, isStale, ReminderContext, reminderMessage } from './reminders';

describe('calcul des rappels (lot 2)', () => {
  const base = (over: Partial<ReminderContext> = {}): ReminderContext => ({
    projectId: 'p',
    status: 'active',
    startDate: '2026-10-12',
    plannedEndDate: '2026-11-10',
    tasks: [{ id: 't', title: 'Séance', timeOfDay: '15:00', weekdays: 127 }],
    pauses: [],
    completions: new Set(),
    timeZone: 'Africa/Abidjan',
    offsets: [0, 60, 120],
    quiet: { start: '22:00', end: '06:00' },
    ...over,
  });
  const at = (iso: string) => new Date(iso);
  const minute = 60_000;

  it('à l’heure de la tâche, puis +1 h et +2 h (Abidjan = UTC)', () => {
    const r = dueReminders(base(), at('2026-10-15T00:00:00Z'), at('2026-10-15T23:59:00Z'));
    expect(r.map((x) => [x.attempt, x.fireAt.toISOString()])).toEqual([
      [0, '2026-10-15T15:00:00.000Z'],
      [1, '2026-10-15T16:00:00.000Z'],
      [2, '2026-10-15T17:00:00.000Z'],
    ]);
    expect(r[0].key).toBe('p|t|2026-10-15|0');
  });

  it('fenêtre ]from, to] : une occurrence n’apparaît que dans une seule fenêtre', () => {
    expect(dueReminders(base(), at('2026-10-15T14:59:00Z'), at('2026-10-15T15:00:00Z'))).toHaveLength(1);
    expect(dueReminders(base(), at('2026-10-15T15:00:00Z'), at('2026-10-15T15:01:00Z'))).toHaveLength(0);
  });

  it('découpage minute par minute sur une journée : aucun doublon, aucun oubli (deux tâches, trois tentatives)', () => {
    const ctx = base({ tasks: [{ id: 'a', title: 'Marche', timeOfDay: '07:00', weekdays: 127 }, { id: 'b', title: 'Séance', timeOfDay: '15:30', weekdays: 127 }] });
    const whole = dueReminders(ctx, at('2026-10-15T00:00:00Z'), at('2026-10-16T00:00:00Z')).map((x) => x.key);
    const pieces: string[] = [];
    for (let t = at('2026-10-15T00:00:00Z').getTime(); t < at('2026-10-16T00:00:00Z').getTime(); t += minute) {
      pieces.push(...dueReminders(ctx, new Date(t), new Date(t + minute)).map((x) => x.key));
    }
    expect(pieces).toEqual(whole);
    expect(new Set(pieces).size).toBe(pieces.length);
    expect(whole).toHaveLength(6);
  });

  it('tâche cochée, jour de pause, projet en pause ou terminé, jours hors programme : aucun rappel', () => {
    const day = [at('2026-10-15T00:00:00Z'), at('2026-10-16T00:00:00Z')] as const;
    expect(dueReminders(base({ completions: new Set(['t|2026-10-15']) }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ pauses: [{ startDay: '2026-10-14', endDay: '2026-10-16' }] }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ status: 'paused' }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ status: 'completed' }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ startDate: '2026-10-16' }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ plannedEndDate: '2026-10-14' }), ...day)).toHaveLength(0);
  });

  it('période active de la tâche et jours de la semaine respectés', () => {
    const day = [at('2026-10-15T00:00:00Z'), at('2026-10-16T00:00:00Z')] as const; // jeudi
    expect(dueReminders(base({ tasks: [{ id: 't', title: 'x', timeOfDay: '15:00', weekdays: 127, activeFrom: '2026-10-16' }] }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ tasks: [{ id: 't', title: 'x', timeOfDay: '15:00', weekdays: 127, activeUntil: '2026-10-15' }] }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ tasks: [{ id: 't', title: 'x', timeOfDay: '15:00', weekdays: 0b0010101 }] }), ...day)).toHaveLength(0); // lun, mer, ven
  });

  it('heures calmes 22:00 → 06:00 : les rappels qui y tombent ne partent pas', () => {
    const late = base({ tasks: [{ id: 't', title: 'Étirements', timeOfDay: '21:30', weekdays: 127 }] });
    const r = dueReminders(late, at('2026-10-15T00:00:00Z'), at('2026-10-16T12:00:00Z'));
    expect(r.filter((x) => x.day === '2026-10-15').map((x) => x.attempt)).toEqual([0]);
    expect(inQuietHours('21:59', { start: '22:00', end: '06:00' })).toBe(false);
    expect(inQuietHours('22:00', { start: '22:00', end: '06:00' })).toBe(true);
    expect(inQuietHours('05:59', { start: '22:00', end: '06:00' })).toBe(true);
    expect(inQuietHours('06:00', { start: '22:00', end: '06:00' })).toBe(false);
    expect(inQuietHours('13:00', { start: '12:00', end: '14:00' })).toBe(true);
    expect(inQuietHours('03:00', null)).toBe(false);
    // Sans heures calmes, le rappel « +1 h » d'une tâche de 23:30 part le lendemain à 00:30, rattaché au bon jour.
    const night = dueReminders(base({ quiet: null, tasks: [{ id: 't', title: 'x', timeOfDay: '23:30', weekdays: 127 }] }), at('2026-10-16T00:00:00Z'), at('2026-10-16T01:00:00Z'));
    expect(night.map((x) => [x.day, x.attempt])).toEqual([['2026-10-15', 1]]);
  });

  it('autre fuseau : 15:00 à Douala part à 14:00 UTC', () => {
    const r = dueReminders(base({ timeZone: 'Africa/Douala', offsets: [0] }), at('2026-10-15T00:00:00Z'), at('2026-10-16T00:00:00Z'));
    expect(r.map((x) => x.fireAt.toISOString())).toEqual(['2026-10-15T14:00:00.000Z']);
  });

  it('rappel périmé après le délai maximal (reprise après panne)', () => {
    expect(isStale(at('2026-10-15T15:00:00Z'), at('2026-10-15T15:29:00Z'), 30)).toBe(false);
    expect(isStale(at('2026-10-15T15:00:00Z'), at('2026-10-15T15:31:00Z'), 30)).toBe(true);
  });

  it('textes de Peni : courts, sans donnée sensible, selon la tentative', () => {
    expect(reminderMessage('Séance', 0, false).body).toBe('C’est l’heure : Séance. On y va ?');
    expect(reminderMessage('Séance', 1, false).body).toContain('Petit rappel');
    expect(reminderMessage('Séance', 2, true).body).toContain('il est encore temps');
    expect(reminderMessage('x'.repeat(80), 0, false).body.length).toBeLessThan(90);
  });
});
