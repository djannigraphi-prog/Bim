import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Refund {
  id: string;
  amountFcfa: number;
  status: string;
  reason: string;
}
interface Item {
  id: string;
  orderNumber: string;
  shop: string;
  provider: string;
  amountFcfa: number;
  status: 'pending' | 'succeeded' | 'failed' | 'expired';
  failureReason: string | null;
  createdAt: string;
  refunds: Refund[];
}
interface Account {
  id: string;
  shop: string;
  slug: string;
  provider: string;
  accountRef: string;
  status: string;
}

const STATUS: Record<Item['status'], string> = { pending: 'En attente du client', succeeded: 'Vérifié par le prestataire', failed: 'Échoué', expired: 'Expiré' };
const REASON: Record<string, string> = {
  provider_failed: 'refusé par le prestataire',
  amount_mismatch: 'montant différent',
  currency_mismatch: 'devise différente',
  payee_mismatch: 'autre bénéficiaire que la boutique',
  payment_closed: 'paiement déjà clos',
  replaced: 'remplacé par un nouveau lancement',
  expired: 'non validé dans le délai',
};
const OPERATORS: Record<string, string> = { orange: 'Orange Money', mtn: 'MTN Mobile Money', wave: 'Wave', moov: 'Moov Money' };

/**
 * Lot 8 — Paiements en ligne : suivi (consultation journalisée), comptes des boutiques chez le prestataire (F4 : sans
 * compte de la boutique, aucun paiement en ligne), remboursements demandés par l'équipe (jamais automatiques).
 */
export function OnlinePayments() {
  const [provider, setProvider] = useState('none');
  const [operators, setOperators] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [slug, setSlug] = useState('');
  const [ref, setRef] = useState('');
  const [refund, setRefund] = useState<Record<string, { amount: string; reason: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ provider: string; operators: string[]; items: Item[] }>('/admin/v1/online-payments');
      setProvider(r.provider);
      setOperators(r.operators);
      setItems(r.items);
      setAccounts((await api<{ items: Account[] }>('/admin/v1/online-payments/accounts')).items);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/admin/v1/online-payments/accounts', { method: 'POST', body: { shopSlug: slug, accountRef: ref } });
      setSlug('');
      setRef('');
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function disable(id: string) {
    try {
      await api(`/admin/v1/online-payments/accounts/${id}/disable`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function doRefund(e: FormEvent, id: string) {
    e.preventDefault();
    const r = refund[id] ?? { amount: '', reason: '' };
    try {
      await api(`/admin/v1/online-payments/${id}/refund`, { method: 'POST', body: { reason: r.reason, ...(r.amount ? { amountFcfa: Number(r.amount) } : {}) } });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section>
      <h2>Paiements en ligne</h2>
      <p className="muted">
        Prestataire : {provider === 'none' ? 'aucun (paiement en ligne fermé)' : provider}. Opérateurs pris en charge : {operators.length ? operators.map((o) => OPERATORS[o] ?? o).join(', ') : 'aucun'}. L'argent va directement à
        la boutique ; aucun remboursement n'est automatique.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h3>Comptes des boutiques chez le prestataire</h3>
      <form className="card" aria-label="Associer une boutique à son compte" onSubmit={addAccount}>
        <label>
          Adresse de la boutique
          <input value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </label>
        <label>
          Référence du compte (sous-compte)
          <input value={ref} onChange={(e) => setRef(e.target.value)} required minLength={4} />
        </label>
        <button type="submit">Associer</button>
      </form>
      {accounts.length === 0 && <p>Aucun compte de boutique.</p>}
      <ul>
        {accounts.map((a) => (
          <li key={a.id}>
            {a.shop} — {a.provider} {a.accountRef} — {a.status === 'active' ? 'actif' : 'désactivé'}{' '}
            {a.status === 'active' && (
              <button type="button" onClick={() => disable(a.id)}>
                Désactiver
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3>Paiements</h3>
      {items.length === 0 && !error && <p>Aucun paiement en ligne.</p>}
      {items.map((i) => (
        <div key={i.id} className="card" aria-label={`Paiement en ligne de la commande ${i.orderNumber}`}>
          <h4>
            {i.orderNumber} · {i.amountFcfa} F · {STATUS[i.status]}
            {i.failureReason ? ` (${REASON[i.failureReason] ?? i.failureReason})` : ''}
          </h4>
          <p>
            {i.shop} — {new Date(i.createdAt).toLocaleString('fr-FR')}
          </p>
          {i.refunds.map((r) => (
            <p key={r.id}>
              Remboursement de {r.amountFcfa} F : {r.status} — {r.reason}
            </p>
          ))}
          {i.status === 'succeeded' && (
            <form onSubmit={(e) => doRefund(e, i.id)}>
              <label>
                Montant à rembourser (vide : le reste)
                <input inputMode="numeric" value={refund[i.id]?.amount ?? ''} onChange={(e) => setRefund({ ...refund, [i.id]: { amount: e.target.value, reason: refund[i.id]?.reason ?? '' } })} />
              </label>
              <label>
                Motif
                <input value={refund[i.id]?.reason ?? ''} onChange={(e) => setRefund({ ...refund, [i.id]: { amount: refund[i.id]?.amount ?? '', reason: e.target.value } })} required minLength={5} />
              </label>
              <button type="submit">Rembourser</button>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}
