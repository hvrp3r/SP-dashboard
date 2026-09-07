import type { ProfileReactionValue } from '../types.js';

interface ProfileReactionsProps {
  likeCount: number;
  dislikeCount: number;
  userReaction: ProfileReactionValue | 0;
  /** Omis = affichage lecture seule (ex: son propre profil, réaction à soi-même impossible). */
  onReact?: (value: ProfileReactionValue) => void;
}

export default function ProfileReactions({
  likeCount,
  dislikeCount,
  userReaction,
  onReact,
}: ProfileReactionsProps) {
  const interactive = Boolean(onReact);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={interactive ? () => onReact!(1) : undefined}
        disabled={!interactive}
        aria-label="Like"
        aria-pressed={userReaction === 1}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold border transition ${
          userReaction === 1
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
            : 'bg-zinc-800 border-zinc-700 text-zinc-300'
        } ${interactive ? 'hover:border-emerald-500/40 hover:text-emerald-400 cursor-pointer' : 'cursor-default'}`}
      >
        <span aria-hidden="true">👍</span> {likeCount}
      </button>
      <button
        type="button"
        onClick={interactive ? () => onReact!(-1) : undefined}
        disabled={!interactive}
        aria-label="Dislike"
        aria-pressed={userReaction === -1}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold border transition ${
          userReaction === -1
            ? 'bg-red-500/15 border-red-500/40 text-red-400'
            : 'bg-zinc-800 border-zinc-700 text-zinc-300'
        } ${interactive ? 'hover:border-red-500/40 hover:text-red-400 cursor-pointer' : 'cursor-default'}`}
      >
        <span aria-hidden="true">👎</span> {dislikeCount}
      </button>
    </div>
  );
}
