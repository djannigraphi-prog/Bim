import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../api';

type Mode = 'express' | 'economy';
const MODES: Array<{ mode: Mode; label: string }> = [
  { mode: 'express', label: 'Rapide' },
  { mode: 'economy', label: 'Économique' },
];
const modeLabel = (m: string) => MODES.find((x) => x.mode === m)?.label ?? m;

interface Commune {
  code: string;
  city: string;
  name: string;
  active: boolean;
}
interface Duration {
  fromCode: string;
  toCode: string;
  mode: Mode;
  minutes: number;
}
interface Tariff {
  id: string;
  mode: Mode;
  version: number;
  status: 'draft' | 'published';
  current: boolean;
  baseFcfa: number;
  perMinuteFcfa: number;
  minimumFcfa: number;
  roundingFcfa: number;
  freeWaitMinutes: number;
  waitPerMinuteFcfa: number;
  waitCapMinutes: number;
  publishedAt: string | null;
}

const FIELDS: Array<{ key: keyof Tariff; label: string }> = [
  { key: 'baseFcfa', label: 'Prise en charge (F)' },
  { key: 'perMinuteFcfa', label: 'Prix par minute (F)' },
  { key: 'minimumFcfa', label: 'Minimum (F)' },
  { key: 'roundingFcfa', label: "Pas d'arrondi (F)" },
  { key: 'freeWaitMinutes', label: 'Attente gratuite (min)' },
  { key: 'waitPerMinuteFcfa', label: "Prix par minute d'attente (F)" },
  { key: 'waitCapMinutes', label: "Plafond d'attente (min)" },
];

const EMPTY: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.key, '']));

/**
 * Lot 7-D — Tarifs de livraison : communes desservables, durées estimées entre communes, grilles par mode.
 * Une grille publiée ne se modifie plus : on publie une nouvelle version, qui s'applique aux commandes confirmées
 * ensuite. Aucune valeur n'est fixée dans le code.
 */
export function Deliveries({ canWrite }: { canWrite: boolean }) {
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [durations, setDurations] = useState<Duration[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCommune, setNewCommune] = useState({ city: 'Abidjan', name: '' });
  const [duration, setDuration] = useState({ fromCode: '', toCode: '', mode: 'express' as Mode, minutes: '' });
  const [drafts, setDrafts] = useState<Record<Mode, Record<string, string>>>({ express: { ...EMPTY }, economy: { ...EMPTY } });
  const [simulation, setSimulation] = useState<Record<string, string>>({});

  async function run<T>(p: Promise<T>, then: (r: T) => void) {
    try {
      then(await p);
      setError(null);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  const loadTariffs = () => run(api<{ items: Tariff[] }>('/admin/v1/delivery/tariffs'), (r) => setTariffs(r.items));
  useEffect(() => {
    void run(api<{ items: Commune[] }>('/admin/v1/delivery/communes'), (r) => setCommunes(r.items));
    void run(api<{ items: Duration[] }>('/admin/v1/delivery/durations'), (r) => setDurations(r.items));
    void loadTariffs();
  }, []);

  const name = (code: string) => {
    const c = communes.find((x) => x.code === code);
    return c ? `${c.name} (${c.city})` : code;
  };

  async function addCommune(e: FormEvent) {
    e.preventDefault();
    if (await run(api<{ items: Commune[] }>('/admin/v1/delivery/communes', { method: 'POST', body: newCommune }), (r) => setCommunes(r.items))) setNewCommune({ ...newCommune, name: '' });
  }

  async function saveDuration(e: FormEvent, remove = false) {
    e.preventDefault();
    const body = { fromCode: duration.fromCode, toCode: duration.toCode, mode: duration.mode, minutes: remove ? null : Number(duration.minutes) };
    if (await run(api<{ items: Duration[] }>('/admin/v1/delivery/durations', { method: 'PUT', body }), (r) => setDurations(r.items))) setDuration({ ...duration, minutes: '' });
  }

  async function saveDraft(e: FormEvent, mode: Mode) {
    e.preventDefault();
    const body = { mode, ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(drafts[mode][f.key])])) };
    if (await run(api('/admin/v1/delivery/tariffs/draft', { method: 'PUT', body }), () => undefined)) await loadTariffs();
  }

  function editFrom(t: Tariff) {
    setDrafts({ ...drafts, [t.mode]: Object.fromEntries(FIELDS.map((f) => [f.key, String(t[f.key])])) });
  }

  return (
    <section>
      <h2>Tarifs de livraison</h2>
      <p className="muted">
        Frais = arrondi supérieur au pas de max(minimum, prise en charge + prix par minute × durée estimée). Une commune absente ou un trajet sans durée rend
        la livraison indisponible. L'attente est enregistrée ; elle n'est facturée que si le réglage « delivery.wait_fees_enabled » est activé.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h3>Grilles</h3>
      {MODES.map(({ mode, label }) => {
        const rows = tariffs.filter((t) => t.mode === mode);
        const current = rows.find((t) => t.current);
        return (
          <div key={mode} className="card" aria-label={`Grille ${label}`}>
            <h4>
              {label} — {current ? `version ${current.version} en vigueur` : 'aucune grille publiée : mode indisponible'}
            </h4>
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>État</th>
                  {FIELDS.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>{t.version}</td>
                    <td>{t.status === 'draft' ? 'Brouillon' : t.current ? 'En vigueur' : 'Remplacée'}</td>
                    {FIELDS.map((f) => (
                      <td key={f.key}>{String(t[f.key])}</td>
                    ))}
                    <td>
                      <input
                        aria-label={`Minutes à simuler, version ${t.version} ${label}`}
                        size={4}
                        value={simulation[t.id] ?? ''}
                        onChange={(e) => setSimulation({ ...simulation, [t.id]: e.target.value })}
                      />
                      <button
                        className="link"
                        onClick={() =>
                          run(api<{ feeFcfa: number }>(`/admin/v1/delivery/tariffs/${t.id}/simulate`, { method: 'POST', body: { minutes: Number(simulation[t.id]) } }), (r) =>
                            setSimulation({ ...simulation, [`${t.id}:r`]: `${r.feeFcfa} F` }),
                          )
                        }
                      >
                        Simuler
                      </button>
                      {simulation[`${t.id}:r`] && <span data-testid={`simulation-${t.id}`}> {simulation[`${t.id}:r`]}</span>}
                      {canWrite && t.status === 'draft' && (
                        <button onClick={() => run(api<{ items: Tariff[] }>(`/admin/v1/delivery/tariffs/${t.id}/publish`, { method: 'POST' }), (r) => setTariffs(r.items))}>
                          Publier la version {t.version}
                        </button>
                      )}
                      {canWrite && (
                        <button className="link" onClick={() => editFrom(t)}>
                          Reprendre ces valeurs
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canWrite && (
              <form onSubmit={(e) => saveDraft(e, mode)} className="row">
                {FIELDS.map((f) => (
                  <label key={f.key}>
                    {f.label} ({label})
                    <input
                      inputMode="numeric"
                      value={drafts[mode][f.key]}
                      onChange={(e) => setDrafts({ ...drafts, [mode]: { ...drafts[mode], [f.key]: e.target.value } })}
                      required
                    />
                  </label>
                ))}
                <button type="submit">Enregistrer le brouillon {label}</button>
              </form>
            )}
          </div>
        );
      })}

      <h3>Communes desservables</h3>
      <table>
        <thead>
          <tr>
            <th>Ville</th>
            <th>Commune</th>
            <th>Code</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          {communes.map((c) => (
            <tr key={c.code}>
              <td>{c.city}</td>
              <td>{c.name}</td>
              <td>{c.code}</td>
              <td>
                {c.active ? 'Desservie' : 'Désactivée'}
                {canWrite && (
                  <button className="link" onClick={() => run(api<{ items: Commune[] }>(`/admin/v1/delivery/communes/${c.code}`, { method: 'PATCH', body: { active: !c.active } }), (r) => setCommunes(r.items))}>
                    {c.active ? 'Désactiver' : 'Réactiver'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canWrite && (
        <form onSubmit={addCommune} className="row">
          <label>
            Ville
            <input value={newCommune.city} onChange={(e) => setNewCommune({ ...newCommune, city: e.target.value })} required />
          </label>
          <label>
            Commune
            <input value={newCommune.name} onChange={(e) => setNewCommune({ ...newCommune, name: e.target.value })} required />
          </label>
          <button type="submit">Ajouter la commune</button>
        </form>
      )}

      <h3>Durées estimées des trajets</h3>
      <table>
        <thead>
          <tr>
            <th>De</th>
            <th>Vers</th>
            <th>Mode</th>
            <th>Minutes</th>
          </tr>
        </thead>
        <tbody>
          {durations.map((d) => (
            <tr key={`${d.fromCode}>${d.toCode}>${d.mode}`}>
              <td>{name(d.fromCode)}</td>
              <td>{name(d.toCode)}</td>
              <td>{modeLabel(d.mode)}</td>
              <td>{d.minutes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canWrite && (
        <form onSubmit={(e) => saveDuration(e)} className="row">
          <label>
            De
            <select value={duration.fromCode} onChange={(e) => setDuration({ ...duration, fromCode: e.target.value })} required>
              <option value="">—</option>
              {communes.map((c) => (
                <option key={c.code} value={c.code}>
                  {name(c.code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vers
            <select value={duration.toCode} onChange={(e) => setDuration({ ...duration, toCode: e.target.value })} required>
              <option value="">—</option>
              {communes.map((c) => (
                <option key={c.code} value={c.code}>
                  {name(c.code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={duration.mode} onChange={(e) => setDuration({ ...duration, mode: e.target.value as Mode })}>
              {MODES.map((m) => (
                <option key={m.mode} value={m.mode}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minutes
            <input inputMode="numeric" value={duration.minutes} onChange={(e) => setDuration({ ...duration, minutes: e.target.value })} />
          </label>
          <button type="submit" disabled={!duration.minutes}>
            Enregistrer la durée
          </button>
          <button type="button" className="link" onClick={(e) => saveDuration(e as unknown as FormEvent, true)} disabled={!duration.fromCode || !duration.toCode}>
            Retirer ce trajet
          </button>
        </form>
      )}
    </section>
  );
}
