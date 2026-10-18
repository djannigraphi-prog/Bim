import { z } from 'zod';
import { parseServiceAccount } from '../modules/notifications/fcm-push-sender';

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
    /**
     * Lot 5 : clé de chiffrement des pièces d'identité et selfies des demandes de boutique (AES-256-GCM), 32 octets en
     * base64 (openssl rand -base64 32), à conserver dans AWS Secrets Manager. Absente : l'ouverture de boutique est
     * indisponible (aucune pièce d'identité n'est jamais stockée en clair).
     */
    KYC_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'KYC_ENCRYPTION_KEY doit faire 32 octets encodés en base64')
      .optional(),
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
    /** Lot 11 : taille maximale d'un Reel (vidéo MP4), en Mo. */
    MEDIA_MAX_VIDEO_MB: z.coerce.number().int().min(1).max(100).default(30),
    S3_BUCKET: z.string().default(''),
    S3_REGION: z.string().default('eu-west-3'),
    /** Uniquement pour un stockage compatible S3 (ex. MinIO en test) ; vide pour AWS. */
    S3_ENDPOINT: z.string().default(''),

    /**
     * Rappels (lot 2). WORKER_MODE : « off » (défaut, aucun envoi), « embedded » (dans le processus de l'API : tests,
     * bêta fermée) ou « standalone » (service séparé recommandé, `node dist/worker.js`). Même code dans les deux cas.
     * Le réglage administrable `notifications.reminders_enabled` reste un second interrupteur (false tant que non validé).
     */
    WORKER_MODE: z.enum(['off', 'embedded', 'standalone']).default('off'),
    /** Port du contrôle de santé du worker séparé (contrôle de conteneur ECS). */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    /** Envoi des notifications : « none » (rien n'est envoyé), « fcm » (Firebase Cloud Messaging), « test » (enregistré en mémoire). */
    PUSH_PROVIDER: z.enum(['none', 'fcm', 'test']).default('none'),
    /**
     * Fournisseur d'IA de Peni (lot 3). Seule valeur possible : « none » (discussion guidée, sans IA). Un fournisseur
     * ne sera ajouté qu'après l'accord du fondateur (coût, données envoyées, ARTCI) : voir src/modules/peni/llm-provider.ts.
     */
    PENI_LLM_PROVIDER: z.enum(['none']).default('none'),
    /**
     * Prototype (lots 9 à 11) : ouvre le circuit « demo » de Premium, des pièces, des retraits et des Lives, sans aucun
     * argent réel ni service payant. Interdit en production ; à couper avant l'ouverture au public.
     */
    DEMO_MODE: boolish.default(false),
    /** Démonstration sur un ordinateur : adresse à saisir dans l'app (ex. http://192.168.1.20:3000), affichée sur /demo. */
    DEMO_PUBLIC_URL: z.string().default(''),
    /**
     * Lot 8 — Prestataire de paiement en ligne : « none » (aucun paiement en ligne) ou « simulator » (développement et
     * tests seulement). Aucun prestataire réel (Paystack, CinetPay…) ne sera ajouté sans l'autorisation explicite du
     * fondateur, après examen de l'étude ; aucune clé de production dans le dépôt.
     */
    PAYMENT_PROVIDER: z.enum(['none', 'simulator', 'paystack']).default('none'),
    /** Secret de signature des notifications du simulateur (valeur de test, jamais une clé de prestataire). */
    PAYMENT_SIMULATOR_SECRET: z.string().default(''),
    /**
     * V1 — Achats dans l'app (Premium et pièces) vérifiés auprès du magasin (Google Play, App Store) : « none » (aucun
     * achat par le magasin) ou « simulator » (développement et tests seulement). Les vérificateurs Google et Apple
     * seront ajoutés avec les comptes développeur, après l'accord du fondateur (aucune dépense sans lui).
     */
    STORE_PROVIDER: z.enum(['none', 'simulator']).default('none'),
    /**
     * Lot 8 — Clé secrète Paystack : **clé de test seulement** (`sk_test_…`) ; une clé de production est refusée tant que
     * le fondateur n'a pas autorisé les paiements réels. Secret : injecté depuis le coffre, jamais dans le dépôt.
     */
    PAYSTACK_SECRET_KEY: z.string().default(''),
    /** Adresse de l'API Paystack remplacée par un faux serveur : développement et tests seulement. */
    PAYSTACK_API_BASE_URL: z.string().default(''),
    /** Page de retour après le paiement (facultative). */
    PAYMENT_CALLBACK_URL: z.string().default(''),
    /** Domaine des adresses techniques transmises au prestataire quand le client n'a pas d'e-mail vérifié. */
    PAYMENT_CUSTOMER_EMAIL_DOMAIN: z.string().default(''),
    /**
     * Compte de service Firebase (JSON complet), obligatoire avec PUSH_PROVIDER=fcm. Secret : injecté depuis AWS
     * (Parameter Store chiffré ou Secrets Manager), jamais écrit dans le dépôt ni dans les journaux.
     */
    FCM_SERVICE_ACCOUNT_JSON: z.string().default(''),
    /** Adresses de remplacement pour tester l'envoi contre un faux serveur : développement uniquement. */
    FCM_API_BASE_URL: z.string().default(''),
    FCM_TOKEN_URL: z.string().default(''),
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
    if (cfg.NODE_ENV === 'production' && cfg.DEMO_MODE) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_MODE'], message: 'Le mode démonstration (achats et retraits simulés) est interdit en production' });
    }
    if (!devLike && cfg.STORE_PROVIDER === 'simulator') {
      ctx.addIssue({ code: 'custom', path: ['STORE_PROVIDER'], message: 'Le simulateur du magasin est interdit hors développement' });
    }
    if (!devLike && cfg.PAYMENT_PROVIDER === 'simulator') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Le simulateur de paiement est interdit hors développement' });
    }
    if (cfg.PAYMENT_PROVIDER === 'paystack') {
      if (!/^sk_test_[A-Za-z0-9]{16,}$/.test(cfg.PAYSTACK_SECRET_KEY)) {
        ctx.addIssue({ code: 'custom', path: ['PAYSTACK_SECRET_KEY'], message: 'Clé Paystack de test (sk_test_…) obligatoire ; les clés de production sont refusées (paiements réels non autorisés)' });
      }
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cfg.PAYMENT_CUSTOMER_EMAIL_DOMAIN)) {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_CUSTOMER_EMAIL_DOMAIN'], message: 'Domaine des adresses techniques obligatoire avec Paystack' });
      }
    }
    if (!devLike && cfg.PAYSTACK_API_BASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['PAYSTACK_API_BASE_URL'], message: "L'adresse Paystack de remplacement est interdite hors développement" });
    }
    if (cfg.PAYMENT_PROVIDER === 'simulator' && cfg.PAYMENT_SIMULATOR_SECRET.length < 16) {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_SIMULATOR_SECRET'], message: 'PAYMENT_SIMULATOR_SECRET (16 caractères au moins) est obligatoire avec le simulateur' });
    }
    if (!devLike && cfg.PUSH_PROVIDER === 'test') {
      ctx.addIssue({ code: 'custom', path: ['PUSH_PROVIDER'], message: 'Le fournisseur de notifications « test » est interdit hors développement' });
    }
    if (cfg.PUSH_PROVIDER === 'fcm') {
      try {
        parseServiceAccount(cfg.FCM_SERVICE_ACCOUNT_JSON);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['FCM_SERVICE_ACCOUNT_JSON'], message: (e as Error).message });
      }
    }
    if (!devLike && (cfg.FCM_API_BASE_URL || cfg.FCM_TOKEN_URL)) {
      ctx.addIssue({ code: 'custom', path: ['FCM_API_BASE_URL'], message: 'Les adresses FCM de remplacement sont interdites hors développement' });
    }
    if (cfg.WORKER_MODE !== 'off' && cfg.PUSH_PROVIDER === 'none') {
      ctx.addIssue({ code: 'custom', path: ['PUSH_PROVIDER'], message: 'Un worker de rappels sans fournisseur de notifications ne servirait à rien (PUSH_PROVIDER)' });
    }
    // Derrière le répartiteur de charge, sans TRUST_PROXY toutes les requêtes viendraient de son adresse : limites de
    // débit communes à tout le monde et adresses fausses dans le journal d'audit (audit, C-3).
    // Le service séparé des rappels (dist/worker.js) ne reçoit aucune requête : la règle ne le concerne pas.
    if (!devLike && cfg.TRUST_PROXY === 0 && cfg.WORKER_MODE !== 'standalone') {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY doit être indiqué hors développement (1 derrière le répartiteur de charge)' });
    }
    if (cfg.KYC_ENCRYPTION_KEY && cfg.KYC_ENCRYPTION_KEY === cfg.ADMIN_TOTP_ENCRYPTION_KEY) {
      ctx.addIssue({ code: 'custom', path: ['KYC_ENCRYPTION_KEY'], message: 'KYC_ENCRYPTION_KEY doit différer de ADMIN_TOTP_ENCRYPTION_KEY' });
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
