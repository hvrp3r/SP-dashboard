import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import VoteControl from '../components/VoteControl.jsx';
import * as suggestionsApi from '../api/suggestions.js';
import type {
  SuggestionDetail as SuggestionDetailType,
  SuggestionType,
  SuggestionVoteValue,
} from '../types.js';

const POLL_INTERVAL_MS = 10000;

const TYPE_LABELS: Record<SuggestionType, string> = {
  feature: 'Feature',
  bug: 'Bug',
};

export default function SuggestionDetail() {
  const { id } = useParams<{ id: string }>();
  const suggestionId = Number(id);
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [suggestion, setSuggestion] = useState<SuggestionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await suggestionsApi.getSuggestion(suggestionId);
      setSuggestion(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [suggestionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  async function handleVote(value: SuggestionVoteValue) {
    if (!suggestion) return;
    setSuggestion((prev) => {
      if (!prev) return prev;
      const nextVote = prev.user_vote === value ? 0 : value;
      return { ...prev, user_vote: nextVote, vote_count: prev.vote_count - prev.user_vote + nextVote };
    });
    try {
      const result = await suggestionsApi.castVote(suggestionId, value);
      setSuggestion((prev) =>
        prev ? { ...prev, user_vote: result.userVote, vote_count: result.voteCount } : prev
      );
    } catch {
      await load();
    }
  }

  async function handleComment(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmittingComment(true);
    setError(null);
    try {
      const updated = await suggestionsApi.addComment(suggestionId, commentBody.trim());
      setSuggestion(updated);
      setCommentBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleClose() {
    const ok = await confirm({
      title: 'Clôturer cette suggestion ?',
      message: 'Elle ne pourra plus recevoir de votes ou de commentaires.',
      confirmLabel: 'Clôturer',
      danger: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await suggestionsApi.closeSuggestion(suggestionId);
      setSuggestion(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: 'Supprimer cette suggestion',
      message: 'Cette suggestion, ses votes et ses commentaires seront définitivement supprimés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await suggestionsApi.deleteSuggestion(suggestionId);
      navigate('/suggestions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/suggestions" className="text-sm text-emerald-400 font-medium">
          ← Suggestions
        </Link>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="mt-4 text-zinc-500">Chargement…</p>
        ) : !suggestion ? (
          <p className="mt-4 text-zinc-500">Suggestion introuvable.</p>
        ) : (
          <>
            <div className="flex gap-3 mt-4">
              <VoteControl
                userVote={suggestion.user_vote}
                voteCount={suggestion.vote_count}
                canVote={!!user && suggestion.status === 'open'}
                onVote={handleVote}
                size="lg"
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
                      suggestion.type === 'feature'
                        ? 'bg-violet-500/15 text-violet-400'
                        : 'bg-orange-500/15 text-orange-400'
                    }`}
                  >
                    {TYPE_LABELS[suggestion.type]}
                  </span>
                  <span
                    className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${
                      suggestion.status === 'open'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {suggestion.status === 'open' ? 'Ouverte' : 'Clôturée'}
                  </span>
                </div>
                <h1 className="text-2xl font-bold text-zinc-50">{suggestion.title}</h1>
                {suggestion.author_username && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
                    proposé par
                    <Avatar
                      username={suggestion.author_username}
                      avatarUrl={suggestion.author_avatar_url}
                      size={18}
                      frameUrl={
                        suggestion.author_equipped_cosmetics.find((c) => c.slot === 'avatar_frame')
                          ?.image_url
                      }
                    />
                    <UserNameTag
                      username={suggestion.author_username}
                      equipped={suggestion.author_equipped_cosmetics}
                      className="text-sm text-zinc-300"
                    />
                  </p>
                )}
                {suggestion.description && (
                  <p className="mt-3 text-sm text-zinc-300 whitespace-pre-line">
                    {suggestion.description}
                  </p>
                )}
              </div>
            </div>

            {isAdmin && (
              <div className="flex gap-2 mt-4">
                {suggestion.status === 'open' && (
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={busy}
                    className="text-sm font-medium px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-50"
                  >
                    Clôturer
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="text-sm font-medium px-3 py-1.5 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition disabled:opacity-50"
                >
                  Supprimer
                </button>
              </div>
            )}

            <div className="mt-8">
              <h2 className="text-sm font-semibold text-zinc-300 mb-3">
                {suggestion.comments.length} commentaire{suggestion.comments.length !== 1 ? 's' : ''}
              </h2>

              {suggestion.status === 'open' && (
                <form onSubmit={handleComment} className="flex gap-2 mb-4">
                  <input
                    type="text"
                    placeholder="Ajouter un commentaire…"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={submittingComment || !commentBody.trim()}
                    className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition text-sm disabled:opacity-50"
                  >
                    Envoyer
                  </button>
                </form>
              )}

              <div className="space-y-3">
                {suggestion.comments.map((c) => (
                  <div
                    key={c.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex gap-2"
                  >
                    <Avatar
                      username={c.author_username ?? '?'}
                      avatarUrl={c.author_avatar_url}
                      size={28}
                      frameUrl={c.author_equipped_cosmetics.find((cos) => cos.slot === 'avatar_frame')?.image_url}
                    />
                    <div className="min-w-0 flex-1">
                      {c.author_username ? (
                        <UserNameTag
                          username={c.author_username}
                          equipped={c.author_equipped_cosmetics}
                          className="text-sm text-zinc-200"
                        />
                      ) : (
                        <p className="text-sm font-medium text-zinc-200">Joueur supprimé</p>
                      )}
                      <p className="text-sm text-zinc-300 whitespace-pre-line">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
