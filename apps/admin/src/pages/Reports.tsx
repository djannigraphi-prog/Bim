import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface Report {
  id: string;
  context: 'project' | 'general';
  day: string | null;
  reason: string;
  message: string | null;
  status: 'open' | 'resolved';
  resolution: string | null;
  createdAt: string;
  projectTitle: string | null;
  categoryCode: string | null;
  templateId: string | null;
  username: string;
  taskTitle: string | null;
  image: { url: string; expiresAt: string } | null;
}

const REASONS: Record<string, string> = {
  unavailable: 'Lieu ou intervenant indisponible',
  too_hard: 'Trop difficile',
  health: 'Douleur ou malaise',
  content: 'Tâche inadaptée',
  other: 'Autre',
  app: "Difficulté avec l'application",
  product: 'Problème avec un produit ou un service',
};

/**
 * Signalements envoyés depuis la journée d'un projet (écran 27) ou « Résoudre un problème » (écran 21, sans projet).
 * L'image jointe est lue par un lien temporaire ; la réponse est visible par la personne dans l'app.
 */
export function Reports({ canResolve }: { canResolve: boolean }) {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [items, setItems] = useState<Report[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = (s = status) =>
    api<{ items: Report[] }>(`/admin/v1/reports?status=${s}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function resolve(id: string) {
    try {
      await api(`/admin/v1/reports/${id}/resolve`, { method: 'POST', body: { resolution: answers[id] ?? '' } });
      setError(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section>
      <h2>Signalements</h2>
      <p className="muted">Pour une douleur ou un malaise, l'app a déjà conseillé à la personne de consulter un professionnel de santé. BIM ne donne pas d'avis médical.</p>
      <div className="actions">
        <button className={status === 'open' ? '' : 'secondary'} onClick={() => setStatus('open')}>À traiter</button>
        <button className={status === 'resolved' ? '' : 'secondary'} onClick={() => setStatus('resolved')}>Traités</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 && <p className="muted">Aucun signalement.</p>}
      {items.map((r) => (
        <div
          className="card"
          key={r.id}
          aria-label={r.context === 'general' ? `Signalement général de @${r.username}` : `Signalement de @${r.username} sur « ${r.projectTitle} »`}
        >
          <strong>{REASONS[r.reason] ?? r.reason}</strong> — @{r.username} ·{' '}
          {r.context === 'general'
            ? `problème général, envoyé le ${new Date(r.createdAt).toLocaleDateString('fr-FR')}`
            : `${r.projectTitle} · jour du ${new Date(r.day!).toLocaleDateString('fr-FR')}`}
          {r.taskTitle && <div className="muted">Tâche : {r.taskTitle}</div>}
          {r.message && <p>« {r.message} »</p>}
          {r.image && (
            <a href={r.image.url} target="_blank" rel="noreferrer noopener" title="Ouvrir l'image en grand (lien temporaire)">
              <img className="report-image" src={r.image.url} alt="Image jointe au signalement" />
            </a>
          )}
          {r.templateId && <div className="muted">Projet suivant un programme type : vérifier son contenu si besoin.</div>}
          {r.status === 'resolved' ? (
            <p>Réponse : {r.resolution}</p>
          ) : (
            canResolve && (
              <>
                <label>
                  Réponse à la personne
                  <textarea rows={2} value={answers[r.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [r.id]: e.target.value })} />
                </label>
                <button disabled={(answers[r.id] ?? '').trim().length < 3} onClick={() => resolve(r.id)}>Répondre et clore</button>
              </>
            )
          )}
        </div>
      ))}
    </section>
  );
}
