import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { ProtectedImage } from './Merchants';

type Stage = 'submitted' | 'active' | 'to_correct';

interface Row {
  id: string;
  stage: string;
  fullName: string;
  username: string;
  idDocType: string | null;
  vehicle: string | null;
  rejectReason: string | null;
  submittedAt: string | null;
  checklist: { identity: boolean; selfie: boolean; details: boolean };
}

interface Detail extends Row {
  birthDate: string;
}

const DOC: Record<string, string> = { cni: 'Carte nationale d’identité', passport: 'Passeport', permis: 'Permis de conduire' };
const VEHICLE: Record<string, string> = { moto: 'Moto', velo: 'Vélo', voiture: 'Voiture', pied: 'À pied' };

/**
 * Lot 7-E — Comptes livreurs : vérification par une personne de l'équipe (pièce d'identité, selfie). Documents
 * sensibles, chiffrés ; chaque consultation est inscrite au journal d'audit.
 */
export function Couriers() {
  const [stage, setStage] = useState<Stage>('submitted');
  const [items, setItems] = useState<Row[]>([]);
  const [open, setOpen] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (s = stage) =>
    api<{ items: Row[] }>(`/admin/v1/courier-applications?stage=${s}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    setOpen(null);
    void load(stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function show(id: string) {
    try {
      setOpen(await api<Detail>(`/admin/v1/courier-applications/${id}`));
      setReason('');
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/admin/v1/courier-applications/${id}/${action}`, { method: 'POST', body: action === 'reject' ? { reason } : undefined });
      setOpen(null);
      setError(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Livreurs</h2>
      <p className="muted">
        Demandes de compte livreur. Vérifie que le selfie correspond à la pièce d’identité. Un compte vérifié ne donne accès à aucune commande de boutique : seulement aux
        courses qu’il accepte (à venir). Chaque consultation est inscrite au journal d’audit.
      </p>
      <div className="actions">
        <button className={stage === 'submitted' ? '' : 'secondary'} onClick={() => setStage('submitted')}>À vérifier</button>
        <button className={stage === 'active' ? '' : 'secondary'} onClick={() => setStage('active')}>Vérifiés</button>
        <button className={stage === 'to_correct' ? '' : 'secondary'} onClick={() => setStage('to_correct')}>À corriger</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 && <p className="muted">Aucune demande.</p>}
      {items.map((r) => (
        <div className="card" key={r.id} aria-label={`Demande de livreur de @${r.username}`}>
          <strong>{r.fullName}</strong> (@{r.username})
          <div className="muted">
            {r.idDocType ? DOC[r.idDocType] : 'Pièce non précisée'} · {r.vehicle ? VEHICLE[r.vehicle] : 'transport non précisé'}
            {r.submittedAt && ` · envoyée le ${new Date(r.submittedAt).toLocaleDateString('fr-FR')}`}
          </div>
          {r.rejectReason && <p>Motif donné : {r.rejectReason}</p>}
          {open?.id !== r.id ? (
            <button className="secondary" onClick={() => show(r.id)}>Examiner</button>
          ) : (
            <div>
              <p>Né(e) le {new Date(open.birthDate).toLocaleDateString('fr-FR')}</p>
              <div className="kyc-images">
                {open.checklist.identity && <ProtectedImage path={`/admin/v1/courier-applications/${open.id}/documents/id_front`} alt="Pièce d’identité, recto" />}
                {open.checklist.identity && <ProtectedImage path={`/admin/v1/courier-applications/${open.id}/documents/id_back`} alt="Pièce d’identité, verso" />}
                {open.checklist.selfie && <ProtectedImage path={`/admin/v1/courier-applications/${open.id}/documents/selfie`} alt="Selfie" />}
              </div>
              {r.stage === 'submitted' && (
                <>
                  <label>
                    Motif en cas de refus (ce que la personne doit corriger)
                    <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="actions">
                    <button disabled={busy} onClick={() => decide(r.id, 'approve')}>Valider le compte livreur</button>
                    <button className="secondary" disabled={busy || reason.trim().length < 5} onClick={() => decide(r.id, 'reject')}>
                      Demander une correction
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
