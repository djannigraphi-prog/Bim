import { loadConfig } from './config';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://bim:bim@localhost:5432/bim_dev',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  OTP_SECRET: 'b'.repeat(40),
  ADMIN_TOTP_ENCRYPTION_KEY: 'Y2ktb25seS1hZG1pbi10b3RwLWtleS0zMmJ5dGVzISE=',
};

describe('loadConfig', () => {
  it('accepte une configuration de développement minimale', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.SMS_PROVIDER).toBe('none');
    expect(cfg.TRUST_PROXY).toBe(0);
    expect(cfg.HTTP_THROTTLE_ENABLED).toBe(true);
  });

  it('exige NODE_ENV et refuse TRUST_PROXY=true', () => {
    const { NODE_ENV: _omit, ...noEnv } = base;
    expect(() => loadConfig({ ...noEnv })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('refuse l’envoi factice de SMS et la désactivation de la limitation en production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'console' })).toThrow(/SMS_PROVIDER/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none', HTTP_THROTTLE_ENABLED: 'false' })).toThrow(/HTTP_THROTTLE_ENABLED/);
  });

  it('refuse un secret trop court ou réutilisé', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'court' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ ...base, OTP_SECRET: base.JWT_ACCESS_SECRET })).toThrow(/OTP_SECRET/);
  });
});
