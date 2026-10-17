import type { Chest } from '../projects/plan';
import { FORBIDDEN } from './encouragements';
import { chestMilestone, completionMilestone, MILESTONE_CATALOG, MILESTONES_VERSION } from './milestones';

const chest = (over: Partial<Chest> = {}): Chest => ({ kind: 'week', week: 2, day: '2026-10-14', fromIndex: 8, toIndex: 14, due: 10, done: 4, state: 'upcoming', ...over });

describe('Messages de Peni : coffres et fin du programme (lot 3)', () => {
  it('un message par état de coffre, chiffres du serveur (seuil 70 % arrondi au-dessus)', () => {
    expect(chestMilestone(chest())).toEqual({
      key: 'chest_week_upcoming',
      title: 'Coffre de la semaine 2',
      text: 'Fais au moins 7 des 10 tâches prévues cette semaine pour l’ouvrir. Pour l’instant : 4.',
      pose: 'think',
      version: MILESTONES_VERSION,
    });
    expect(chestMilestone(chest({ state: 'open', done: 8 }))).toMatchObject({ key: 'chest_week_open', title: 'Semaine 2 tenue !', pose: 'cheer' });
    expect(chestMilestone(chest({ state: 'missed' })).text).toContain('il faut 7 tâches sur 10, tu en as fait 4');
    expect(chestMilestone(chest({ kind: 'final', week: null, state: 'open', due: 40, done: 30 }))).toMatchObject({ key: 'chest_final_open', title: 'Programme terminé !' });
    expect(chestMilestone(chest({ kind: 'final', week: null, state: 'missed' })).key).toBe('chest_final_missed');
    expect(chestMilestone(chest({ kind: 'final', week: null })).text).toContain('au moins 7 des 10');
    expect(chestMilestone(chest({ state: 'open', done: 1, due: 1 })).text).toContain('1 tâche sur 1');
  });

  it('fin du programme : seulement quand le projet est terminé', () => {
    expect(completionMilestone({ status: 'active', title: 'Abdos' })).toBeNull();
    expect(completionMilestone({ status: 'completed', title: 'Abdos' })).toMatchObject({ key: 'program_completed', text: 'Tu es allé·e au bout de « Abdos ». Je suis tellement fière de toi ❤️' });
  });

  it('aucun mot culpabilisant, aucune promesse, aucune valeur financière dans tout le catalogue', () => {
    const samples = [
      { week: 1, done: 0, due: 1, needed: 1, title: 'Abdos' },
      { week: 3, done: 12, due: 14, needed: 10, title: 'Cheveux' },
    ];
    for (const [key, e] of Object.entries(MILESTONE_CATALOG)) {
      for (const v of samples) {
        const text = `${e.title(v)} ${e.text(v)}`;
        expect([key, text]).not.toEqual([key, expect.stringMatching(FORBIDDEN)]);
        expect(text).not.toMatch(/garanti|résultat assuré|FCFA|argent|pièce|€|\bF\b/i);
      }
    }
  });
});
