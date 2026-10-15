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

  it('rappels (lot 2) : interrupteur, délais croissants, heures calmes, retard maximal', () => {
    expect(validateSettingValue('notifications.reminders_enabled', true)).toBeNull();
    expect(validateSettingValue('notifications.reminders_enabled', 'oui')).not.toBeNull();
    expect(validateSettingValue('notifications.reminder_offsets_minutes', [0, 60, 120])).toBeNull();
    expect(validateSettingValue('notifications.reminder_offsets_minutes', [60, 0])).not.toBeNull();
    expect(validateSettingValue('notifications.reminder_offsets_minutes', [])).not.toBeNull();
    expect(validateSettingValue('notifications.reminder_offsets_minutes', [0, 1000])).not.toBeNull();
    expect(validateSettingValue('notifications.quiet_hours', { start: '22:00', end: '06:00' })).toBeNull();
    expect(validateSettingValue('notifications.quiet_hours', null)).toBeNull();
    expect(validateSettingValue('notifications.quiet_hours', { start: '22h', end: '06:00' })).not.toBeNull();
    expect(validateSettingValue('notifications.reminder_grace_minutes', 30)).toBeNull();
    expect(validateSettingValue('notifications.reminder_grace_minutes', 1)).not.toBeNull();
  });

  it('purge des comptes et Peni : interrupteurs, mode, limites, conservation (null = aucune suppression)', () => {
    expect(validateSettingValue('maintenance.account_purge_enabled', false)).toBeNull();
    expect(validateSettingValue('maintenance.account_purge_enabled', 'non')).not.toBeNull();
    expect(validateSettingValue('maintenance.account_purge_mode', 'simulation')).toBeNull();
    expect(validateSettingValue('maintenance.account_purge_mode', 'reel')).not.toBeNull();
    expect(validateSettingValue('maintenance.account_purge_after_days', 7)).not.toBeNull(); // décision : 30 jours au moins
    expect(validateSettingValue('peni.llm_enabled', 1)).not.toBeNull();
    expect(validateSettingValue('peni.daily_message_limit', 0)).not.toBeNull();
    expect(validateSettingValue('peni.conversation_max_messages', 60)).toBeNull();
    expect(validateSettingValue('peni.conversation_retention_days', null)).toBeNull();
    expect(validateSettingValue('peni.conversation_retention_days', 365)).toBeNull();
    expect(validateSettingValue('peni.conversation_retention_days', 0)).not.toBeNull();
    expect(validateSettingValue('peni.conversation_retention_days', 6)).not.toBeNull();
  });

  it('valeur manquante refusée', () => {
    expect(validateSettingValue('x.y', undefined)).not.toBeNull();
  });
});
