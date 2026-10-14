import { UUID_RE, uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('produit un UUID v7 valide et triable par date', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(UUID_RE);
    expect(a[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(a[19]);
    expect(a < b).toBe(true);
  });
});
