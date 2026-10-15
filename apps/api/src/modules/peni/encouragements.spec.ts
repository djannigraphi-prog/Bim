import type { Chest, DaySummary } from '../projects/plan';
import { CATALOG, encouragement, EncouragementInput, FORBIDDEN, situation } from './encouragements';

const day = (over: Partial<DaySummary> = {}): DaySummary => ({ day: '2026-10-15', index: 5, due: 2, done: 0, state: 'today', ...over });
const input = (over: Partial<EncouragementInput> = {}): EncouragementInput => ({
  context: 'day',
  firstName: 'Awa',
  projectId: 'p1',
  projectStatus: 'active',
  durationDays: 30,
  day: day(),
  today: '2026-10-15',
  previous: day({ day: '2026-10-14', index: 4, done: 2, state: 'done' }),
  streak: 1,
  weekChest: null,
  localTime: '09:00',
  quiet: false,
  ...over,
});
const chest = (over: Partial<Chest> = {}): Chest => ({ kind: 'week', week: 1, day: '2026-10-18', fromIndex: 1, toIndex: 7, due: 10, done: 5, state: 'upcoming', ...over });

describe('encouragements de Peni (lot 3, écrans 26 et 27)', () => {
  it('selon le moment de la journée, sans rien de fait : matin (avec le prénom), après-midi, soir', () => {
    expect(encouragement(input()).text).toBe('Bonjour Awa ☀️ 2 tâches au programme aujourd’hui. On commence tranquillement ?');
    expect(encouragement(input({ localTime: '14:30' })).text).toBe('2 tâches au programme aujourd’hui. Un petit pas suffit pour commencer 🙂');
    expect(encouragement(input({ localTime: '19:00' })).text).toBe('Il reste encore un peu de temps aujourd’hui 🙂 Même une seule tâche, c’est déjà bien.');
    expect(encouragement(input({ day: day({ due: 1 }) })).text).toBe('Bonjour Awa ☀️ 1 tâche au programme aujourd’hui. On commence tranquillement ?');
  });

  it('heures calmes : jamais d’incitation à faire une tâche, quel que soit l’état de la journée', () => {
    expect(encouragement(input({ quiet: true, localTime: '22:30' }))).toMatchObject({ key: 'quiet_night', pose: 'happy' });
    expect(encouragement(input({ quiet: true, localTime: '01:00' })).key).toBe('quiet_night');
    expect(encouragement(input({ quiet: true, localTime: '05:30' }))).toMatchObject({ key: 'quiet_early', text: 'Il est encore tôt 🌙 Rien ne presse : on s’y met quand la journée commence.' });
    expect(encouragement(input({ quiet: true, localTime: '14:00' })).key).toBe('quiet_calm'); // heures calmes personnelles en journée
    expect(encouragement(input({ quiet: true, localTime: '23:00', day: day({ done: 2, state: 'done' }) })).text).toBe('Tout est fait pour aujourd’hui 🌙 Bravo, et bonne nuit !');
    // Même le premier jour, la fin du programme ou un coffre proche ne passent pas avant les heures calmes.
    for (const over of [{ day: day({ index: 1 }) }, { day: day({ index: 29 }) }, { context: 'map' as const, weekChest: chest({ done: 6 }) }]) {
      expect(situation(input({ ...over, quiet: true, localTime: '23:00' }))).toBe('quiet_night');
    }
    for (const key of ['quiet_night', 'quiet_early', 'quiet_calm']) {
      for (const v of CATALOG[key].variants) expect(v({ name: 'Awa', done: 0, total: 2, remaining: 2, streak: 0, left: 3, needed: 1 })).not.toMatch(/on y va|on commence|allez|vas-y|fais /i);
    }
  });

  it('journée réussie, avec ou sans série ; journée commencée', () => {
    expect(encouragement(input({ day: day({ done: 2, state: 'done' }) })).key).toBe('today_done');
    expect(encouragement(input({ day: day({ done: 2, state: 'done' }), streak: 5 })).text).toBe('Tout est fait, et ça fait 5 jours d’affilée 🔥 Bravo !');
    const partial = encouragement(input({ day: day({ due: 3, done: 1 }) }));
    expect(partial.key).toBe('partial');
    expect(['1 sur 3, c’est un bon début 👏 On continue ?', 'Déjà 1 tâche faite ! Il en reste 2, tu gères 💪']).toContain(partial.text);
  });

  it('premier jour, derniers jours, retour après un jour sans tâche cochée (sans culpabiliser)', () => {
    expect(encouragement(input({ day: day({ index: 1 }), previous: null })).text).toBe('C’est le premier jour ! 🎉 On commence ensemble ?');
    expect(encouragement(input({ day: day({ index: 28 }) })).text).toBe('Plus que 3 jours avant la fin du programme : tu y es presque ! 💪');
    expect(encouragement(input({ day: day({ index: 30 }) })).text).toBe('Plus que 1 jour avant la fin du programme : tu y es presque ! 💪');
    const back = encouragement(input({ previous: day({ day: '2026-10-14', index: 4, done: 0, state: 'missed' }) }));
    expect(back.key).toBe('comeback');
    expect(back.text).not.toMatch(/hier/);
  });

  it('carte : coffre de la semaine proche (3 tâches ou moins) ; pas sur l’écran de la journée', () => {
    expect(encouragement(input({ context: 'map', weekChest: chest({ done: 5 }) })).text).toBe('Plus que 2 tâches cette semaine pour ouvrir ton coffre 🎁');
    expect(encouragement(input({ context: 'map', weekChest: chest({ done: 6 }) })).text).toBe('Plus que 1 tâche cette semaine pour ouvrir ton coffre 🎁');
    expect(situation(input({ context: 'map', weekChest: chest({ done: 1 }) }))).toBe('morning'); // encore loin : pas de pression
    expect(situation(input({ context: 'map', weekChest: chest({ done: 7, state: 'open' }) }))).toBe('morning');
    expect(situation(input({ context: 'day', weekChest: chest({ done: 6 }) }))).toBe('morning');
  });

  it('autres jours, repos, pause, projet terminé ou pas encore commencé', () => {
    const past = (over: Partial<DaySummary>) => encouragement(input({ day: day({ day: '2026-10-10', index: 1, ...over }) }));
    expect(past({ done: 2, state: 'done' }).text).toBe('Journée réussie ✅ Bravo !');
    expect(past({ done: 1, state: 'partial' }).text).toBe('1 sur 2 ce jour-là : chaque pas compte 👏');
    expect(past({ state: 'missed' }).text).toBe('Ce jour-là n’a pas été coché. Pas grave : ce qui compte, c’est aujourd’hui 💛');
    expect(encouragement(input({ day: day({ day: '2026-10-20', state: 'upcoming' }) })).key).toBe('future_day');
    expect(encouragement(input({ day: day({ due: 0, state: 'rest' }) })).key).toBe('rest');
    expect(encouragement(input({ day: day({ index: null, state: 'paused' }) })).text).toBe('Ton projet est en pause. Repose-toi bien, je t’attends ! 💛');
    expect(encouragement(input({ projectStatus: 'paused', day: null })).key).toBe('paused');
    expect(encouragement(input({ projectStatus: 'completed' })).text).toBe('Programme terminé ! Bravo pour tout ce chemin 🎉');
    expect(encouragement(input({ day: null })).key).toBe('not_started_yet');
  });

  it('même tournure toute la journée pour un projet, variée d’un jour à l’autre ; pose jamais triste', () => {
    const a = encouragement(input({ day: day({ due: 3, done: 1 }) }));
    expect(encouragement(input({ day: day({ due: 3, done: 1 }) }))).toEqual(a);
    const texts = new Set(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((d) => encouragement(input({ today: d, day: day({ day: d, due: 3, done: 1 }) })).text));
    expect(texts.size).toBe(2);
    for (const entry of Object.values(CATALOG)) expect(entry.pose).not.toBe('sad');
  });

  it('aucun mot culpabilisant ni promesse de résultat dans tout le catalogue', () => {
    const samples = [0, 1, 2, 5].map((n) => ({ name: 'Awa', done: n, total: n + 2, remaining: 2, streak: n + 3, left: n + 1, needed: n + 1 }));
    for (const [key, entry] of Object.entries(CATALOG)) {
      for (const variant of entry.variants) {
        for (const vars of samples) {
          const text = variant(vars);
          expect([key, text]).not.toEqual([key, expect.stringMatching(FORBIDDEN)]);
          expect(text).not.toMatch(/garanti|résultat assuré|sans effort|maigrir vite/i);
          expect(text.length).toBeLessThan(120);
        }
      }
    }
  });
});
