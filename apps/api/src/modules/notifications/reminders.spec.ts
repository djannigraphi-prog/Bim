import { dueReminders, inQuietHours, isStale, quietExempt, ReminderContext, reminderMessage } from './reminders';

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
    // Projet en pause : ses jours de pause ne déclenchent rien ; une pause terminée (statut « paused » resté en base,
    // audit du 18/10/2026) n'empêche plus les rappels.
    expect(dueReminders(base({ status: 'paused', pauses: [{ startDay: '2026-10-15', endDay: '2026-10-17' }] }), ...day)).toHaveLength(0);
    expect(dueReminders(base({ status: 'paused', pauses: [{ startDay: '2026-10-12', endDay: '2026-10-13' }] }), ...day).length).toBeGreaterThan(0);
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

  it('heures calmes 22:00 → 06:00, option B : le rappel à l’heure choisie part, les relances qui y tombent non', () => {
    const attempts = (time: string) =>
      dueReminders(base({ tasks: [{ id: 't', title: 'x', timeOfDay: time, weekdays: 127 }] }), at('2026-10-15T00:00:00Z'), at('2026-10-16T12:00:00Z'))
        .filter((x) => x.day === '2026-10-15')
        .map((x) => [x.attempt, x.fireAt.toISOString().slice(11, 16)]);
    expect(attempts('15:00')).toEqual([[0, '15:00'], [1, '16:00'], [2, '17:00']]);
    expect(attempts('20:30')).toEqual([[0, '20:30'], [1, '21:30']]); // 22:30 supprimé
    expect(attempts('21:30')).toEqual([[0, '21:30']]); // 22:30 et 23:30 supprimés
    expect(attempts('22:00')).toEqual([[0, '22:00']]); // heure choisie : envoyé ; 23:00 et 00:00 supprimés
    expect(attempts('23:30')).toEqual([[0, '23:30']]); // 00:30 et 01:30 (le lendemain) supprimés
    expect(attempts('05:30')).toEqual([[0, '05:30'], [1, '06:30'], [2, '07:30']]);
    expect(attempts('06:00')).toEqual([[0, '06:00'], [1, '07:00'], [2, '08:00']]);
    // Jamais reporté : rien n'apparaît le matin à 06:00 pour une tâche de 23:30.
    const morning = dueReminders(base({ tasks: [{ id: 't', title: 'x', timeOfDay: '23:30', weekdays: 127 }] }), at('2026-10-16T00:00:00Z'), at('2026-10-16T12:00:00Z'));
    expect(morning.filter((x) => x.day === '2026-10-15')).toEqual([]);
    expect(inQuietHours('21:59', { start: '22:00', end: '06:00' })).toBe(false);
    expect(inQuietHours('22:00', { start: '22:00', end: '06:00' })).toBe(true);
    expect(inQuietHours('05:59', { start: '22:00', end: '06:00' })).toBe(true);
    expect(inQuietHours('06:00', { start: '22:00', end: '06:00' })).toBe(false);
    expect(inQuietHours('13:00', { start: '12:00', end: '14:00' })).toBe(true);
    expect(inQuietHours('03:00', null)).toBe(false);
    expect([0, 1, 2].map(quietExempt)).toEqual([true, false, false]);
    // Sans heures calmes, le rappel « +1 h » d'une tâche de 23:30 part le lendemain à 00:30, rattaché au bon jour.
    const night = dueReminders(base({ quiet: null, tasks: [{ id: 't', title: 'x', timeOfDay: '23:30', weekdays: 127 }] }), at('2026-10-16T00:00:00Z'), at('2026-10-16T01:00:00Z'));
    expect(night.map((x) => [x.day, x.attempt])).toEqual([['2026-10-15', 1]]);
  });

  it('option B, découpage minute par minute sur une nuit : aucun doublon, aucun envoi de relance pendant les heures calmes', () => {
    const ctx = base({ tasks: [{ id: 'a', title: 'x', timeOfDay: '21:30', weekdays: 127 }, { id: 'b', title: 'y', timeOfDay: '23:00', weekdays: 127 }, { id: 'c', title: 'z', timeOfDay: '05:00', weekdays: 127 }] });
    const keys: string[] = [];
    const sent: { attempt: number; hhmm: string }[] = [];
    for (let t = at('2026-10-15T18:00:00Z').getTime(); t < at('2026-10-16T09:00:00Z').getTime(); t += minute) {
      for (const r of dueReminders(ctx, new Date(t), new Date(t + minute))) {
        keys.push(r.key);
        sent.push({ attempt: r.attempt, hhmm: r.fireAt.toISOString().slice(11, 16) });
      }
    }
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of sent) if (r.attempt > 0) expect(inQuietHours(r.hhmm, { start: '22:00', end: '06:00' })).toBe(false);
    expect(sent.map((r) => [r.attempt, r.hhmm])).toEqual([[0, '21:30'], [0, '23:00'], [0, '05:00'], [1, '06:00'], [2, '07:00']]);
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
    expect(reminderMessage('Séance', 0, false)).toEqual({ title: 'Peni', body: 'Séance : c’est l’heure ! 💪 Tu vas tout déchirer.', pose: 'happy' });
    expect(reminderMessage('Séance', 1, false)).toEqual({ title: 'Peni', body: 'Séance t’attend encore. Un petit pas aujourd’hui, c’est déjà gagné 🙂', pose: 'think' });
    expect(reminderMessage('Séance', 2, true)).toEqual({ title: 'Peni', body: 'Séance : encore un peu de temps ! Et sinon, demain est une nouvelle chance 💛', pose: 'happy' });
    // La tâche est au début du texte (visible dans une notification repliée), et jamais de pose triste.
    for (const a of [0, 1, 2]) {
      expect(reminderMessage('Séance · Abdos', a, a === 2).body.startsWith('Séance · Abdos')).toBe(true);
      expect(reminderMessage('Séance', a, a === 2).pose).not.toBe('sad');
    }
    // Une seule tentative prévue : c'est aussi la dernière, mais le premier texte reste celui de l'heure de la tâche.
    expect(reminderMessage('Séance', 0, true).pose).toBe('happy');
    expect(reminderMessage('x'.repeat(80), 0, false).body.length).toBeLessThan(110);
    // Aucun mot qui culpabilise (décision C8).
    for (const a of [0, 1, 2]) expect(reminderMessage('Séance', a, a === 2).body).not.toMatch(/supplie|honte|déçu|nul/i);
  });
});
