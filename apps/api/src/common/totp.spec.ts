import { randomBytes } from 'node:crypto';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, otpauthUri, totpAt, verifyTotp } from './totp';

describe('TOTP (RFC 6238)', () => {
  // Secret de la RFC 6238, annexe B : « 12345678901234567890 ».
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('reproduit les vecteurs de test de la RFC (6 derniers chiffres)', () => {
    expect(totpAt(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(totpAt(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totpAt(secret, Math.floor(2000000000 / 30), 8)).toBe('69279037');
  });

  it('base32 aller-retour', () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it('accepte ± 30 s, refuse au-delà et refuse la réutilisation', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });

  it('chiffre les secrets (AES-256-GCM) et détecte une altération', () => {
    const key = randomBytes(32).toString('base64');
    const enc = encryptSecret('SECRET', key);
    expect(enc).not.toContain('SECRET');
    expect(decryptSecret(enc, key)).toBe('SECRET');
    const parts = enc.split('.');
    parts[2] = Buffer.from('autre').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });

  it('URI otpauth pour le QR code', () => {
    expect(otpauthUri('ABC', 'a@b.ci')).toBe('otpauth://totp/BIM%20Admin%3Aa%40b.ci?secret=ABC&issuer=BIM%20Admin&algorithm=SHA1&digits=6&period=30');
  });
});
