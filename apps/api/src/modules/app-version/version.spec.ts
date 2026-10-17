import { compareVersions } from './version';

describe('Version minimale de l’app (7-A) : comparaison', () => {
  it('compare x.y.z numériquement, ignore le numéro de build, refuse l’illisible', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0+7', '0.1.0')).toBe(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBeNull();
    expect(compareVersions('', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeNull();
  });
});
