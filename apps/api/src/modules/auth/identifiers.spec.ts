import { classifyIdentifier, maskDestination, normalizeEmail, normalizePhone, normalizeUsername, usernameProblem } from './identifiers';

describe('identifiants de connexion (écran 03, Q12)', () => {
  it('reconnaît un e-mail, un téléphone ivoirien et un @nom d’utilisateur', () => {
    expect(classifyIdentifier(' Yannick@Exemple.com ', 'CI')).toEqual({ kind: 'email', value: 'yannick@exemple.com' });
    expect(classifyIdentifier('07 00 00 00 01', 'CI')).toEqual({ kind: 'phone', value: '+2250700000001' });
    expect(classifyIdentifier('+225 07 00 00 00 01', 'CI')).toEqual({ kind: 'phone', value: '+2250700000001' });
    expect(classifyIdentifier('@Yannick.Doho', 'CI')).toEqual({ kind: 'username', value: 'yannick.doho' });
    expect(classifyIdentifier('   ', 'CI')).toBeNull();
  });

  it('normalise et valide', () => {
    expect(normalizePhone('0102030405', 'CI')).toBe('+2250102030405');
    expect(normalizePhone('123', 'CI')).toBeNull();
    expect(normalizeEmail('pas-un-email')).toBeNull();
    expect(normalizeUsername('@Awa_K')).toBe('awa_k');
  });

  it('refuse les noms mal formés ou réservés', () => {
    expect(usernameProblem('ab')).toBe('format');
    expect(usernameProblem('.awa')).toBe('format');
    expect(usernameProblem('awa..k')).toBe('format');
    expect(usernameProblem('support')).toBe('reserved');
    expect(usernameProblem('bim_officiel')).toBe('reserved');
    expect(usernameProblem('awa.k')).toBeNull();
  });

  it('masque les coordonnées', () => {
    expect(maskDestination('phone', '+2250700000001')).toBe('+22507••••0001');
    expect(maskDestination('email', 'yannick@exemple.com')).toBe('y•••@exemple.com');
  });
});
