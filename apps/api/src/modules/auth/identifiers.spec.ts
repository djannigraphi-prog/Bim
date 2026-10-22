import { classifyIdentifier, looksLikePhone, maskDestination, normalizeEmail, normalizePhone, normalizeUsername, stripPhoneFormatting, usernameProblem } from './identifiers';

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

  it('V1 : numéro collé avec sa mise en forme (parenthèses, points, tirets, caractères invisibles)', () => {
    const phone = { kind: 'phone', value: '+2250707123456' };
    expect(classifyIdentifier('(+225) 07 07 12 34 56', 'CI')).toEqual(phone);
    expect(classifyIdentifier('07.07.12.34.56', 'CI')).toEqual(phone);
    expect(classifyIdentifier('+225-07-07-12-34-56', 'CI')).toEqual(phone);
    expect(classifyIdentifier('\u202a+225 07 07 12 34 56\u202c', 'CI')).toEqual(phone);
    expect(classifyIdentifier('+225\u00a007\u00a007\u00a012\u00a034\u00a056', 'CI')).toEqual(phone);
    expect(classifyIdentifier('\u200e07 07 12 34 56', 'CI')).toEqual(phone);
  });

  it('V1 : reconnaît la forme d’un numéro, même invalide (message clair à la connexion)', () => {
    expect(looksLikePhone('07071234')).toBe(true);
    expect(looksLikePhone('(+225) 07 07 12')).toBe(true);
    expect(looksLikePhone('awa.k')).toBe(false);
    expect(looksLikePhone('yannick@exemple.com')).toBe(false);
    expect(stripPhoneFormatting('(+225) 07.07-12 34\u202c')).toBe('+22507071234');
  });
});
