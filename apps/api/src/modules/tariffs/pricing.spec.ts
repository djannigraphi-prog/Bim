import { communeCode, deliveryFee, slug, waitFee } from './pricing';

const t = { baseFcfa: 500, perMinuteFcfa: 40, minimumFcfa: 1000, roundingFcfa: 25, freeWaitMinutes: 5, waitPerMinuteFcfa: 50, waitCapMinutes: 15 };

describe('7-D — calcul des frais', () => {
  it('minimum du mode, puis prise en charge + minutes, arrondi supérieur au pas', () => {
    expect(deliveryFee(t, 5)).toBe(1000); // 700 < minimum
    expect(deliveryFee(t, 30)).toBe(1700); // 500 + 1200
    expect(deliveryFee({ ...t, perMinuteFcfa: 33 }, 30)).toBe(1500); // 1490 → 1500
    expect(deliveryFee({ ...t, roundingFcfa: 1 }, 31)).toBe(1740);
    expect(() => deliveryFee(t, 0)).toThrow();
  });

  it('attente : gratuite puis à la minute pleine, plafonnée ; nulle si non facturée (A2-c)', () => {
    expect(waitFee(t, 4 * 60, true)).toEqual({ billableMinutes: 0, feeFcfa: 0 });
    expect(waitFee(t, 8 * 60 + 59, true)).toEqual({ billableMinutes: 3, feeFcfa: 150 });
    expect(waitFee(t, 120 * 60, true)).toEqual({ billableMinutes: 15, feeFcfa: 750 });
    expect(waitFee(t, 120 * 60, false)).toEqual({ billableMinutes: 15, feeFcfa: 0 });
    expect(waitFee(t, -30, true)).toEqual({ billableMinutes: 0, feeFcfa: 0 });
  });

  it('codes des communes stables, sans accents', () => {
    expect(slug('  Port-Bouët ')).toBe('port-bouet');
    expect(communeCode('Abidjan', 'Cocody')).toBe('abidjan-cocody');
    expect(communeCode('Grand-Bassam', 'Moossou')).toBe('grand-bassam-moossou');
  });
});
