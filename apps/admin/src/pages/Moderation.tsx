import { useEffect, useState } from 'react';
import { api, errorText } from '../api';

interface ContentReport {
  id: string;
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  reason: string;
  message: string | null;
  reporter: string;
  author: { id: string; username: string; fullName: string; status: string } | null;
  content: { kind: string; text: string | null; status: string | null; images: string[]; visibility?: string; postId?: string };
  status: 'open' | 'resolved';
  action: 'none' | 'hidden' | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const REASONS: Record<string, string> = {
  spam: 'Spam ou publicité',
  harassment: 'Harcèlement',
  nudity: 'Nudité',
  violence: 'Violence',
  hate: 'Propos haineux',
  self_harm: 'Automutilation ou suicide',
  false_info: 'Fausse information',
  other: 'Autre',
};
const TARGETS: Record<string, string> = { post: 'Publication', comment: 'Commentaire', user: 'Profil' };
const STATUS: Record<string, string> = { published: 'en ligne', hidden: 'masqué', deleted: 'supprimé par son auteur' };

/**
 * Modération du social (lot 4) : publications, commentaires et profils signalés par les personnes. Décision : rien à
 * reprocher, ou contenu masqué (réversible). Pour une personne, la mesure est la suspension (page Utilisateurs).
 */
export function Moderation({ canModerate }: { canModerate: boolean }) {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [items, setItems] = useState<ContentReport[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = (s = status) =>
    api<{ items: ContentReport[] }>(`/admin/v1/content-reports?status=${s}`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(path: string, body?: unknown) {
    try {
      await api(path, { method: 'POST', body });
      setError(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section>
      <h2>Modération</h2>
      <p className="muted">
        Contenus signalés par les personnes. Masquer retire le contenu pour tout le monde, y compris son auteur ; c’est réversible. Pour une personne, suspends son compte depuis la page Utilisateurs.
        Automutilation ou suicide : traiter en priorité.
      </p>
      <div className="actions">
        <button className={status === 'open' ? '' : 'secondary'} onClick={() => setStatus('open')}>À traiter</button>
        <button className={status === 'resolved' ? '' : 'secondary'} onClick={() => setStatus('resolved')}>Traités</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 && <p className="muted">Aucun signalement.</p>}
      {items.map((r) => {
        const note = (notes[r.id] ?? '').trim();
        return (
          <div className="card" key={r.id} aria-label={`${TARGETS[r.targetType]} signalée : ${REASONS[r.reason] ?? r.reason}, de @${r.author?.username ?? '?'}`}>
            <strong>{REASONS[r.reason] ?? r.reason}</strong> — {TARGETS[r.targetType]} de @{r.author?.username ?? '?'} · signalé par @{r.reporter} le{' '}
            {new Date(r.createdAt).toLocaleDateString('fr-FR')}
            {r.message && <p>« {r.message} »</p>}
            {r.content.text && <blockquote>{r.content.text}</blockquote>}
            {r.content.images.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer noopener" title="Ouvrir l'image en grand (lien temporaire)">
                <img className="report-image" src={url} alt="Image de la publication signalée" />
              </a>
            ))}
            {r.content.status && <div className="muted">État du contenu : {STATUS[r.content.status] ?? r.content.status}</div>}
            {r.author && r.author.status !== 'active' && <div className="muted">Compte de l’auteur : {r.author.status}</div>}
            {r.status === 'resolved' ? (
              <>
                <p>
                  Décision : {r.action === 'hidden' ? 'contenu masqué' : 'rien à reprocher'} — {r.resolution}
                </p>
                {canModerate && r.content.status === 'hidden' && r.targetType !== 'user' && (
                  <button className="secondary" onClick={() => act(`/admin/v1/content/${r.targetType}/${r.targetId}/restore`)}>
                    Rétablir le contenu
                  </button>
                )}
              </>
            ) : (
              canModerate && (
                <>
                  <label>
                    Motif de la décision (journal d’audit)
                    <textarea rows={2} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  </label>
                  <div className="actions">
                    {r.targetType !== 'user' && (
                      <button disabled={note.length < 3} onClick={() => act(`/admin/v1/content-reports/${r.id}/resolve`, { action: 'hidden', resolution: note })}>
                        Masquer le contenu
                      </button>
                    )}
                    <button className="secondary" disabled={note.length < 3} onClick={() => act(`/admin/v1/content-reports/${r.id}/resolve`, { action: 'none', resolution: note })}>
                      Rien à reprocher
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        );
      })}
    </section>
  );
}
