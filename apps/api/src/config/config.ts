import { z } from 'zod';

/**
 * Configuration de l'API, lue une seule fois au démarrage depuis les variables d'environnement.
 * Toute valeur invalide arrête le démarrage avec un message clair : mieux vaut ne pas démarrer
 * que démarrer avec une configuration dangereuse (ex. secret trop court, envoi de SMS factice en production).
 * La liste complète et commentée des variables est dans docs/ENVIRONMENT.md.
 */
const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    /** Obligatoire : un oubli ne doit jamais faire démarrer la production en mode développement. */
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /**
     * Nombre de proxys de confiance devant l'API (1 derrière l'ALB AWS). Jamais « true » : le client pourrait
     * alors choisir son adresse IP via X-Forwarded-For et contourner les limites par IP.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    CORS_ORIGINS: z.string().default(''),
    /** Limitation de débit HTTP par adresse IP. Désactivable uniquement pour les tests automatisés. */
    HTTP_THROTTLE_ENABLED: boolish.default(true),

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET doit contenir au moins 32 caractères'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    STEP_UP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),

    OTP_SECRET: z.string().min(32, 'OTP_SECRET doit contenir au moins 32 caractères'),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
    /** Plafond d'envois de codes vers un même téléphone ou e-mail sur une heure (anti-bombardement, anti force brute). */
    OTP_MAX_SENDS_PER_DESTINATION_PER_HOUR: z.coerce.number().int().min(3).max(50).default(6),

    /**
     * Fournisseur d'envoi des SMS et e-mails. « console » écrit le code dans les journaux : refusé hors développement.
     * Par défaut « none » : sans configuration explicite, aucun code n'est envoyé ni écrit dans les journaux.
     */
    SMS_PROVIDER: z.enum(['console', 'test', 'none']).default('none'),
    EMAIL_PROVIDER: z.enum(['console', 'test', 'none']).default('none'),

    /** Connexions sociales : préparées, désactivées tant que les identifiants ne sont pas fournis. */
    GOOGLE_CLIENT_IDS: z.string().default(''),
    APPLE_CLIENT_IDS: z.string().default(''),
    FACEBOOK_APP_ID: z.string().default(''),

    DEFAULT_PHONE_REGION: z.string().length(2).default('CI'),

    /**
     * Administration (/admin/v1) : clé de chiffrement des secrets TOTP, 32 octets encodés en base64
     * (générer avec : openssl rand -base64 32). Obligatoire ; à conserver dans AWS Secrets Manager.
     */
    ADMIN_TOTP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'ADMIN_TOTP_ENCRYPTION_KEY doit faire 32 octets encodés en base64'),
    ADMIN_SESSION_TTL_MINUTES: z.coerce.number().int().min(15).max(720).default(480),
    ADMIN_LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(10).default(5),
    ADMIN_LOCK_MINUTES: z.coerce.number().int().min(5).max(1440).default(15),

    /**
     * Stockage des photos privées (avant / après). « local » : dossier sur le disque, développement et tests uniquement.
     * « s3 » : compartiment privé (AWS S3 ou compatible) ; « none » : fonction fermée (NOT_CONFIGURED).
     */
    MEDIA_STORAGE: z.enum(['local', 's3', 'none']).default('none'),
    MEDIA_LOCAL_DIR: z.string().default('./.media'),
    MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    MEDIA_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(10),
    S3_BUCKET: z.string().default(''),
    S3_REGION: z.string().default('eu-west-3'),
    /** Uniquement pour un stockage compatible S3 (ex. MinIO en test) ; vide pour AWS. */
    S3_ENDPOINT: z.string().default(''),
  })
  .superRefine((cfg, ctx) => {
    const devLike = cfg.NODE_ENV === 'development' || cfg.NODE_ENV === 'test';
    if (!devLike && (cfg.SMS_PROVIDER === 'console' || cfg.SMS_PROVIDER === 'test')) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'Le fournisseur SMS « console » ou « test » est interdit hors développement',
      });
    }
    if (!devLike && (cfg.EMAIL_PROVIDER === 'console' || cfg.EMAIL_PROVIDER === 'test')) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: "Le fournisseur d'e-mail « console » ou « test » est interdit hors développement",
      });
    }
    if (!devLike && !cfg.HTTP_THROTTLE_ENABLED) {
      ctx.addIssue({ code: 'custom', path: ['HTTP_THROTTLE_ENABLED'], message: 'La limitation de débit ne peut pas être désactivée hors développement' });
    }
    if (!devLike && cfg.MEDIA_STORAGE === 'local') {
      ctx.addIssue({ code: 'custom', path: ['MEDIA_STORAGE'], message: 'Le stockage « local » est interdit hors développement (utiliser s3)' });
    }
    if (cfg.MEDIA_STORAGE === 's3' && !cfg.S3_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET est obligatoire avec MEDIA_STORAGE=s3' });
    }
    if (cfg.JWT_ACCESS_SECRET === cfg.OTP_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['OTP_SECRET'], message: 'OTP_SECRET doit différer de JWT_ACCESS_SECRET' });
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
