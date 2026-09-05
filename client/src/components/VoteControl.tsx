import type { SuggestionVoteValue } from '../types.js';

interface VoteControlProps {
  userVote: SuggestionVoteValue | 0;
  voteCount: number;
  canVote: boolean;
  onVote: (value: SuggestionVoteValue) => void;
  size?: 'sm' | 'lg';
}

export default function VoteControl({
  userVote,
  voteCount,
  canVote,
  onVote,
  size = 'sm',
}: VoteControlProps) {
  const width = size === 'lg' ? 'w-14' : 'w-12';
  const padding = size === 'lg' ? 'py-3' : 'py-2';
  const arrowSize = size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <div
      className={`flex-shrink-0 ${width} h-fit flex flex-col items-center gap-1 rounded-md ${padding} bg-zinc-950 border border-zinc-800`}
    >
      <button
        type="button"
        onClick={() => onVote(1)}
        disabled={!canVote}
        aria-label="Upvote"
        className={`leading-none transition ${arrowSize} ${
          userVote === 1 ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-200'
        }`}
      >
        ▲
      </button>
      <span
        className={`text-sm font-semibold ${
          userVote === 1 ? 'text-emerald-400' : userVote === -1 ? 'text-red-400' : 'text-zinc-300'
        }`}
      >
        {voteCount}
      </span>
      <button
        type="button"
        onClick={() => onVote(-1)}
        disabled={!canVote}
        aria-label="Downvote"
        className={`leading-none transition ${arrowSize} ${
          userVote === -1 ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-200'
        }`}
      >
        ▼
      </button>
    </div>
  );
}
