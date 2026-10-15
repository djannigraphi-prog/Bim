import { isValidTimeZone, localDay, offsetMinutes, zonedTime } from './timezone';

describe('fuseaux horaires (lot 2)', () => {
  it('Abidjan (défaut) = UTC : le jour ne change qu’à minuit UTC', () => {
    expect(localDay(new Date('2026-10-15T23:59:00Z'))).toBe('2026-10-15');
    expect(localDay(new Date('2026-10-16T00:00:00Z'), 'Africa/Abidjan')).toBe('2026-10-16');
  });

  it('autre pays : Douala (UTC+1) passe au lendemain à 23:00 UTC', () => {
    expect(localDay(new Date('2026-10-15T22:59:00Z'), 'Africa/Douala')).toBe('2026-10-15');
    expect(localDay(new Date('2026-10-15T23:00:00Z'), 'Africa/Douala')).toBe('2026-10-16');
    expect(offsetMinutes(new Date('2026-10-15T12:00:00Z'), 'Africa/Douala')).toBe(60);
  });

  it('heure locale → instant UTC, y compris avec l’heure d’été', () => {
    expect(zonedTime('2026-10-15', '15:00').toISOString()).toBe('2026-10-15T15:00:00.000Z');
    expect(zonedTime('2026-10-15', '15:00', 'Africa/Douala').toISOString()).toBe('2026-10-15T14:00:00.000Z');
    // Paris : UTC+2 en été, UTC+1 en hiver (changement le 25/10/2026).
    expect(zonedTime('2026-10-24', '18:00', 'Europe/Paris').toISOString()).toBe('2026-10-24T16:00:00.000Z');
    expect(zonedTime('2026-10-26', '18:00', 'Europe/Paris').toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });

  it('fuseaux reconnus et refusés', () => {
    expect(isValidTimeZone('Africa/Abidjan')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Afrique/Abidjan')).toBe(false);
    expect(isValidTimeZone('Africa/Abidjan; DROP TABLE')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
