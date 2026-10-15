import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Run {
  id: string;
  mode: 'simulation' | 'real';
  status: string;
  trigger: 'schedule' | 'admin';
  candidates: number;
  deleted: number;
  startedAt: string;
}

interface Overview {
  enabled: boolean;
  mode: 'simulation' | 'real';
  effectiveMode: 'simulation' | 'real';
  realDeletionAllowed: boolean;
  afterDays: number;
  maxPerRun: number;
  runs: Run[];
}

const STATUS: Record<string, string> = { ok: 'Terminé', aborted: 'Arrêté (plus de 500 comptes)', error: 'Erreur' };

/**
 * Purge des comptes jamais vérifiés : état, derniers passages et simulation à la demande. Aucune suppression depuis
 * cette page : la suppression réelle se décide dans les Réglages, après validation du fondateur.
 */
export function Maintenance() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api<Overview>('/admin/v1/maintenance/account-purge'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function simulate() {
    setBusy(true);
    try {
      await api('/admin/v1/maintenance/account-purge/simulate', { method: 'POST' });
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Purge des comptes jamais vérifiés</h2>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <p>
            Purge quotidienne : <strong>{data.enabled ? 'activée' : 'désactivée'}</strong> · mode appliqué :{' '}
            <strong>{data.effectiveMode === 'real' ? 'suppression réelle' : 'simulation (rien n’est supprimé)'}</strong> · comptes
            jamais vérifiés depuis plus de {data.afterDays} jours · {data.maxPerRun} comptes au plus par passage.
          </p>
          {data.mode === 'real' && !data.realDeletionAllowed && (
            <p className="error">Mode réel demandé mais non validé : la purge reste en simulation.</p>
          )}
          <button disabled={busy} onClick={() => void simulate()}>
            Lancer une simulation
          </button>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Origine</th>
                <th>Mode</th>
                <th>État</th>
                <th>Comptes concernés</th>
                <th>Supprimés</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.startedAt).toLocaleString('fr-FR')}</td>
                  <td>{r.trigger === 'admin' ? 'Administration' : 'Passage quotidien'}</td>
                  <td>{r.mode === 'real' ? 'Réel' : 'Simulation'}</td>
                  <td>{STATUS[r.status] ?? r.status}</td>
                  <td>{r.candidates}</td>
                  <td>{r.deleted}</td>
                </tr>
              ))}
              {!data.runs.length && (
                <tr>
                  <td colSpan={6}>Aucun passage pour l’instant.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
