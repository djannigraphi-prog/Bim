import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Item {
  id: string;
  orderNumber: string;
  orderStatus: string;
  shop: string;
  customer: string;
  method: 'mobile_money' | 'cash';
  amountFcfa: number;
  status: string;
  declaredAt: string | null;
  declaredReference: string | null;
  contestReason: string | null;
  deliveredAt: string | null;
  queuedAt: string;
}

const STATUS: Record<string, string> = {
  not_paid: 'Aucune déclaration, aucune décision de la boutique',
  declared_by_customer: 'Déclaré par le client, sans décision de la boutique',
  cash_received_to_confirm: 'Espèces reçues par la boutique, sans décision',
  contested_by_shop: 'Contesté par la boutique',
};

/**
 * Lot 7-C — Paiements à vérifier : sans décision de la boutique après le délai réglé, ou contestés. BIM ne détient ni
 * ne transfère aucun fonds : le support vérifie et note sa vérification ; il ne change ni la décision ni les montants.
 * Chaque consultation de cette page est journalisée.
 */
export function Payments() {
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ items: Item[] }>('/admin/v1/payments/review')
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    void load();
  }, []);

  async function reviewed(e: FormEvent, id: string) {
    e.preventDefault();
    try {
      await api(`/admin/v1/payments/${id}/reviewed`, { method: 'POST', body: { note: notes[id] ?? '' } });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2>Paiements à vérifier</h2>
      <p className="muted">Aucune confirmation implicite : un paiement sans décision de la boutique reste « à confirmer ». Aucun prestataire n'est intégré.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 && !error && <p>Aucun paiement à vérifier.</p>}
      {items.map((p) => (
        <form key={p.id} className="card" aria-label={`Paiement de la commande ${p.orderNumber}`} onSubmit={(e) => reviewed(e, p.id)}>
          <h4>
            {p.orderNumber} · {p.amountFcfa} F · {p.method === 'cash' ? 'espèces' : 'Mobile Money'}
          </h4>
          <p>
            {p.shop} — client : {p.customer}
          </p>
          <p>{STATUS[p.status] ?? p.status}</p>
          {p.declaredReference && <p>Référence indiquée par le client : {p.declaredReference}</p>}
          {p.contestReason && <p>Motif de la boutique : {p.contestReason}</p>}
          <label>
            Note de vérification
            <input value={notes[p.id] ?? ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} required minLength={3} />
          </label>
          <button type="submit">Marquer comme vérifié</button>
        </form>
      ))}
    </section>
  );
}
