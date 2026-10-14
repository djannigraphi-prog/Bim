import { hash, Algorithm } from '@node-rs/argon2';
import { totpAt, timeStep } from '../src/common/totp';
import { uuidv7 } from '../src/common/uuid';
import { bearer, Harness } from './harness';

const PASSWORD = 'Admin-Test-2026!long';
let seq = 0;

/** Crée un compte d'administration de test et ouvre une session (mot de passe + TOTP). */
export async function adminSession(h: Harness, roles: string[]) {
  seq += 1;
  const id = uuidv7();
  const email = `helper${seq}.${Date.now()}@bim.test`;
  const passwordHash = await hash(PASSWORD, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await h.pool.query('insert into admin_users (id, email, full_name, password_hash) values ($1, $2, $3, $4)', [id, email, `Helper ${seq}`, passwordHash]);
  for (const r of roles) await h.pool.query('insert into admin_user_roles (admin_id, role_code) values ($1, $2)', [id, r]);
  h.adminClock.t += 30_000;
  const l = await h.http().post('/admin/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  const e = await h.http().post('/admin/v1/auth/totp/enrollment').send({ loginToken: l.body.loginToken }).expect(200);
  const v = await h
    .http()
    .post('/admin/v1/auth/totp/verify')
    .send({ loginToken: l.body.loginToken, code: totpAt(e.body.secret, timeStep(h.adminClock.now())) })
    .expect(200);
  return bearer(v.body.accessToken);
}
