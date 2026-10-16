import { useEffect, useState } from 'react';
import { api, apiBlob, errorText } from '../api';

interface Row {
  id: string;
  status: 'submitted' | 'approved' | 'rejected';
  shopName: string;
  city: string | null;
  commune: string | null;
  username: string;
  fullName: string;
  idDocType: string | null;
  payoutOperator: string | null;
  payoutVerified: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

interface Detail {
  id: string;
  status: string;
  shop: { name: string; description: string | null; city: string | null; commune: string | null };
  person: { username: string; fullName: string; birthDate: string; city: string };
  idDocType: string | null;
  documents: { idFront: boolean; idBack: boolean; selfie: boolean };
  payout: { operator: string; phone: string; verified: boolean } | null;
  address: string | null;
  rejectionReason: string | null;
}

const DOC: Record<string, string> = { cni: 'Carte nationale d’identité', passport: 'Passeport', permis: 'Permis de conduire' };
const OPERATOR: Record<string, string> = { wave: 'Wave', orange: 'Orange Money', mtn: 'MTN MoMo', moov: 'Moov Money' };

/** Pièce d'identité ou selfie : lu avec le jeton d'administration (chaque lecture est inscrite au journal d'audit). */
function ProtectedImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    apiBlob(path)
      .then((b) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => setError(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  if (error) return <p className="error">Image illisible.</p>;
  return url ? <img className="kyc-image" src={url} alt={alt} /> : <p className="muted">Chargement…</p>;
}

/**
 * Lot 5-A — Demandes d'ouverture de boutique : vérification par une personne de l'équipe (pièce d'identité, selfie,
 * numéro Mobile Money confirmé par SMS). Données sensibles : ne les consulte que pour vérifier la demande.
 */
export function Merchants() {
  const [status, setStatus] = useState<'submitted' | 'approved' | 'rejected'>('submitted');
  const [items, setItems] = useState<Row[]>([]);
  const [open, setOpen] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = (s = status) =>
    api<{ items: Row[] }>(`/admin/v1/merchant-applications?status=${s}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    setOpen(null);
    void load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function show(id: string) {
    try {
      setOpen(await api<Detail>(`/admin/v1/merchant-applications/${id}`));
      setReason('');
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    try {
      await api(`/admin/v1/merchant-applications/${id}/${action}`, { method: 'POST', body: action === 'reject' ? { reason } : undefined });
      setOpen(null);
      setError(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section>
      <h2>Boutiques</h2>
      <p className="muted">
        Demandes d’ouverture de boutique. Vérifie que le selfie correspond à la pièce d’identité et que le nom est cohérent. Ces documents sont sensibles : chaque consultation est
        inscrite au journal d’audit.
      </p>
      <div className="actions">
        <button className={status === 'submitted' ? '' : 'secondary'} onClick={() => setStatus('submitted')}>À vérifier</button>
        <button className={status === 'approved' ? '' : 'secondary'} onClick={() => setStatus('approved')}>Validées</button>
        <button className={status === 'rejected' ? '' : 'secondary'} onClick={() => setStatus('rejected')}>À corriger</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 && <p className="muted">Aucune demande.</p>}
      {items.map((r) => (
        <div className="card" key={r.id} aria-label={`Demande de boutique « ${r.shopName} »`}>
          <strong>{r.shopName}</strong> — {r.fullName} (@{r.username}) · {[r.commune, r.city].filter(Boolean).join(', ')}
          <div className="muted">
            {r.idDocType ? DOC[r.idDocType] : 'Pièce non précisée'} · {r.payoutOperator ? OPERATOR[r.payoutOperator] : 'Mobile Money'} {r.payoutVerified ? 'confirmé par SMS' : 'non confirmé'}
            {r.submittedAt && ` · envoyée le ${new Date(r.submittedAt).toLocaleDateString('fr-FR')}`}
          </div>
          {r.rejectionReason && <p>Motif donné : {r.rejectionReason}</p>}
          {open?.id !== r.id ? (
            <button className="secondary" onClick={() => show(r.id)}>Examiner</button>
          ) : (
            <div>
              <p>
                Personne : {open.person.fullName} · née le {new Date(open.person.birthDate).toLocaleDateString('fr-FR')} · {open.person.city}
                <br />
                Boutique : {open.shop.description ?? 'sans présentation'}
                <br />
                Numéro Mobile Money : {open.payout ? `${open.payout.phone} (${OPERATOR[open.payout.operator]})` : '—'}
                <br />
                Adresse : {open.address ?? 'non donnée'}
              </p>
              <div className="kyc-images">
                {open.documents.idFront && <ProtectedImage path={`/admin/v1/merchant-applications/${open.id}/documents/id_front`} alt="Pièce d’identité, recto" />}
                {open.documents.idBack && <ProtectedImage path={`/admin/v1/merchant-applications/${open.id}/documents/id_back`} alt="Pièce d’identité, verso" />}
                {open.documents.selfie && <ProtectedImage path={`/admin/v1/merchant-applications/${open.id}/documents/selfie`} alt="Selfie" />}
              </div>
              {r.status === 'submitted' && (
                <>
                  <label>
                    Motif en cas de refus (ce que la personne doit corriger)
                    <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="actions">
                    <button onClick={() => decide(r.id, 'approve')}>Valider et ouvrir la boutique</button>
                    <button className="secondary" disabled={reason.trim().length < 3} onClick={() => decide(r.id, 'reject')}>
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
