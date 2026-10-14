import { ageOn, isRealDate } from './age';

describe('ageOn (F15)', () => {
  const on = new Date('2026-10-14T12:00:00Z');
  it("compte les années révolues : l'anniversaire du jour compte", () => {
    expect(ageOn('2010-10-14', on)).toBe(16);
    expect(ageOn('2010-10-15', on)).toBe(15);
    expect(ageOn('2008-10-14', on)).toBe(18);
    expect(ageOn('2008-10-15', on)).toBe(17);
  });
  it('gère les naissances un 29 février', () => {
    expect(ageOn('2008-02-29', new Date('2026-02-28T00:00:00Z'))).toBe(17);
    expect(ageOn('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(18);
  });
  it('refuse un format invalide', () => {
    expect(() => ageOn('14/10/2008', on)).toThrow();
  });
});

describe('isRealDate', () => {
  it('accepte une date réelle et refuse une date impossible', () => {
    expect(isRealDate('1998-03-12')).toBe(true);
    expect(isRealDate('2001-02-30')).toBe(false);
    expect(isRealDate('2001-13-01')).toBe(false);
    expect(isRealDate('98-03-12')).toBe(false);
  });
});
