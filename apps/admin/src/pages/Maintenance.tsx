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

interface PeniRetention {
  retentionDays: number | null;
  decided: boolean;
  active: boolean;
  minDays: number;
  expired: number | null;
  runs: Array<{ id: string; status: string; deleted: number; startedAt: string }>;
}

const STATUS: Record<string, string> = { ok: 'Terminé', aborted: 'Arrêté (plus de 500 comptes)', error: 'Erreur' };

/**
 * Maintenance : purge des comptes jamais vérifiés (état, passages, simulation) et conservation des discussions avec
 * Peni (durée, discussions concernées, passages). Aucune suppression depuis cette page : tout se décide dans les
 * Réglages, après validation du fondateur.
 */
export function Maintenance() {
  const [data, setData] = useState<Overview | null>(null);
  const [peni, setPeni] = useState<PeniRetention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [purge, retention] = await Promise.all([
        api<Overview>('/admin/v1/maintenance/account-purge'),
        api<PeniRetention>('/admin/v1/maintenance/peni-retention'),
      ]);
      setData(purge);
      setPeni(retention);
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
      {peni && (
        <>
          <h2>Conservation des discussions avec Peni</h2>
          <p data-testid="peni-retention">
            {peni.retentionDays === null
              ? 'Aucune durée fixée : aucune discussion n’est supprimée.'
              : `Durée réglée : ${peni.retentionDays} jours sans activité${peni.active ? ' (suppression automatique active)' : ' — pas encore validée : aucune suppression'}.`}{' '}
            {peni.expired !== null && `Discussions concernées aujourd’hui : ${peni.expired}.`}
          </p>
          <p>Durée minimale : {peni.minDays} jours. La durée se règle dans Réglages (peni.conversation_retention_days), marquée « decided » une fois validée.</p>
          {peni.runs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Discussions supprimées</th>
                </tr>
              </thead>
              <tbody>
                {peni.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.startedAt).toLocaleString('fr-FR')}</td>
                    <td>{r.deleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
