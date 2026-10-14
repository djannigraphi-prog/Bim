import { AppError } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { AgePolicyService } from './age-policy.service';

function policyWith(values: Record<string, unknown>) {
  const settings = {
    get: async (key: string) => (key in values ? { value: values[key], decisionStatus: values[key] === null ? 'pending' : 'provisional' } : null),
  } as unknown as SettingsService;
  return new AgePolicyService(settings);
}

describe('AgePolicyService (F15 : restrictions séparées par capacité)', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const policy = policyWith({ 'age.min_registration': 16, 'age.min_coins_purchase': 18, 'age.min_coins_withdrawal': 18, 'age.min_paid_subscription': null });

  it('autorise l’inscription à 16 ans mais pas l’achat de pièces avant 18 ans', async () => {
    await expect(policy.assert('registration', '2010-10-14', now)).resolves.toBeUndefined();
    await expect(policy.assert('coins_purchase', '2010-10-14', now)).rejects.toMatchObject({ code: 'AGE_REQUIREMENT_NOT_MET' });
    await expect(policy.assert('coins_withdrawal', '2008-10-14', now)).resolves.toBeUndefined();
  });

  it('refuse l’inscription à 15 ans', async () => {
    const err = await policy.assert('registration', '2010-10-15', now).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('AGE_REQUIREMENT_NOT_MET');
    expect(err.details).toEqual({ capability: 'registration', minAge: 16 });
  });

  it('garde fermée une capacité dont la règle n’est pas décidée', async () => {
    await expect(policy.assert('paid_subscription', '1990-01-01', now)).rejects.toMatchObject({ code: 'RULE_NOT_DECIDED' });
    await expect(policy.assert('merchant', '1990-01-01', now)).rejects.toMatchObject({ code: 'RULE_NOT_DECIDED' });
    expect(await policy.status('merchant', '1990-01-01', now)).toEqual({ allowed: false, ruleStatus: 'pending', minAge: null });
  });
});
