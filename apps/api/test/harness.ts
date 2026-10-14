import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ADMIN_CLOCK } from '../src/modules/admin/admin-auth.service';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { STATE_FILE } from './test-db';

export interface Harness {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  pool: Pool;
  outbox: DeliveryService['testOutbox'];
  settings: SettingsService;
  lastCodeFor: (destination: string) => string;
  /** Horloge de l'administration, avançable dans les tests (codes TOTP à usage unique). */
  adminClock: { t: number; now(): number };
  close: () => Promise<void>;
}

/** Démarre l'API complète (mêmes modules, gardes et filtres qu'en production) sur la base de test. */
export async function startHarness(extraEnv: Record<string, string> = {}): Promise<Harness> {
  const { url } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { url: string };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: url,
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghij',
    OTP_SECRET: 'test-otp-secret-0123456789-abcdefghijklmn',
    ADMIN_TOTP_ENCRYPTION_KEY: 'Y2ktb25seS1hZG1pbi10b3RwLWtleS0zMmJ5dGVzISE=',
    SMS_PROVIDER: 'test',
    EMAIL_PROVIDER: 'test',
    HTTP_THROTTLE_ENABLED: 'false',
    OTP_RESEND_COOLDOWN_SECONDS: '15',
    ...extraEnv,
  });
  const adminClock = { t: Date.now(), now() { return this.t; } };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ADMIN_CLOCK).useValue(adminClock).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  const delivery = app.get(DeliveryService);
  const pool = new Pool({ connectionString: url, max: 2 });
  return {
    app,
    http: () => request(app.getHttpServer()),
    pool,
    outbox: delivery.testOutbox,
    adminClock,
    settings: app.get(SettingsService),
    lastCodeFor: (destination: string) => {
      const msg = [...delivery.testOutbox].reverse().find((m) => m.destination === destination && m.code);
      if (!msg?.code) throw new Error(`Aucun code envoyé à ${destination}`);
      return msg.code;
    },
    close: async () => {
      await pool.end();
      await app.close();
    },
  };
}

let seq = 0;
/** Données d'inscription valides et uniques ; chaque test peut en surcharger une partie. */
export function newUser(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const n = `${Date.now() % 1_000_000}${seq}`.padStart(8, '0').slice(-8);
  return {
    fullName: 'Awa Koné',
    username: `awa.${n}`,
    birthDate: '1998-03-12',
    city: 'Cocody',
    phone: `07${n}`,
    password: 'Bim-Test-2026!',
    interests: ['mode', 'sport_coaching', 'coiffure'],
    ...overrides,
  };
}

/** Inscrit et active un compte ; renvoie les jetons et le numéro E.164. */
export async function registerAndActivate(h: Harness, overrides: Record<string, unknown> = {}) {
  const body = newUser(overrides);
  const reg = await h.http().post('/v1/auth/register').send(body).expect(201);
  const destination = await destinationOf(h, reg.body.verification.challengeId);
  const code = h.lastCodeFor(destination);
  const ver = await h.http().post('/v1/auth/register/verify').send({ challengeId: reg.body.verification.challengeId, code }).expect(200);
  return { body, userId: reg.body.userId as string, destination, tokens: ver.body.tokens, me: ver.body.me };
}

export async function destinationOf(h: Harness, challengeId: string): Promise<string> {
  const r = await h.pool.query('select destination from verification_codes where id = $1', [challengeId]);
  return r.rows[0].destination;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
