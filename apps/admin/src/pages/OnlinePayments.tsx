import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Item {
  id: string;
  orderNumber: string;
  shop: string;
  provider: string;
  amountFcfa: number;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'late_paid';
  failureReason: string | null;
  createdAt: string;
  paidAmountFcfa: number | null;
}
interface Account {
  id: string;
  shop: string;
  slug: string;
  provider: string;
  accountRef: string;
  status: string;
}

const STATUS: Record<Item['status'], string> = { pending: 'En attente du client', succeeded: 'Vérifié par le prestataire', failed: 'Échoué', expired: 'Expiré', late_paid: 'Reçu mais non retenu pour la commande — à examiner par le support (aucun remboursement)' };
const REASON: Record<string, string> = {
  provider_failed: 'refusé par le prestataire',
  amount_mismatch: 'montant différent',
  currency_mismatch: 'devise différente',
  payee_mismatch: 'autre bénéficiaire que la boutique',
  payment_closed: 'paiement déjà clos',
  replaced: 'remplacé par un nouveau lancement',
  expired: 'non validé dans le délai',
  late_expired: 'payé après le délai',
  late_replaced: 'payé après un nouveau lancement',
  late_failed: 'payé après un échec',
};
const OPERATORS: Record<string, string> = { orange: 'Orange Money', mtn: 'MTN Mobile Money', wave: 'Wave', moov: 'Moov Money' };

/**
 * Lot 8 — Paiements en ligne : suivi (consultation journalisée), comptes des boutiques chez le prestataire (F4 : sans
 * compte de la boutique, aucun paiement en ligne). Aucun remboursement dans BIM (règle du fondateur, 18/10/2026) : un
 * paiement reçu en retard ou non conforme est seulement signalé au support.
 */
export function OnlinePayments() {
  const [provider, setProvider] = useState('none');
  const [operators, setOperators] = useState<string[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [slug, setSlug] = useState('');
  const [ref, setRef] = useState('');
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

  return (
    <section>
      <h2>Paiements en ligne</h2>
      <p className="muted">
        Prestataire : {provider === 'none' ? 'aucun (paiement en ligne fermé)' : provider}. Opérateurs pris en charge : {operators.length ? operators.map((o) => OPERATORS[o] ?? o).join(', ') : 'aucun'}. L'argent va directement à
        la boutique. BIM ne fait aucun remboursement : en cas de problème, le client signale la boutique.
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
          {i.status === 'late_paid' && (
            <p>
              Montant reçu : {i.paidAmountFcfa ?? i.amountFcfa} F. Il ne vaut pas pour la commande ; aucun remboursement n'est fait par BIM. Le support contacte le client et la boutique.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
