import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Setting {
  key: string;
  value: unknown;
  description: string;
  decisionStatus: 'decided' | 'provisional' | 'pending';
  decisionRef: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const STATUS: Record<Setting['decisionStatus'], string> = { decided: 'Décidé', provisional: 'Provisoire', pending: 'Non décidé' };

/** Réglages métier (âges F15, projets…). null = règle non décidée : la fonctionnalité reste fermée. */
export function Settings({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<Setting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Setting | null>(null);

  const load = () => api<{ items: Setting[] }>('/admin/v1/settings').then((r) => setItems(r.items)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h2>Réglages</h2>
      <p className="muted">Règles métier administrables. « null » signifie que la règle n'est pas décidée : la fonction concernée reste fermée.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Clé</th>
            <th>Valeur</th>
            <th>Statut</th>
            <th>Description</th>
            {canWrite && <th />}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.key}>
              <td><code>{s.key}</code></td>
              <td className="value"><code>{JSON.stringify(s.value)}</code></td>
              <td>
                <span className={`badge ${s.decisionStatus}`}>{STATUS[s.decisionStatus]}</span>
                {s.decisionRef && <span className="muted"> {s.decisionRef}</span>}
              </td>
              <td className="desc">{s.description}</td>
              {canWrite && (
                <td>
                  <button className="small" onClick={() => setEditing(s)} aria-label={`Modifier ${s.key}`}>
                    Modifier
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <EditSetting
          setting={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function EditSetting({ setting, onClose, onSaved }: { setting: Setting; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify(setting.value, null, 1));
  const [status, setStatus] = useState(setting.decisionStatus);
  const [ref, setRef] = useState(setting.decisionRef ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      setError('Valeur JSON invalide (ex. 18, null, [30, 60], "texte").');
      return;
    }
    try {
      await api(`/admin/v1/settings/${encodeURIComponent(setting.key)}`, { method: 'PUT', body: { value, decisionStatus: status, decisionRef: ref || null } });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="dialog" role="dialog" aria-label={`Modifier ${setting.key}`}>
      <h3>{setting.key}</h3>
      <p className="muted">{setting.description}</p>
      <label>
        Valeur (JSON)
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        Statut de décision
        <select value={status} onChange={(e) => setStatus(e.target.value as Setting['decisionStatus'])}>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Référence (décision, ex. F15)
        <input value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button onClick={save}>Enregistrer</button>
        <button className="secondary" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}
