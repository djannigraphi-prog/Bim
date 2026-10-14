import { FormEvent, useState } from 'react';
import { api, errorText } from '../api';

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  status: string;
  createdAt: string;
}
interface UserDetail extends UserRow {
  city: string;
  contacts: Array<{ type: string; value: string; verified: boolean }>;
}

/** Recherche de comptes (journalisée), fiche avec coordonnées masquées, suspension motivée. */
export function Users({ canSuspend }: { canSuspend: boolean }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<UserRow[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setItems((await api<{ items: UserRow[] }>(`/admin/v1/users?q=${encodeURIComponent(q)}`)).items);
      setDetail(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function open(id: string) {
    try {
      setDetail(await api<UserDetail>(`/admin/v1/users/${id}`));
      setReason('');
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function changeStatus(status: 'suspended' | 'active') {
    if (!detail) return;
    try {
      setDetail(await api<UserDetail>(`/admin/v1/users/${detail.id}/status`, { method: 'PATCH', body: { status, reason } }));
      setReason('');
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2>Utilisateurs</h2>
      <form className="inline" onSubmit={search}>
        <input placeholder="Nom d'utilisateur, nom, téléphone ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        <button>Rechercher</button>
      </form>
      <p className="muted">Chaque recherche et chaque fiche consultée sont inscrites au journal d'audit.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="split">
        <ul className="list">
          {items.map((u) => (
            <li key={u.id}>
              <button className="link" onClick={() => open(u.id)}>
                @{u.username} — {u.fullName}
              </button>{' '}
              <span className={`badge ${u.status}`}>{u.status}</span>
            </li>
          ))}
        </ul>
        {detail && (
          <div className="card">
            <h3>@{detail.username}</h3>
            <p>
              {detail.fullName} · {detail.city} · inscrit le {new Date(detail.createdAt).toLocaleDateString('fr-FR')}
            </p>
            <p>
              Statut : <span className={`badge ${detail.status}`}>{detail.status}</span>
            </p>
            <ul>
              {detail.contacts.map((c, i) => (
                <li key={i}>
                  {c.type === 'phone' ? 'Téléphone' : 'E-mail'} : {c.value} {c.verified ? '(vérifié)' : '(non vérifié)'}
                </li>
              ))}
            </ul>
            {canSuspend && (detail.status === 'active' || detail.status === 'suspended') && (
              <>
                <label>
                  Motif (obligatoire, conservé dans le journal)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                {detail.status === 'active' ? (
                  <button className="danger" disabled={reason.trim().length < 5} onClick={() => changeStatus('suspended')}>
                    Suspendre le compte
                  </button>
                ) : (
                  <button disabled={reason.trim().length < 5} onClick={() => changeStatus('active')}>
                    Réactiver le compte
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
