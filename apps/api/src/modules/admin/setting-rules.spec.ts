import { validateSettingValue } from './setting-rules';

describe('règles des réglages administrables', () => {
  it('âges : entier 13–99 ou null (non décidé)', () => {
    expect(validateSettingValue('age.min_registration', 16)).toBeNull();
    expect(validateSettingValue('age.min_merchant', null)).toBeNull();
    expect(validateSettingValue('age.min_registration', 1)).not.toBeNull();
    expect(validateSettingValue('age.min_registration', '16')).not.toBeNull();
    expect(validateSettingValue('age.min_registration', 16.5)).not.toBeNull();
  });

  it('projets : limite, durées, heures', () => {
    expect(validateSettingValue('projects.max_active', 5)).toBeNull();
    expect(validateSettingValue('projects.max_active', 0)).not.toBeNull();
    expect(validateSettingValue('projects.durations_days', [30, 60])).toBeNull();
    expect(validateSettingValue('projects.durations_days', [])).not.toBeNull();
    expect(validateSettingValue('projects.availability_times', { morning: '07:00', noon: '12:30', afternoon: '15:00' })).toBeNull();
    expect(validateSettingValue('projects.availability_times', { morning: '7h' })).not.toBeNull();
  });

  it('valeur manquante refusée', () => {
    expect(validateSettingValue('x.y', undefined)).not.toBeNull();
  });
});
