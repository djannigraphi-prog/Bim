import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hache en Argon2id et vérifie', async () => {
    const h = await svc.hash('Bim-Test-2026!');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(h, 'Bim-Test-2026!')).toBe(true);
    expect(await svc.verify(h, 'mauvais')).toBe(false);
  });

  it('retourne false sans erreur quand le compte n’a pas de mot de passe', async () => {
    expect(await svc.verify(null, 'nimporte')).toBe(false);
  });

  it('refuse les mots de passe faibles', () => {
    expect(svc.weakness('court')).toMatch(/8 caractères/);
    expect(svc.weakness('12345678')).toMatch(/courant/);
    expect(svc.weakness('aaaaaaaaaa')).toMatch(/répéter/);
    expect(svc.weakness('yannick.doho2026', { username: 'yannick.doho' })).toMatch(/nom d'utilisateur/);
    expect(svc.weakness('Bim-Test-2026!')).toBeNull();
  });
});
