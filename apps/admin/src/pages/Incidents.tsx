import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface IncidentEvent {
  type: string;
  actorType: string;
  note: string | null;
  at: string;
}

interface Item {
  id: string;
  orderNumber: string;
  shop: string;
  customer: string;
  reason: string;
  description: string | null;
  status: 'open' | 'with_support' | 'resolved';
  openedBy: string;
  resolution: string | null;
  createdAt: string;
  events: IncidentEvent[];
  /** Photos jointes par les parties (liens temporaires ; supprimées 30 jours après la clôture). */
  photos?: { id: string; by: string; url: string | null }[];
  actions: string[];
}

const REASONS: Record<string, string> = {
  item_incorrect: 'Article incorrect',
  item_damaged: 'Article endommagé',
  item_incomplete: 'Article incomplet',
  client_absent: 'Client absent',
  courier_absent: 'Livreur absent',
  courier_not_there: "Le livreur n'est pas là",
  delay: 'Retard',
  payment: 'Paiement',
  behaviour: 'Comportement',
  other: 'Autre',
};

const ACTORS: Record<string, string> = { customer: 'client', shop: 'boutique', courier: 'livreur', system: 'système', admin: 'support' };

const TABS: { value: Item['status']; label: string }[] = [
  { value: 'with_support', label: 'Transmis au support' },
  { value: 'open', label: 'Ouverts' },
  { value: 'resolved', label: 'Résolus' },
];

/**
 * Lot 7-G — Incidents de commande et de livraison. Le support lit le dossier et note sa décision ; aucune pénalité,
 * aucun frais, aucun remboursement automatique. Chaque consultation et chaque décision sont journalisées.
 */
export function Incidents() {
  const [status, setStatus] = useState<Item['status']>('with_support');
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = (s: Item['status']) =>
    api<{ items: Item[] }>(`/admin/v1/incidents?status=${s}`)
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    void load(status);
  }, [status]);

  async function resolve(e: FormEvent, id: string) {
    e.preventDefault();
    try {
      await api(`/admin/v1/incidents/${id}/resolve`, { method: 'POST', body: { note: notes[id] ?? '' } });
      await load(status);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2>Incidents</h2>
      <p className="muted">Aucune pénalité, aucun frais ni remboursement automatique : la décision du support est une note, sans effet financier.</p>
      <div role="tablist" aria-label="État des incidents">
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
      {items.length === 0 && !error && <p>Aucun incident.</p>}
      {items.map((i) => (
        <form key={i.id} className="card" aria-label={`Incident de la commande ${i.orderNumber}`} onSubmit={(e) => resolve(e, i.id)}>
          <h4>
            {i.orderNumber} · {REASONS[i.reason] ?? i.reason}
          </h4>
          <p>
            {i.shop} — client : {i.customer} — ouvert par : {ACTORS[i.openedBy] ?? i.openedBy}
          </p>
          {i.description && <p>{i.description}</p>}
          <ul>
            {i.events.map((ev, n) => (
              <li key={n}>
                {new Date(ev.at).toLocaleString('fr-FR')} · {ACTORS[ev.actorType] ?? ev.actorType} · {ev.type}
                {ev.note ? ` — ${ev.note}` : ''}
              </li>
            ))}
          </ul>
          {!!i.photos?.length && (
            <p>
              {i.photos.map((p) =>
                p.url ? (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                    <img src={p.url} alt={`Photo (${ACTORS[p.by] ?? p.by})`} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  </a>
                ) : null,
              )}
            </p>
          )}
          {i.resolution && <p>Décision : {i.resolution}</p>}
          {i.actions.includes('resolve') && (
            <>
              <label>
                Décision du support
                <input value={notes[i.id] ?? ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} required minLength={3} />
              </label>
              <button type="submit">Marquer comme résolu</button>
            </>
          )}
        </form>
      ))}
    </section>
  );
}
