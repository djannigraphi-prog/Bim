import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Hachage des mots de passe : Argon2id, paramètres minimaux recommandés par l'OWASP
 * (19 Mio de mémoire, 2 itérations, 1 fil). À réévaluer si les serveurs le permettent.
 */
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'motdepasse', 'azertyuiop', 'qwertyuiop', '00000000',
  '11111111', 'abidjan2024', 'abidjan2025', 'abidjan2026', 'bim12345', 'iloveyou', 'password1',
]);

@Injectable()
export class PasswordService {
  /** Empreinte factice : vérifiée quand le compte n'existe pas, pour que la durée de réponse ne révèle rien. */
  private dummyHash: Promise<string> = hash('bim-dummy-password-for-timing', OPTIONS);

  hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  async verify(hashValue: string | null, plain: string): Promise<boolean> {
    if (!hashValue) {
      await verify(await this.dummyHash, plain).catch(() => false);
      return false;
    }
    return verify(hashValue, plain).catch(() => false);
  }

  /** Retourne la raison du refus, ou null si le mot de passe est acceptable. */
  weakness(plain: string, context: { username?: string } = {}): string | null {
    if (plain.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
    if (plain.length > 128) return 'Le mot de passe ne doit pas dépasser 128 caractères.';
    if (COMMON_PASSWORDS.has(plain.toLowerCase())) return 'Ce mot de passe est trop courant.';
    if (context.username && plain.toLowerCase().includes(context.username.toLowerCase()))
      return "Le mot de passe ne doit pas contenir ton nom d'utilisateur.";
    if (/^(.)\1+$/.test(plain)) return 'Le mot de passe ne doit pas répéter un seul caractère.';
    return null;
  }
}
