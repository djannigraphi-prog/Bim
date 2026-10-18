import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Item {
  id: string;
  coins: number;
  feeFcfa: number;
  netFcfa: number;
  operator: string;
  phone: string;
  channel: string;
  status: 'review' | 'paid' | 'rejected';
  reviewReason: 'first' | 'amount' | null;
  rejectReason: string | null;
  at: string;
  user: { id: string; username: string; fullName: string };
}

const TABS: { value: Item['status']; label: string }[] = [
  { value: 'review', label: 'À vérifier' },
  { value: 'paid', label: 'Versés' },
  { value: 'rejected', label: 'Refusés' },
];
const OPERATORS: Record<string, string> = { orange: 'Orange Money', mtn: 'MTN MoMo', moov: 'Moov Money', wave: 'Wave' };
const REASONS: Record<string, string> = { first: 'Premier retrait', amount: 'Montant au-delà du seuil' };
const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} F`;

/**
 * Lot 9 (prototype) — Retraits de pièces reçues. Premier retrait et gros montants : vérification par l'équipe.
 * Prototype : « Valider » enregistre un versement simulé ; aucun argent ne part. « Refuser » rend les pièces.
 */
export function Withdrawals() {
  const [status, setStatus] = useState<Item['status']>('review');
  const [items, setItems] = useState<Item[]>([]);
  const [demo, setDemo] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = (s: Item['status']) =>
    api<{ demo: boolean; items: Item[] }>(`/admin/v1/withdrawals?status=${s}`)
      .then((r) => {
        setItems(r.items);
        setDemo(r.demo);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    void load(status);
  }, [status]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    try {
      await api(`/admin/v1/withdrawals/${id}/decision`, { method: 'POST', body: decision === 'reject' ? { decision, reason: reasons[id] ?? '' } : { decision } });
      await load(status);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2>Retraits de pièces</h2>
      <p className="muted">
        {demo ? 'Mode démonstration : « Valider » enregistre un versement simulé, aucun argent ne part.' : 'Mode démonstration coupé : aucun nouveau retrait possible.'} Commission BIM : 0 F ; les frais de
        l’opérateur sont à la charge de la personne.
      </p>
      <div role="tablist" aria-label="État des retraits">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={status === t.value} className={status === t.value ? 'active' : ''} onClick={() => setStatus(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 && !error && <p>Aucun retrait.</p>}
      {items.map((w) => (
        <div key={w.id} className="card" aria-label={`Retrait de ${w.user.fullName}`}>
          <h4>
            {w.user.fullName} (@{w.user.username}) · {w.coins.toLocaleString('fr-FR')} pièces
          </h4>
          <p>
            {OPERATORS[w.operator] ?? w.operator} · {w.phone} · frais {fcfa(w.feeFcfa)} · versé {fcfa(w.netFcfa)} · {new Date(w.at).toLocaleString('fr-FR')}
            {w.channel === 'demo' ? ' · simulé' : ''}
          </p>
          {w.reviewReason && <p>Vérification : {REASONS[w.reviewReason] ?? w.reviewReason}</p>}
          {w.rejectReason && <p>Motif du refus : {w.rejectReason}</p>}
          {w.status === 'review' && (
            <>
              <button type="button" onClick={() => decide(w.id, 'approve')}>
                Valider
              </button>
              <label>
                Motif du refus
                <input value={reasons[w.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [w.id]: e.target.value })} />
              </label>
              <button type="button" disabled={!(reasons[w.id] ?? '').trim()} onClick={() => decide(w.id, 'reject')}>
                Refuser et rendre les pièces
              </button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
