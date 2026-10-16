import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Entry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Journal d'audit, en lecture seule (la base refuse toute modification). */
export function Audit() {
  const [items, setItems] = useState<Entry[]>([]);
  // Page suivante : date ET identifiant du dernier élément affiché (aucune entrée sautée, audit défaut 4).
  const [next, setNext] = useState<{ before: string; beforeId: string | null } | null>(null);
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: { before: string; beforeId: string | null }) {
    const q = new URLSearchParams({ limit: '50' });
    if (action) q.set('action', action);
    if (cursor) {
      q.set('before', cursor.before);
      if (cursor.beforeId) q.set('beforeId', cursor.beforeId);
    }
    try {
      const r = await api<{ items: Entry[]; nextBefore: string | null; nextBeforeId?: string | null }>(`/admin/v1/audit-logs?${q}`);
      setItems((prev) => (cursor ? [...prev, ...r.items] : r.items));
      setNext(r.nextBefore ? { before: r.nextBefore, beforeId: r.nextBeforeId ?? null } : null);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <h2>Journal d'audit</h2>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input placeholder="Action (ex. admin., auth., project.)" value={action} onChange={(e) => setAction(e.target.value)} />
        <button>Filtrer</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Auteur</th>
            <th>Action</th>
            <th>Cible</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString('fr-FR')}</td>
              <td>
                {e.actorType}
                <br />
                <small className="muted">{e.actorId ?? '—'}</small>
              </td>
              <td><code>{e.action}</code></td>
              <td>
                {e.targetType ?? '—'}
                <br />
                <small className="muted">{e.targetId ?? ''}</small>
              </td>
              <td><code className="wrap">{Object.keys(e.metadata ?? {}).length ? JSON.stringify(e.metadata) : ''}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      {next && (
        <button className="secondary" onClick={() => load(next)}>
          Plus ancien
        </button>
      )}
    </section>
  );
}
