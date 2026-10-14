import { useEffect, useState } from 'react';
import { api, errorText, WEEKDAYS, weekdaysLabel } from '../api';

interface Task {
  title: string;
  detail?: string | null;
  icon?: string;
  timeOfDay: string;
  weekdays: number;
}
interface Program {
  id: string;
  categoryCode: string;
  goalCode: string | null;
  title: string;
  durationDays: number;
  status: 'draft' | 'published' | 'archived';
  validatedBy: string | null;
  tasks: Task[];
}
interface Category {
  code: string;
  label: string;
  goals: Array<{ code: string; label: string }>;
}

const STATUS = { draft: 'Brouillon', published: 'Publié', archived: 'Archivé' };

/**
 * Programmes types (C7). Rédigés par l'équipe BIM, publiés seulement avec le nom de la personne compétente
 * qui a validé le contenu. Un programme publié est figé : pour le modifier, on l'archive et on en crée une nouvelle version.
 */
export function Programs({ canWrite, canPublish }: { canWrite: boolean; canPublish: boolean }) {
  const [items, setItems] = useState<Program[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Program | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ items: Program[]; categories: Category[] }>('/admin/v1/programs')
      .then((r) => {
        setItems(r.items);
        setCats(r.categories);
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const label = (p: Program) => {
    const c = cats.find((x) => x.code === p.categoryCode);
    const g = c?.goals.find((x) => x.code === p.goalCode);
    return `${c?.label ?? p.categoryCode}${g ? ` · ${g.label}` : ' · tous objectifs'}`;
  };

  async function publish(p: Program) {
    const who = window.prompt('Nom et qualité de la personne compétente qui a validé ce contenu (ex. « Awa Koné, coach diplômée ») :');
    if (!who) return;
    try {
      await api(`/admin/v1/programs/${p.id}/publish`, { method: 'POST', body: { validatedBy: who } });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function archive(p: Program) {
    try {
      await api(`/admin/v1/programs/${p.id}/archive`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section>
      <h2>Programmes types</h2>
      <p className="muted">
        Sans programme publié pour une catégorie, l'app construit le programme à partir des réponses de la personne (séances par semaine, disponibilité).
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {canWrite && !editing && <button onClick={() => setEditing('new')}>Nouveau programme</button>}
      {editing && (
        <ProgramEditor
          categories={cats}
          program={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      <table>
        <thead>
          <tr>
            <th>Programme</th>
            <th>Catégorie</th>
            <th>Durée</th>
            <th>Tâches</th>
            <th>Statut</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td>{label(p)}</td>
              <td>{p.durationDays} j</td>
              <td>
                {p.tasks.map((t, i) => (
                  <div key={i}>
                    {t.timeOfDay} — {t.title} <small className="muted">({weekdaysLabel(t.weekdays)})</small>
                  </div>
                ))}
              </td>
              <td>
                <span className={`badge ${p.status}`}>{STATUS[p.status]}</span>
                {p.validatedBy && <div className="muted">Validé par {p.validatedBy}</div>}
              </td>
              <td className="actions">
                {canWrite && p.status === 'draft' && <button className="small secondary" onClick={() => setEditing(p)}>Modifier</button>}
                {canPublish && p.status === 'draft' && <button className="small" onClick={() => publish(p)}>Publier</button>}
                {canWrite && p.status !== 'archived' && <button className="small secondary" onClick={() => archive(p)}>Archiver</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProgramEditor({ categories, program, onClose, onSaved }: { categories: Category[]; program: Program | null; onClose: () => void; onSaved: () => void }) {
  const [categoryCode, setCategory] = useState(program?.categoryCode ?? categories[0]?.code ?? '');
  const [goalCode, setGoal] = useState<string>(program?.goalCode ?? '');
  const [title, setTitle] = useState(program?.title ?? '');
  const [durationDays, setDuration] = useState(program?.durationDays ?? 30);
  const [tasks, setTasks] = useState<Task[]>(program?.tasks ?? [{ title: '', timeOfDay: '07:00', weekdays: 127 }]);
  const [error, setError] = useState<string | null>(null);
  const goals = categories.find((c) => c.code === categoryCode)?.goals ?? [];

  const setTask = (i: number, patch: Partial<Task>) => setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  async function save() {
    const body = {
      categoryCode,
      goalCode: goalCode || null,
      title,
      durationDays,
      tasks: tasks.map((t) => ({ title: t.title, detail: t.detail || undefined, timeOfDay: t.timeOfDay, weekdays: t.weekdays })),
    };
    try {
      if (program) await api(`/admin/v1/programs/${program.id}`, { method: 'PUT', body });
      else await api('/admin/v1/programs', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="card editor" aria-label="Éditeur de programme">
      <h3>{program ? 'Modifier le brouillon' : 'Nouveau programme (brouillon)'}</h3>
      <div className="row">
        <label>
          Catégorie
          <select aria-label="Catégorie du programme" value={categoryCode} onChange={(e) => { setCategory(e.target.value); setGoal(''); }}>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
        <label>
          Objectif
          <select aria-label="Objectif du programme" value={goalCode} onChange={(e) => setGoal(e.target.value)}>
            <option value="">Tous les objectifs de la catégorie</option>
            {goals.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
          </select>
        </label>
        <label>
          Durée (jours)
          <input aria-label="Durée (jours)" type="number" min={7} max={365} value={durationDays} onChange={(e) => setDuration(Number(e.target.value))} />
        </label>
      </div>
      <label>
        Titre
        <input aria-label="Titre du programme" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <h4>Tâches</h4>
      {tasks.map((t, i) => (
        <div className="task" key={i}>
          <input aria-label={`Titre de la tâche ${i + 1}`} placeholder="Titre" value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} />
          <input aria-label={`Précision de la tâche ${i + 1}`} placeholder="Précision (facultatif)" value={t.detail ?? ''} onChange={(e) => setTask(i, { detail: e.target.value })} />
          <input aria-label={`Heure de la tâche ${i + 1}`} type="time" value={t.timeOfDay} onChange={(e) => setTask(i, { timeOfDay: e.target.value })} />
          <span className="days">
            {WEEKDAYS.map((d, b) => (
              <label key={d} className="day">
                <input type="checkbox" checked={!!(t.weekdays & (1 << b))} onChange={() => setTask(i, { weekdays: t.weekdays ^ (1 << b) })} />
                {d}
              </label>
            ))}
          </span>
          <button className="small secondary" onClick={() => setTasks((ts) => ts.filter((_, j) => j !== i))} aria-label={`Retirer la tâche ${i + 1}`}>
            Retirer
          </button>
        </div>
      ))}
      <button className="small secondary" onClick={() => setTasks((ts) => [...ts, { title: '', timeOfDay: '07:00', weekdays: 127 }])}>
        Ajouter une tâche
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button onClick={save}>Enregistrer le brouillon</button>
        <button className="secondary" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}
