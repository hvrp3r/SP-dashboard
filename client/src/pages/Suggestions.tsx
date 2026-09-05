import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import Avatar from '../components/Avatar.jsx';
import UserNameTag from '../components/UserNameTag.jsx';
import VoteControl from '../components/VoteControl.jsx';
import * as suggestionsApi from '../api/suggestions.js';
import type {
  Suggestion,
  SuggestionSort,
  SuggestionStatus,
  SuggestionType,
  SuggestionVoteValue,
} from '../types.js';

const TYPE_LABELS: Record<SuggestionType, string> = {
  feature: 'Feature',
  bug: 'Bug',
};

export default function Suggestions() {
  const { user } = useAuth();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SuggestionSort>('top');
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | undefined>('open');

  const [type, setType] = useState<SuggestionType>('feature');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await suggestionsApi.listSuggestions(statusFilter, sort);
      setSuggestions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sort]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await suggestionsApi.createSuggestion(type, title.trim(), description.trim() || undefined);
      setTitle('');
      setDescription('');
      setType('feature');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(id: number, value: SuggestionVoteValue) {
    // Optimistic update pour un feedback immédiat, resynchronisé par la réponse serveur.
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const nextVote = s.user_vote === value ? 0 : value;
        return { ...s, user_vote: nextVote, vote_count: s.vote_count - s.user_vote + nextVote };
      })
    );
    try {
      const result = await suggestionsApi.castVote(id, value);
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, user_vote: result.userVote, vote_count: result.voteCount } : s
        )
      );
    } catch {
      await load();
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-2">
          <h1 className="text-2xl font-bold text-zinc-50">Suggestions</h1>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition text-sm"
          >
            {showForm ? 'Annuler' : '+ Proposer'}
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {showForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
            <form onSubmit={handleCreate} className="space-y-2">
              <div className="flex gap-2">
                {(['feature', 'bug'] as SuggestionType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                      type === t
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-zinc-950 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {t === 'feature' ? '💡 Feature' : '🐛 Bug'}
                  </button>
                ))}
              </div>
              <input
                type="text"
                required
                maxLength={200}
                placeholder="Titre"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <textarea
                placeholder="Description (optionnel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Publier
              </button>
            </form>
          </div>
        )}

        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex gap-1">
            {(['top', 'new'] as SuggestionSort[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  sort === s
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
              >
                {s === 'top' ? 'Top' : 'Récents'}
              </button>
            ))}
          </div>
          <select
            value={statusFilter ?? 'all'}
            onChange={(e) =>
              setStatusFilter(e.target.value === 'all' ? undefined : (e.target.value as SuggestionStatus))
            }
            className="rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="open">Ouvertes</option>
            <option value="closed">Clôturées</option>
            <option value="all">Toutes</option>
          </select>
        </div>

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-zinc-500">Aucune suggestion pour le moment.</p>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onVote={(value) => handleVote(s.id, value)}
                canVote={!!user && s.status === 'open'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion: s,
  onVote,
  canVote,
}: {
  suggestion: Suggestion;
  onVote: (value: SuggestionVoteValue) => void;
  canVote: boolean;
}) {
  return (
    <div className="flex gap-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 hover:border-emerald-500/50 transition">
      <VoteControl userVote={s.user_vote} voteCount={s.vote_count} canVote={canVote} onVote={onVote} />

      <Link to={`/suggestions/${s.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
              s.type === 'feature'
                ? 'bg-violet-500/15 text-violet-400'
                : 'bg-orange-500/15 text-orange-400'
            }`}
          >
            {TYPE_LABELS[s.type]}
          </span>
          <span
            className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${
              s.status === 'open'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {s.status === 'open' ? 'Ouverte' : 'Clôturée'}
          </span>
          <p className="font-medium text-zinc-100 truncate">{s.title}</p>
        </div>
        {s.description && (
          <p className="text-sm text-zinc-500 line-clamp-2 mb-2">{s.description}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {s.author_username && (
            <span className="flex items-center gap-1.5">
              <Avatar
                username={s.author_username}
                avatarUrl={s.author_avatar_url}
                size={16}
                frameUrl={
                  s.author_equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url
                }
              />
              <UserNameTag
                username={s.author_username}
                equipped={s.author_equipped_cosmetics}
                className="text-xs"
              />
            </span>
          )}
          <span>· {s.comment_count} commentaire{s.comment_count !== 1 ? 's' : ''}</span>
        </div>
      </Link>
    </div>
  );
}
