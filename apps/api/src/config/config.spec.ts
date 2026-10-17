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

  it('rappels : « test » interdit en production, worker sans fournisseur refusé, FCM exige un compte de service valide', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PUSH_PROVIDER: 'test' })).toThrow(/PUSH_PROVIDER/);
    expect(() => loadConfig({ ...base, WORKER_MODE: 'standalone' })).toThrow(/PUSH_PROVIDER/);
    expect(() => loadConfig({ ...base, PUSH_PROVIDER: 'fcm' })).toThrow(/FCM_SERVICE_ACCOUNT_JSON/);
    expect(() => loadConfig({ ...base, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' })).toThrow(/FCM_SERVICE_ACCOUNT_JSON/);
    const account = JSON.stringify({ project_id: 'bim-test', client_email: 'x@bim-test.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' });
    expect(loadConfig({ ...base, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT_JSON: account }).PUSH_PROVIDER).toBe('fcm');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', FCM_API_BASE_URL: 'http://127.0.0.1:9' })).toThrow(/FCM_API_BASE_URL/);
  });

  it('audit : TRUST_PROXY obligatoire hors développement ; clés de chiffrement distinctes', () => {
    const prod = { ...base, NODE_ENV: 'production', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none' };
    expect(() => loadConfig(prod)).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...prod, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...prod, WORKER_MODE: 'standalone', PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p', client_email: 'x@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n' }) }).WORKER_MODE).toBe('standalone');
    expect(() => loadConfig({ ...base, KYC_ENCRYPTION_KEY: base.ADMIN_TOTP_ENCRYPTION_KEY })).toThrow(/KYC_ENCRYPTION_KEY/);
  });

  it('lot 8 : prestataire désactivé par défaut ; simulateur interdit en production ; Paystack en clé de test seulement', () => {
    expect(loadConfig({ ...base }).PAYMENT_PROVIDER).toBe('none');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'simulator', PAYMENT_SIMULATOR_SECRET: 's'.repeat(20) })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'simulator' })).toThrow(/PAYMENT_SIMULATOR_SECRET/);
    const paystack = { ...base, PAYMENT_PROVIDER: 'paystack', PAYMENT_CUSTOMER_EMAIL_DOMAIN: 'clients.bim.ci' };
    expect(() => loadConfig({ ...paystack })).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(() => loadConfig({ ...paystack, PAYSTACK_SECRET_KEY: `sk_live_${'a'.repeat(32)}` })).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(loadConfig({ ...paystack, PAYSTACK_SECRET_KEY: `sk_test_${'a'.repeat(32)}` }).PAYMENT_PROVIDER).toBe('paystack');
    expect(() => loadConfig({ ...paystack, PAYSTACK_SECRET_KEY: `sk_test_${'a'.repeat(32)}`, PAYMENT_CUSTOMER_EMAIL_DOMAIN: '' })).toThrow(/PAYMENT_CUSTOMER_EMAIL_DOMAIN/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PAYSTACK_API_BASE_URL: 'http://faux' })).toThrow(/PAYSTACK_API_BASE_URL/);
  });
});
