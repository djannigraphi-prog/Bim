import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Jeton aléatoire opaque, encodé en base64url (sans caractères problématiques dans une URL). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales de même longueur. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Code numérique à n chiffres, tiré uniformément (pas de biais de modulo). */
export function numericCode(digits = 6): string {
  return randomInt(0, 10 ** digits).toString().padStart(digits, '0');
}
