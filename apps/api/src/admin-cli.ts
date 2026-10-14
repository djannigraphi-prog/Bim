/**
 * Création d'un compte d'administration en ligne de commande (premier administrateur principal, ou secours).
 * Le mot de passe est lu dans la variable ADMIN_PASSWORD (jamais en argument, pour ne pas finir dans l'historique du shell)
 * et n'est jamais affiché ni écrit dans le dépôt. La double authentification se configure à la première connexion.
 *
 *   ADMIN_PASSWORD='…' npm run admin:create -- --email fondateur@bim.ci --name "Doho Yannick" --roles super_admin
 */
import { hash, Algorithm } from '@node-rs/argon2';
import { Pool } from 'pg';
import { uuidv7 } from './common/uuid';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const roles = (arg('roles') ?? 'super_admin').split(',').map((r) => r.trim()).filter(Boolean);
  const password = process.env.ADMIN_PASSWORD ?? '';
  const url = process.env.DATABASE_URL;
  if (!url || !email || !name) throw new Error('Usage : ADMIN_PASSWORD=… DATABASE_URL=… admin:create -- --email … --name … [--roles super_admin]');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD doit contenir au moins 12 caractères.');
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('select 1 from admin_users where email = $1', [email]);
    if (exists.rowCount) throw new Error('Un compte existe déjà avec cet e-mail.');
    const known = (await client.query('select code from admin_roles')).rows.map((r: { code: string }) => r.code);
    const unknown = roles.filter((r) => !known.includes(r));
    if (unknown.length) throw new Error(`Rôles inconnus : ${unknown.join(', ')}`);
    const id = uuidv7();
    const passwordHash = await hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await client.query('insert into admin_users (id, email, full_name, password_hash) values ($1, $2, $3, $4)', [id, email, name, passwordHash]);
    for (const r of roles) await client.query('insert into admin_user_roles (admin_id, role_code) values ($1, $2)', [id, r]);
    await client.query(
      "insert into audit_logs (id, actor_type, action, target_type, target_id, metadata) values ($1, 'system', 'admin.admin_created_cli', 'admin', $2, $3)",
      [uuidv7(), id, JSON.stringify({ roles })],
    );
    await client.query('COMMIT');
    console.log(`Compte d'administration créé : ${email} (${roles.join(', ')}). Configure la double authentification à la première connexion.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
