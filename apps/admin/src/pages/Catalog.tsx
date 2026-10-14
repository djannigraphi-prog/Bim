import { FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Goal {
  code: string;
  categoryCode: string;
  label: string;
  quantityUnit: string | null;
  quantityMin: number | null;
  quantityMax: number | null;
  titlePattern: string;
  sortOrder: number;
  active: boolean;
}
interface Category {
  code: string;
  label: string;
  icon: string;
  tint: string;
  sortOrder: number;
  active: boolean;
  goals: Goal[];
}

/** Catégories (écran 20) et objectifs (écran 21) proposés dans « Nouveau projet ». */
export function Catalog({ canWrite }: { canWrite: boolean }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [icons, setIcons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState({ code: '', label: '', icon: 'leaf', tint: '#EAF7EF' });
  const [newGoal, setNewGoal] = useState({ code: '', categoryCode: '', label: '', quantityUnit: '', quantityMin: '', quantityMax: '', titlePattern: '' });

  const apply = (r: { categories: Category[]; icons: string[] }) => {
    setCats(r.categories);
    setIcons(r.icons);
    setError(null);
  };
  const load = () => api<{ categories: Category[]; icons: string[] }>('/admin/v1/catalog').then(apply).catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  async function call(path: string, method: string, body: unknown) {
    try {
      apply(await api<{ categories: Category[]; icons: string[] }>(path, { method, body }));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (await call('/admin/v1/categories', 'POST', { ...newCat, sortOrder: (cats.length + 1) * 10 })) setNewCat({ code: '', label: '', icon: 'leaf', tint: '#EAF7EF' });
  }

  async function addGoal(e: FormEvent) {
    e.preventDefault();
    const g = newGoal;
    const body = {
      code: g.code,
      categoryCode: g.categoryCode,
      label: g.label,
      titlePattern: g.titlePattern,
      ...(g.quantityUnit ? { quantityUnit: g.quantityUnit, quantityMin: Number(g.quantityMin), quantityMax: Number(g.quantityMax) } : {}),
      sortOrder: 1000,
    };
    if (await call('/admin/v1/goals', 'POST', body)) setNewGoal({ ...newGoal, code: '', label: '', quantityUnit: '', quantityMin: '', quantityMax: '', titlePattern: '' });
  }

  return (
    <section>
      <h2>Catégories et objectifs</h2>
      <p className="muted">Une catégorie ou un objectif désactivé n'est plus proposé ; les projets existants ne changent pas.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Catégorie</th>
            <th>Objectifs</th>
            <th>Statut</th>
            {canWrite && <th />}
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.code}>
              <td>
                <span className="swatch" style={{ background: c.tint }} /> <strong>{c.label}</strong>
                <br />
                <small className="muted">{c.code} · icône {c.icon}</small>
              </td>
              <td>
                {c.goals.length === 0 && <span className="muted">Aucun (la personne décrit son objectif)</span>}
                {c.goals.map((g) => (
                  <div key={g.code}>
                    {g.label}
                    {g.quantityUnit && <small className="muted"> · {g.quantityMin}–{g.quantityMax} {g.quantityUnit}</small>}
                    <small className="muted"> · « {g.titlePattern} »</small>
                    {!g.active && <span className="badge disabled"> inactif</span>}
                    {canWrite && (
                      <button className="small link" onClick={() => call(`/admin/v1/goals/${g.code}`, 'PATCH', { active: !g.active })}>
                        {g.active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    )}
                  </div>
                ))}
              </td>
              <td>
                <span className={`badge ${c.active ? 'active' : 'disabled'}`}>{c.active ? 'Active' : 'Inactive'}</span>
              </td>
              {canWrite && (
                <td>
                  <button className="small secondary" onClick={() => call(`/admin/v1/categories/${c.code}`, 'PATCH', { active: !c.active })}>
                    {c.active ? 'Désactiver' : 'Réactiver'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canWrite && (
        <div className="row">
          <form className="card" onSubmit={addCategory} aria-label="Nouvelle catégorie">
            <h3>Nouvelle catégorie</h3>
            <label>Code<input value={newCat.code} placeholder="ex. bien_etre_mental" onChange={(e) => setNewCat({ ...newCat, code: e.target.value })} /></label>
            <label>Libellé<input value={newCat.label} onChange={(e) => setNewCat({ ...newCat, label: e.target.value })} /></label>
            <label>
              Icône
              <select value={newCat.icon} onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })}>
                {icons.map((i) => <option key={i}>{i}</option>)}
              </select>
            </label>
            <label>Couleur de fond<input type="color" value={newCat.tint} onChange={(e) => setNewCat({ ...newCat, tint: e.target.value.toUpperCase() })} /></label>
            <button>Créer la catégorie</button>
          </form>
          <form className="card" onSubmit={addGoal} aria-label="Nouvel objectif">
            <h3>Nouvel objectif</h3>
            <label>
              Catégorie
              <select value={newGoal.categoryCode} onChange={(e) => setNewGoal({ ...newGoal, categoryCode: e.target.value })}>
                <option value="">—</option>
                {cats.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <label>Code<input value={newGoal.code} onChange={(e) => setNewGoal({ ...newGoal, code: e.target.value })} /></label>
            <label>Libellé<input value={newGoal.label} onChange={(e) => setNewGoal({ ...newGoal, label: e.target.value })} /></label>
            <label>Unité (facultatif, ex. kg)<input value={newGoal.quantityUnit} onChange={(e) => setNewGoal({ ...newGoal, quantityUnit: e.target.value })} /></label>
            {newGoal.quantityUnit && (
              <div className="row">
                <label>Minimum<input type="number" value={newGoal.quantityMin} onChange={(e) => setNewGoal({ ...newGoal, quantityMin: e.target.value })} /></label>
                <label>Maximum<input type="number" value={newGoal.quantityMax} onChange={(e) => setNewGoal({ ...newGoal, quantityMax: e.target.value })} /></label>
              </div>
            )}
            <label>
              Nom de projet généré {newGoal.quantityUnit ? '(avec {q}, ex. « Perdre {q} kg »)' : ''}
              <input value={newGoal.titlePattern} onChange={(e) => setNewGoal({ ...newGoal, titlePattern: e.target.value })} />
            </label>
            <button>Créer l'objectif</button>
          </form>
        </div>
      )}
    </section>
  );
}
