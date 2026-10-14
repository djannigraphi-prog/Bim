import { FormEvent, useEffect, useState } from 'react';
import { AdminProfile, api, errorText } from '../api';

interface AdminRow {
  id: string;
  email: string;
  fullName: string;
  status: 'active' | 'disabled';
  totpEnabled: boolean;
  lastLoginAt: string | null;
  roles: string[];
}
interface Role {
  code: string;
  label: string;
}

/** Comptes d'administration (administrateur principal uniquement). */
export function Admins({ me }: { me: AdminProfile }) {
  const [items, setItems] = useState<AdminRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', roles: [] as string[] });

  const load = () =>
    api<{ items: AdminRow[]; roles: Role[] }>('/admin/v1/admins')
      .then((r) => {
        setItems(r.items);
        setRoles(r.roles);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/admin/v1/admins', { method: 'POST', body: form });
      setForm({ email: '', fullName: '', password: '', roles: [] });
      setError(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function update(id: string, body: Record<string, unknown>) {
    try {
      await api(`/admin/v1/admins/${id}`, { method: 'PATCH', body });
      setError(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const roleLabel = (c: string) => roles.find((r) => r.code === c)?.label ?? c;

  return (
    <section>
      <h2>Administrateurs</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Compte</th>
            <th>Rôles</th>
            <th>Double authentification</th>
            <th>Statut</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>
                {a.fullName}
                <br />
                <small className="muted">{a.email}</small>
              </td>
              <td>{a.roles.map(roleLabel).join(', ')}</td>
              <td>{a.totpEnabled ? 'Configurée' : 'À configurer à la première connexion'}</td>
              <td><span className={`badge ${a.status}`}>{a.status === 'active' ? 'Actif' : 'Désactivé'}</span></td>
              <td className="actions">
                {a.id !== me.id && (
                  <>
                    <button className="small secondary" onClick={() => update(a.id, { status: a.status === 'active' ? 'disabled' : 'active' })}>
                      {a.status === 'active' ? 'Désactiver' : 'Réactiver'}
                    </button>
                    {a.totpEnabled && (
                      <button className="small secondary" onClick={() => window.confirm('Réinitialiser la double authentification (appareil perdu) ?') && update(a.id, { resetTotp: true })}>
                        Réinitialiser la double authentification
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card" onSubmit={create}>
        <h3>Nouveau compte</h3>
        <p className="muted">Transmets le mot de passe initial par un canal sûr ; la double authentification se configure à la première connexion.</p>
        <div className="row">
          <label>
            E-mail
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Nom
            <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </label>
          <label>
            Mot de passe initial (12 caractères min.)
            <input type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
        </div>
        <fieldset>
          <legend>Rôles</legend>
          {roles.map((r) => (
            <label key={r.code} className="day">
              <input
                type="checkbox"
                checked={form.roles.includes(r.code)}
                onChange={() => setForm({ ...form, roles: form.roles.includes(r.code) ? form.roles.filter((x) => x !== r.code) : [...form.roles, r.code] })}
              />
              {r.label}
            </label>
          ))}
        </fieldset>
        <button disabled={!form.roles.length}>Créer le compte</button>
      </form>
    </section>
  );
}
