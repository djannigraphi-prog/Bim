import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

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

/** Chiffrement de fichiers sensibles (pièces d'identité, lot 5) : AES-256-GCM, IV aléatoire, intégrité vérifiée. */
export function encryptBytes(plain: Buffer, keyBase64: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  // Format : version (1 octet) · IV (12) · étiquette (16) · données.
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), data]);
}

export function decryptBytes(payload: Buffer, keyBase64: string): Buffer {
  if (payload[0] !== 1) throw new Error('Format de fichier chiffré inconnu');
  const iv = payload.subarray(1, 13);
  const tag = payload.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]);
}
