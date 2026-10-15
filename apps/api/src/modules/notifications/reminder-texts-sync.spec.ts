import { readFileSync } from 'fs';
import { join } from 'path';
import { reminderMessage } from './reminders';

/**
 * Les textes de l'essai « Les 3 textes de Peni » de l'app (tests sur téléphones) sont une copie des modèles du serveur :
 * ce test garantit qu'on vérifie sur les téléphones exactement ce que le serveur enverra (textes et poses).
 */
describe('textes des rappels : copie de l’app identique au serveur', () => {
  it('les trois textes et poses de l’essai sur téléphone sont ceux de reminderMessage', () => {
    const dart = readFileSync(join(__dirname, '../../../../mobile/lib/features/notifications/presentation/reminder_preferences_screen.dart'), 'utf8');
    const block = /const testReminderTexts = \[([\s\S]*?)\];/.exec(dart)?.[1];
    expect(block).toBeDefined();
    const copies = [...block!.matchAll(/\('([^']*)', '(\w+)'\)/g)].map((m) => [m[1], m[2]]);
    const server = [0, 1, 2].map((a) => reminderMessage('Séance d’essai', a, a === 2)).map((m) => [m.body, m.pose]);
    expect(copies).toEqual(server);
  });
});
